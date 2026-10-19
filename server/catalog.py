"""SQLite catalogs (.opiacat): open/create/switch, backup, optimise, and all library data edits."""
import datetime
import json
import os
import shutil
import sqlite3
import threading
import zipfile

from . import core
from .core import api, cfg, ApiError

EXT, DATA = '.opiacat', '.opiadata'
OLD_EXTS, OLD_DATAS = ('.lrcat',), ('.lrdata',)      # what catalogs and preview folders were called before
CAT_EXTS, DATA_EXTS = (EXT,) + OLD_EXTS, (DATA,) + OLD_DATAS


def migrate(path):
    """A catalog still saved under an earlier extension is renamed in place, with its preview folders.
    Returns the path to open: the new name, or the old one if something still has the files open."""
    old = next((e for e in OLD_EXTS if path.lower().endswith(e)), None)
    if not old:
        return path
    stem = path[:-len(old)]
    new = stem + EXT
    if not os.path.exists(path) or os.path.exists(new):
        return new if os.path.exists(new) else path
    try:
        os.rename(path, new)
    except OSError:
        return path
    pairs = [(path + s, new + s) for s in ('-wal', '-shm')]
    pairs += [(stem + k + d, stem + k + DATA) for k in (' Previews', ' Smart Previews') for d in OLD_DATAS]
    for a, b in pairs:
        try:
            if os.path.exists(a) and not os.path.exists(b):
                os.rename(a, b)
        except OSError:
            pass
    return new

SCHEMA = '''
CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS photos(
 id INTEGER PRIMARY KEY AUTOINCREMENT, path TEXT NOT NULL, master_id INTEGER, copy_name TEXT DEFAULT '',
 width INTEGER, height INTEGER, orient INTEGER DEFAULT 0, filesize INTEGER, format TEXT,
 capture_time REAL, import_time REAL, import_batch INTEGER,
 rating INTEGER DEFAULT 0, flag INTEGER DEFAULT 0, label TEXT DEFAULT '',
 title TEXT DEFAULT '', caption TEXT DEFAULT '', exif TEXT, iptc TEXT, lat REAL, lon REAL,
 develop TEXT, stack_id INTEGER, stack_pos INTEGER DEFAULT 0, smart INTEGER DEFAULT 0, ver INTEGER DEFAULT 0);
CREATE INDEX IF NOT EXISTS photos_path ON photos(path);
CREATE TABLE IF NOT EXISTS keywords(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, parent_id INTEGER,
 synonyms TEXT DEFAULT '', export INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS photo_keywords(photo_id INTEGER, keyword_id INTEGER, PRIMARY KEY(photo_id, keyword_id));
CREATE TABLE IF NOT EXISTS collections(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, parent_id INTEGER,
 type TEXT, rules TEXT);
CREATE TABLE IF NOT EXISTS collection_photos(collection_id INTEGER, photo_id INTEGER, pos INTEGER DEFAULT 0,
 PRIMARY KEY(collection_id, photo_id));
CREATE TABLE IF NOT EXISTS history(id INTEGER PRIMARY KEY AUTOINCREMENT, photo_id INTEGER, time REAL, label TEXT, develop TEXT);
CREATE INDEX IF NOT EXISTS history_photo ON history(photo_id);
CREATE TABLE IF NOT EXISTS snapshots(id INTEGER PRIMARY KEY AUTOINCREMENT, photo_id INTEGER, name TEXT, time REAL, develop TEXT);
CREATE TABLE IF NOT EXISTS people(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT);
CREATE TABLE IF NOT EXISTS faces(id INTEGER PRIMARY KEY AUTOINCREMENT, photo_id INTEGER, x REAL, y REAL, w REAL, h REAL,
 feat BLOB, person_id INTEGER, cluster INTEGER);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT);
'''

PHOTO_FIELDS = ('rating', 'flag', 'label', 'title', 'caption', 'lat', 'lon', 'orient', 'copy_name', 'stack_id', 'stack_pos')


class Catalog:
    def __init__(self, path):
        self.path = os.path.abspath(path)
        self.dir = os.path.dirname(self.path)
        self.name = os.path.splitext(os.path.basename(self.path))[0]
        self.previews = os.path.join(self.dir, self.name + ' Previews' + DATA)
        self.smart = os.path.join(self.dir, self.name + ' Smart Previews' + DATA)
        self.backups = os.path.join(self.dir, 'Backups')
        for d in (self.previews, self.smart):
            os.makedirs(d, exist_ok=True)
        self.lock = threading.RLock()
        self.db = sqlite3.connect(self.path, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        with self.lock:
            self.db.executescript(SCHEMA)
            self.db.execute('PRAGMA journal_mode=WAL')
            self.db.commit()

    def q(self, sql, args=()):
        with self.lock:
            return [dict(r) for r in self.db.execute(sql, args).fetchall()]

    def one(self, sql, args=()):
        rows = self.q(sql, args)
        return rows[0] if rows else None

    def x(self, sql, args=()):
        with self.lock:
            cur = self.db.execute(sql, args)
            self.db.commit()
            return cur.lastrowid

    def xm(self, sql, seq):
        with self.lock:
            self.db.executemany(sql, seq)
            self.db.commit()

    def get(self, key, default=None):
        r = self.one('SELECT value FROM settings WHERE key=?', (key,))
        return json.loads(r['value']) if r else default

    def set(self, key, value):
        self.x('INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)', (key, json.dumps(value)))

    def meta(self, key, default=None):
        r = self.one('SELECT value FROM meta WHERE key=?', (key,))
        return r['value'] if r else default

    def set_meta(self, key, value):
        self.x('INSERT OR REPLACE INTO meta(key,value) VALUES(?,?)', (key, str(value)))

    def photo(self, pid):
        r = self.one('SELECT * FROM photos WHERE id=?', (pid,))
        if not r:
            raise ApiError('Photo %s is not in the catalog' % pid)
        return r

    def close(self):
        with self.lock:
            try:
                self.db.execute('PRAGMA optimize')
                self.db.commit()
                self.db.close()
            except sqlite3.Error:
                pass

    def info(self):
        size = os.path.getsize(self.path) if os.path.exists(self.path) else 0
        return {'path': self.path, 'dir': self.dir, 'name': self.name, 'size': size,
                'count': self.one('SELECT COUNT(*) n FROM photos')['n'],
                'last_backup': float(self.meta('last_backup', 0) or 0),
                'last_optimize': float(self.meta('last_optimize', 0) or 0)}


def photo_out(r, kw=None):
    """DB row -> the dict the UI works with."""
    w, h = r['width'] or 0, r['height'] or 0
    if (r['orient'] or 0) & 1:
        w, h = h, w
    return {
        'id': r['id'], 'path': r['path'], 'filename': os.path.basename(r['path']),
        'folder': os.path.dirname(r['path']), 'master_id': r['master_id'], 'copy_name': r['copy_name'] or '',
        'w': w, 'h': h, 'orient': r['orient'] or 0, 'filesize': r['filesize'] or 0,
        'format': r['format'] or '', 'capture_time': r['capture_time'] or 0, 'import_time': r['import_time'] or 0,
        'import_batch': r['import_batch'] or 0, 'rating': r['rating'] or 0, 'flag': r['flag'] or 0,
        'label': r['label'] or '', 'title': r['title'] or '', 'caption': r['caption'] or '',
        'exif': json.loads(r['exif']) if r['exif'] else {}, 'iptc': json.loads(r['iptc']) if r['iptc'] else {},
        'gps': [r['lat'], r['lon']] if r['lat'] is not None and r['lon'] is not None else None,
        'develop': json.loads(r['develop']) if r['develop'] else None,
        'stack_id': r['stack_id'], 'stack_pos': r['stack_pos'] or 0, 'smart': r['smart'] or 0, 'ver': r['ver'] or 0,
        'keywords': kw or [], 'missing': not os.path.exists(r['path']),
    }


def photos_out(cat, ids=None):
    if ids is None:
        rows = cat.q('SELECT * FROM photos')
        kws = cat.q('SELECT photo_id, keyword_id FROM photo_keywords')
    else:
        marks = ','.join('?' * len(ids))
        rows = cat.q('SELECT * FROM photos WHERE id IN (%s)' % marks, ids)
        kws = cat.q('SELECT photo_id, keyword_id FROM photo_keywords WHERE photo_id IN (%s)' % marks, ids)
    by = {}
    for k in kws:
        by.setdefault(k['photo_id'], []).append(k['keyword_id'])
    return [photo_out(r, by.get(r['id'])) for r in rows]


# ---------------------------------------------------------------- catalog management

def default_catalog_path():
    return os.path.join(core.HOME, 'Opia Catalog', 'Opia Catalog' + EXT)


def open_catalog(path):
    path = migrate(os.path.abspath(path))
    if not path.lower().endswith(CAT_EXTS):
        raise ApiError('Catalog files must end in ' + EXT)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    old = core.state['cat']
    new = Catalog(path)
    core.state['cat'] = new
    if old:
        old.close()
    recent = [p for p in cfg.get('recent_catalogs', []) if p != path and os.path.exists(p)]
    cfg.set('recent_catalogs', [path] + recent[:11])
    return new


def open_startup():
    recent = [p for p in map(migrate, cfg.get('recent_catalogs', [])) if os.path.exists(p)]
    return open_catalog(recent[0] if recent else default_catalog_path())


@api
def catalog_list():
    seen, out = set(), []
    paths = list(cfg.get('recent_catalogs', []))
    if os.path.isdir(core.HOME):
        for root, dirs, files in os.walk(core.HOME):
            dirs[:] = [d for d in dirs if not d.lower().endswith(DATA_EXTS) and d != 'Backups'][:50]
            paths += [os.path.join(root, f) for f in files if f.lower().endswith(CAT_EXTS)]
            if root.count(os.sep) - core.HOME.count(os.sep) >= 2:
                dirs[:] = []
    cur = core.state['cat']
    for p in paths:
        p = os.path.abspath(p)
        if p in seen or not os.path.exists(p):
            continue
        seen.add(p)
        st = os.stat(p)
        out.append({'path': p, 'name': os.path.splitext(os.path.basename(p))[0], 'size': st.st_size,
                    'mtime': st.st_mtime, 'current': bool(cur and cur.path == p)})
    return out


@api
def catalog_create(name, dir=None):
    name = ''.join(ch for ch in name if ch not in '\\/:*?"<>|').strip()
    if not name:
        raise ApiError('Give the catalog a name')
    base = os.path.join(dir or core.HOME, name)
    path = os.path.join(base, name + EXT)
    if os.path.exists(path):
        raise ApiError('A catalog with that name already exists there')
    return open_catalog(path).info()


@api
def catalog_open(path):
    if not os.path.exists(path):
        raise ApiError('Catalog not found: ' + path)
    return open_catalog(path).info()


@api
def catalog_info():
    return core.cat().info()


@api
def catalog_backup(dest=None, test=True):
    cat = core.cat()
    stamp = datetime.datetime.now().strftime('%Y-%m-%d %H%M%S')
    folder = os.path.join(dest or cfg.get('backup_dir') or cat.backups, stamp)
    os.makedirs(folder, exist_ok=True)
    tmp = os.path.join(folder, cat.name + EXT)
    with cat.lock:
        if test:
            res = cat.db.execute('PRAGMA integrity_check').fetchone()[0]
            if res != 'ok':
                raise ApiError('Catalog failed its integrity check: ' + res)
        out = sqlite3.connect(tmp)
        cat.db.backup(out)
        out.close()
    zpath = tmp + '.zip'
    with zipfile.ZipFile(zpath, 'w', zipfile.ZIP_DEFLATED) as z:
        z.write(tmp, os.path.basename(tmp))
    os.remove(tmp)
    cat.set_meta('last_backup', core.now())
    return {'path': zpath, 'size': os.path.getsize(zpath)}


@api
def catalog_backups():
    cat = core.cat()
    out = []
    for base in {cat.backups, cfg.get('backup_dir') or cat.backups}:
        if not os.path.isdir(base):
            continue
        for root, _dirs, files in os.walk(base):
            for f in files:
                if f.lower().endswith(tuple(e + '.zip' for e in CAT_EXTS)):
                    p = os.path.join(root, f)
                    out.append({'path': p, 'name': os.path.basename(root), 'size': os.path.getsize(p),
                                'mtime': os.path.getmtime(p)})
    return sorted(out, key=lambda b: -b['mtime'])


@api
def catalog_restore(path):
    """Unpack a backup next to the live catalog as a new catalog and open it."""
    cat = core.cat()
    stamp = os.path.basename(os.path.dirname(path)).replace(':', '')
    name = '%s (restored %s)' % (cat.name, stamp)
    folder = os.path.join(os.path.dirname(cat.dir), name)
    os.makedirs(folder, exist_ok=True)
    with zipfile.ZipFile(path) as z:
        member = [m for m in z.namelist() if m.lower().endswith(CAT_EXTS)][0]
        target = os.path.join(folder, name + EXT)
        with z.open(member) as src, open(target, 'wb') as dst:
            shutil.copyfileobj(src, dst)
    return open_catalog(target).info()


@api
def catalog_optimize():
    cat = core.cat()
    before = os.path.getsize(cat.path)
    with cat.lock:
        check = cat.db.execute('PRAGMA integrity_check').fetchone()[0]
        for table, col in (('photo_keywords', 'photo_id'), ('collection_photos', 'photo_id'), ('faces', 'photo_id'),
                           ('history', 'photo_id'), ('snapshots', 'photo_id')):
            cat.db.execute('DELETE FROM %s WHERE %s NOT IN (SELECT id FROM photos)' % (table, col))
        cat.db.execute('DELETE FROM photo_keywords WHERE keyword_id NOT IN (SELECT id FROM keywords)')
        cat.db.execute('DELETE FROM photos WHERE master_id IS NOT NULL AND master_id NOT IN (SELECT id FROM photos)')
        cat.db.commit()
        cat.db.execute('PRAGMA wal_checkpoint(TRUNCATE)')
        cat.db.execute('VACUUM')
        cat.db.execute('ANALYZE')
        cat.db.commit()
        ids = {str(r[0]) for r in cat.db.execute('SELECT id FROM photos')}
    purged = 0
    for base in (cat.previews, cat.smart):
        for root, _dirs, files in os.walk(base):
            for f in files:
                stem = os.path.splitext(f)[0].split('_')[0]
                if stem.isdigit() and stem not in ids and os.path.basename(root) != 'f':
                    os.remove(os.path.join(root, f))
                    purged += 1
    cat.set_meta('last_optimize', core.now())
    return {'integrity': check, 'before': before, 'after': os.path.getsize(cat.path), 'purged': purged}


@api
def catalog_load():
    cat = core.cat()
    cp = {}
    for r in cat.q('SELECT collection_id, photo_id FROM collection_photos ORDER BY pos'):
        cp.setdefault(r['collection_id'], []).append(r['photo_id'])
    cols = cat.q('SELECT * FROM collections')
    for c in cols:
        c['rules'] = json.loads(c['rules']) if c['rules'] else None
    return {
        'info': cat.info(), 'photos': photos_out(cat), 'keywords': cat.q('SELECT * FROM keywords'),
        'collections': cols, 'collection_photos': cp, 'people': cat.q('SELECT * FROM people'),
        'faces': cat.q('SELECT id, photo_id, x, y, w, h, person_id, cluster FROM faces'),
        'settings': {r['key']: json.loads(r['value']) for r in cat.q('SELECT * FROM settings')},
        'last_batch': int(cat.meta('import_batch', 0) or 0),
    }


@api
def kv_set(scope, key, value):
    if scope == 'app':
        cfg.set(key, value)
    else:
        core.cat().set(key, value)
    return True


# ---------------------------------------------------------------- photos

@api
def photos_get(ids):
    return photos_out(core.cat(), ids)


@api
def photos_update(ids, fields):
    cat = core.cat()
    sets, args = [], []
    for k, v in fields.items():
        if k in PHOTO_FIELDS:
            sets.append(k + '=?')
            args.append(v)
        elif k == 'gps':
            sets.append('lat=?, lon=?')
            args += [v[0], v[1]] if v else [None, None]
        elif k == 'develop':
            sets.append('develop=?, ver=ver+1')
            args.append(json.dumps(v) if v else None)
    with cat.lock:
        if sets:
            cat.db.executemany('UPDATE photos SET %s WHERE id=?' % ', '.join(sets), [args + [i] for i in ids])
        if 'iptc' in fields:
            for i in ids:
                cur = json.loads(cat.db.execute('SELECT iptc FROM photos WHERE id=?', (i,)).fetchone()[0] or '{}')
                cur.update(fields['iptc'])
                cur = {k: v for k, v in cur.items() if v not in ('', None)}
                cat.db.execute('UPDATE photos SET iptc=? WHERE id=?', (json.dumps(cur), i))
        cat.db.commit()
    if cfg.get('prefs', {}).get('autoXmp'):
        from . import xmp
        xmp.write_sidecars(ids)
    return True


@api
def photos_develop(items):
    """Save differing develop settings for many photos in one go: [{id, develop}]."""
    cat = core.cat()
    cat.xm('UPDATE photos SET develop=?, ver=ver+1 WHERE id=?',
           [(json.dumps(i['develop']) if i['develop'] else None, i['id']) for i in items])
    if cfg.get('prefs', {}).get('autoXmp'):
        from . import xmp
        xmp.write_sidecars([i['id'] for i in items])
    return True


@api
def photos_remove(ids, delete_files=False):
    cat = core.cat()
    marks = ','.join('?' * len(ids))
    rows = cat.q('SELECT id, path, master_id FROM photos WHERE id IN (%s) OR master_id IN (%s)' % (marks, marks), ids + ids)
    gone = [r['id'] for r in rows]
    trashed = 0
    if delete_files:
        from . import files
        for p in {r['path'] for r in rows if not r['master_id']}:
            trashed += files.recycle(p)
            side = os.path.splitext(p)[0] + '.xmp'
            if os.path.exists(side):
                files.recycle(side)
    m2 = ','.join('?' * len(gone))
    with cat.lock:
        for t, c in (('photos', 'id'), ('photo_keywords', 'photo_id'), ('collection_photos', 'photo_id'),
                     ('faces', 'photo_id'), ('history', 'photo_id'), ('snapshots', 'photo_id')):
            cat.db.execute('DELETE FROM %s WHERE %s IN (%s)' % (t, c, m2), gone)
        cat.db.commit()
    return {'removed': gone, 'trashed': trashed}


@api
def photos_virtual_copy(ids):
    cat = core.cat()
    new = []
    for i in ids:
        r = cat.photo(i)
        master = r['master_id'] or r['id']
        n = cat.one('SELECT COUNT(*) n FROM photos WHERE master_id=?', (master,))['n'] + 1
        cols = [c for c in r.keys() if c not in ('id', 'master_id', 'copy_name', 'ver')]
        nid = cat.x('INSERT INTO photos(%s, master_id, copy_name) VALUES(%s,?,?)' % (','.join(cols), ','.join('?' * len(cols))),
                    [r[c] for c in cols] + [master, 'Copy %d' % n])
        cat.xm('INSERT OR IGNORE INTO photo_keywords(photo_id, keyword_id) VALUES(?,?)',
               [(nid, k['keyword_id']) for k in cat.q('SELECT keyword_id FROM photo_keywords WHERE photo_id=?', (i,))])
        new.append(nid)
    return photos_out(cat, new)


@api
def photos_stack(ids):
    """Group photos into one stack; the first id becomes the top."""
    cat = core.cat()
    sid = ids[0]
    cat.xm('UPDATE photos SET stack_id=?, stack_pos=? WHERE id=?', [(sid, n, i) for n, i in enumerate(ids)])
    return sid


@api
def photos_unstack(ids):
    cat = core.cat()
    marks = ','.join('?' * len(ids))
    sids = [r['stack_id'] for r in cat.q('SELECT DISTINCT stack_id FROM photos WHERE id IN (%s) AND stack_id IS NOT NULL' % marks, ids)]
    if sids:
        cat.x('UPDATE photos SET stack_id=NULL, stack_pos=0 WHERE stack_id IN (%s)' % ','.join('?' * len(sids)), sids)
    return sids


# ---------------------------------------------------------------- keywords

def keyword_path(cat, kid, cache=None):
    cache = cache if cache is not None else {k['id']: k for k in cat.q('SELECT * FROM keywords')}
    parts = []
    while kid in cache and len(parts) < 20:
        parts.append(cache[kid]['name'])
        kid = cache[kid]['parent_id']
    return list(reversed(parts))


def keyword_ensure(cat, path):
    """Find or create a keyword from 'Parent > Child' (or 'Parent|Child') text; returns its id."""
    parts = [p.strip() for p in path.replace('|', '>').split('>') if p.strip()]
    parent = None
    for name in parts:
        r = cat.one('SELECT id FROM keywords WHERE name=? COLLATE NOCASE AND parent_id IS ?', (name, parent))
        if not r and parent is None and len(parts) == 1:
            r = cat.one('SELECT id FROM keywords WHERE name=? COLLATE NOCASE', (name,))
        parent = r['id'] if r else cat.x('INSERT INTO keywords(name, parent_id) VALUES(?,?)', (name, parent))
    return parent


@api
def keywords_list():
    return core.cat().q('SELECT * FROM keywords')


@api
def keyword_create(name, parent_id=None, synonyms='', export=1):
    cat = core.cat()
    if parent_id is None and ('>' in name or '|' in name):
        kid = keyword_ensure(cat, name)
    else:
        kid = cat.x('INSERT INTO keywords(name, parent_id, synonyms, export) VALUES(?,?,?,?)',
                    (name.strip(), parent_id, synonyms, export))
    return cat.q('SELECT * FROM keywords')


@api
def keyword_update(id, fields):
    cat = core.cat()
    if 'parent_id' in fields:  # refuse to make a keyword its own ancestor
        p = fields['parent_id']
        while p is not None:
            if p == id:
                raise ApiError('A keyword cannot be moved inside itself')
            row = cat.one('SELECT parent_id FROM keywords WHERE id=?', (p,))
            p = row['parent_id'] if row else None
    for k in ('name', 'parent_id', 'synonyms', 'export'):
        if k in fields:
            cat.x('UPDATE keywords SET %s=? WHERE id=?' % k, (fields[k], id))
    return cat.q('SELECT * FROM keywords')


@api
def keyword_delete(id):
    cat = core.cat()
    ids, frontier = [id], [id]
    while frontier:
        kids = [r['id'] for r in cat.q('SELECT id FROM keywords WHERE parent_id IN (%s)' % ','.join('?' * len(frontier)), frontier)]
        ids += kids
        frontier = kids
    marks = ','.join('?' * len(ids))
    cat.x('DELETE FROM keywords WHERE id IN (%s)' % marks, ids)
    cat.x('DELETE FROM photo_keywords WHERE keyword_id IN (%s)' % marks, ids)
    return ids


@api
def keywords_assign(photo_ids, keywords, remove=False):
    """keywords may be ids or names/paths ('Nature > Birds'); names are created on demand."""
    cat = core.cat()
    kids = [k if isinstance(k, int) else keyword_ensure(cat, k) for k in keywords]
    kids = [k for k in kids if k]
    pairs = [(p, k) for p in photo_ids for k in kids]
    if remove:
        cat.xm('DELETE FROM photo_keywords WHERE photo_id=? AND keyword_id=?', pairs)
    else:
        cat.xm('INSERT OR IGNORE INTO photo_keywords(photo_id, keyword_id) VALUES(?,?)', pairs)
    return {'keywords': cat.q('SELECT * FROM keywords'), 'ids': kids}


@api
def keywords_set(photo_ids, keywords):
    """Replace the keyword list of the given photos."""
    cat = core.cat()
    kids = [k if isinstance(k, int) else keyword_ensure(cat, k) for k in keywords]
    cat.x('DELETE FROM photo_keywords WHERE photo_id IN (%s)' % ','.join('?' * len(photo_ids)), photo_ids)
    cat.xm('INSERT OR IGNORE INTO photo_keywords(photo_id, keyword_id) VALUES(?,?)', [(p, k) for p in photo_ids for k in kids if k])
    return {'keywords': cat.q('SELECT * FROM keywords'), 'ids': kids}


# ---------------------------------------------------------------- collections

@api
def collection_create(name, type='collection', parent_id=None, rules=None, photo_ids=None):
    cat = core.cat()
    cid = cat.x('INSERT INTO collections(name, parent_id, type, rules) VALUES(?,?,?,?)',
                (name, parent_id, type, json.dumps(rules) if rules else None))
    if photo_ids:
        collection_add(cid, photo_ids)
    return cid


@api
def collection_update(id, fields):
    cat = core.cat()
    for k in ('name', 'parent_id'):
        if k in fields:
            cat.x('UPDATE collections SET %s=? WHERE id=?' % k, (fields[k], id))
    if 'rules' in fields:
        cat.x('UPDATE collections SET rules=? WHERE id=?', (json.dumps(fields['rules']), id))
    return True


@api
def collection_delete(id):
    cat = core.cat()
    ids, frontier = [id], [id]
    while frontier:
        kids = [r['id'] for r in cat.q('SELECT id FROM collections WHERE parent_id IN (%s)' % ','.join('?' * len(frontier)), frontier)]
        ids += kids
        frontier = kids
    marks = ','.join('?' * len(ids))
    cat.x('DELETE FROM collections WHERE id IN (%s)' % marks, ids)
    cat.x('DELETE FROM collection_photos WHERE collection_id IN (%s)' % marks, ids)
    return ids


@api
def collection_add(id, photo_ids):
    cat = core.cat()
    base = cat.one('SELECT COALESCE(MAX(pos),0) m FROM collection_photos WHERE collection_id=?', (id,))['m']
    cat.xm('INSERT OR IGNORE INTO collection_photos(collection_id, photo_id, pos) VALUES(?,?,?)',
           [(id, p, base + n + 1) for n, p in enumerate(photo_ids)])
    return True


@api
def collection_remove(id, photo_ids):
    core.cat().xm('DELETE FROM collection_photos WHERE collection_id=? AND photo_id=?', [(id, p) for p in photo_ids])
    return True


@api
def collection_order(id, photo_ids):
    core.cat().xm('UPDATE collection_photos SET pos=? WHERE collection_id=? AND photo_id=?',
                  [(n, id, p) for n, p in enumerate(photo_ids)])
    return True


# ---------------------------------------------------------------- history & snapshots

@api
def history_list(photo_id):
    cat = core.cat()
    rows = cat.q('SELECT id, time, label, develop FROM history WHERE photo_id=? ORDER BY id DESC LIMIT 300', (photo_id,))
    snaps = cat.q('SELECT id, name, time, develop FROM snapshots WHERE photo_id=? ORDER BY name', (photo_id,))
    for r in rows + snaps:
        r['develop'] = json.loads(r['develop']) if r['develop'] else None
    return {'history': rows, 'snapshots': snaps}


@api
def history_add(photo_id, label, develop):
    cat = core.cat()
    hid = cat.x('INSERT INTO history(photo_id, time, label, develop) VALUES(?,?,?,?)',
                (photo_id, core.now(), label, json.dumps(develop) if develop else None))
    return hid


@api
def history_clear(photo_id, above=None):
    cat = core.cat()
    if above is None:
        cat.x('DELETE FROM history WHERE photo_id=?', (photo_id,))
    else:
        cat.x('DELETE FROM history WHERE photo_id=? AND id>?', (photo_id, above))
    return True


@api
def snapshot_add(photo_id, name, develop):
    return core.cat().x('INSERT INTO snapshots(photo_id, name, time, develop) VALUES(?,?,?,?)',
                        (photo_id, name, core.now(), json.dumps(develop) if develop else None))


@api
def snapshot_update(id, fields):
    cat = core.cat()
    if 'name' in fields:
        cat.x('UPDATE snapshots SET name=? WHERE id=?', (fields['name'], id))
    if 'develop' in fields:
        cat.x('UPDATE snapshots SET develop=?, time=? WHERE id=?', (json.dumps(fields['develop']), core.now(), id))
    return True


@api
def snapshot_delete(id):
    core.cat().x('DELETE FROM snapshots WHERE id=?', (id,))
    return True

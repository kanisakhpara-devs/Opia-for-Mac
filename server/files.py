"""Local disk: folder browsing, import, renaming templates, recycle bin, external programs, DNG conversion."""
import ctypes
import datetime
import json
import os
import re
import shutil
import string
import subprocess
import sys
import webbrowser

from . import core, imaging, xmp
from .catalog import keyword_ensure, photos_out
from .core import api, cfg, ApiError

ILLEGAL = re.compile(r'[\\/:*?"<>|\x00-\x1f]')


def recycle(path):
    """Send a file to the Trash (the Recycle Bin on Windows; never a hard delete). Returns 1 on success."""
    if not os.path.exists(path):
        return 0
    if sys.platform == 'darwin':
        try:
            from Foundation import NSFileManager, NSURL     # pyobjc, which pywebview brings along on a Mac
        except ImportError:
            return 0
        ok, _, _ = NSFileManager.defaultManager().trashItemAtURL_resultingItemURL_error_(NSURL.fileURLWithPath_(os.path.abspath(path)), None, None)
        return 1 if ok else 0
    if sys.platform != 'win32':
        return 0

    class SHFILEOPSTRUCTW(ctypes.Structure):
        _fields_ = [('hwnd', ctypes.c_void_p), ('wFunc', ctypes.c_uint), ('pFrom', ctypes.c_wchar_p),
                    ('pTo', ctypes.c_wchar_p), ('fFlags', ctypes.c_ushort), ('fAnyOperationsAborted', ctypes.c_int),
                    ('hNameMappings', ctypes.c_void_p), ('lpszProgressTitle', ctypes.c_wchar_p)]
    buf = ctypes.create_unicode_buffer(os.path.abspath(path) + '\0')
    op = SHFILEOPSTRUCTW(None, 3, ctypes.cast(buf, ctypes.c_wchar_p), None, 0x40 | 0x10 | 0x4 | 0x400, 0, None, None)
    return 1 if ctypes.windll.shell32.SHFileOperationW(ctypes.byref(op)) == 0 else 0


def unique_path(path):
    if not os.path.exists(path):
        return path
    base, ext = os.path.splitext(path)
    n = 2
    while os.path.exists('%s-%d%s' % (base, n, ext)):
        n += 1
    return '%s-%d%s' % (base, n, ext)


def template_context(row):
    """Values a naming template can use, from a DB row or an import-time meta dict."""
    exif = row.get('exif') or {}
    if isinstance(exif, str):
        exif = json.loads(exif or '{}')
    path = row.get('path', '')
    return {'name': os.path.splitext(os.path.basename(path))[0], 'folder': os.path.basename(os.path.dirname(path)),
            'time': row.get('capture_time') or 0, 'camera': exif.get('model', ''), 'make': exif.get('make', ''),
            'lens': exif.get('lens', ''), 'iso': exif.get('iso', ''), 'focal': exif.get('focal', ''),
            'aperture': exif.get('aperture', ''), 'rating': row.get('rating') or 0, 'label': row.get('label') or '',
            'title': row.get('title') or '', 'width': row.get('width') or 0, 'height': row.get('height') or 0,
            'copy': row.get('copy_name') or ''}


def apply_template(tpl, ctx, seq=1, custom='', total=1):
    """Expand {tokens}: name custom seq[:digits] date[:strftime] time year month day hour minute second
    camera make lens iso focal aperture rating label title folder width height copy total."""
    dt = datetime.datetime.fromtimestamp(ctx.get('time') or 0)
    simple = {'year': '%Y', 'month': '%m', 'day': '%d', 'hour': '%H', 'minute': '%M', 'second': '%S', 'time': '%H%M%S',
              'yy': '%y', 'monthname': '%b'}

    def rep(m):
        key, arg = m.group(1).lower(), m.group(2)
        if key == 'seq':
            width = len(arg) if arg and not arg.isdigit() else int(arg or 1)
            return str(seq).zfill(width)
        if key == 'date':
            return dt.strftime(arg or '%Y%m%d')
        if key in simple:
            return dt.strftime(simple[key])
        if key == 'custom':
            return custom
        if key == 'total':
            return str(total)
        if key in ('name', 'original', 'filename'):
            return ctx['name']
        v = ctx.get(key, '')
        if isinstance(v, float) and v == int(v):
            v = int(v)
        return str(v)
    out = re.sub(r'\{([A-Za-z0-9_]+)(?::([^}]*))?\}', rep, tpl or '{name}')
    out = ILLEGAL.sub('_', out).strip(' .')
    return out or ctx['name']


# ---------------------------------------------------------------- browsing

@api
def fs_list(path=None, images=True):
    if not path:
        home = os.path.expanduser('~')
        places = [{'name': n, 'path': os.path.join(home, n)} for n in ('Pictures', 'Desktop', 'Downloads', 'Documents')
                  if os.path.isdir(os.path.join(home, n))]
        drives = []
        if sys.platform == 'win32':
            mask = ctypes.windll.kernel32.GetLogicalDrives()
            kinds = {2: 'Removable', 3: 'Local Disk', 4: 'Network', 5: 'CD/DVD', 6: 'RAM Disk'}
            for i, letter in enumerate(string.ascii_uppercase):
                if mask >> i & 1:
                    root = letter + ':\\'
                    kind = kinds.get(ctypes.windll.kernel32.GetDriveTypeW(root), 'Drive')
                    drives.append({'name': '%s (%s)' % (kind, letter + ':'), 'path': root, 'kind': kind})
        elif sys.platform == 'darwin':
            # the startup disk, then every other disk, card and network share, which macOS mounts under /Volumes
            drives.append({'name': 'Macintosh HD', 'path': '/', 'kind': 'Local Disk'})
            try:
                with os.scandir('/Volumes') as it:
                    for e in sorted(it, key=lambda e: e.name.lower()):
                        if e.name.startswith('.') or os.path.realpath(e.path) == '/':
                            continue
                        drives.append({'name': e.name, 'path': e.path, 'kind': 'Removable' if os.path.ismount(e.path) else 'Drive'})
            except OSError:
                pass
        else:
            drives.append({'name': '/', 'path': '/', 'kind': 'Local Disk'})
        return {'path': '', 'parent': None, 'dirs': drives, 'places': places, 'files': []}
    path = os.path.abspath(path)
    dirs, files = [], []
    try:
        with os.scandir(path) as it:
            for e in it:
                try:
                    if e.name.startswith('.') or e.name.startswith('$'):
                        continue
                    if e.is_dir() and e.name.lower().endswith('.app') and sys.platform == 'darwin':
                        if not images:     # a Mac app is a folder, but picking a program means picking it whole
                            files.append({'name': e.name, 'path': e.path, 'size': 0, 'mtime': e.stat().st_mtime})
                    elif e.is_dir():
                        if not e.name.lower().endswith(('.opiadata', '.lrdata')):
                            dirs.append({'name': e.name, 'path': e.path})
                    elif images and imaging.is_image(e.name):
                        st = e.stat()
                        files.append({'name': e.name, 'path': e.path, 'size': st.st_size, 'mtime': st.st_mtime})
                    elif not images:
                        st = e.stat()
                        files.append({'name': e.name, 'path': e.path, 'size': st.st_size, 'mtime': st.st_mtime})
                except OSError:
                    continue
    except OSError as e:
        raise ApiError('Cannot read %s (%s)' % (path, e.strerror or e))
    dirs.sort(key=lambda d: d['name'].lower())
    files.sort(key=lambda f: f['name'].lower())
    parent = os.path.dirname(path)
    return {'path': path, 'parent': parent if parent != path else '', 'dirs': dirs, 'files': files}


@api
def fs_mkdir(path):
    os.makedirs(path, exist_ok=True)
    return path


def launch(app, paths):
    """Open files in a chosen program: a Mac .app goes through `open -a`, anything else is run directly."""
    if sys.platform == 'darwin' and app.rstrip('/').lower().endswith('.app'):
        return subprocess.Popen(['open', '-a', app] + list(paths))
    return subprocess.Popen([app] + list(paths))


@api
def fs_reveal(path):
    if sys.platform == 'darwin':
        subprocess.Popen(['open', path] if os.path.isdir(path) else ['open', '-R', path])     # -R: show it selected in Finder
    elif sys.platform == 'win32':
        if os.path.isdir(path):
            os.startfile(path)
        else:
            subprocess.Popen(['explorer', '/select,', os.path.normpath(path)])
    return True


@api
def fs_open(path, app=None):
    if app:
        launch(app, [path])
    elif sys.platform == 'darwin':
        subprocess.Popen(['open', path])
    elif sys.platform == 'win32':
        os.startfile(path)
    return True


HELP_WHATSAPP = 'https://wa.me/918450973767'   # Help › Get Help on WhatsApp


@api
def help_whatsapp():
    """Open a WhatsApp chat with Opia's help number in the default browser (which hands it to WhatsApp if installed)."""
    webbrowser.open(HELP_WHATSAPP)
    return True


@api
def fs_exists(paths):
    return [os.path.exists(p) for p in paths]


# ---------------------------------------------------------------- import

@api
def import_scan(path, recursive=True):
    cat = core.cat()
    known = {r['path'].lower() for r in cat.q('SELECT path FROM photos WHERE master_id IS NULL')}
    out = []
    for root, dirs, files in os.walk(path):
        dirs[:] = [d for d in dirs if not d.startswith('.') and not d.lower().endswith(('.opiadata', '.lrdata'))] if recursive else []
        for f in sorted(files):
            if imaging.is_image(f):
                p = os.path.join(root, f)
                try:
                    st = os.stat(p)
                except OSError:
                    continue
                out.append({'path': p, 'name': f, 'size': st.st_size, 'mtime': st.st_mtime, 'known': p.lower() in known})
        if len(out) > 20000:
            break
    return out


def import_files(job, files, mode='add', dest=None, subfolder='', template=None, custom='', start=1, preset=None,
                 keywords=None, develop=None, smart=False, stack_with=None):
    cat = core.cat()
    batch = int(cat.meta('import_batch', 0) or 0) + 1
    known = {r['path'].lower() for r in cat.q('SELECT path FROM photos WHERE master_id IS NULL')}
    if job:
        job.total = len(files)
    ids, skipped, errors, seq = [], 0, [], int(start or 1)
    extra_kw = [keyword_ensure(cat, k) for k in (keywords or [])]
    for src in files:
        if job and job.cancel:
            break
        if job:
            job.step(os.path.basename(src))
        try:
            if mode == 'add' and src.lower() in known:
                skipped += 1
                continue
            meta = imaging.read_meta(src)
            meta['path'] = src
            path = src
            if mode in ('copy', 'move'):
                if not dest:
                    raise ApiError('Choose a destination folder')
                sub = datetime.datetime.fromtimestamp(meta['capture_time']).strftime(subfolder) if subfolder else ''
                ext = os.path.splitext(src)[1]
                name = apply_template(template, template_context(meta), seq, custom, len(files)) if template \
                    else os.path.splitext(os.path.basename(src))[0]
                target = os.path.join(dest, sub, name + ext)
                if os.path.abspath(target).lower() != os.path.abspath(src).lower():
                    os.makedirs(os.path.dirname(target), exist_ok=True)
                    target = unique_path(target)
                    (shutil.copy2 if mode == 'copy' else shutil.move)(src, target)
                    side = os.path.splitext(src)[0] + '.xmp'
                    if os.path.exists(side):
                        (shutil.copy2 if mode == 'copy' else shutil.move)(side, os.path.splitext(target)[0] + '.xmp')
                path = target
                if path.lower() in known:
                    skipped += 1
                    continue
            seq += 1
            side = xmp.read_sidecar(path)
            iptc = dict(meta['iptc'])
            iptc.update(side.get('iptc', {}))
            title, caption = side.get('title') or meta['title'], side.get('caption') or meta['caption']
            if preset:
                for k, v in preset.items():
                    if v in ('', None):
                        continue
                    if k == 'title':
                        title = v
                    elif k == 'caption':
                        caption = v
                    else:
                        iptc[k] = v
            dev = side.get('develop') or develop
            pid = cat.x('''INSERT INTO photos(path, width, height, filesize, format, capture_time, import_time, import_batch,
                rating, label, flag, title, caption, exif, iptc, lat, lon, develop) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)''',
                        (path, meta['width'], meta['height'], meta['filesize'], meta['format'], meta['capture_time'],
                         core.now(), batch, side.get('rating', meta['rating']), side.get('label', meta['label']),
                         side.get('flag', 0), title, caption, json.dumps(meta['exif']), json.dumps(iptc),
                         meta['lat'], meta['lon'], json.dumps(dev) if dev else None))
            kws = extra_kw + [keyword_ensure(cat, k) for k in list(meta['keywords']) + side.get('keywords', [])]
            if kws:
                cat.xm('INSERT OR IGNORE INTO photo_keywords(photo_id, keyword_id) VALUES(?,?)', [(pid, k) for k in kws if k])
            known.add(path.lower())
            ids.append(pid)
        except Exception as e:
            errors.append('%s: %s' % (os.path.basename(src), e))
    if ids:
        cat.set_meta('import_batch', batch)
        if stack_with:
            top = cat.photo(stack_with)
            sid = top['stack_id'] or stack_with
            cat.x('UPDATE photos SET stack_id=?, stack_pos=0 WHERE id=? AND stack_id IS NULL', (sid, stack_with))
            n = cat.one('SELECT COALESCE(MAX(stack_pos),0) m FROM photos WHERE stack_id=?', (sid,))['m']
            cat.xm('UPDATE photos SET stack_id=?, stack_pos=? WHERE id=?', [(sid, n + 1 + k, i) for k, i in enumerate(ids)])
        if smart and job:
            imaging.smart_build(core.Job('smart'), ids)
        from . import plugins
        plugins.fire('on_import', photos_out(cat, ids))
    return {'ids': ids, 'skipped': skipped, 'errors': errors, 'batch': batch, 'photos': photos_out(cat, ids) if ids else []}


@api
def import_run(files, **opts):
    return core.start_job('Importing', import_files, files, **opts)


# ---------------------------------------------------------------- renaming & relinking

def _rename_plan(ids, template, custom, start):
    cat = core.cat()
    rows = [cat.photo(i) for i in ids]
    masters, seen = [], set()
    for r in rows:
        if r['path'] not in seen:
            seen.add(r['path'])
            masters.append(r)
    plan, used = [], set()
    for n, r in enumerate(masters):
        ext = os.path.splitext(r['path'])[1]
        name = apply_template(template, template_context(r), int(start or 1) + n, custom, len(masters))
        target = os.path.join(os.path.dirname(r['path']), name + ext)
        k = 2
        while target.lower() in used or (os.path.exists(target) and target.lower() != r['path'].lower()):
            target = os.path.join(os.path.dirname(r['path']), '%s-%d%s' % (name, k, ext))
            k += 1
        used.add(target.lower())
        plan.append((r, target))
    return plan


@api
def rename_preview(ids, template, custom='', start=1):
    return [{'from': os.path.basename(r['path']), 'to': os.path.basename(t)} for r, t in _rename_plan(ids[:200], template, custom, start)]


@api
def photos_rename(ids, template, custom='', start=1):
    cat = core.cat()
    done, errors = 0, []
    for r, target in _rename_plan(ids, template, custom, start):
        if target == r['path']:
            continue
        try:
            os.rename(r['path'], target)
            side = os.path.splitext(r['path'])[0] + '.xmp'
            if os.path.exists(side):
                os.rename(side, os.path.splitext(target)[0] + '.xmp')
            cat.x('UPDATE photos SET path=? WHERE path=?', (target, r['path']))
            done += 1
        except OSError as e:
            errors.append('%s: %s' % (os.path.basename(r['path']), e.strerror or e))
    return {'renamed': done, 'errors': errors, 'photos': photos_out(cat, ids)}


@api
def photos_locate(id, path):
    """Point a missing photo at its new location, and fix siblings that moved with it."""
    cat = core.cat()
    r = cat.photo(id)
    if not os.path.isfile(path):
        raise ApiError('That file does not exist')
    old_dir, new_dir = os.path.dirname(r['path']), os.path.dirname(path)
    cat.x('UPDATE photos SET path=? WHERE path=?', (path, r['path']))
    fixed = 1
    for s in cat.q('SELECT DISTINCT path FROM photos'):
        if os.path.dirname(s['path']) == old_dir and not os.path.exists(s['path']):
            cand = os.path.join(new_dir, os.path.basename(s['path']))
            if os.path.exists(cand):
                cat.x('UPDATE photos SET path=? WHERE path=?', (cand, s['path']))
                fixed += 1
    return fixed


# ---------------------------------------------------------------- external editors & DNG converter

EDITOR_HINTS = [   # (name, an .app in /Applications or ~/Applications; a * matches any version)
    ('Adobe Photoshop', 'Adobe Photoshop*/Adobe Photoshop*.app'),
    ('Affinity Photo 2', 'Affinity Photo 2.app'),
    ('Affinity Photo', 'Affinity Photo.app'),
    ('Pixelmator Pro', 'Pixelmator Pro.app'),
    ('GIMP', 'GIMP*.app'),
    ('Krita', 'krita.app'),
    ('Photomator', 'Photomator.app'),
    ('Preview', '/System/Applications/Preview.app'),
]
DNG_PATHS = ['/Applications/Adobe DNG Converter.app/Contents/MacOS/Adobe DNG Converter']


@api
def editors_detect():
    import glob
    found = []
    for name, pattern in EDITOR_HINTS:
        roots = [''] if pattern.startswith('/') else ['/Applications', os.path.expanduser('~/Applications')]
        hits = sorted(h for r in roots for h in glob.glob(os.path.join(r, pattern)) if os.path.isdir(h))
        if hits and not any(f['name'] == name for f in found):
            found.append({'name': name, 'path': hits[-1]})      # the newest version sorts last
    return found


def dng_converter():
    p = cfg.get('prefs', {}).get('dngConverter')
    if p and p.rstrip('/').lower().endswith('.app'):      # the program inside the app you picked
        p = os.path.join(p, 'Contents', 'MacOS', os.path.basename(p.rstrip('/'))[:-4])
    if p and os.path.exists(p):
        return p
    for p in DNG_PATHS:
        if os.path.exists(p):
            return p
    return None


@api
def dng_status():
    return {'path': dng_converter()}


def _dng(job, ids, opts):
    exe = dng_converter()
    if not exe:
        raise ApiError('Adobe DNG Converter was not found. Install it from Adobe (it goes in Applications), or set its location in Preferences > External Editing.')
    cat = core.cat()
    rows = [cat.photo(i) for i in ids if imaging.is_raw(cat.photo(i)['path']) and not cat.photo(i)['path'].lower().endswith('.dng')]
    job.total = len(rows)
    converted, errors = [], []
    for r in rows:
        if job.cancel:
            break
        job.step(os.path.basename(r['path']))
        out_dir = os.path.dirname(r['path'])
        args = [exe, '-c' if opts.get('compressed', True) else '-u', '-p%d' % int(opts.get('preview', 1)),
                '-d', out_dir]
        if opts.get('embed'):
            args.append('-e')
        if opts.get('lossy'):
            args.append('-lossy')
        args.append(r['path'])
        try:
            subprocess.run(args, check=True, timeout=600)
            target = os.path.splitext(r['path'])[0] + '.dng'
            if not os.path.exists(target):
                raise ApiError('converter produced no file')
            if opts.get('replace', True):
                cat.x('UPDATE photos SET path=?, format=?, filesize=? WHERE path=?',
                      (target, 'DNG', os.path.getsize(target), r['path']))
                if opts.get('delete_original'):
                    recycle(r['path'])
            converted.append(r['id'])
        except Exception as e:
            errors.append('%s: %s' % (os.path.basename(r['path']), e))
    return {'converted': len(converted), 'errors': errors, 'skipped': len(ids) - len(rows),
            'photos': photos_out(cat, converted) if converted else []}


@api
def dng_convert(ids, opts=None):
    return core.start_job('Converting to DNG', _dng, ids, opts or {})


@core.img
def text(rest, q):
    """Small text files the UI parses itself: lens profiles and GPS tracklogs."""
    path = q['path']
    if os.path.splitext(path)[1].lower() not in ('.lcp', '.gpx') or not os.path.isfile(path):
        raise ApiError('Not a readable profile or tracklog')
    with open(path, 'rb') as f:
        return core.Binary(f.read(8 * 1024 * 1024), 'text/xml; charset=utf-8')


@core.img
def media(rest, q):
    """Audio for slideshow soundtracks."""
    path = q['path']
    types = {'.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.flac': 'audio/flac'}
    ext = os.path.splitext(path)[1].lower()
    if ext not in types or not os.path.isfile(path):
        raise ApiError('Not a playable audio file')
    with open(path, 'rb') as f:
        return core.Binary(f.read(), types[ext])

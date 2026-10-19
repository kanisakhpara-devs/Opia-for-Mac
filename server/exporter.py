"""Export: write rendered pixels to disk with naming/colour/metadata, then deliver (folder, FTP, disc, PDF, web)."""
import ftplib
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import uuid

from PIL import Image, ImageFilter

from . import core, files, icc, xmp
from .catalog import photos_out
from .core import api, upload, ApiError

SESS = {}
EXT = {'jpeg': '.jpg', 'tiff': '.tif', 'png': '.png', 'webp': '.webp', 'avif': '.avif'}
SHARPEN = {  # (radius, percent) for the three media at "standard"; low/high scale the percent
    'screen': (0.6, 60), 'matte': (1.0, 110), 'glossy': (0.8, 85)}


def session(sid):
    s = SESS.get(sid)
    if not s:
        raise ApiError('Export session expired')
    return s


def _safe_join(base, rel):
    target = os.path.abspath(os.path.join(base, rel))
    if not target.startswith(os.path.abspath(base)):
        raise ApiError('Bad file name')
    return target


@api
def session_begin(settings=None, staging=True):
    """Start collecting output files. With staging they land in a temp folder until committed."""
    st = settings or {}
    sid = uuid.uuid4().hex[:12]
    if staging or st.get('dest') in ('ftp', 'disc'):
        folder = tempfile.mkdtemp(prefix='opia_')
        staged = True
    else:
        folder = st.get('folder') or os.path.join(os.path.expanduser('~'), 'Pictures', 'Opia Exports')
        if st.get('subfolder'):
            folder = os.path.join(folder, files.ILLEGAL.sub('_', st['subfolder']))
        os.makedirs(folder, exist_ok=True)
        staged = False
    SESS[sid] = {'dir': folder, 'files': [], 'settings': st, 'staged': staged, 'sources': {}, 'seq': 0}
    return {'session': sid, 'dir': folder}


@upload
def session_put(q, body):
    """Store one arbitrary file (web gallery asset, PDF page, print sheet) in the session folder."""
    s = session(q['session'])
    target = _safe_join(s['dir'], q['name'])
    os.makedirs(os.path.dirname(target), exist_ok=True)
    with open(target, 'wb') as f:
        f.write(body)
    if target not in s['files']:
        s['files'].append(target)
    return {'path': target}


def _exif_bytes(row, photo, mode, remove_location):
    """EXIF block for the exported file, honouring the metadata privacy choice."""
    ex = Image.Exif()
    if mode in ('all', 'all_except_camera') and os.path.exists(row['path']):
        try:
            with Image.open(row['path']) as src:
                ex = src.getexif()
                ex.get_ifd(0x8769)
                ex.get_ifd(0x8825)
        except Exception:
            ex = Image.Exif()
    for tag in (0x0112, 0x0201, 0x0202, 0x0103, 0x0111, 0x0117, 0x0100, 0x0101, 0x0102, 0x0106, 0x0115, 0x011C, 0x8773):
        ex.pop(tag, None)
    ex[0x0131] = 'Opia ' + core.VERSION
    iptc = photo.get('iptc') or {}
    if iptc.get('creator'):
        ex[0x013B] = iptc['creator']
    if iptc.get('copyright'):
        ex[0x8298] = iptc['copyright']
    if mode == 'all' or mode == 'all_except_camera':
        if photo.get('caption'):
            ex[0x010E] = photo['caption']
    if mode == 'all_except_camera':
        for tag in (0x010F, 0x0110, 0x8769, 0xA005):
            ex.pop(tag, None)
    gps = photo.get('gps')
    if remove_location or mode not in ('all', 'all_except_camera'):
        ex.pop(0x8825, None)
    elif gps:
        def dms(v):
            a = abs(v)
            d = int(a)
            m = int((a - d) * 60)
            return (float(d), float(m), round((a - d - m / 60) * 3600, 4))
        try:
            ifd = ex.get_ifd(0x8825)
            ifd[1], ifd[2] = 'N' if gps[0] >= 0 else 'S', dms(gps[0])
            ifd[3], ifd[4] = 'E' if gps[1] >= 0 else 'W', dms(gps[1])
        except Exception:
            pass
    try:
        return ex.tobytes()
    except Exception:
        return b''


def output_name(s, row, index):
    st = s['settings']
    nm = st.get('naming') or {}
    ctx = files.template_context(row)
    if nm.get('enabled') and nm.get('template'):
        name = files.apply_template(nm['template'], ctx, int(nm.get('start') or 1) + index, nm.get('custom', ''),
                                    int(st.get('count') or 1))
    else:
        name = ctx['name']
        if row.get('master_id') and row.get('copy_name'):
            name += '-' + files.ILLEGAL.sub('_', row['copy_name'])
    return name + (st.get('suffix') or '')


def _place(s, name, ext, sub=''):
    """Final path, honouring the 'existing files' policy. None means skip."""
    base = _safe_join(s['dir'], sub) if sub else s['dir']
    os.makedirs(base, exist_ok=True)
    target = os.path.join(base, name + ext)
    policy = s['settings'].get('existing', 'rename')
    if os.path.exists(target) or target in s['files']:
        if policy == 'skip':
            return None
        if policy != 'overwrite' or target in s['files']:
            target = files.unique_path(target)
            n = 2
            while target in s['files']:
                target = os.path.join(base, '%s-%d%s' % (name, n, ext))
                n += 1
    return target


@upload
def export_put(q, body):
    """Receive one rendered photo (PNG bytes) and write the final file."""
    s = session(q['session'])
    st = s['settings']
    cat = core.cat()
    row = cat.photo(int(q['id']))
    photo = photos_out(cat, [row['id']])[0]
    index = int(q.get('index', 0))
    fmt = st.get('format', 'jpeg')
    name = output_name(s, row, index)
    if fmt == 'original':
        ext = os.path.splitext(row['path'])[1]
        target = _place(s, name, ext, q.get('sub', ''))
        if target is None:
            return {'skipped': True}
        if not os.path.exists(row['path']):
            raise ApiError('Original is offline: ' + os.path.basename(row['path']))
        shutil.copy2(row['path'], target)
        kws = xmp.kw_paths_for(cat, [row['id']]).get(row['id'], [])
        with open(os.path.splitext(target)[0] + '.xmp', 'w', encoding='utf-8') as f:
            f.write(xmp.build(photo, kws))
        s['files'].append(target)
        s['sources'][target] = row['id']
        return {'path': target}
    target = _place(s, name, EXT.get(fmt, '.jpg'), q.get('sub', ''))
    if target is None:
        return {'skipped': True}
    im = Image.open(io.BytesIO(body)).convert('RGB')
    sh = st.get('sharpen') or {}
    if sh.get('enabled'):
        radius, pct = SHARPEN.get(sh.get('target', 'screen'), SHARPEN['screen'])
        pct = int(pct * {'low': 0.6, 'standard': 1.0, 'high': 1.5}.get(sh.get('amount', 'standard'), 1.0))
        im = im.filter(ImageFilter.UnsharpMask(radius=radius, percent=pct, threshold=2))
    bd = st.get('border') or {}
    if bd.get('enabled'):                   # a plain frame around the finished picture, sized as a share of its long edge
        from PIL import ImageOps
        im = ImageOps.expand(im, border=max(1, round(max(im.size) * float(bd.get('size', 4)) / 100)), fill=bd.get('color') or '#ffffff')
    space = st.get('colorSpace') or 'sRGB'
    if fmt in ('png', 'webp', 'avif') and space not in ('sRGB', 'AdobeRGB', 'DisplayP3', 'ProPhoto'):
        prof = icc.get_profile(space)
        if icc.space_of(prof) != 'RGB':
            raise ApiError('%s files cannot hold CMYK; choose JPEG or TIFF for this profile' % fmt.upper())
    im, profile = icc.convert(im, space, st.get('intent', 'relative'))
    mode = (st.get('metadata') or 'all')
    kw = {'icc_profile': profile}
    dpi = int((st.get('resize') or {}).get('dpi') or 240)
    xmp_bytes = b''
    if mode != 'none':
        kws = xmp.kw_paths_for(cat, [row['id']]).get(row['id'], [])
        fields = mode if mode in ('copyright', 'copyright_contact') else ('no_location' if st.get('removeLocation') else 'all')
        xmp_bytes = xmp.build(photo, kws, develop=False, fields=fields).encode('utf-8')
        exif = _exif_bytes(row, photo, mode, st.get('removeLocation'))
        if exif:
            kw['exif'] = exif
    if fmt == 'jpeg':
        im.save(target, 'JPEG', quality=int(st.get('quality', 90)), subsampling=0 if int(st.get('quality', 90)) >= 90 else 2,
                optimize=True, dpi=(dpi, dpi), **({'xmp': xmp_bytes} if xmp_bytes else {}), **kw)
    elif fmt == 'tiff':
        comp = {'none': None, 'lzw': 'tiff_lzw', 'zip': 'tiff_adobe_deflate'}.get(st.get('tiffCompression', 'lzw'))
        info = {700: xmp_bytes} if xmp_bytes else {}
        im.save(target, 'TIFF', compression=comp, dpi=(dpi, dpi), tiffinfo=info, **kw)
    elif fmt == 'png':
        im.save(target, 'PNG', optimize=False, dpi=(dpi, dpi), **kw)
    elif fmt == 'webp':
        im.save(target, 'WEBP', quality=int(st.get('quality', 90)), method=4, **({'xmp': xmp_bytes} if xmp_bytes else {}), **kw)
    elif fmt == 'avif':
        im.save(target, 'AVIF', quality=int(st.get('quality', 80)), **kw)
    else:
        raise ApiError('Unknown export format ' + fmt)
    s['files'].append(target)
    s['sources'][target] = row['id']
    return {'path': target, 'size': os.path.getsize(target)}


# ---------------------------------------------------------------- FTP

def ftp_connect(c):
    if not c.get('host'):
        raise ApiError('Enter the FTP server name')
    cls = ftplib.FTP_TLS if c.get('tls') else ftplib.FTP
    f = cls()
    try:
        f.connect(c['host'].strip(), int(c.get('port') or 21), timeout=25)
        f.login(c.get('user') or 'anonymous', c.get('pass') or '')
        if c.get('tls'):
            f.prot_p()
        f.set_pasv(c.get('passive', True))
    except ftplib.all_errors as e:
        raise ApiError('FTP: %s' % e)
    return f


def ftp_cd(f, path):
    if path.startswith('/'):
        f.cwd('/')
    for part in [p for p in path.replace('\\', '/').split('/') if p]:
        try:
            f.cwd(part)
        except ftplib.error_perm:
            f.mkd(part)
            f.cwd(part)


def ftp_upload(job, conn, base, paths):
    f = ftp_connect(conn)
    try:
        ftp_cd(f, conn.get('path') or '')
        root = f.pwd()
        job.total += len(paths)
        for p in paths:
            if job.cancel:
                break
            rel = os.path.relpath(p, base).replace('\\', '/')
            job.step('Uploading ' + rel)
            f.cwd(root)
            if '/' in rel:
                ftp_cd(f, os.path.dirname(rel))
            with open(p, 'rb') as fh:
                f.storbinary('STOR ' + os.path.basename(rel), fh)
        return root
    except ftplib.all_errors as e:
        raise ApiError('FTP upload failed: %s' % e)
    finally:
        try:
            f.quit()
        except ftplib.all_errors:
            f.close()


@api
def ftp_test(conn):
    f = ftp_connect(conn)
    try:
        welcome = f.getwelcome() or ''
        if conn.get('path'):
            ftp_cd(f, conn['path'])
        names = []
        try:
            names = f.nlst()[:25]
        except ftplib.all_errors:
            pass
        return {'ok': True, 'welcome': welcome[:200], 'cwd': f.pwd(), 'list': names}
    except ftplib.all_errors as e:
        raise ApiError('FTP: %s' % e)
    finally:
        try:
            f.quit()
        except ftplib.all_errors:
            f.close()


# ---------------------------------------------------------------- CD / DVD (Windows IMAPI2)

PS_DISC_INFO = r'''
$ErrorActionPreference='Stop'
$out=@()
try { $dm = New-Object -ComObject IMAPI2.MsftDiscMaster2 } catch { '[]'; exit 0 }
for ($i=0; $i -lt $dm.Count; $i++) {
  $rec = New-Object -ComObject IMAPI2.MsftDiscRecorder2
  $rec.InitializeDiscRecorder($dm.Item($i))
  $media = 'none'; $free = 0
  try {
    $fmt = New-Object -ComObject IMAPI2.MsftDiscFormat2Data
    $fmt.Recorder = $rec; $fmt.ClientName = 'Opia'
    if ($fmt.IsCurrentMediaSupported($rec)) { $media = 'writable'; $free = [int64]$fmt.FreeSectorsOnMedia * 2048 }
  } catch { $media = 'none' }
  $out += [pscustomobject]@{ index=$i; name=("$($rec.VendorId) $($rec.ProductId)").Trim(); drive=(@($rec.VolumePathNames) -join ','); media=$media; free=$free }
}
ConvertTo-Json -Compress -InputObject @($out)
'''
PS_DISC_BURN = r'''
param($Folder, $Label, [int]$Index)
$ErrorActionPreference='Stop'
$dm = New-Object -ComObject IMAPI2.MsftDiscMaster2
if ($dm.Count -eq 0) { throw 'No disc recorder is connected to this computer.' }
$rec = New-Object -ComObject IMAPI2.MsftDiscRecorder2
$rec.InitializeDiscRecorder($dm.Item($Index))
$fmt = New-Object -ComObject IMAPI2.MsftDiscFormat2Data
$fmt.Recorder = $rec; $fmt.ClientName = 'Opia'
if (-not $fmt.IsCurrentMediaSupported($rec)) { throw 'Insert a blank writable CD or DVD and try again.' }
$fs = New-Object -ComObject IMAPI2FS.MsftFileSystemImage
$fs.ChooseImageDefaults($rec); $fs.VolumeName = $Label
$fs.Root.AddTree($Folder, $false)
$fmt.Write($fs.CreateResultImage().ImageStream)
$rec.EjectMedia()
'BURNED'
'''
PS_DISC_ISO = r'''
param($Folder, $Label, $Out)
$ErrorActionPreference='Stop'
$cp = New-Object System.CodeDom.Compiler.CompilerParameters
$cp.CompilerOptions = '/unsafe'
Add-Type -CompilerParameters $cp -TypeDefinition @'
public class OpiaIso {
  public unsafe static void Save(string path, object stream, int blockSize, int totalBlocks) {
    int bytes = 0; byte[] buf = new byte[blockSize];
    System.IntPtr ptr = (System.IntPtr)(&bytes);
    System.IO.FileStream o = System.IO.File.Create(path);
    System.Runtime.InteropServices.ComTypes.IStream i = stream as System.Runtime.InteropServices.ComTypes.IStream;
    while (totalBlocks-- > 0) { i.Read(buf, blockSize, ptr); o.Write(buf, 0, bytes); }
    o.Flush(); o.Close();
  }
}
'@
$fs = New-Object -ComObject IMAPI2FS.MsftFileSystemImage
$fs.FileSystemsToCreate = 3    # ISO9660 + Joliet
$fs.VolumeName = $Label
$fs.Root.AddTree($Folder, $false)
$res = $fs.CreateResultImage()
[OpiaIso]::Save($Out, $res.ImageStream, $res.BlockSize, $res.TotalBlocks)
'ISO'
'''


def _ps(script, *args, timeout=3600):
    if sys.platform != 'win32':
        raise ApiError('Burning CDs and DVDs is only in Opia for Windows. Export to a folder, then burn it with Finder (right-click the folder, Burn).')
    path = os.path.join(tempfile.gettempdir(), 'opia_%s.ps1' % uuid.uuid4().hex[:8])
    with open(path, 'w', encoding='utf-8-sig') as f:
        f.write(script)
    try:
        r = subprocess.run(['powershell', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path, *args],
                           capture_output=True, text=True, timeout=timeout, creationflags=0x08000000)
    finally:
        os.remove(path)
    if r.returncode != 0:
        msg = (r.stderr or r.stdout or 'PowerShell failed').strip().splitlines()
        raise ApiError(next((m for m in msg if m.strip()), 'Disc operation failed')[:300])
    return r.stdout.strip()


@api
def disc_info():
    try:
        out = _ps(PS_DISC_INFO, timeout=60)
        data = json.loads(out or '[]')
        return data if isinstance(data, list) else [data]
    except (ApiError, ValueError, subprocess.TimeoutExpired):
        return []


def disc_label(text):
    return ''.join(ch for ch in (text or 'OPIA') if ch.isalnum() or ch in ' _-')[:30] or 'OPIA'


# ---------------------------------------------------------------- finishing

def _finish(job, sid, deliver):
    s = session(sid)
    st = s['settings']
    deliver = deliver or {}
    dest = deliver.get('dest') or st.get('dest') or 'disk'
    out = {'files': list(s['files']), 'dir': s['dir'], 'messages': [], 'count': len(s['files'])}
    paths = list(s['files'])
    for extra in list(paths):   # sidecars written beside originals travel too
        side = os.path.splitext(extra)[0] + '.xmp'
        if st.get('format') == 'original' and os.path.exists(side) and side not in paths:
            paths.append(side)
    from . import plugins
    out['messages'] += plugins.fire('on_export', paths, st, s['dir'])
    if dest == 'ftp':
        conn = deliver.get('ftp') or st.get('ftp') or {}
        root = ftp_upload(job, conn, s['dir'], [p for p in _walk(s['dir'])])
        out['messages'].append('Uploaded %d file(s) to ftp://%s%s' % (len(_walk(s['dir'])), conn.get('host'), root))
    elif dest == 'disc':
        d = deliver.get('disc') or st.get('disc') or {}
        label = disc_label(d.get('label'))
        if d.get('iso'):
            target = files.unique_path(os.path.join(d.get('isoFolder') or os.path.join(os.path.expanduser('~'), 'Pictures'), label + '.iso'))
            job.message = 'Writing disc image'
            _ps(PS_DISC_ISO, s['dir'], label, target)
            out['messages'].append('Disc image written: ' + target)
            out['iso'] = target
        else:
            job.message = 'Burning disc (this can take several minutes)'
            _ps(PS_DISC_BURN, s['dir'], label, str(int(d.get('recorder') or 0)))
            out['messages'].append('Disc "%s" burned and ejected' % label)
    elif dest == 'folder' or (dest == 'disk' and s['staged']):
        target = deliver.get('folder') or st.get('folder')
        if not target:
            raise ApiError('Choose a destination folder')
        os.makedirs(target, exist_ok=True)
        moved = []
        for p in _walk(s['dir']):
            rel = os.path.relpath(p, s['dir'])
            t = os.path.join(target, rel)
            os.makedirs(os.path.dirname(t), exist_ok=True)
            shutil.copy2(p, t)
            moved.append(t)
        out['files'], out['dir'] = moved, target
    if st.get('addToCatalog') and dest == 'disk' and not s['staged']:
        added = []
        for p in s['files']:
            res = files.import_files(None, [p], stack_with=s['sources'].get(p) if st.get('stack') else None)
            added += res['photos']
        out['added'] = added
    if s['staged']:
        shutil.rmtree(s['dir'], ignore_errors=True)
    post = deliver.get('post') or st.get('post') or 'nothing'
    try:
        if post == 'reveal' and dest in ('disk', 'folder'):
            files.fs_reveal(out['dir'])
        elif post == 'open' and out['files']:
            files.fs_open(deliver.get('open') or out['files'][0])
        elif post == 'app' and (st.get('app') or deliver.get('app')) and out['files'] and dest in ('disk', 'folder'):
            files.launch(st.get('app') or deliver.get('app'), out['files'][:20])
    except OSError as e:
        out['messages'].append('Post-processing failed: %s' % e)
    SESS.pop(sid, None)
    return out


def _walk(folder):
    return [os.path.join(r, f) for r, _d, fs in os.walk(folder) for f in fs]


@api
def session_finish(session, deliver=None):
    return core.start_job('Finishing export', _finish, session, deliver)


@api
def session_process(session, format='jpeg', quality=92, colorSpace='sRGB', intent='relative', sharpen=None, dpi=300):
    """Convert every staged page image to its final form: output sharpening, ICC conversion, embedded profile."""
    s = SESS.get(session)
    if not s:
        raise ApiError('Session expired')
    out = []
    for p in sorted(s['files']):
        im = Image.open(p).convert('RGB')
        if sharpen and sharpen.get('enabled'):
            radius, pct = SHARPEN.get(sharpen.get('target', 'glossy'), SHARPEN['glossy'])
            pct = int(pct * {'low': 0.6, 'standard': 1.0, 'high': 1.5}.get(sharpen.get('amount', 'standard'), 1.0))
            im = im.filter(ImageFilter.UnsharpMask(radius=radius * max(1.0, dpi / 240.0), percent=pct, threshold=2))
        im, profile = icc.convert(im, colorSpace, intent)
        target = os.path.splitext(p)[0] + EXT.get(format, '.jpg')
        if format == 'tiff':
            im.save(target, 'TIFF', compression='tiff_lzw', dpi=(dpi, dpi), icc_profile=profile)
        else:
            im.save(target, 'JPEG', quality=int(quality), subsampling=0, dpi=(dpi, dpi), icc_profile=profile)
        if target != p:
            os.remove(p)
        out.append(target)
    s['files'] = out
    return {'files': [os.path.relpath(p, s['dir']) for p in out]}


@api
def session_cancel(session):
    s = SESS.pop(session, None)
    if s and s['staged']:
        shutil.rmtree(s['dir'], ignore_errors=True)
    return True


@api
def pdf_build(session, pages, dest, dpi=150, post='open'):
    """Assemble uploaded page images (in order) into one PDF."""
    s = SESS.get(session)
    if not s:
        raise ApiError('Session expired')
    ims = [Image.open(_safe_join(s['dir'], p)) for p in pages]
    ims = [im if im.mode in ('RGB', 'CMYK', 'L') else im.convert('RGB') for im in ims]
    if not ims:
        raise ApiError('Nothing to write')
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    dest = files.unique_path(dest if dest.lower().endswith('.pdf') else dest + '.pdf')
    ims[0].save(dest, 'PDF', save_all=True, append_images=ims[1:], resolution=float(dpi), quality=92)
    shutil.rmtree(s['dir'], ignore_errors=True)
    SESS.pop(session, None)
    if post == 'open':
        files.fs_open(dest)
    return {'path': dest, 'pages': len(ims)}

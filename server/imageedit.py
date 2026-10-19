"""Image workspace: a layered picture editor. The pixels are edited in the browser; this side opens files the browser cannot read
by itself, writes finished pictures, and keeps projects (.opiaimg: a zip of one PNG per layer plus a JSON description)."""
import base64
import io
import json
import os
import zipfile

from PIL import Image, ImageOps

from . import core, files, imaging
from .core import api, img, upload, ApiError, Binary

NATIVE = {'.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp'}
SAVE = {'png': ('PNG', '.png'), 'jpeg': ('JPEG', '.jpg'), 'webp': ('WEBP', '.webp'), 'tiff': ('TIFF', '.tif'), 'bmp': ('BMP', '.bmp')}
PROJECT = '.opiaimg'


def _png(im):
    buf = io.BytesIO()
    im.save(buf, 'PNG', compress_level=1)
    return buf.getvalue()


def _decode(data, name, path=None):
    """Bytes of any picture Opia can read -> PNG bytes, turned the right way up, transparency kept."""
    try:
        im = ImageOps.exif_transpose(Image.open(io.BytesIO(data)))
        im.load()
        if im.mode not in ('RGB', 'RGBA'):
            im = im.convert('RGBA' if im.mode in ('LA', 'P', 'PA') or 'transparency' in im.info else 'RGB')
        return _png(im)
    except Exception:
        pass
    if path:                      # RAW files and 16-bit TIFFs go through the photo decoder
        try:
            return _png(Image.fromarray(imaging.decode(path)))
        except Exception:
            pass
    raise ApiError('%s is not a picture Opia can open' % name)


def _safe_ext(path):
    return os.path.splitext(path)[1].lower()


@img
def imgfile(rest, q):
    """A picture on disk, in a form the browser can draw."""
    path = q.get('path') or ''
    if not os.path.isfile(path):
        raise ApiError('File not found')
    ext = _safe_ext(path)
    if ext == PROJECT or not (imaging.is_image(path) or ext in NATIVE):
        raise ApiError('Not a picture')
    with open(path, 'rb') as f:
        data = f.read()
    if ext in NATIVE and ext not in ('.jpg', '.jpeg'):      # JPEGs are re-encoded so their EXIF orientation is applied the same way everywhere
        return Binary(data, NATIVE[ext])
    return Binary(_decode(data, os.path.basename(path), path), 'image/png')


@upload
def image_decode(q, body):
    """A dropped file the browser could not read by itself (TIFF, HEIC...)."""
    return Binary(_decode(body, q.get('name') or 'That file'), 'image/png')


def _target(path, ext):
    path = os.path.abspath(path)
    if not os.path.isdir(os.path.dirname(path)):
        raise ApiError('That folder does not exist')
    if _safe_ext(path) != ext:
        path += ext
    return path


@upload
def image_export(q, body):
    """The flattened picture arrives as PNG; write it in the format asked for."""
    fmt = q.get('fmt', 'png')
    if fmt not in SAVE:
        raise ApiError('Unknown picture format')
    kind, ext = SAVE[fmt]
    path = _target(q['path'], '.jpeg' if fmt == 'jpeg' and _safe_ext(q['path']) == '.jpeg' else ext)
    im = Image.open(io.BytesIO(body))
    im.load()
    if kind in ('JPEG', 'BMP') and im.mode == 'RGBA':        # these cannot hold transparency: put it on white
        bg = Image.new('RGB', im.size, q.get('bg') or '#ffffff')
        bg.paste(im, mask=im.getchannel('A'))
        im = bg
    opts = {}
    if kind in ('JPEG', 'WEBP'):
        opts['quality'] = max(10, min(int(q.get('quality', 92)), 100))
    if kind == 'JPEG':
        opts.update(optimize=True, subsampling=0 if opts['quality'] >= 90 else 2)
    if kind == 'TIFF':
        opts['compression'] = 'tiff_lzw'
    if kind == 'PNG':
        opts['optimize'] = False
    tmp = path + '.tmp'
    im.save(tmp, kind, **opts)
    os.replace(tmp, path)
    out = {'path': path, 'size': os.path.getsize(path), 'photos': []}
    if q.get('catalog') == '1':
        try:
            out['photos'] = files.import_files(None, [path])['photos']
        except ApiError as e:
            out['note'] = str(e)
    return out


@upload
def image_project_save(q, body):
    """body: JSON {w, h, layers: [{..., png: data URL}], preview: data URL}. Written as a zip so each layer stays a plain PNG."""
    path = _target(q['path'], PROJECT)
    doc = json.loads(body)
    pngs = []
    for k, layer in enumerate(doc.get('layers') or []):
        url = layer.pop('png', None)
        if url:
            layer['file'] = 'layers/%03d.png' % k
            pngs.append((layer['file'], base64.b64decode(url.split(',', 1)[1])))
    preview = doc.pop('preview', None)
    doc['format'] = 'opia-image'
    doc['version'] = 1
    tmp = path + '.tmp'
    with zipfile.ZipFile(tmp, 'w', zipfile.ZIP_STORED) as z:     # PNGs are compressed already
        z.writestr('project.json', json.dumps(doc, indent=1))
        for name, data in pngs:
            z.writestr(name, data)
        if preview:
            z.writestr('preview.png', base64.b64decode(preview.split(',', 1)[1]))
    os.replace(tmp, path)
    return {'path': path, 'size': os.path.getsize(path)}


def _project(data, name):
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            doc = json.loads(z.read('project.json'))
            if doc.get('format') != 'opia-image':
                raise ValueError
            for layer in doc.get('layers') or []:
                f = layer.pop('file', None)
                if f:
                    layer['png'] = 'data:image/png;base64,' + base64.b64encode(z.read(f)).decode('ascii')
            return doc
    except (zipfile.BadZipFile, KeyError, ValueError):
        raise ApiError('%s is not an Opia image project, or it is damaged' % name)


@api
def image_project_open(path):
    try:
        with open(path, 'rb') as f:
            data = f.read()
    except OSError as e:
        raise ApiError('Cannot read %s (%s)' % (path, e.strerror or e))
    return _project(data, os.path.basename(path))


@upload
def image_project_upload(q, body):
    return _project(body, q.get('name') or 'That file')


@api
def image_photo_path(id):
    """Where a catalog photo's file is, so the editor can suggest saving next to it."""
    row = core.cat().photo(id)
    return {'path': row['path'], 'folder': os.path.dirname(row['path'])}

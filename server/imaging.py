"""Decoding, metadata, previews, retouching and image analysis (depth, upright, chromatic aberration)."""
import datetime
import io
import os
import threading
from collections import OrderedDict

import cv2
import numpy as np
from PIL import Image, ImageCms, ImageOps, IptcImagePlugin

from . import core
from .core import api, img, upload, ApiError, Binary

try:
    import rawpy
except ImportError:  # RAW support is optional
    rawpy = None
try:
    import exifread
except ImportError:
    exifread = None

Image.MAX_IMAGE_PIXELS = None
RAW_EXT = {'.cr2', '.cr3', '.nef', '.nrw', '.arw', '.srf', '.sr2', '.raf', '.orf', '.rw2', '.pef', '.dng', '.srw',
           '.3fr', '.erf', '.kdc', '.mrw', '.x3f', '.iiq', '.raw', '.rwl', '.dcr'}
STD_EXT = {'.jpg', '.jpeg', '.png', '.tif', '.tiff', '.webp', '.bmp', '.gif', '.avif', '.jp2', '.psd'}
try:                                   # iPhone photos
    import pillow_heif
    pillow_heif.register_heif_opener()
    STD_EXT |= {'.heic', '.heif'}
except Exception:
    pillow_heif = None
IMG_EXT = RAW_EXT | STD_EXT
SMART_SIZE = 2560
_SRGB = ImageCms.createProfile('sRGB')

_lock = threading.RLock()
_full = OrderedDict()     # (path, mtime) -> full-res RGB array
_scaled = OrderedDict()   # (path, mtime, orient, size) -> RGB array
_disk = OrderedDict()     # (path, mtime, size) -> jpeg bytes for un-imported files


def is_image(name):
    return os.path.splitext(name)[1].lower() in IMG_EXT


def is_raw(name):
    return os.path.splitext(name)[1].lower() in RAW_EXT


def apply_orient(a, o):
    """orient = quarter turns clockwise (0-3) + 4 when mirrored first."""
    if o & 4:
        a = a[:, ::-1]
    if o & 3:
        a = np.rot90(a, -(o & 3))
    return np.ascontiguousarray(a)


def decode(path, half=False, draft=0):
    """Any supported file -> RGB uint8 array with the EXIF orientation applied."""
    ext = os.path.splitext(path)[1].lower()
    if ext in RAW_EXT:
        if rawpy is None:
            raise ApiError('RAW support (rawpy) is not installed')
        with rawpy.imread(path) as raw:
            return raw.postprocess(use_camera_wb=True, half_size=half, output_bps=8)
    try:
        im = Image.open(path)
        if draft and im.format == 'JPEG':
            im.draft('RGB', (draft, draft))
        im = ImageOps.exif_transpose(im)
        icc = im.info.get('icc_profile')
        if im.mode in ('I;16', 'I;16B', 'I;16L', 'I', 'F'):
            a = np.asarray(im).astype(np.float32)
            a = (a / max(float(a.max()), 1.0) * 255).astype(np.uint8)
            return np.dstack([a, a, a])
        if icc and im.mode in ('RGB', 'CMYK'):
            try:
                im = ImageCms.profileToProfile(im, ImageCms.ImageCmsProfile(io.BytesIO(icc)), _SRGB, outputMode='RGB')
            except (ImageCms.PyCMSError, OSError, ValueError):
                pass
        if im.mode == 'RGBA' or 'transparency' in im.info:
            bg = Image.new('RGB', im.size, (255, 255, 255))
            bg.paste(im.convert('RGBA'), mask=im.convert('RGBA').split()[3])
            im = bg
        return np.asarray(im.convert('RGB'))
    except (OSError, ValueError, SyntaxError):
        a = cv2.imdecode(np.fromfile(path, np.uint8), cv2.IMREAD_UNCHANGED)   # 16-bit TIFF/PNG Pillow cannot open
        if a is None:
            raise ApiError('Cannot decode ' + os.path.basename(path))
        if a.dtype != np.uint8:
            a = (a.astype(np.float32) / 257).astype(np.uint8)
        if a.ndim == 2:
            return cv2.cvtColor(a, cv2.COLOR_GRAY2RGB)
        return cv2.cvtColor(a[:, :, :3], cv2.COLOR_BGR2RGB)


def resize_long(a, size):
    h, w = a.shape[:2]
    if size and max(w, h) > size:
        s = size / max(w, h)
        a = cv2.resize(a, (max(1, round(w * s)), max(1, round(h * s))), interpolation=cv2.INTER_AREA)
    return a


def jpeg(a, q=90):
    ok, buf = cv2.imencode('.jpg', cv2.cvtColor(a, cv2.COLOR_RGB2BGR), [cv2.IMWRITE_JPEG_QUALITY, int(q)])
    return buf.tobytes()


def _put(cache, key, val, limit):
    with _lock:
        cache[key] = val
        cache.move_to_end(key)
        while len(cache) > limit:
            cache.popitem(last=False)


def smart_path(row):
    return os.path.join(core.cat().smart, '%d.jpg' % (row['master_id'] or row['id']))


def base_image(row, size=0):
    """RGB array for a catalog photo with user rotation applied, long edge <= size (0 = full resolution).

    Falls back to the Smart Preview when the original is offline, and prefers it for small requests."""
    path, orient = row['path'], row['orient'] or 0
    exists = os.path.exists(path)
    sp = smart_path(row)
    has_smart = os.path.exists(sp)
    if not exists and not has_smart:
        raise ApiError('The original file is offline and no Smart Preview exists: ' + path)
    mtime = os.path.getmtime(path) if exists else 0
    key = (path, mtime, orient, size)
    with _lock:
        if key in _scaled:
            _scaled.move_to_end(key)
            return _scaled[key]
    if has_smart and (not exists or (size and size <= SMART_SIZE)):
        a = np.asarray(Image.open(sp).convert('RGB'))
    else:
        fkey = (path, mtime)
        with _lock:
            a = _full.get(fkey)
        if a is None:
            a = decode(path)
            _put(_full, fkey, a, 2)
    a = resize_long(apply_orient(a, orient), size)
    _put(_scaled, key, a, 8)
    return a


# ---------------------------------------------------------------- metadata

def _f(tag):
    try:
        return float(tag.values[0])
    except Exception:
        return None


def _s(tag):
    return str(tag.printable).strip() if tag is not None else ''


def _gps(tags, key):
    t, ref = tags.get('GPS GPS' + key), _s(tags.get('GPS GPS%sRef' % key))
    if t is None:
        return None
    try:
        d, m, s = [float(v) for v in t.values[:3]]
    except Exception:
        return None
    val = d + m / 60 + s / 3600
    return -val if ref[:1] in ('S', 'W') else val


def exif_tags(path):
    if exifread is None:
        return {}
    try:
        with open(path, 'rb') as f:
            return exifread.process_file(f, details=False)
    except Exception:
        return {}


def read_meta(path):
    """Everything the catalog stores about a file at import time."""
    ext = os.path.splitext(path)[1].lower()
    st = os.stat(path)
    m = {'width': 0, 'height': 0, 'format': ext[1:].upper(), 'filesize': st.st_size, 'capture_time': st.st_mtime,
         'exif': {}, 'iptc': {}, 'lat': None, 'lon': None, 'title': '', 'caption': '', 'keywords': [],
         'rating': 0, 'label': ''}
    tags = exif_tags(path)
    swap = False
    try:
        swap = int(tags['Image Orientation'].values[0]) in (5, 6, 7, 8)
    except Exception:
        pass
    if ext in RAW_EXT and rawpy is not None:
        try:
            with rawpy.imread(path) as raw:
                s = raw.sizes
                m['width'], m['height'] = (s.height, s.width) if s.flip in (5, 6) else (s.width, s.height)
        except Exception:
            pass
    else:
        try:
            with Image.open(path) as im:
                m['width'], m['height'] = (im.size[1], im.size[0]) if swap else im.size
                try:
                    ip = IptcImagePlugin.getiptcinfo(im) or {}
                except Exception:
                    ip = {}

                def dec(v):
                    if isinstance(v, (list, tuple)):
                        return [dec(x) for x in v]
                    try:
                        return v.decode('utf-8')
                    except UnicodeDecodeError:
                        return v.decode('latin-1')
                for code, field in (((2, 80), 'creator'), ((2, 116), 'copyright'), ((2, 90), 'city'), ((2, 95), 'state'),
                                    ((2, 101), 'country'), ((2, 105), 'headline'), ((2, 110), 'credit'),
                                    ((2, 115), 'source'), ((2, 92), 'sublocation'), ((2, 40), 'instructions')):
                    if code in ip:
                        v = dec(ip[code])
                        m['iptc'][field] = v[0] if isinstance(v, list) else v
                if (2, 5) in ip:
                    m['title'] = str(dec(ip[(2, 5)]))
                if (2, 120) in ip:
                    m['caption'] = str(dec(ip[(2, 120)]))
                if (2, 25) in ip:
                    v = dec(ip[(2, 25)])
                    m['keywords'] = v if isinstance(v, list) else [v]
        except Exception:
            pass
    e = m['exif']
    for key, name in (('Image Make', 'make'), ('Image Model', 'model'), ('EXIF LensModel', 'lens'),
                      ('Image Software', 'software'), ('EXIF ExposureProgram', 'program'),
                      ('EXIF MeteringMode', 'metering'), ('EXIF Flash', 'flash'), ('EXIF WhiteBalance', 'wb'),
                      ('EXIF ColorSpace', 'colorspace'), ('EXIF ExposureTime', 'shutter')):
        if key in tags and _s(tags[key]):
            e[name] = _s(tags[key])
    for key, name in (('EXIF FocalLength', 'focal'), ('EXIF FocalLengthIn35mmFilm', 'focal35'), ('EXIF FNumber', 'aperture'),
                      ('EXIF ISOSpeedRatings', 'iso'), ('EXIF ExposureBiasValue', 'bias'), ('EXIF ExposureTime', 'exposure')):
        v = _f(tags.get(key)) if key in tags else None
        if v is not None:
            e[name] = round(v, 6)
    for key, field in (('Image Artist', 'creator'), ('Image Copyright', 'copyright')):
        if key in tags and _s(tags[key]) and field not in m['iptc']:
            m['iptc'][field] = _s(tags[key])
    for key in ('EXIF DateTimeOriginal', 'EXIF DateTimeDigitized', 'Image DateTime'):
        if key in tags:
            try:
                dt = datetime.datetime.strptime(_s(tags[key])[:19], '%Y:%m:%d %H:%M:%S')
                m['capture_time'] = dt.timestamp()
                e['datetime'] = dt.strftime('%Y-%m-%d %H:%M:%S')
                break
            except ValueError:
                pass
    m['lat'], m['lon'] = _gps(tags, 'Latitude'), _gps(tags, 'Longitude')
    if 'GPS GPSAltitude' in tags and _f(tags['GPS GPSAltitude']) is not None:
        e['altitude'] = round(_f(tags['GPS GPSAltitude']), 1)
    return m


@api
def exif_full(id):
    row = core.cat().photo(id)
    if not os.path.exists(row['path']):
        raise ApiError('The original file is offline')
    tags = exif_tags(row['path'])
    out = []
    for k in sorted(tags):
        if k.startswith('JPEGThumbnail') or 'Thumbnail' in k.split(' ')[0]:
            continue
        group, _, name = k.partition(' ')
        v = _s(tags[k])
        out.append([group, name, v[:300]])
    return out


# ---------------------------------------------------------------- previews

def _preview_file(kind, pid):
    d = os.path.join(core.cat().previews, kind)
    os.makedirs(d, exist_ok=True)
    return os.path.join(d, '%d.jpg' % pid)


def make_thumb(row):
    path = row['path']
    a = None
    if os.path.exists(path):
        if is_raw(path) and rawpy is not None:
            try:
                with rawpy.imread(path) as raw:
                    t = raw.extract_thumb()
                    flip = raw.sizes.flip
                if t.format == rawpy.ThumbFormat.JPEG:
                    a = np.asarray(ImageOps.exif_transpose(Image.open(io.BytesIO(t.data))).convert('RGB'))
                    if a.shape[1] > a.shape[0] and flip in (5, 6):   # embedded preview stored unrotated
                        a = np.rot90(a, 1 if flip == 5 else -1)
                else:
                    a = t.data
            except Exception:
                a = None
        if a is None:
            a = decode(path, half=True, draft=640)
        a = apply_orient(np.asarray(a), row['orient'] or 0)
    else:
        a = base_image(row, 640)
    return jpeg(resize_long(a, 480), 84)


@img
def thumb(rest, q):
    pid = int(rest)
    e = _preview_file('e', pid)
    if os.path.exists(e) and q.get('raw') != '1':
        with open(e, 'rb') as f:
            return Binary(f.read(), 'image/jpeg', cache=True)
    t = _preview_file('t', pid)
    if not os.path.exists(t):
        data = make_thumb(core.cat().photo(pid))
        with open(t, 'wb') as f:
            f.write(data)
        return Binary(data, 'image/jpeg', cache=True)
    with open(t, 'rb') as f:
        return Binary(f.read(), 'image/jpeg', cache=True)


@upload
def thumb_put(q, body):
    with open(_preview_file('e', int(q['id'])), 'wb') as f:
        f.write(body)
    return True


@api
def thumb_clear(ids, source=False):
    for i in ids:
        for kind in ('e', 't') if source else ('e',):
            p = _preview_file(kind, i)
            if os.path.exists(p):
                os.remove(p)
    return True


@img
def src(rest, q):
    row = core.cat().photo(int(rest))
    return Binary(jpeg(base_image(row, int(q.get('size', 0))), 92), 'image/jpeg', cache=True)


@api
def src_render(id, size=0, spots=None):
    """Source pixels for the develop pipeline, with spot edits baked in (they need real neighbourhood maths)."""
    row = core.cat().photo(id)
    a = base_image(row, size)
    if spots:
        a = apply_retouch(a.copy(), spots)
    return Binary(jpeg(a, 96 if not size else 92), 'image/jpeg')


@img
def disk(rest, q):
    """Thumbnail of a file that is not in the catalog (import dialog, pickers)."""
    path = q['path']
    if not is_image(path) or not os.path.exists(path):
        raise ApiError('Not an image')
    size = int(q.get('size', 240))
    key = (path, os.path.getmtime(path), size)
    with _lock:
        if key in _disk:
            return Binary(_disk[key], 'image/jpeg', cache=True)
    a = None
    if is_raw(path) and rawpy is not None:
        try:
            with rawpy.imread(path) as raw:
                t = raw.extract_thumb()
            if t.format == rawpy.ThumbFormat.JPEG:
                a = np.asarray(ImageOps.exif_transpose(Image.open(io.BytesIO(t.data))).convert('RGB'))
        except Exception:
            a = None
    if a is None:
        a = decode(path, half=True, draft=size * 2)
    data = jpeg(resize_long(a, size), 80)
    _put(_disk, key, data, 600)
    return Binary(data, 'image/jpeg', cache=True)


@img
def file(rest, q):
    """Serve a local image file as-is (identity plate / watermark graphics)."""
    path = q['path']
    ext = os.path.splitext(path)[1].lower()
    types = {'.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
             '.webp': 'image/webp', '.svg': 'image/svg+xml', '.bmp': 'image/bmp'}
    if ext not in types or not os.path.isfile(path):
        raise ApiError('Not a displayable image')
    with open(path, 'rb') as f:
        return Binary(f.read(), types[ext])


@api
def photo_rotate(ids, orients):
    """Store new user orientations and drop the previews that baked the old one in."""
    cat = core.cat()
    cat.xm('UPDATE photos SET orient=?, ver=ver+1 WHERE id=?', list(zip(orients, ids)))
    thumb_clear(ids, source=True)
    for i in ids:
        for kind in ('d',):
            p = _preview_file(kind, i)
            if os.path.exists(p):
                os.remove(p)
    return True


def smart_build(job, ids):
    cat = core.cat()
    rows = [cat.photo(i) for i in ids]
    job.total = len(rows)
    built = 0
    for r in rows:
        if job.cancel:
            break
        job.step(os.path.basename(r['path']))
        sp = smart_path(r)
        if os.path.exists(sp) or not os.path.exists(r['path']):
            continue
        Image.fromarray(resize_long(decode(r['path']), SMART_SIZE)).save(sp, 'JPEG', quality=90)
        built += 1
        master = r['master_id'] or r['id']
        cat.x('UPDATE photos SET smart=1 WHERE id=? OR master_id=?', (master, master))
    return {'built': built}


@api
def smart_previews_build(ids):
    return core.start_job('Building Smart Previews', smart_build, ids)


@api
def smart_previews_discard(ids):
    cat = core.cat()
    n = 0
    for i in ids:
        r = cat.photo(i)
        sp = smart_path(r)
        if os.path.exists(sp):
            os.remove(sp)
            n += 1
        master = r['master_id'] or r['id']
        cat.x('UPDATE photos SET smart=0 WHERE id=? OR master_id=?', (master, master))
    return n


# ---------------------------------------------------------------- retouch (clone / heal / content-aware remove)

def _spot_mask(shape, s):
    h, w = shape[:2]
    m = np.zeros((h, w), np.uint8)
    r = max(1, int(round(s['r'] * max(w, h))))
    pts = s.get('pts') or [[s['x'], s['y']]]
    P = [(int(round(x * w)), int(round(y * h))) for x, y in pts]
    if len(P) > 1:
        cv2.polylines(m, [np.array(P, np.int32)], False, 255, r * 2, cv2.LINE_AA)
    for p in (P[0], P[-1]):
        cv2.circle(m, p, r, 255, -1, cv2.LINE_AA)
    return m, r


def _roi(mask, pad):
    h, w = mask.shape
    x, y, bw, bh = cv2.boundingRect(mask)
    return max(0, x - pad), max(0, y - pad), min(w, x + bw + pad), min(h, y + bh + pad)


def find_source(a, mask, r):
    """Pick the nearby patch whose surroundings best match the hole's surroundings (masked template match)."""
    h, w = mask.shape
    pad = max(6, r)
    x0, y0, x1, y1 = _roi(mask, pad)
    tw, th = x1 - x0, y1 - y0
    if tw < 4 or th < 4:
        return None
    sx0, sy0 = max(0, x0 - tw * 5), max(0, y0 - th * 5)
    sx1, sy1 = min(w, x1 + tw * 5), min(h, y1 + th * 5)
    f = min(1.0, 72.0 / max(tw, th))
    search = a[sy0:sy1, sx0:sx1]
    templ = a[y0:y1, x0:x1]
    ctx = (cv2.dilate(mask[y0:y1, x0:x1], np.ones((3, 3), np.uint8), iterations=2) == 0).astype(np.float32)
    if f < 1:
        search = cv2.resize(search, None, fx=f, fy=f, interpolation=cv2.INTER_AREA)
        templ = cv2.resize(templ, None, fx=f, fy=f, interpolation=cv2.INTER_AREA)
        ctx = cv2.resize(ctx, (templ.shape[1], templ.shape[0]), interpolation=cv2.INTER_NEAREST)
    if search.shape[0] <= templ.shape[0] or search.shape[1] <= templ.shape[1] or ctx.sum() < 8:
        return None
    res = cv2.matchTemplate(search.astype(np.float32), templ.astype(np.float32), cv2.TM_SQDIFF,
                            mask=np.dstack([ctx, ctx, ctx]))
    res = np.nan_to_num(res, nan=1e18, posinf=1e18)
    ox, oy = (x0 - sx0) * f, (y0 - sy0) * f                     # where the hole itself sits in the result map
    ys, xs = np.mgrid[0:res.shape[0], 0:res.shape[1]]
    res[(np.abs(xs - ox) < templ.shape[1] * 0.85) & (np.abs(ys - oy) < templ.shape[0] * 0.85)] = 1e18
    _, _, loc, _ = cv2.minMaxLoc(res)
    dx, dy = (loc[0] - ox) / f, (loc[1] - oy) / f
    return dx, dy


def apply_retouch(a, spots):
    h, w = a.shape[:2]
    for s in spots:
        mask, r = _spot_mask(a.shape, s)
        opacity = float(s.get('opacity', 100)) / 100
        feather = float(s.get('feather', 50)) / 100
        kind = s.get('type', 'heal')
        if s.get('sx') is None:
            d = find_source(a, mask, r)
        else:
            d = ((s['sx'] - s['x']) * w, (s['sy'] - s['y']) * h)
        pad = r + 6
        x0, y0, x1, y1 = _roi(mask, pad)
        if x1 - x0 < 2 or y1 - y0 < 2:
            continue
        m = mask[y0:y1, x0:x1]
        dst = a[y0:y1, x0:x1]
        if d is None:   # nothing to borrow from: diffuse the surroundings inwards instead
            fill = cv2.inpaint(dst, m, max(3, r // 2), cv2.INPAINT_TELEA)
            alpha = (cv2.GaussianBlur(m, (0, 0), max(0.6, r * 0.15)).astype(np.float32) / 255 * opacity)[..., None]
            a[y0:y1, x0:x1] = (fill * alpha + dst * (1 - alpha)).astype(np.uint8)
            continue
        dx, dy = int(round(d[0])), int(round(d[1]))
        ys = np.clip(np.arange(y0, y1) + dy, 0, h - 1)
        xs = np.clip(np.arange(x0, x1) + dx, 0, w - 1)
        patch = np.ascontiguousarray(a[np.ix_(ys, xs)])
        done = False
        if kind in ('heal', 'remove'):
            try:
                mm = m.copy()
                if x0 == 0: mm[:, :2] = 0
                if y0 == 0: mm[:2, :] = 0
                if x1 == w: mm[:, -2:] = 0
                if y1 == h: mm[-2:, :] = 0
                bx, by, bw, bh = cv2.boundingRect(mm)
                if bw > 2 and bh > 2:
                    center = (x0 + bx + bw // 2, y0 + by + bh // 2)
                    healed = cv2.seamlessClone(patch, a, mm, center, cv2.NORMAL_CLONE)[y0:y1, x0:x1]
                    alpha = (cv2.GaussianBlur(mm, (0, 0), max(0.6, r * 0.08)).astype(np.float32) / 255 * opacity)[..., None]
                    a[y0:y1, x0:x1] = (healed * alpha + dst * (1 - alpha)).astype(np.uint8)
                    done = True
            except cv2.error:
                done = False
        if not done:
            alpha = (cv2.GaussianBlur(m, (0, 0), max(0.6, r * feather * 0.5)).astype(np.float32) / 255 * opacity)[..., None]
            a[y0:y1, x0:x1] = (patch * alpha + dst * (1 - alpha)).astype(np.uint8)
    return a


@api
def retouch_auto(id, spot, spots=None):
    """Choose a source for a new spot; returns normalised source centre or None."""
    row = core.cat().photo(id)
    a = base_image(row, 2048)
    if spots:
        a = apply_retouch(a.copy(), spots)
    mask, r = _spot_mask(a.shape, spot)
    d = find_source(a, mask, r)
    if d is None:
        return None
    h, w = a.shape[:2]
    return {'sx': spot['x'] + d[0] / w, 'sy': spot['y'] + d[1] / h}


# ---------------------------------------------------------------- analysis

@img
def depth(rest, q):
    """Estimated depth (0 near, 255 far) from focus, haze and position cues. A stand-in for a real depth map."""
    pid = int(rest)
    p = _preview_file('d', pid)
    if not os.path.exists(p):
        a = base_image(core.cat().photo(pid), 512)
        h, w = a.shape[:2]
        g = cv2.cvtColor(a, cv2.COLOR_RGB2GRAY).astype(np.float32) / 255
        foc = cv2.GaussianBlur(np.abs(cv2.Laplacian(g, cv2.CV_32F, ksize=3)), (0, 0), w * 0.035)
        foc = np.sqrt(foc / (foc.max() + 1e-6))
        dark = cv2.erode(a.min(axis=2), np.ones((9, 9), np.uint8)).astype(np.float32) / 255
        dark = cv2.GaussianBlur(dark, (0, 0), w * 0.02)
        yy = np.linspace(0, 1, h, dtype=np.float32)[:, None] * np.ones((1, w), np.float32)
        near = 0.45 * yy + 0.35 * foc + 0.20 * (1 - dark)
        near = cv2.GaussianBlur(near, (0, 0), w * 0.012)
        near = (near - near.min()) / (near.max() - near.min() + 1e-6)
        cv2.imencode('.jpg', ((1 - near) * 255).astype(np.uint8), [cv2.IMWRITE_JPEG_QUALITY, 88])[1].tofile(p)
    with open(p, 'rb') as f:
        return Binary(f.read(), 'image/jpeg')


def _vanish(lines, weights):
    """Robust least-squares vanishing point of homogeneous lines (iteratively re-weighted)."""
    if len(lines) < 2:
        return None
    L = np.array(lines, np.float64)
    wts = np.array(weights, np.float64)
    v = None
    for _ in range(5):
        M = (L * wts[:, None]).T @ L
        _, vecs = np.linalg.eigh(M)
        v = vecs[:, 0]
        res = np.abs(L @ v) / (np.linalg.norm(v[:2]) + 1e-9 if abs(v[2]) < 1e-9 else np.linalg.norm(v))
        sigma = max(float(np.median(res)), 1e-4) * 1.5
        wts = np.array(weights) / (1 + (res / sigma) ** 2)
    return [float(x) for x in v]


@api
def upright_analyze(id):
    """Detect dominant vertical/horizontal structure. Coordinates are centred and in units of image height."""
    a = base_image(core.cat().photo(id), 1200)
    h, w = a.shape[:2]
    g = cv2.cvtColor(a, cv2.COLOR_RGB2GRAY)
    segs = cv2.createLineSegmentDetector().detect(g)[0]
    out = {'v': None, 'h': None, 'angle': 0.0, 'nv': 0, 'nh': 0}
    if segs is None:
        return out
    minlen = 0.05 * np.hypot(w, h)
    V, H, wv, wh, av, ah = [], [], [], [], [], []
    for x1, y1, x2, y2 in segs.reshape(-1, 4):
        ln = np.hypot(x2 - x1, y2 - y1)
        if ln < minlen:
            continue
        p1 = np.array([(x1 - w / 2) / h, (y1 - h / 2) / h, 1.0])
        p2 = np.array([(x2 - w / 2) / h, (y2 - h / 2) / h, 1.0])
        l = np.cross(p1, p2)
        l = l / (np.hypot(l[0], l[1]) + 1e-12)
        ang = np.degrees(np.arctan2(y2 - y1, x2 - x1)) % 180          # 0 = horizontal, 90 = vertical
        if abs(ang - 90) < 22:
            V.append(l); wv.append(ln); av.append(ang - 90)
        elif ang < 22 or ang > 158:
            H.append(l); wh.append(ln); ah.append(ang if ang < 90 else ang - 180)
    out['nv'], out['nh'] = len(V), len(H)
    out['v'], out['h'] = _vanish(V, wv), _vanish(H, wh)

    def wmedian(vals, wts):
        if not vals:
            return None
        order = np.argsort(vals)
        cs = np.cumsum(np.array(wts)[order])
        return float(np.array(vals)[order][np.searchsorted(cs, cs[-1] / 2)])
    mh, mv = wmedian(ah, wh), wmedian(av, wv)
    out['angle'] = mh if (mh is not None and sum(wh) >= sum(wv)) else (mv if mv is not None else (mh or 0.0))
    return out


@api
def ca_estimate(id):
    """Lateral chromatic aberration: radial scale of red and blue that best aligns their edges with green."""
    a = base_image(core.cat().photo(id), 1600).astype(np.float32)
    h, w = a.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    rad = ((xx - w / 2) ** 2 + (yy - h / 2) ** 2) / ((w / 2) ** 2 + (h / 2) ** 2)

    def grad(ch):
        return cv2.Sobel(ch, cv2.CV_32F, 1, 0, ksize=3), cv2.Sobel(ch, cv2.CV_32F, 0, 1, ksize=3)
    ggx, ggy = grad(a[..., 1])
    out = {}
    for name, idx in (('r', 0), ('b', 2)):
        best, bk = -1e30, 1.0
        for k in np.linspace(0.9965, 1.0035, 29):
            M = np.float32([[k, 0, (1 - k) * w / 2], [0, k, (1 - k) * h / 2]])
            ch = cv2.warpAffine(a[..., idx], M, (w, h), flags=cv2.INTER_LINEAR | cv2.WARP_INVERSE_MAP,
                                borderMode=cv2.BORDER_REPLICATE)
            gx, gy = grad(ch)
            score = float(((gx * ggx + gy * ggy) * rad).sum())
            if score > best:
                best, bk = score, float(k)
        out[name] = round(bk - 1.0, 6)
    return out

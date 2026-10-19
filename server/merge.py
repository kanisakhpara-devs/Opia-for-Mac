"""Photo Merge: panorama stitching (with Boundary Warp / Fill Edges / Auto Crop) and HDR exposure fusion."""
import os

import cv2
import numpy as np
from PIL import Image

from . import core, files, imaging
from .core import api, ApiError, Binary

_preview = {}


def _valid_mask(bgr):
    """Pixels that belong to the stitched image: everything not connected to the border through pure black."""
    h, w = bgr.shape[:2]
    black = (bgr.max(axis=2) == 0).astype(np.uint8)
    pad = np.zeros((h + 2, w + 2), np.uint8)
    pad[1:-1, 1:-1] = black
    ff = np.zeros((h + 4, w + 4), np.uint8)
    pad[0, :], pad[-1, :], pad[:, 0], pad[:, -1] = 1, 1, 1, 1
    cv2.floodFill(pad, ff, (0, 0), 2)
    return (pad[1:-1, 1:-1] != 2).astype(np.uint8) * 255


def _smooth(v, k):
    k = max(3, int(k) | 1)
    return cv2.GaussianBlur(v.astype(np.float32).reshape(1, -1), (k, 1), 0).ravel()


def boundary_warp(img, mask, amount):
    """Stretch the uneven panorama outline towards the rectangular frame (0-100)."""
    a = max(0.0, min(1.0, amount / 100.0))
    if a <= 0:
        return img, mask
    for axis in (0, 1):
        h, w = mask.shape
        m = mask > 0
        if axis == 0:   # move rows: per column first/last valid row
            any_ = m.any(axis=0)
            lo = np.where(any_, m.argmax(axis=0), 0)
            hi = np.where(any_, h - 1 - m[::-1].argmax(axis=0), h - 1)
            lo, hi = _smooth(lo, w * 0.03), _smooth(hi, w * 0.03)
            yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
            t = yy / max(1, h - 1)
            src = lo[None, :] + t * (hi - lo)[None, :]
            mapy, mapx = yy * (1 - a) + src * a, xx
        else:
            any_ = m.any(axis=1)
            lo = np.where(any_, m.argmax(axis=1), 0)
            hi = np.where(any_, w - 1 - m[:, ::-1].argmax(axis=1), w - 1)
            lo, hi = _smooth(lo, h * 0.03), _smooth(hi, h * 0.03)
            yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
            t = xx / max(1, w - 1)
            src = lo[:, None] + t * (hi - lo)[:, None]
            mapx, mapy = xx * (1 - a) + src * a, yy
        img = cv2.remap(img, mapx.astype(np.float32), mapy.astype(np.float32), cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)
        mask = cv2.remap(mask, mapx.astype(np.float32), mapy.astype(np.float32), cv2.INTER_NEAREST, borderMode=cv2.BORDER_CONSTANT)
    return img, mask


def fill_edges(img, mask):
    """Synthesize the empty corners. Done at reduced size (it is slow) then blended in, so the fill is soft."""
    hole = (mask == 0).astype(np.uint8) * 255
    if not hole.any():
        return img
    h, w = mask.shape
    s = min(1.0, 900.0 / max(w, h))
    small = cv2.resize(img, None, fx=s, fy=s, interpolation=cv2.INTER_AREA)
    sh = cv2.dilate(cv2.resize(hole, (small.shape[1], small.shape[0]), interpolation=cv2.INTER_NEAREST), np.ones((3, 3), np.uint8))
    filled = cv2.resize(cv2.inpaint(small, sh, 6, cv2.INPAINT_TELEA), (w, h), interpolation=cv2.INTER_CUBIC)
    alpha = (cv2.GaussianBlur(cv2.dilate(hole, np.ones((5, 5), np.uint8)), (0, 0), 2).astype(np.float32) / 255)[..., None]
    return (filled * alpha + img * (1 - alpha)).astype(np.uint8)


def auto_crop(mask):
    """Largest axis-aligned rectangle of valid pixels (greedy shrink from the full frame)."""
    h, w = mask.shape
    m = mask > 0
    x0, y0, x1, y1 = 0, 0, w, h
    for _ in range(w + h):
        if x1 - x0 < 8 or y1 - y0 < 8:
            break
        edges = [(1 - m[y0, x0:x1].mean(), 't'), (1 - m[y1 - 1, x0:x1].mean(), 'b'),
                 (1 - m[y0:y1, x0].mean(), 'l'), (1 - m[y0:y1, x1 - 1].mean(), 'r')]
        bad, side = max(edges)
        if bad <= 0.002:
            break
        if side == 't': y0 += 1
        elif side == 'b': y1 -= 1
        elif side == 'l': x0 += 1
        else: x1 -= 1
    return x0, y0, x1, y1


def _load(ids, size):
    cat = core.cat()
    rows = [cat.photo(i) for i in ids]
    return rows, [cv2.cvtColor(imaging.base_image(r, size), cv2.COLOR_RGB2BGR) for r in rows]


def pano(ids, opts, size):
    if len(ids) < 2:
        raise ApiError('Select at least two overlapping photos')
    rows, imgs = _load(ids, size)
    mode = cv2.Stitcher_SCANS if opts.get('projection') == 'scans' else cv2.Stitcher_PANORAMA
    st = cv2.Stitcher.create(mode)
    status, out = st.stitch(imgs)
    if status != cv2.Stitcher_OK:
        reason = {1: 'not enough overlapping detail between the photos', 2: 'the photos could not be aligned',
                  3: 'camera parameters could not be estimated'}.get(status, 'unknown error')
        raise ApiError('Unable to merge the panorama: ' + reason)
    mask = _valid_mask(out)
    out, mask = boundary_warp(out, mask, float(opts.get('boundaryWarp', 0)))
    if opts.get('fillEdges'):
        out = fill_edges(out, mask)
    elif opts.get('autoCrop', True):
        x0, y0, x1, y1 = auto_crop(mask)
        out = out[y0:y1, x0:x1]
    return rows, out


def hdr(ids, opts, size):
    if len(ids) < 2:
        raise ApiError('Select at least two bracketed exposures')
    rows, imgs = _load(ids, size)
    shape = imgs[0].shape
    if any(i.shape != shape for i in imgs):
        raise ApiError('Bracketed exposures must all have the same dimensions')
    mask = np.full(shape[:2], 255, np.uint8)
    if opts.get('align', True):
        mtb = cv2.createAlignMTB()
        ref = cv2.cvtColor(imgs[len(imgs) // 2], cv2.COLOR_BGR2GRAY)
        aligned = []
        for im in imgs:
            sx, sy = mtb.calculateShift(ref, cv2.cvtColor(im, cv2.COLOR_BGR2GRAY))
            M = np.float32([[1, 0, sx], [0, 1, sy]])
            aligned.append(cv2.warpAffine(im, M, (shape[1], shape[0]), borderMode=cv2.BORDER_CONSTANT))
            mask = cv2.bitwise_and(mask, cv2.warpAffine(np.full(shape[:2], 255, np.uint8), M, (shape[1], shape[0])))
        imgs = aligned
    fused = cv2.createMergeMertens(1.0, float(opts.get('saturation', 1.0)), 1.0).process(imgs)
    out = np.clip(fused * 255, 0, 255).astype(np.uint8)
    if (mask == 0).any():
        if opts.get('fillEdges'):
            out = fill_edges(out, mask)
        else:
            x0, y0, x1, y1 = auto_crop(mask)
            out = out[y0:y1, x0:x1]
    return rows, out


def focus(ids, opts, size):
    """Focus stacking: line the frames up, then build the picture from whichever frame is sharpest at each point."""
    if len(ids) < 2:
        raise ApiError('Select at least two photos focused at different distances')
    rows, imgs = _load(ids, size)
    shape = imgs[0].shape
    if any(i.shape != shape for i in imgs):
        raise ApiError('The photos must all have the same dimensions')
    h, w = shape[:2]
    mask = np.full((h, w), 255, np.uint8)
    if opts.get('align', True):
        k = 800 / max(h, w)
        small = lambda im: cv2.resize(cv2.cvtColor(im, cv2.COLOR_BGR2GRAY), None, fx=k, fy=k, interpolation=cv2.INTER_AREA)
        ref = small(imgs[0])
        aligned = [imgs[0]]
        for im in imgs[1:]:
            M = np.eye(2, 3, dtype=np.float32)
            try:
                _cc, M = cv2.findTransformECC(ref, small(im), M, cv2.MOTION_AFFINE, (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 60, 1e-5), None, 5)
            except cv2.error:
                pass                  # too little in common to line up: use the frame as it is
            M[:, 2] /= k
            flags = cv2.INTER_LINEAR | cv2.WARP_INVERSE_MAP
            aligned.append(cv2.warpAffine(im, M, (w, h), flags=flags, borderMode=cv2.BORDER_REFLECT))
            mask = cv2.bitwise_and(mask, cv2.warpAffine(np.full((h, w), 255, np.uint8), M, (w, h), flags=flags))
        imgs = aligned
    blur = max(3, int(opts.get('smooth', 9)) | 1)
    detail = np.stack([cv2.GaussianBlur(np.abs(cv2.Laplacian(cv2.GaussianBlur(cv2.cvtColor(i, cv2.COLOR_BGR2GRAY), (3, 3), 0), cv2.CV_32F, ksize=3)), (blur, blur), 0) for i in imgs])
    weights = (detail + 1e-6) ** 4          # strongly favour the sharpest frame, but blend at the joins
    weights /= weights.sum(0)
    out = np.clip(sum(wt[..., None] * im.astype(np.float32) for wt, im in zip(weights, imgs)), 0, 255).astype(np.uint8)
    if (mask == 0).any():
        x0, y0, x1, y1 = auto_crop(mask)
        out = out[y0:y1, x0:x1]
    return rows, out


KINDS = {'pano': (pano, '-Pano'), 'hdr': (hdr, '-HDR'), 'focus': (focus, '-Focus')}


def _run(job, ids, kind, opts):
    job.total = 3
    job.step('Merging %d photos' % len(ids))
    size = int(opts.get('size') or 3000)
    rows, out = KINDS[kind][0](ids, opts, size)
    job.step('Writing file')
    first = rows[0]['path']
    folder = os.path.dirname(first) if os.path.isdir(os.path.dirname(first)) else core.cat().dir
    base = os.path.splitext(os.path.basename(first))[0] + KINDS[kind][1]
    target = files.unique_path(os.path.join(folder, base + '.jpg'))
    kw = {}
    try:
        with Image.open(first) as src:
            ex = src.getexif()
            ex.pop(0x0112, None)
            kw['exif'] = ex.tobytes()
    except Exception:
        pass
    Image.fromarray(cv2.cvtColor(out, cv2.COLOR_BGR2RGB)).save(target, 'JPEG', quality=96, subsampling=0, **kw)
    job.step('Adding to catalog')
    res = files.import_files(None, [target], stack_with=ids[0] if opts.get('stack') else None)
    return {'path': target, 'photos': res['photos'], 'width': out.shape[1], 'height': out.shape[0]}


@api
def merge_run(ids, kind='pano', opts=None):
    return core.start_job('Photo Merge', _run, ids, kind, opts or {})


def _prev(job, ids, kind, opts):
    job.total = 1
    _rows, out = KINDS[kind][0](ids, opts or {}, 900)
    key = 'p%d' % (len(_preview) + 1)
    _preview.clear()
    _preview[key] = cv2.imencode('.jpg', out, [cv2.IMWRITE_JPEG_QUALITY, 88])[1].tobytes()
    job.step()
    return {'key': key, 'width': out.shape[1], 'height': out.shape[0]}


@api
def merge_preview(ids, kind='pano', opts=None):
    return core.start_job('Merge preview', _prev, ids, kind, opts)


@core.img
def mergeprev(rest, q):
    if rest not in _preview:
        raise ApiError('Preview expired')
    return Binary(_preview[rest], 'image/jpeg')

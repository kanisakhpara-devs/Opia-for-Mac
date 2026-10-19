"""Library helpers that look at the pictures themselves: finding duplicates and judging which frame is sharpest."""
import io
import os

import cv2
import numpy as np
from PIL import Image

from . import core, imaging
from .core import api

_hash = {}      # (photo id, file mtime) -> 64-bit difference hash


def _thumb(row):
    """A small rendition of the photo, reusing the catalog's thumbnail when there is one."""
    t = imaging._preview_file('t', row['id'])
    if os.path.exists(t):
        return Image.open(t).convert('L')
    return Image.open(io.BytesIO(imaging.make_thumb(row))).convert('L')


def _dhash(row):
    """Difference hash: shrink to 9x8 grey and record whether each pixel is brighter than its neighbour.
    Copies, resizes and re-saves of the same picture come out almost identical."""
    try:
        key = (row['id'], os.path.getmtime(row['path']) if os.path.exists(row['path']) else 0)
    except OSError:
        key = (row['id'], 0)
    if key not in _hash:
        a = np.asarray(_thumb(row).resize((9, 8), Image.LANCZOS), dtype=np.int16)
        _hash[key] = np.packbits((a[:, 1:] > a[:, :-1]).flatten())
    return _hash[key]


def _find(job, tolerance):
    cat = core.cat()
    rows = [r for r in cat.q('SELECT * FROM photos ORDER BY capture_time, id') if not r['copy_name']]
    job.total = len(rows) + 1
    ids, hashes = [], []
    for r in rows:
        job.step('Looking at ' + os.path.basename(r['path']))
        try:
            hashes.append(_dhash(r))
            ids.append(r['id'])
        except Exception:
            continue
    job.step('Comparing')
    groups, seen = [], set()
    if hashes:
        H = np.unpackbits(np.stack(hashes), axis=1).astype(np.int16)
        for i in range(len(ids)):
            if ids[i] in seen:
                continue
            near = np.flatnonzero((H[i + 1:] != H[i]).sum(1) <= tolerance) + i + 1
            group = [ids[i]] + [ids[j] for j in near if ids[j] not in seen]
            if len(group) > 1:
                seen.update(group)
                groups.append(group)
    return {'groups': groups, 'checked': len(ids)}


@api
def duplicates_find(tolerance=4):
    return core.start_job('Finding duplicates', _find, int(tolerance))


@api
def sharpness(ids):
    """How much fine detail each photo holds (variance of the Laplacian); the highest is the sharpest frame."""
    cat = core.cat()
    out = {}
    for i in ids:
        try:
            g = cv2.cvtColor(imaging.base_image(cat.photo(i), 1400), cv2.COLOR_RGB2GRAY)
            out[str(i)] = float(cv2.Laplacian(g, cv2.CV_64F).var())
        except Exception:
            out[str(i)] = 0.0
    return out

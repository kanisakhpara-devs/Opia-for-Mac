"""People view: local face detection (YuNet) and recognition (SFace) through OpenCV. Nothing leaves the machine."""
import os
import threading

import cv2
import numpy as np

from . import core, imaging
from .core import api, img, ApiError, Binary

DET = os.path.join(core.MODELS, 'face_detection_yunet_2023mar.onnx')
REC = os.path.join(core.MODELS, 'face_recognition_sface_2021dec.onnx')
SAME, SUGGEST = 0.40, 0.46     # cosine similarity: join a cluster / suggest a named person
_models, _mlock = {}, threading.Lock()


def models_ok():
    return os.path.exists(DET) and os.path.exists(REC)


def _load():
    with _mlock:
        if not _models:
            if not models_ok():
                raise ApiError('Face models are missing from the models folder')
            _models['det'] = cv2.FaceDetectorYN.create(DET, '', (320, 320), 0.8, 0.3, 500)
            _models['rec'] = cv2.FaceRecognizerSF.create(REC, '')
        return _models['det'], _models['rec']


def _face_file(fid):
    d = os.path.join(core.cat().previews, 'f')
    os.makedirs(d, exist_ok=True)
    return os.path.join(d, '%d.jpg' % fid)


def _feats(rows):
    F = np.array([np.frombuffer(r['feat'], np.float32) for r in rows], np.float32)
    return F / (np.linalg.norm(F, axis=1, keepdims=True) + 1e-9)


def recluster():
    """Group unnamed faces; a negative cluster id means 'probably person -id'."""
    cat = core.cat()
    rows = cat.q('SELECT id, feat, person_id FROM faces WHERE feat IS NOT NULL')
    if not rows:
        return
    F = _feats(rows)
    named = {}
    for r, f in zip(rows, F):
        if r['person_id']:
            named.setdefault(r['person_id'], []).append(f)
    pids = list(named)
    P = np.array([np.mean(named[p], axis=0) for p in pids], np.float32) if pids else np.zeros((0, F.shape[1]), np.float32)
    if len(P):
        P /= np.linalg.norm(P, axis=1, keepdims=True) + 1e-9
    cents, counts, updates = [], [], []
    for r, f in zip(rows, F):
        if r['person_id']:
            continue
        if len(P):
            sims = P @ f
            k = int(np.argmax(sims))
            if sims[k] >= SUGGEST:
                updates.append((-pids[k], r['id']))
                continue
        best, bk = 0.0, -1
        for k, c in enumerate(cents):
            s = float(c @ f) / (np.linalg.norm(c) + 1e-9)
            if s > best:
                best, bk = s, k
        if best >= SAME:
            cents[bk] = cents[bk] + f
            counts[bk] += 1
        else:
            cents.append(f.copy())
            counts.append(1)
            bk = len(cents) - 1
        updates.append((bk + 1, r['id']))
    cat.xm('UPDATE faces SET cluster=? WHERE id=?', updates)
    cat.x('UPDATE faces SET cluster=NULL WHERE person_id IS NOT NULL')


def _scan(job, ids, rescan):
    cat = core.cat()
    det, rec = _load()
    done = set(cat.get('faces_scanned', []))
    rows = []
    for i in ids:
        r = cat.photo(i)
        if r['master_id'] is None and (rescan or r['id'] not in done):
            rows.append(r)
    job.total = len(rows)
    found = 0
    for r in rows:
        if job.cancel:
            break
        job.step(os.path.basename(r['path']))
        try:
            a = imaging.base_image(r, 1280)
        except Exception:
            continue
        if rescan:
            cat.x('DELETE FROM faces WHERE photo_id=? AND person_id IS NULL', (r['id'],))
        bgr = cv2.cvtColor(a, cv2.COLOR_RGB2BGR)
        h, w = bgr.shape[:2]
        with _mlock:
            det.setInputSize((w, h))
            _n, faces = det.detect(bgr)
        for f in (faces if faces is not None else []):
            x, y, fw, fh = [float(v) for v in f[:4]]
            if min(fw, fh) < 28:
                continue
            with _mlock:
                feat = rec.feature(rec.alignCrop(bgr, f)).astype(np.float32).ravel()
            fid = cat.x('INSERT INTO faces(photo_id, x, y, w, h, feat) VALUES(?,?,?,?,?,?)',
                        (r['id'], x / w, y / h, fw / w, fh / h, feat.tobytes()))
            m = 0.35
            x0, y0 = int(max(0, x - fw * m)), int(max(0, y - fh * m))
            x1, y1 = int(min(w, x + fw * (1 + m))), int(min(h, y + fh * (1 + m)))
            crop = imaging.resize_long(a[y0:y1, x0:x1], 200)
            with open(_face_file(fid), 'wb') as fh_:
                fh_.write(imaging.jpeg(crop, 86))
            found += 1
        done.add(r['id'])
    cat.set('faces_scanned', sorted(done))
    recluster()
    return {'found': found, 'scanned': len(rows), **people_get()}


@api
def faces_scan(ids, rescan=False):
    return core.start_job('Finding faces', _scan, ids, rescan)


@api
def people_get():
    cat = core.cat()
    return {'people': cat.q('SELECT * FROM people'), 'available': models_ok(),
            'faces': cat.q('SELECT id, photo_id, x, y, w, h, person_id, cluster FROM faces')}


@api
def face_name(face_ids, name):
    cat = core.cat()
    name = name.strip()
    if not name:
        raise ApiError('Enter a name')
    p = cat.one('SELECT id FROM people WHERE name=? COLLATE NOCASE', (name,))
    pid = p['id'] if p else cat.x('INSERT INTO people(name) VALUES(?)', (name,))
    cat.xm('UPDATE faces SET person_id=? WHERE id=?', [(pid, f) for f in face_ids])
    recluster()
    return people_get()


@api
def face_unname(face_ids):
    core.cat().xm('UPDATE faces SET person_id=NULL WHERE id=?', [(f,) for f in face_ids])
    recluster()
    return people_get()


@api
def face_delete(face_ids):
    cat = core.cat()
    cat.xm('DELETE FROM faces WHERE id=?', [(f,) for f in face_ids])
    for f in face_ids:
        p = _face_file(f)
        if os.path.exists(p):
            os.remove(p)
    return people_get()


@api
def person_update(id, name=None, delete=False):
    cat = core.cat()
    if delete:
        cat.x('UPDATE faces SET person_id=NULL WHERE person_id=?', (id,))
        cat.x('DELETE FROM people WHERE id=?', (id,))
    elif name:
        other = cat.one('SELECT id FROM people WHERE name=? COLLATE NOCASE AND id<>?', (name.strip(), id))
        if other:   # renaming onto an existing person merges the two
            cat.x('UPDATE faces SET person_id=? WHERE person_id=?', (other['id'], id))
            cat.x('DELETE FROM people WHERE id=?', (id,))
        else:
            cat.x('UPDATE people SET name=? WHERE id=?', (name.strip(), id))
    recluster()
    return people_get()


@img
def face(rest, q):
    p = _face_file(int(rest))
    if not os.path.exists(p):
        raise ApiError('No face thumbnail')
    with open(p, 'rb') as f:
        return Binary(f.read(), 'image/jpeg', cache=True)

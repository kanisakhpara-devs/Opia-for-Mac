"""Tethered capture: watch a folder that camera software saves into, or take frames from a connected webcam."""
import os
import threading
import time

from . import core, files, imaging
from .core import api, upload, ApiError

T = {'active': False, 'folder': '', 'session': 'Tether', 'opts': {}, 'seen': {}, 'new': [], 'count': 0, 'seq': 1, 'gen': 0}
_lock = threading.Lock()


def _import(path):
    o = T['opts']
    res = files.import_files(None, [path], preset=o.get('preset'), develop=o.get('develop'), keywords=o.get('keywords'))
    with _lock:
        T['new'] += res['photos']
        T['count'] += len(res['photos'])


def _watch(gen):
    while T['active'] and T['gen'] == gen:
        try:
            for e in os.scandir(T['folder']):
                if not e.is_file() or not imaging.is_image(e.name):
                    continue
                size = e.stat().st_size
                prev = T['seen'].get(e.path)
                if prev == 'done':
                    continue
                if prev == size and size > 0:      # unchanged since the last pass: the camera finished writing it
                    T['seen'][e.path] = 'done'
                    _import(e.path)
                else:
                    T['seen'][e.path] = size
        except OSError:
            pass
        time.sleep(0.8)


@api
def tether_start(folder, session='Tether', opts=None):
    if not folder:
        raise ApiError('Choose the folder your camera software saves into')
    os.makedirs(folder, exist_ok=True)
    with _lock:
        T.update(active=True, folder=folder, session=session or 'Tether', opts=opts or {}, new=[], count=0,
                 gen=T['gen'] + 1)
        T['seen'] = {e.path: 'done' for e in os.scandir(folder) if e.is_file()}   # only new arrivals count
        T['seq'] = 1 + sum(1 for p in T['seen'] if os.path.basename(p).startswith(T['session'] + '_'))
    threading.Thread(target=_watch, args=(T['gen'],), daemon=True).start()
    return {'active': True, 'folder': folder}


@api
def tether_poll():
    with _lock:
        new, T['new'] = T['new'], []
        return {'active': T['active'], 'photos': new, 'count': T['count'], 'folder': T['folder']}


@api
def tether_stop():
    T['active'] = False
    return True


@upload
def tether_capture(q, body):
    """A frame grabbed in the UI (webcam / capture card). Saved into the session folder and imported at once."""
    if not T['active']:
        raise ApiError('Start a tethered session first')
    with _lock:
        name = '%s_%04d.jpg' % (files.ILLEGAL.sub('_', T['session']), T['seq'])
        T['seq'] += 1
    path = files.unique_path(os.path.join(T['folder'], name))
    with open(path, 'wb') as f:
        f.write(body)
    T['seen'][path] = 'done'
    _import(path)
    return {'path': path}

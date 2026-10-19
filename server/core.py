"""Shared plumbing: paths, API registry, app-level config, background jobs."""
import json
import os
import threading
import time
import traceback
import uuid

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB = os.path.join(ROOT, 'web')
MODELS = os.path.join(ROOT, 'models')
PLUGINS = os.path.join(ROOT, 'plugins')


def _home():
    """Where catalogs and settings live."""
    return os.environ.get('OPIA_HOME') or os.path.join(os.path.expanduser('~'), 'Pictures', 'Opia')


HOME = _home()
CONFIG_PATH = os.path.join(HOME, 'config.json')
APP_NAME = 'Opia'
VERSION = '1.0'

API = {}       # name -> callable(**json_args) returning JSON-able or Binary
UPLOAD = {}    # name -> callable(query_dict, body_bytes)
IMG = {}       # name -> callable(rest_of_path, query_dict) returning Binary or FileRef
STREAM = {}    # name -> callable(query_dict, readable, length): uploads written to disk as they arrive, not held in memory


def api(fn):
    API[fn.__name__] = fn
    return fn


def upload(fn):
    UPLOAD[fn.__name__] = fn
    return fn


def img(fn):
    IMG[fn.__name__] = fn
    return fn


def stream(fn):
    STREAM[fn.__name__] = fn
    return fn


class FileRef:
    """A file on disk served as it is, with byte ranges, so audio and video can be played and seeked without loading them whole."""
    def __init__(self, path, ctype='application/octet-stream'):
        self.path, self.ctype = path, ctype


class Binary:
    def __init__(self, data, ctype='application/octet-stream', cache=False):
        self.data, self.ctype, self.cache = data, ctype, cache


class ApiError(Exception):
    pass


class Config:
    """App-level settings (presets, preferences, recent catalogs) kept in one JSON file."""

    def __init__(self):
        self.lock = threading.RLock()
        self.data = {}
        self.load()

    def load(self):
        try:
            with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
                self.data = json.load(f)
        except (OSError, ValueError):
            self.data = {}

    def save(self):
        with self.lock:
            os.makedirs(HOME, exist_ok=True)
            tmp = CONFIG_PATH + '.tmp'
            with open(tmp, 'w', encoding='utf-8') as f:
                json.dump(self.data, f, indent=1)
            os.replace(tmp, CONFIG_PATH)

    def get(self, key, default=None):
        return self.data.get(key, default)

    def set(self, key, value):
        with self.lock:
            self.data[key] = value
            self.save()


cfg = Config()


class Job:
    def __init__(self, title):
        self.id = uuid.uuid4().hex[:12]
        self.title = title
        self.progress, self.total, self.message = 0, 0, ''
        self.done, self.result, self.error, self.cancel = False, None, None, False

    def step(self, message=None, n=1):
        self.progress += n
        if message is not None:
            self.message = message

    def info(self):
        return {'id': self.id, 'title': self.title, 'progress': self.progress, 'total': self.total,
                'message': self.message, 'done': self.done, 'result': self.result, 'error': self.error}


JOBS = {}


def start_job(title, fn, *args, **kw):
    job = Job(title)
    JOBS[job.id] = job

    def run():
        try:
            job.result = fn(job, *args, **kw)
        except Exception as e:  # surfaced to the UI through job_status
            traceback.print_exc()
            job.error = str(e) or e.__class__.__name__
        job.done = True

    threading.Thread(target=run, daemon=True).start()
    return {'job': job.id}


@api
def job_status(id):
    job = JOBS.get(id)
    if not job:
        raise ApiError('Unknown job')
    info = job.info()
    if job.done:
        JOBS.pop(id, None)
    return info


@api
def job_cancel(id):
    if id in JOBS:
        JOBS[id].cancel = True
    return True


def now():
    return time.time()


# The open catalog lives here so every module can reach it without import cycles.
state = {'cat': None}


def cat():
    c = state['cat']
    if c is None:
        raise ApiError('No catalog is open')
    return c

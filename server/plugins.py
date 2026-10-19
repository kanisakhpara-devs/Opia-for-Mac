"""Plug-in manager: local Python extensions discovered from folders, each with a plugin.json manifest.

A plug-in folder holds:
  plugin.json  {"id", "name", "version", "author", "description", "entry": "plugin.py",
                "commands": [{"id", "title"}]}
  plugin.py    optional functions:  run(command, ctx)   on_export(paths, settings, folder, ctx)   on_import(photos, ctx)
"""
import importlib.util
import json
import os
import sys
import traceback

from . import core
from .core import api, cfg, ApiError

_plugins = {}


class Context:
    """What a plug-in is handed: the selection plus a few safe helpers."""

    def __init__(self, photos=None):
        self.photos = photos or []
        self.home = core.HOME
        self.messages = []

    @property
    def catalog(self):
        return core.cat()

    def log(self, text):
        self.messages.append(str(text))

    def image(self, photo_id, size=1024):
        from . import imaging
        return imaging.base_image(core.cat().photo(photo_id), size)

    def import_files(self, paths):
        from . import files
        return files.import_files(None, list(paths))

    def open(self, path):
        from . import files
        files.fs_open(path)

    def reveal(self, path):
        from . import files
        files.fs_reveal(path)


def _folders():
    out = []
    for base in [core.PLUGINS] + list(cfg.get('plugin_dirs', [])):
        if not os.path.isdir(base):
            continue
        if os.path.exists(os.path.join(base, 'plugin.json')):
            out.append(base)
            continue
        for name in sorted(os.listdir(base)):
            d = os.path.join(base, name)
            if os.path.exists(os.path.join(d, 'plugin.json')):
                out.append(d)
    return out


def load_all():
    _plugins.clear()
    disabled = set(cfg.get('plugins_disabled', []))
    for d in _folders():
        info = {'dir': d, 'module': None, 'error': None, 'builtin': os.path.abspath(d).startswith(os.path.abspath(core.PLUGINS))}
        try:
            with open(os.path.join(d, 'plugin.json'), 'r', encoding='utf-8') as f:
                man = json.load(f)
            pid = man.get('id') or os.path.basename(d)
            info['manifest'] = man
            info['enabled'] = pid not in disabled
            if info['enabled']:
                entry = os.path.join(d, man.get('entry', 'plugin.py'))
                spec = importlib.util.spec_from_file_location('opia_plugin_' + pid.replace('.', '_').replace('-', '_'), entry)
                mod = importlib.util.module_from_spec(spec)
                if d not in sys.path:
                    sys.path.append(d)
                spec.loader.exec_module(mod)
                info['module'] = mod
        except Exception as e:
            pid = os.path.basename(d)
            info.setdefault('manifest', {'id': pid, 'name': pid})
            info.setdefault('enabled', False)
            info['error'] = '%s: %s' % (e.__class__.__name__, e)
            traceback.print_exc()
        _plugins[pid] = info


def fire(hook, *args):
    """Call a hook on every enabled plug-in; returns the messages they produced."""
    msgs = []
    for pid, p in _plugins.items():
        fn = getattr(p['module'], hook, None) if p['module'] else None
        if not fn:
            continue
        ctx = Context()
        try:
            res = fn(*args, ctx)
            msgs += ctx.messages
            if isinstance(res, str) and res:
                msgs.append(res)
        except Exception as e:
            traceback.print_exc()
            msgs.append('%s failed: %s' % (p['manifest'].get('name', pid), e))
    return msgs


@api
def plugins_list():
    return [{'id': pid, 'name': p['manifest'].get('name', pid), 'version': p['manifest'].get('version', ''),
             'author': p['manifest'].get('author', ''), 'description': p['manifest'].get('description', ''),
             'commands': p['manifest'].get('commands', []), 'dir': p['dir'], 'enabled': p['enabled'],
             'error': p['error'], 'builtin': p['builtin'],
             'hooks': [h for h in ('run', 'on_export', 'on_import') if p['module'] and hasattr(p['module'], h)]}
            for pid, p in _plugins.items()]


@api
def plugins_reload():
    load_all()
    return plugins_list()


@api
def plugin_toggle(id, enabled):
    off = set(cfg.get('plugins_disabled', []))
    (off.discard if enabled else off.add)(id)
    cfg.set('plugins_disabled', sorted(off))
    load_all()
    return plugins_list()


@api
def plugin_add(path):
    if not os.path.isdir(path):
        raise ApiError('Choose a folder')
    has = os.path.exists(os.path.join(path, 'plugin.json')) or any(
        os.path.exists(os.path.join(path, n, 'plugin.json')) for n in os.listdir(path))
    if not has:
        raise ApiError('No plugin.json found in that folder')
    dirs = [d for d in cfg.get('plugin_dirs', []) if d != path] + [path]
    cfg.set('plugin_dirs', dirs)
    load_all()
    return plugins_list()


@api
def plugin_remove(id):
    p = _plugins.get(id)
    if not p:
        raise ApiError('Unknown plug-in')
    if p['builtin']:
        raise ApiError('Bundled plug-ins can be disabled but not removed')
    dirs = [d for d in cfg.get('plugin_dirs', []) if os.path.abspath(d) not in (os.path.abspath(p['dir']), os.path.dirname(os.path.abspath(p['dir'])))]
    cfg.set('plugin_dirs', dirs)
    load_all()
    return plugins_list()


@api
def plugin_run(id, command, photo_ids=None):
    from .catalog import photos_out
    p = _plugins.get(id)
    if not p or not p['module']:
        raise ApiError('Plug-in is not loaded')
    fn = getattr(p['module'], 'run', None)
    if not fn:
        raise ApiError('This plug-in has no commands')
    ctx = Context(photos_out(core.cat(), photo_ids) if photo_ids else [])
    try:
        res = fn(command, ctx)
    except Exception as e:
        traceback.print_exc()
        raise ApiError('%s: %s' % (p['manifest'].get('name', id), e))
    out = {'messages': ctx.messages}
    if isinstance(res, str):
        out['messages'].append(res)
    elif isinstance(res, dict):
        out.update(res)
    return out

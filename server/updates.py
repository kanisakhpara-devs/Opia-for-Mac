"""Updates: check GitHub for a newer Opia for Mac and install it, but only after you've said Opia may go online for it.

How it updates depends on how Opia is installed:
  exe    - the packaged Opia.app: download the zip for this Mac's chip (Apple silicon or Intel) from the newest release,
           unpack it next to nothing else, check its signature, then swap it in once Opia has closed.
  git    - a git checkout (like a folder you cloned): `git pull --ff-only`, then install any new Python packages.
  folder - plain files without git: download the code as a zip and copy it over this folder.
Nothing about you or your files is sent; the requests are the same as opening the repository's page.
"""
import json
import os
import platform
import plistlib
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
import zipfile

from . import core
from .core import api, cfg, ApiError

REPO = 'kanisakhpara-devs/Opia-for-Mac'
API_URL = 'https://api.github.com/repos/' + REPO
FROZEN = bool(getattr(sys, 'frozen', False))
APP_DIR = os.path.dirname(os.path.abspath(sys.executable)) if FROZEN else core.ROOT
BUNDLE = os.path.abspath(os.path.join(sys.executable, '..', '..', '..')) if FROZEN else ''   # .../Opia.app, from .../Opia.app/Contents/MacOS/Opia
BUNDLE_ID = 'io.github.kanisakhpara.opia'
# one build per kind of Mac; Python reports what this copy was built for (x86_64 for the Intel build, also under Rosetta)
ASSET = 'Opia-Mac-AppleSilicon.zip' if platform.machine() == 'arm64' else 'Opia-Mac-Intel.zip'
BUILD = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'build.json')   # written by the release build
WORK = os.path.join(tempfile.gettempdir(), 'opia-update')
HIDDEN = getattr(subprocess, 'CREATE_NO_WINDOW', 0)


def build_info():
    try:
        with open(BUILD, encoding='utf-8') as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def movable():
    """Why the packaged app can't replace itself where it is, or '' when it can."""
    if '/AppTranslocation/' in BUNDLE or BUNDLE.startswith('/Volumes/'):
        return ('Opia is running from the disk image or from a read-only copy macOS made, so it can\'t update itself there. '
                'Quit Opia, drag Opia.app into your Applications folder, open it from there, and update again.')
    if not os.access(os.path.dirname(BUNDLE), os.W_OK) or not os.access(BUNDLE, os.W_OK):
        return 'Opia can\'t write to the folder it is in (%s), so it can\'t update itself. Download the new version from GitHub instead.' % os.path.dirname(BUNDLE)
    return ''


def kind():
    if FROZEN:
        return 'exe'
    if os.path.isdir(os.path.join(APP_DIR, '.git')) and shutil.which('git'):
        return 'git'
    return 'folder'


def git(*args, timeout=120):
    r = subprocess.run(['git', '-C', APP_DIR, *args], capture_output=True, text=True, timeout=timeout, creationflags=HIDDEN)
    if r.returncode:
        raise ApiError((r.stderr or r.stdout).strip().splitlines()[-1] if (r.stderr or r.stdout).strip() else 'git failed')
    return r.stdout.strip()


def current():
    """What this copy is: a version number for the packaged app, a commit for the source."""
    b = build_info()
    if kind() == 'git':
        try:
            return {'commit': git('rev-parse', 'HEAD', timeout=20), 'version': b.get('version', '')}
        except (ApiError, OSError, subprocess.SubprocessError):
            return {'commit': '', 'version': b.get('version', '')}
    return {'commit': b.get('commit', ''), 'version': b.get('version', '')}


def fetch(url, accept='application/vnd.github+json'):
    req = urllib.request.Request(url, headers={'User-Agent': 'Opia-updater', 'Accept': accept})
    return urllib.request.urlopen(req, timeout=20)


def get_json(url):
    try:
        with fetch(url) as r:
            return json.loads(r.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        if e.code == 403:
            raise ApiError('GitHub is limiting how often it can be asked. Try again in an hour.')
        raise ApiError('GitHub answered with an error (%s).' % e.code)
    except (urllib.error.URLError, OSError) as e:
        raise ApiError('Could not reach GitHub. Check the internet connection. (%s)' % getattr(e, 'reason', e))


def vtuple(v):
    out = []
    for part in str(v).lstrip('vV').split('.'):
        try:
            out.append(int(part))
        except ValueError:
            out.append(0)
    return tuple(out)


def allowed():
    return bool(cfg.get('update_consent'))


@api
def update_settings():
    return {'consent': allowed(), 'auto': bool(cfg.get('update_auto')), 'last': cfg.get('update_last', 0), 'kind': kind(),
            'current': current(), 'repo': REPO}


@api
def update_consent(allow, auto=False):
    cfg.set('update_consent', bool(allow))
    cfg.set('update_auto', bool(allow and auto))
    return update_settings()


@api
def update_check():
    """Is there something newer? Only ever runs once you have allowed it."""
    if not allowed():
        raise ApiError('Opia needs your permission before it goes online to check for updates.')
    cfg.set('update_last', time.time())
    k, cur = kind(), current()
    if k == 'exe':
        rel = get_json(API_URL + '/releases/latest')
        if not rel:
            return {'available': False, 'kind': k, 'current': cur, 'note': 'No version of Opia for Mac has been published yet.'}
        asset = next((a for a in rel.get('assets', []) if a.get('name', '').lower() == ASSET.lower()), None)
        latest = rel.get('tag_name', '')
        newer = asset is not None and (not cur['version'] or vtuple(latest) > vtuple(cur['version']))
        return {'available': newer, 'kind': k, 'current': cur, 'latest': latest, 'size': asset and asset.get('size'),
                'url': asset and asset.get('browser_download_url'), 'notes': notes(rel.get('body', '')), 'date': rel.get('published_at', '')}
    head = get_json(API_URL + '/commits/main')
    if not head:
        raise ApiError('Could not find the code on GitHub.')
    sha = head.get('sha', '')
    if cur['commit'] == sha:
        return {'available': False, 'kind': k, 'current': cur, 'latest': sha[:7]}
    if cur['commit']:
        cmp = get_json('%s/compare/%s...%s' % (API_URL, cur['commit'], sha)) or {}
        status = cmp.get('status')
        if status in ('identical', 'behind'):
            return {'available': False, 'kind': k, 'current': cur, 'latest': sha[:7]}
        msgs = [c['commit']['message'].splitlines()[0] for c in reversed(cmp.get('commits', []))][:12]
        return {'available': True, 'kind': k, 'current': cur, 'latest': sha[:7], 'count': cmp.get('ahead_by', len(msgs)),
                'notes': msgs, 'diverged': status == 'diverged'}
    return {'available': True, 'kind': k, 'current': cur, 'latest': sha[:7], 'notes': [head['commit']['message'].splitlines()[0]]}


def notes(body):
    """The release notes as a few short lines."""
    lines = [ln.strip(' -*#\t') for ln in (body or '').splitlines()]
    return [ln for ln in lines if ln][:12]


def download(job, url, dest, size=0):
    try:
        get_file(job, url, dest, size)
    except urllib.error.HTTPError as e:
        raise ApiError('The download failed: GitHub answered %s.' % e.code)
    except (urllib.error.URLError, OSError) as e:
        raise ApiError('The download failed: %s' % getattr(e, 'reason', e))


def get_file(job, url, dest, size):
    with fetch(url, accept='*/*') as r:
        job.total = int(r.headers.get('Content-Length') or size or 0)
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        with open(dest + '.part', 'wb') as f:
            while True:
                if job.cancel:
                    raise ApiError('Update cancelled.')
                chunk = r.read(1 << 16)
                if not chunk:
                    break
                f.write(chunk)
                job.step('%.0f of %.0f MB' % ((job.progress + len(chunk)) / 1048576, job.total / 1048576) if job.total else None, len(chunk))
    os.replace(dest + '.part', dest)


def do_install(job):
    info = update_check()
    if not info.get('available'):
        raise ApiError('Opia is already up to date.')
    k = info['kind']
    shutil.rmtree(WORK, ignore_errors=True)
    os.makedirs(WORK, exist_ok=True)
    if k == 'exe':
        where = movable()
        if where:
            raise ApiError(where)
        z = os.path.join(WORK, ASSET)
        download(job, info['url'], z, info.get('size') or 0)
        if info.get('size') and os.path.getsize(z) != info['size']:
            raise ApiError('The download was incomplete, so it was not installed.')
        job.message = 'Unpacking'
        new = os.path.join(WORK, 'new')
        # ditto, not zipfile: an app is full of symbolic links and executable bits that zipfile would lose
        r = subprocess.run(['ditto', '-x', '-k', z, new], capture_output=True, text=True, timeout=600)
        app = os.path.join(new, 'Opia.app')
        if r.returncode or not os.path.isdir(app):
            raise ApiError('The download could not be unpacked, so it was not installed.')
        try:
            with open(os.path.join(app, 'Contents', 'Info.plist'), 'rb') as f:
                ident = plistlib.load(f).get('CFBundleIdentifier')
        except (OSError, plistlib.InvalidFileException):
            ident = None
        if ident != BUNDLE_ID:
            raise ApiError('The download is not Opia for Mac, so it was not installed.')
        job.message = 'Checking the new version'
        r = subprocess.run(['codesign', '--verify', '--deep', '--strict', app], capture_output=True, text=True, timeout=600)
        if r.returncode:
            raise ApiError('The new version\'s signature does not check out, so it was not installed.')
        return {'ready': True, 'kind': k}
    if k == 'git':
        if info.get('diverged'):
            raise ApiError('This copy has its own changes that are not on GitHub, so Opia will not overwrite them. Update it with git yourself.')
        changed = [ln for ln in git('status', '--porcelain', '--untracked-files=no').splitlines() if ln.strip()]
        if changed:
            raise ApiError('Some of Opia\'s files have been changed on this computer (%s), so the update would overwrite them. Update it with git yourself.' % ', '.join(ln[3:] for ln in changed[:3]))
        job.message = 'Downloading the changes'
        git('pull', '--ff-only', 'https://github.com/%s.git' % REPO, 'main', timeout=600)
    else:
        z = os.path.join(WORK, 'opia.zip')
        download(job, 'https://github.com/%s/archive/refs/heads/main.zip' % REPO, z)
        job.message = 'Unpacking'
        with zipfile.ZipFile(z) as zf:
            zf.extractall(os.path.join(WORK, 'src'))
        top = os.path.join(WORK, 'src', os.listdir(os.path.join(WORK, 'src'))[0])
        for name in os.listdir(top):
            s, d = os.path.join(top, name), os.path.join(APP_DIR, name)
            if os.path.isdir(s):
                shutil.copytree(s, d, dirs_exist_ok=True)
            else:
                shutil.copy2(s, d)
        with open(os.path.join(APP_DIR, 'server', 'build.json'), 'w', encoding='utf-8') as f:
            json.dump({'commit': (get_json(API_URL + '/commits/main') or {}).get('sha', ''), 'version': ''}, f)
    req = os.path.join(APP_DIR, 'requirements.txt')
    if os.path.exists(req):
        job.message = 'Installing new Python packages'
        subprocess.run([sys.executable, '-m', 'pip', 'install', '--disable-pip-version-check', '-q', '-r', req], capture_output=True, timeout=1200, creationflags=HIDDEN)
    return {'ready': True, 'kind': k}


@api
def update_install():
    if not allowed():
        raise ApiError('Opia needs your permission before it goes online to update.')
    return core.start_job('Updating Opia', do_install)


@api
def update_restart():
    """Close Opia and start the new version. A small script waits for this copy to exit, then (for the exe) swaps the file."""
    pid = os.getpid()
    if FROZEN:
        # wait for this copy to quit, put the new app where the old one was (putting the old one back if that fails), open it
        new, old = os.path.join(WORK, 'new', 'Opia.app'), BUNDLE
        script = ('while kill -0 {pid} 2>/dev/null; do sleep 1; done; '
                  'rm -rf "{old}.old"; if mv "{old}" "{old}.old"; then '
                  'if mv "{new}" "{old}"; then rm -rf "{old}.old"; else mv "{old}.old" "{old}"; fi; fi; '
                  'exec open "{old}"').format(pid=pid, old=old, new=new)
    else:
        script = 'while kill -0 %d 2>/dev/null; do sleep 1; done; exec "%s" "%s"' % (pid, sys.executable, os.path.join(APP_DIR, 'run.py'))
    subprocess.Popen(['sh', '-c', script], start_new_session=True, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    threading.Timer(.6, quit_app).start()
    return True


def quit_app():
    try:
        import webview
        for w in list(webview.windows):
            w.destroy()
        return
    except Exception:
        pass
    os._exit(0)

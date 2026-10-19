"""Video workspace. Projects live in <home>/Video/<name>/project.json and point at media files where they are on disk.
The browser plays the clips itself for the preview; FFmpeg does everything else: reading what a file holds, thumbnails,
waveforms, preview copies of files the browser cannot play, and the final MP4.

FFmpeg comes from the imageio-ffmpeg package (its Python code is BSD-2-Clause; the ffmpeg program it carries is a GPL build),
from a path set in config.json ("ffmpeg"), or from the PATH."""
import base64
import hashlib
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading

import numpy as np
from PIL import Image, ImageOps

from . import core
from .core import api, img, stream, ApiError, Binary, FileRef

VIDEO_EXT = {'.mp4', '.m4v', '.mov', '.webm', '.mkv', '.avi', '.wmv', '.mpg', '.mpeg', '.mts', '.m2ts', '.ts', '.3gp', '.flv', '.ogv'}
AUDIO_EXT = {'.mp3', '.wav', '.m4a', '.aac', '.ogg', '.oga', '.opus', '.flac', '.wma', '.aif', '.aiff'}
PIC_EXT = {'.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tif', '.tiff', '.heic', '.heif'}
CTYPE = {'.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/mp4', '.webm': 'video/webm', '.ogv': 'video/ogg', '.mkv': 'video/webm',
         '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.oga': 'audio/ogg',
         '.opus': 'audio/ogg', '.flac': 'audio/flac'}
PLAY_VIDEO = {'h264', 'vp8', 'vp9', 'av1'}            # what Chromium / WebView2 decodes without extra codec packs
PLAY_AUDIO = {'aac', 'mp3', 'opus', 'vorbis', 'flac', 'pcm_s16le', 'pcm_s24le', 'pcm_f32le', 'pcm_u8'}
NO_PLAY_EXT = set()
if sys.platform == 'darwin':
    # the Mac's WebKit plays HEVC (iPhone video) but not Matroska or Ogg, and AV1 only on the newest chips; anything else gets a preview copy
    NO_PLAY_EXT = {'.mkv', '.ogv', '.ogg', '.oga', '.opus'}
    PLAY_VIDEO = {'h264', 'hevc', 'vp9'}
    PLAY_AUDIO = {'aac', 'mp3', 'alac', 'flac', 'opus', 'pcm_s16le', 'pcm_s24le', 'pcm_f32le', 'pcm_u8'}
NOWIN = 0x08000000 if sys.platform == 'win32' else 0       # CREATE_NO_WINDOW: no console flashing up from the windowed app
LOCK = threading.Lock()
PROXY_JOBS = {}


def ffmpeg():
    p = core.cfg.get('ffmpeg')
    if p and os.path.isfile(p):
        return p
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        pass
    p = shutil.which('ffmpeg')
    if p:
        return p
    raise ApiError('Video needs FFmpeg. Install the imageio-ffmpeg package (pip install imageio-ffmpeg), or set "ffmpeg" in config.json to an ffmpeg program (for example from Homebrew: brew install ffmpeg).')


def _run(args, timeout=120):
    return subprocess.run([ffmpeg(), '-hide_banner', '-nostdin'] + args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout, creationflags=NOWIN)


def _root():
    return os.path.join(core.HOME, 'Video')


def _cache(*parts):
    d = os.path.join(_root(), '.cache')
    os.makedirs(d, exist_ok=True)
    return os.path.join(d, hashlib.sha1('|'.join(map(str, parts)).encode('utf-8')).hexdigest()[:20])


def _key(path):
    st = os.stat(path)
    return (os.path.abspath(path), st.st_size, int(st.st_mtime))


def _kind(path):
    ext = os.path.splitext(path)[1].lower()
    return 'video' if ext in VIDEO_EXT else 'audio' if ext in AUDIO_EXT else 'image' if ext in PIC_EXT else None


# ---------------------------------------------------------------- what a file holds

def _probe(path):
    """Duration, size, frame rate and codecs, read from what ffmpeg prints about the file."""
    err = _run(['-i', path], timeout=60).stderr.decode('utf-8', 'replace')
    info = {'dur': 0.0, 'w': 0, 'h': 0, 'fps': 0.0, 'vcodec': None, 'acodec': None, 'rot': 0, 'pix': None}
    m = re.search(r'Duration: (\d+):(\d+):(\d+(?:\.\d+)?)', err)
    if m:
        info['dur'] = int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3))
    for line in err.splitlines():
        line = line.strip()
        if 'Video:' in line and not info['vcodec'] and 'attached pic' not in line:
            info['vcodec'] = line.split('Video:')[1].strip().split()[0].strip(',')
            m = re.search(r'\b(yuvj?\d{3}p\w*|nv12|p010\w*|gbrp\w*|rgb\w+|gray\w*)', line)
            info['pix'] = m.group(1) if m else None
            m = re.search(r', (\d{2,5})x(\d{2,5})', line)
            if m:
                info['w'], info['h'] = int(m.group(1)), int(m.group(2))
            m = re.search(r'([\d.]+) fps', line) or re.search(r'([\d.]+) tbr', line)
            if m:
                info['fps'] = float(m.group(1))
        elif 'Audio:' in line and not info['acodec']:
            info['acodec'] = line.split('Audio:')[1].strip().split()[0].strip(',')
        m = re.search(r'rotat\w* (?:of )?:?\s*(-?[\d.]+)', line)
        if m and info['vcodec'] and not info['rot']:
            info['rot'] = int(round(float(m.group(1)))) % 360
    if info['rot'] in (90, 270):
        info['w'], info['h'] = info['h'], info['w']
    return info


@api
def video_probe(path):
    if not os.path.isfile(path):
        raise ApiError('File not found: ' + path)
    kind = _kind(path)
    name = os.path.basename(path)
    if kind == 'image':
        try:
            im = ImageOps.exif_transpose(Image.open(path))
            return {'path': path, 'name': name, 'kind': 'image', 'w': im.width, 'h': im.height, 'dur': 0, 'audio': False, 'play': path}
        except Exception:
            raise ApiError(name + ' is not a picture Opia can read')
    i = _probe(path)
    if not i['vcodec'] and not i['acodec']:
        raise ApiError(name + ' has no video or sound that Opia can read')
    kind = 'video' if i['vcodec'] else 'audio'
    ext = os.path.splitext(path)[1].lower()
    native = ext in CTYPE and ext not in NO_PLAY_EXT and (i['vcodec'] in PLAY_VIDEO if kind == 'video' else True) and (not i['acodec'] or i['acodec'] in PLAY_AUDIO)
    if kind == 'video' and i['pix'] not in (None, 'yuv420p', 'yuvj420p', 'nv12'):
        native = False            # 10-bit and 4:2:2 / 4:4:4 video: browsers usually cannot decode it
    if kind == 'video' and max(i['w'], i['h']) > 4096:
        native = False
    out = {'path': path, 'name': name, 'kind': kind, 'w': i['w'], 'h': i['h'], 'fps': round(i['fps'], 3), 'dur': round(i['dur'], 3), 'audio': bool(i['acodec']),
           'vcodec': i['vcodec'], 'acodec': i['acodec'], 'play': path if native else None}
    if not native:
        p = _proxy_path(path, kind)
        out['play'] = p if os.path.isfile(p) else None
    return out


def _proxy_path(path, kind):
    return _cache('proxy', *_key(path)) + ('.mp4' if kind == 'video' else '.m4a')


@api
def video_proxy(path, force=False):
    """A copy the browser can play (H.264 / AAC, at most 720 lines, a keyframe every second for quick seeking). The original is used for export."""
    kind = _kind(path) or 'video'
    info = _probe(path)
    if not info['vcodec']:
        kind = 'audio'
    out = _proxy_path(path, kind)

    with LOCK:
        lock = PROXY_JOBS.setdefault(out, threading.Lock())

    def run(job):
        with lock:                # two clips of the same file must not write the same copy at once
            return make(job)

    def make(job):
        if os.path.isfile(out) and not force:
            return {'play': out}
        job.total = max(1, int(info['dur']))
        tmp = out + '.part' + os.path.splitext(out)[1]
        args = ['-y', '-i', path]
        if kind == 'video':
            fps = info['fps'] or 30
            args += ['-vf', 'scale=-2:\'min(720,ih)\'', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-g', str(max(1, round(fps))), '-pix_fmt', 'yuv420p']
        else:
            args += ['-vn']
        args += ['-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', '-progress', 'pipe:1', '-nostats', tmp]
        _ffmpeg_job(job, args, info['dur'])
        os.replace(tmp, out)
        return {'play': out}
    return core.start_job('Preparing a preview copy', run)


def _ffmpeg_job(job, args, total):
    """Run ffmpeg, following its progress; stop it if the job is cancelled."""
    log = tempfile.TemporaryFile()
    p = subprocess.Popen([ffmpeg(), '-hide_banner', '-nostdin'] + args, stdout=subprocess.PIPE, stderr=log, creationflags=NOWIN)
    job.total = max(1, int(total * 10))
    try:
        for line in p.stdout:
            line = line.decode('ascii', 'replace').strip()
            if line.startswith('out_time_us=') or line.startswith('out_time_ms='):
                try:
                    job.progress = min(job.total, int(int(line.split('=')[1]) / 1e5))
                except ValueError:
                    pass
            if job.cancel:
                p.kill()
                break
        p.wait()
    finally:
        if p.poll() is None:
            p.kill()
    if job.cancel:
        raise ApiError('Cancelled')
    if p.returncode:
        log.seek(0)
        tail = [ln for ln in log.read().decode('utf-8', 'replace').splitlines() if ln.strip()][-6:]
        raise ApiError('FFmpeg could not finish: ' + ' / '.join(tail))


@img
def media(rest, q):
    """A media file (or its preview copy) for the browser to play, with seeking."""
    path = q.get('path') or ''
    ext = os.path.splitext(path)[1].lower()
    if not os.path.isfile(path) or (ext not in CTYPE and ext not in PIC_EXT):
        raise ApiError('Not a media file')
    if ext in PIC_EXT:
        if ext in ('.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp'):
            return FileRef(path, 'image/' + ('jpeg' if ext in ('.jpg', '.jpeg') else ext[1:]))
        buf = io.BytesIO()
        ImageOps.exif_transpose(Image.open(path)).convert('RGBA').save(buf, 'PNG')
        return Binary(buf.getvalue(), 'image/png')
    return FileRef(path, CTYPE[ext])


@img
def vstrip(rest, q):
    """n frames from across a clip, side by side, for the timeline."""
    path, n, hh = q['path'], max(1, min(int(q.get('n', 8)), 40)), max(16, min(int(q.get('h', 54)), 240))
    a, b = float(q.get('a', 0)), float(q.get('b', 0))
    out = _cache('strip', *_key(path), n, hh, a, b) + '.jpg'
    if not os.path.isfile(out):
        if not b:
            b = _probe(path)['dur'] or 1
        times = [a + (b - a) * (k + .5) / n for k in range(n)]
        args = ['-y']
        for t in times:
            args += ['-noaccurate_seek', '-ss', '%.3f' % t, '-i', path]
        f = ';'.join('[%d:v]scale=-2:%d,setsar=1,trim=end_frame=1,setpts=0[s%d]' % (k, hh, k) for k in range(n))
        f += ';' + ''.join('[s%d]' % k for k in range(n)) + ('hstack=inputs=%d[o]' % n if n > 1 else 'null[o]')
        r = _run(args + ['-filter_complex', f, '-map', '[o]', '-frames:v', '1', '-q:v', '5', out], timeout=120)
        if r.returncode or not os.path.isfile(out):
            raise ApiError('No pictures could be read from ' + os.path.basename(path))
    with open(out, 'rb') as fh:
        return Binary(fh.read(), 'image/jpeg', cache=True)


@api
def video_peaks(path, rate=50):
    """How loud the sound is, rate times a second (0-255), to draw its waveform."""
    out = _cache('peaks', *_key(path), rate) + '.json'
    if os.path.isfile(out):
        with open(out) as fh:
            return json.load(fh)
    r = _run(['-i', path, '-vn', '-ac', '1', '-ar', '4000', '-f', 's16le', '-'], timeout=600)
    a = np.abs(np.frombuffer(r.stdout, dtype='<i2').astype(np.float32))
    step = max(1, 4000 // rate)
    n = len(a) // step
    peaks = (a[:n * step].reshape(n, step).max(1) / 32768 * 255).clip(0, 255).astype(int).tolist() if n else []
    res = {'rate': 4000 / step, 'peaks': peaks}
    with open(out, 'w') as fh:
        json.dump(res, fh)
    return res


# ---------------------------------------------------------------- projects

def _clean(name):
    name = ''.join(ch for ch in (name or '') if ch not in '\\/:*?"<>|').strip().strip('.')
    if not name:
        raise ApiError('Give the project a name')
    return name


def _dir(name):
    return os.path.join(_root(), _clean(name))


@api
def video_list():
    out = []
    if os.path.isdir(_root()):
        for e in os.scandir(_root()):
            f = os.path.join(e.path, 'project.json')
            if e.is_dir() and not e.name.startswith('.') and os.path.isfile(f):
                out.append({'name': e.name, 'mtime': os.path.getmtime(f)})
    return sorted(out, key=lambda s: -s['mtime'])


@api
def video_load(name):
    f = os.path.join(_dir(name), 'project.json')
    if not os.path.isfile(f):
        return None
    with open(f, encoding='utf-8') as fh:
        return json.load(fh)


@api
def video_save(name, project):
    d = _dir(name)
    os.makedirs(d, exist_ok=True)
    tmp = os.path.join(d, 'project.json.tmp')
    with open(tmp, 'w', encoding='utf-8') as fh:
        json.dump(project, fh)
    os.replace(tmp, os.path.join(d, 'project.json'))
    return {'folder': d}


@api
def video_rename(old, new):
    a, b = _dir(old), _dir(new)
    if os.path.exists(b):
        raise ApiError('A project with that name already exists')
    if os.path.isdir(a):
        os.rename(a, b)
    return {'name': _clean(new)}


@api
def video_delete(name):
    d = _dir(name)
    if os.path.isdir(d):
        shutil.rmtree(d)
    return True


@stream
def video_media_put(q, src, length):
    """A file dropped or picked in the window when its path is not known: copied into the project's Media folder as it arrives."""
    d = os.path.join(_dir(q['project']), 'Media')
    os.makedirs(d, exist_ok=True)
    name = os.path.basename(q.get('name') or 'media')
    if not _kind(name):
        while length > 0:
            chunk = src.read(min(1 << 20, length))
            if not chunk:
                break
            length -= len(chunk)
        raise ApiError(name + ' is not a video, sound or picture file Opia knows')
    path = os.path.join(d, name)
    base, ext = os.path.splitext(path)
    k = 2
    while os.path.exists(path):
        path = '%s (%d)%s' % (base, k, ext)
        k += 1
    with open(path + '.part', 'wb') as fh:
        while length > 0:
            chunk = src.read(min(1 << 20, length))
            if not chunk:
                break
            fh.write(chunk)
            length -= len(chunk)
    os.replace(path + '.part', path)
    return {'path': path}


@api
def video_still_put(project, name, data):
    """A picture made in the app (a photo from the catalog with its edits) kept in the project's Media folder."""
    d = os.path.join(_dir(project), 'Media')
    os.makedirs(d, exist_ok=True)
    path = os.path.join(d, os.path.basename(name))
    with open(path, 'wb') as fh:
        fh.write(base64.b64decode(data.split(',', 1)[1]))
    return {'path': path}


# ---------------------------------------------------------------- export

def _even(v):
    return max(2, int(round(v / 2)) * 2)


def _clip_frames(c, W, H, fps, scale=1.0):
    """The filters that size, place and fade one picture stream. Returns (chain, x expression, y expression)."""
    fit = 'increase' if c.get('fit') == 'fill' else 'decrease'
    s = float(c.get('scale') or 1)
    vf = ['fps=%s' % fps, 'scale=w=%d:h=%d:force_original_aspect_ratio=%s' % (_even(W * s), _even(H * s), fit)]
    if c.get('fit') == 'fill':
        vf.append('crop=%d:%d' % (_even(W * s), _even(H * s)))
    vf += ['setsar=1', 'format=rgba']
    dx, dy = float(c.get('x') or 0) * W, float(c.get('y') or 0) * H
    return vf, '(W-w)/2%+.2f' % dx, '(H-h)/2%+.2f' % dy


def _graph(project, tmp, titles):
    """Inputs and filter graph for the whole timeline."""
    W, H = _even(project['w']), _even(project['h'])
    fps = project.get('fps') or 30
    tracks = {t['id']: t for t in project['tracks']}
    order = [t['id'] for t in project['tracks']]               # top of the list is drawn on top
    clips = [c for c in project['clips'] if c['track'] in tracks]
    total = max([c['start'] + c['dur'] for c in clips] or [0])
    if total <= 0:
        raise ApiError('The timeline is empty')
    inputs, vchains, achains = [], [], []

    def add_input(args):
        inputs.extend(args)
        return add_input.n.__next__()
    add_input.n = iter(range(10 ** 6))

    def audio_fades(c, xin):
        f = []
        a_in = max(float(c.get('fadeIn') or 0), float(c.get('xfade') or 0))
        if a_in:
            f.append('afade=t=in:st=0:d=%.3f' % a_in)
        a_out = max(float(c.get('fadeOut') or 0), xin)
        if a_out:
            f.append('afade=t=out:st=%.3f:d=%.3f' % (max(0, c['dur'] - a_out), a_out))
        return f

    def successor_overlap(c):
        """When the next clip on the track crossfades in over this one, this clip's sound fades out under it."""
        best = 0.0
        for o in clips:
            if o is c or o['track'] != c['track'] or not o.get('xfade'):
                continue
            if c['start'] < o['start'] < c['start'] + c['dur'] <= o['start'] + o['dur'] + 1e-6:
                best = max(best, c['start'] + c['dur'] - o['start'])
        return best

    vis = sorted([c for c in clips if c['kind'] in ('video', 'image', 'title') and not tracks[c['track']].get('hide')],
                 key=lambda c: (-order.index(c['track']), c['start']))
    for c in vis:
        dur = c['dur']
        if c['kind'] == 'video':
            k = add_input(['-ss', '%.3f' % c['in'], '-t', '%.3f' % dur, '-i', c['src']])
        else:
            if c['kind'] == 'title':
                p = os.path.join(tmp, 'title_%s.png' % c['id'])
                with open(p, 'wb') as fh:
                    fh.write(base64.b64decode(titles[c['id']].split(',', 1)[1]))
            else:
                p = os.path.join(tmp, 'pic_%s.png' % c['id'])
                im = ImageOps.exif_transpose(Image.open(c['src']))
                im.thumbnail((W * 2, H * 2))
                im.convert('RGBA').save(p)
            k = add_input(['-loop', '1', '-framerate', str(fps), '-t', '%.3f' % dur, '-i', p])
        vf, x, y = _clip_frames(c, W, H, fps)
        if c['kind'] == 'title':
            vf = ['fps=%s' % fps, 'scale=%d:%d' % (W, H), 'setsar=1', 'format=rgba']
            x, y = '0', '0'
        vf.insert(0, 'trim=duration=%.3f' % dur)
        vf.insert(1, 'setpts=PTS-STARTPTS')
        fin, fout = max(float(c.get('fadeIn') or 0), float(c.get('xfade') or 0)), float(c.get('fadeOut') or 0)
        if fin:
            vf.append('fade=t=in:st=0:d=%.3f:alpha=1' % fin)
        if fout:
            vf.append('fade=t=out:st=%.3f:d=%.3f:alpha=1' % (max(0, dur - fout), fout))
        op = float(c.get('opacity', 1))
        if op < 1:
            vf.append('colorchannelmixer=aa=%.3f' % op)
        vf.append('setpts=PTS+%.3f/TB' % c['start'])
        vchains.append(('[%d:v]%s[v%d]' % (k, ','.join(vf), len(vchains)), x, y))

    for c in clips:
        t = tracks[c['track']]
        if t.get('mute') or c.get('mute'):
            continue
        has = c['kind'] == 'audio' or (c['kind'] == 'video' and c.get('audio'))
        if not has:
            continue
        vol = float(c.get('vol', 1)) * float(t.get('vol', 1))
        if vol <= 0:
            continue
        k = add_input(['-ss', '%.3f' % c['in'], '-t', '%.3f' % c['dur'], '-i', c['src']])
        af = ['atrim=duration=%.3f' % c['dur'], 'asetpts=PTS-STARTPTS', 'aresample=48000', 'aformat=sample_fmts=fltp:channel_layouts=stereo', 'volume=%.3f' % vol]
        af += audio_fades(c, successor_overlap(c))
        ms = int(round(c['start'] * 1000))
        if ms:
            af.append('adelay=%d:all=1' % ms)
        achains.append('[%d:a]%s[a%d]' % (k, ','.join(af), len(achains)))

    bg = project.get('bg') or '#000000'
    parts = ['color=c=%s:s=%dx%d:r=%s:d=%.3f,format=rgba[base]' % (bg.replace('#', '0x'), W, H, fps, total)]
    last = 'base'
    for i, (chain, x, y) in enumerate(vchains):
        parts.append(chain)
        parts.append('[%s][v%d]overlay=x=%s:y=%s:eof_action=pass:format=auto[o%d]' % (last, i, x, y, i))
        last = 'o%d' % i
    parts.append('[%s]format=yuv420p[vout]' % last)
    if achains:
        parts += achains
        parts.append('%samix=inputs=%d:normalize=0:duration=longest,apad,atrim=duration=%.3f[aout]' % (''.join('[a%d]' % i for i in range(len(achains))), len(achains), total))
    else:
        parts.append('anullsrc=r=48000:cl=stereo,atrim=duration=%.3f[aout]' % total)
    return inputs, ';'.join(parts), total, W, H, fps


@api
def video_export(project, path, titles=None, quality='high', size=None):
    """Render the timeline to an MP4 (H.264 video, AAC sound)."""
    path = os.path.abspath(path)
    if not path.lower().endswith('.mp4'):
        path += '.mp4'
    if not os.path.isdir(os.path.dirname(path)):
        raise ApiError('That folder does not exist')
    if size:
        project = dict(project, w=size[0], h=size[1])
    crf = {'high': 18, 'medium': 22, 'small': 27}.get(quality, 20)

    def run(job):
        tmp = tempfile.mkdtemp(prefix='opia-video-')
        try:
            inputs, graph, total, W, H, fps = _graph(project, tmp, titles or {})
            script = os.path.join(tmp, 'graph.txt')
            with open(script, 'w', encoding='utf-8') as fh:
                fh.write(graph)
            part = path + '.part.mp4'
            args = ['-y'] + inputs + ['-filter_complex_script', script, '-map', '[vout]', '-map', '[aout]',
                                      '-c:v', 'libx264', '-preset', 'medium', '-crf', str(crf), '-pix_fmt', 'yuv420p', '-r', str(fps),
                                      '-c:a', 'aac', '-b:a', '192k', '-t', '%.3f' % total, '-movflags', '+faststart', '-progress', 'pipe:1', '-nostats', part]
            _ffmpeg_job(job, args, total)
            os.replace(part, path)
            return {'path': path, 'size': os.path.getsize(path), 'dur': total}
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
            if os.path.exists(path + '.part.mp4'):
                try:
                    os.remove(path + '.part.mp4')
                except OSError:
                    pass
    return core.start_job('Exporting video', run)


@api
def video_ffmpeg():
    """Which ffmpeg is in use, for the About box and error messages."""
    try:
        exe = ffmpeg()
    except ApiError as e:
        return {'ok': False, 'error': str(e)}
    r = _run(['-version'], timeout=20)
    return {'ok': True, 'path': exe, 'version': r.stdout.decode('utf-8', 'replace').splitlines()[0] if r.stdout else ''}

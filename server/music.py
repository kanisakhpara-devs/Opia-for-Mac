"""Songs for the Music workspace. Each lives in <home>/Music/<name>/ as song.json plus the audio recorded or edited in it."""
import io
import json
import os

import numpy as np

from . import core
from .core import api, img, upload, ApiError, Binary

AUDIO = {'.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.opus': 'audio/ogg', '.flac': 'audio/flac',
         '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.webm': 'audio/webm', '.mid': 'audio/midi', '.midi': 'audio/midi'}


def _root():
    return os.path.join(core.HOME, 'Music')


def _clean(name):
    name = ''.join(ch for ch in (name or '') if ch not in '\\/:*?"<>|').strip().strip('.')
    if not name:
        raise ApiError('Give the song a name')
    return name


def _dir(name):
    return os.path.join(_root(), _clean(name))


@api
def music_list():
    out = []
    if os.path.isdir(_root()):
        for e in os.scandir(_root()):
            f = os.path.join(e.path, 'song.json')
            if e.is_dir() and os.path.isfile(f):
                out.append({'name': e.name, 'mtime': os.path.getmtime(f)})
    return sorted(out, key=lambda s: -s['mtime'])


@api
def music_load(name):
    f = os.path.join(_dir(name), 'song.json')
    if not os.path.isfile(f):
        return None
    with open(f, encoding='utf-8') as fh:
        return json.load(fh)


@api
def music_save(name, song):
    d = _dir(name)
    os.makedirs(d, exist_ok=True)
    tmp = os.path.join(d, 'song.json.tmp')
    with open(tmp, 'w', encoding='utf-8') as fh:
        json.dump(song, fh)
    os.replace(tmp, os.path.join(d, 'song.json'))
    return {'folder': d}


@api
def music_rename(old, new):
    a, b = _dir(old), _dir(new)
    if os.path.exists(b):
        raise ApiError('A song with that name already exists')
    if os.path.isdir(a):
        os.rename(a, b)
    return {'name': _clean(new), 'folder': b}


@upload
def music_audio_put(q, body):
    """Keep a recording or an edited piece of audio inside the song's folder."""
    d = _dir(q['song'])
    os.makedirs(d, exist_ok=True)
    path = os.path.join(d, os.path.basename(q['file']))
    if os.path.splitext(path)[1].lower() != '.wav':
        raise ApiError('Song audio is stored as .wav')
    with open(path, 'wb') as fh:
        fh.write(body)
    return {'path': path}


EXPORT = {'.wav': None, '.mid': None, '.mp3': ('MP3', 'MPEG_LAYER_III'), '.flac': ('FLAC', 'PCM_16'), '.ogg': ('OGG', 'VORBIS')}


def _sf():
    try:
        import soundfile
        return soundfile
    except Exception:
        raise ApiError('This needs the "soundfile" Python package (pip install soundfile)')


def _read(body):
    x, sr = _sf().read(io.BytesIO(body), dtype='float32', always_2d=True)
    return x, sr


def _wav(x, sr):
    out = io.BytesIO()
    _sf().write(out, np.clip(x, -1, 1), sr, format='WAV', subtype='PCM_16')
    return Binary(out.getvalue(), 'audio/wav')


@upload
def music_export(q, body):
    """Write a mixdown (sent as WAV) in the format the file name asks for, or a MIDI file as it is."""
    path = os.path.abspath(q['path'])
    ext = os.path.splitext(path)[1].lower()
    if ext not in EXPORT or not os.path.isdir(os.path.dirname(path)):
        raise ApiError('Choose an existing folder and a .wav, .mp3, .flac, .ogg or .mid name')
    if EXPORT[ext]:
        x, sr = _read(body)
        _sf().write(path, x, sr, format=EXPORT[ext][0], subtype=EXPORT[ext][1])
    else:
        with open(path, 'wb') as fh:
            fh.write(body)
    return {'path': path}


# ---- audio processing that needs real DSP: noise reduction, and changing speed, tempo and pitch

N, HOP = 2048, 512
_noise = {'profile': None}


def _stft(x):
    w = np.hanning(N + 1)[:-1].astype('float32')
    x = np.concatenate([np.zeros(N, 'float32'), x, np.zeros(N + HOP, 'float32')])
    idx = np.arange(0, len(x) - N, HOP)[:, None] + np.arange(N)[None, :]
    return np.fft.rfft(x[idx] * w, axis=1)


def _istft(S, length):
    w = np.hanning(N + 1)[:-1].astype('float32')
    frames = np.fft.irfft(S, n=N, axis=1) * w
    out = np.zeros(len(S) * HOP + N, 'float32')
    norm = np.zeros_like(out)
    for i, f in enumerate(frames):
        out[i * HOP:i * HOP + N] += f
        norm[i * HOP:i * HOP + N] += w * w
    out /= np.maximum(norm, 1e-6)
    return out[N:N + length]


def _smooth(g):
    g = (g + np.roll(g, 1, 0) + np.roll(g, -1, 0)) / 3
    return (g + np.roll(g, 1, 1) + np.roll(g, -1, 1)) / 3


def _denoise(x, amount):
    """Spectral gating: learn how loud the noise is in every frequency band, then turn down whatever is not clearly above it."""
    floor = 10 ** (-(6 + 30 * amount) / 20)
    out = np.empty_like(x)
    for c in range(x.shape[1]):
        S = _stft(x[:, c])
        mag = np.abs(S)
        if _noise['profile'] is not None:
            noise = _noise['profile']
        else:                          # no profile taken: assume the quietest tenth of the audio is just noise
            energy = mag.sum(1)
            noise = mag[np.argsort(energy)[:max(4, len(mag) // 10)]].mean(0)
        g = np.clip(1 - ((1.5 + 2 * amount) * noise[None, :] / np.maximum(mag, 1e-9)) ** 2, 0, 1)
        out[:, c] = _istft(S * (floor + (1 - floor) * _smooth(g)), len(x))
    return out


def _stretch(x, rate):
    """Phase vocoder: play faster (rate > 1) or slower without changing the pitch.
    Each frequency peak carries its neighbours' phases along with it, which keeps notes solid instead of washy."""
    cols = []
    omega = 2 * np.pi * np.arange(N // 2 + 1) * HOP / N
    bins = np.arange(N // 2 + 1)
    for c in range(x.shape[1]):
        S = _stft(x[:, c])
        mags, angs = np.abs(S), np.angle(S)
        times = np.arange(0, len(S) - 1, rate)
        out = np.empty((len(times), S.shape[1]), complex)
        acc = angs[0].copy()
        for k, t in enumerate(times):
            i = int(t)
            frac = t - i
            mag = (1 - frac) * mags[i] + frac * mags[i + 1]
            peaks = np.flatnonzero((mag[1:-1] > mag[:-2]) & (mag[1:-1] >= mag[2:])) + 1
            if len(peaks):
                owner = peaks[np.searchsorted((peaks[:-1] + peaks[1:]) / 2, bins)]
                phase = acc[owner] + angs[i] - angs[i][owner]
            else:
                phase = acc
            out[k] = mag * np.exp(1j * phase)
            d = angs[i + 1] - angs[i] - omega
            acc = phase + omega + d - 2 * np.pi * np.round(d / (2 * np.pi))
        cols.append(_istft(out, int(len(x) / rate)))
    return np.stack(cols, 1).astype('float32')


def _resample(x, factor):
    n = max(1, int(round(len(x) / factor)))
    pos = np.linspace(0, len(x) - 1, n)
    return np.stack([np.interp(pos, np.arange(len(x)), x[:, c]) for c in range(x.shape[1])], 1).astype('float32')


@upload
def music_noise_profile(q, body):
    """Remember what the noise alone sounds like (a stretch with nothing but hiss or hum), for the next noise reduction."""
    if not body:
        _noise['profile'] = None
        return {'ok': True}
    x, _sr = _read(body)
    _noise['profile'] = np.abs(_stft(x.mean(1))).mean(0)
    return {'ok': True}


@upload
def music_process(q, body):
    x, sr = _read(body)
    op, v = q['op'], float(q.get('v', 0))
    if len(x) < N:
        return _wav(x, sr)
    if op == 'denoise':
        x = _denoise(x, min(1, max(0, v)))
    elif op == 'speed':                # tempo and pitch together, like a tape
        x = _resample(x, v)
    elif op == 'tempo':
        x = _stretch(x, v)
    elif op == 'pitch':                # v semitones
        f = 2 ** (v / 12)
        x = _resample(_stretch(x, 1 / f), f)
    else:
        raise ApiError('Unknown audio operation')
    return _wav(x, sr)


@img
def audio(rest, q):
    """Serve a local audio file for the Music workspace to decode."""
    path = q['path']
    ctype = AUDIO.get(os.path.splitext(path)[1].lower())
    if not ctype or not os.path.isfile(path):
        raise ApiError('Not an audio file Opia can open')
    with open(path, 'rb') as fh:
        return Binary(fh.read(), ctype)

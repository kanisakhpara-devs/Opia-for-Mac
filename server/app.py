"""Local HTTP server: static UI, JSON API, image endpoints. Bound to 127.0.0.1 only."""
import json
import mimetypes
import os
import sys
import traceback
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from . import core
from . import catalog, exporter, files, icc, imageedit, imaging, merge, music, pdf, people, plugins, tether, tools, updates, video, xmp  # noqa: F401  (register APIs)
from .core import api, cfg, ApiError, Binary, FileRef

mimetypes.add_type('application/javascript', '.js')
mimetypes.add_type('text/css', '.css')
mimetypes.add_type('font/ttf', '.ttf')


@api
def boot():
    """Everything the UI needs before it can draw."""
    cat = core.state['cat'] or catalog.open_startup()
    return {'app': core.APP_NAME, 'version': core.VERSION, 'home': core.HOME, 'catalog': cat.info(),
            'config': cfg.data, 'platform': sys.platform, 'raw': imaging.rawpy is not None,
            'faces': people.models_ok(), 'dng': files.dng_converter(), 'pictures': os.path.join(os.path.expanduser('~'), 'Pictures'),
            'plugins': plugins.plugins_list(), 'profiles': icc.profiles()}


class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    server_version = 'Opia'

    def log_message(self, fmt, *args):
        pass

    def _send(self, code, body, ctype='application/json', cache=False):
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'private, max-age=31536000, immutable' if cache else 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.end_headers()
        try:
            self.wfile.write(body)
        except (ConnectionError, OSError):
            pass

    def _json(self, obj, code=200):
        self._send(code, json.dumps(obj, separators=(',', ':')).encode('utf-8'))

    def _trusted(self):
        """Refuse other sites and rebinding tricks: the page must come from this very server."""
        host = (self.headers.get('Host') or '').split(':')[0]
        if host not in ('127.0.0.1', 'localhost'):
            return False
        origin = self.headers.get('Origin')
        if origin:
            o = urllib.parse.urlparse(origin)
            if o.hostname not in ('127.0.0.1', 'localhost') or o.port != self.server.server_port:
                return False
        return True

    def _fail(self, e):
        if isinstance(e, ApiError):
            self._json({'error': str(e)}, 400)
        else:
            traceback.print_exc()
            self._json({'error': '%s: %s' % (e.__class__.__name__, e)}, 500)

    def _file(self, ref):
        """Send a file, or the byte range the browser asked for (needed to seek in audio and video)."""
        size = os.path.getsize(ref.path)
        start, end, code = 0, size - 1, 200
        rng = self.headers.get('Range') or ''
        if rng.startswith('bytes='):
            a, _, b = rng[6:].split(',')[0].partition('-')
            try:
                if a:
                    start, end = int(a), (int(b) if b else size - 1)
                elif b:
                    start = max(0, size - int(b))
                end = min(end, size - 1)
                code = 206
            except ValueError:
                start, end = 0, size - 1
            if start > end or start >= size:
                self.send_response(416)
                self.send_header('Content-Range', 'bytes */%d' % size)
                self.send_header('Content-Length', '0')
                self.end_headers()
                return
        self.send_response(code)
        self.send_header('Content-Type', ref.ctype)
        self.send_header('Accept-Ranges', 'bytes')
        self.send_header('Content-Length', str(end - start + 1))
        if code == 206:
            self.send_header('Content-Range', 'bytes %d-%d/%d' % (start, end, size))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        try:
            with open(ref.path, 'rb') as f:
                f.seek(start)
                left = end - start + 1
                while left > 0:
                    chunk = f.read(min(1 << 20, left))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    left -= len(chunk)
        except (ConnectionError, OSError):
            pass

    def do_GET(self):
        if not self._trusted():
            return self._send(403, b'forbidden', 'text/plain')
        u = urllib.parse.urlparse(self.path)
        q = dict(urllib.parse.parse_qsl(u.query))
        path = urllib.parse.unquote(u.path)
        try:
            name, _, rest = path[5:].partition('/')
            if path.startswith('/img/') and name in core.IMG:      # anything else under /img/ is a static file (the icon)
                res = core.IMG[name](rest, q)
                if isinstance(res, FileRef):
                    return self._file(res)
                return self._send(200, res.data, res.ctype, cache=res.cache and 'v' in q)
            rel = 'index.html' if path in ('/', '') else path.lstrip('/')
            target = os.path.abspath(os.path.join(core.WEB, rel))
            if not target.startswith(os.path.abspath(core.WEB)) or not os.path.isfile(target):
                return self._send(404, b'not found', 'text/plain')
            with open(target, 'rb') as f:
                data = f.read()
            ctype = mimetypes.guess_type(target)[0] or 'application/octet-stream'
            if ctype.startswith('text/') or ctype == 'application/javascript':
                ctype += '; charset=utf-8'
            self._send(200, data, ctype)
        except Exception as e:
            self._fail(e)

    def do_POST(self):
        if not self._trusted():
            return self._send(403, b'forbidden', 'text/plain')
        u = urllib.parse.urlparse(self.path)
        q = dict(urllib.parse.parse_qsl(u.query))
        length = int(self.headers.get('Content-Length') or 0)
        if u.path.startswith('/api/stream/'):
            fn = core.STREAM.get(u.path[12:])
            try:
                if not fn:
                    self.rfile.read(length)
                    return self._json({'error': 'unknown upload'}, 404)
                return self._json({'result': fn(q, self.rfile, length)})
            except Exception as e:
                return self._fail(e)
        body = self.rfile.read(length)
        try:
            if u.path.startswith('/api/upload/'):
                fn = core.UPLOAD.get(u.path[12:])
                if not fn:
                    return self._json({'error': 'unknown upload'}, 404)
                res = fn(q, body)
                if isinstance(res, Binary):
                    return self._send(200, res.data, res.ctype)
                return self._json({'result': res})
            fn = core.API.get(u.path[5:]) if u.path.startswith('/api/') else None
            if not fn:
                return self._json({'error': 'unknown api ' + u.path}, 404)
            res = fn(**(json.loads(body) if body else {}))
            if isinstance(res, Binary):
                return self._send(200, res.data, res.ctype)
            self._json({'result': res})
        except Exception as e:
            self._fail(e)


class Server(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = False


def serve(port=0):
    plugins.load_all()
    catalog.open_startup()
    httpd = Server(('127.0.0.1', port), Handler)
    return httpd


def shutdown():
    """Called when the window closes: optional scheduled backup, then a clean catalog close."""
    cat = core.state['cat']
    if not cat:
        return
    try:
        every = cfg.get('prefs', {}).get('backupEvery', 'week')
        last = float(cat.meta('last_backup', 0) or 0)
        age = core.now() - last
        due = {'never': False, 'exit': True, 'day': age > 86400, 'week': age > 7 * 86400, 'month': age > 30 * 86400}.get(every, False)
        if due and cat.info()['count']:
            catalog.catalog_backup()
    except Exception:
        traceback.print_exc()
    cat.close()

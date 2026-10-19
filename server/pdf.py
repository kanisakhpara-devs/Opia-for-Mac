"""PDF workspace. Every file that is opened (a PDF, or a picture turned into a one-page PDF) is kept in memory as a page source.
The UI holds the document as a list of page references plus whatever was drawn on each page; saving builds a new PDF from that list,
so the files that were opened are never changed unless the user saves over one."""
import base64
import ctypes
import io
import math
import os
import threading
import uuid

from PIL import Image, ImageOps

from . import core
from .core import api, img, upload, ApiError, Binary

try:
    import pypdf
    import pypdfium2 as pdfium
    import pypdfium2.raw as pdfium_c
    from pypdf.generic import DecodedStreamObject, DictionaryObject, FloatObject, NameObject, NumberObject, RectangleObject, StreamObject
except ImportError:      # the workspace says so instead of the whole app failing to start
    pypdf = None

SRC = {}                 # id -> Source
PENDING = {}             # token -> (name, path, data) of a locked file waiting for its password
LOCK = threading.RLock()     # PDFium is not thread-safe: every call into it holds this
FONTS = {'sans': ('Helvetica', 'Helvetica-Bold'), 'serif': ('Times-Roman', 'Times-Bold'), 'mono': ('Courier', 'Courier-Bold')}


def _need():
    if pypdf is None:
        raise ApiError('PDF tools need the pypdf and pypdfium2 packages (pip install pypdf pypdfium2)')


class Source:
    def __init__(self, name, path, data, password=None, image=False):
        self.id = uuid.uuid4().hex[:12]
        self.name, self.path, self.data, self.password, self.image = name, path, data, password or None, image
        self._pdf = None

    def pdf(self):
        if self._pdf is None:
            self._pdf = pdfium.PdfDocument(self.data, password=self.password)
        return self._pdf

    def reader(self):
        """A fresh pypdf reader each time: a build must not share parsed objects with another one."""
        r = pypdf.PdfReader(io.BytesIO(self.data))
        if r.is_encrypted:
            r.decrypt(self.password or '')
        return r


def _src(sid):
    s = SRC.get(sid)
    if not s:
        raise ApiError('That file is no longer open. Open it again.')
    return s


# ---------------------------------------------------------------- opening

def _image_pdf(data, name):
    """A picture becomes one page, sized to fit A4 with no margins."""
    try:
        im = ImageOps.exif_transpose(Image.open(io.BytesIO(data)))
        im.load()
    except Exception:
        raise ApiError('%s is not a PDF or a picture Opia can read' % name)
    if im.mode in ('RGBA', 'LA', 'P'):
        im = im.convert('RGBA')
        white = Image.new('RGB', im.size, 'white')
        white.paste(im, mask=im.getchannel('A'))
        im = white
    im = im.convert('RGB')
    bw, bh = (842, 595) if im.width > im.height else (595, 842)
    scale = min(bw / im.width, bh / im.height)
    buf = io.BytesIO()
    im.save(buf, 'PDF', resolution=72 / scale, quality=92)
    return buf.getvalue()


def _dev(page, w, h, x, y):
    """A point in the page's own coordinates -> points from the top-left of the page as it is displayed."""
    dx, dy = ctypes.c_int(), ctypes.c_int()
    pdfium_c.FPDF_PageToDevice(page.raw, 0, 0, round(w * 100), round(h * 100), 0, x, y, ctypes.byref(dx), ctypes.byref(dy))
    return dx.value / 100, dy.value / 100


def _matrix(page, w, h):
    """The transform that takes displayed points (origin top-left, y down) back to the page's own coordinates."""
    def at(x, y):
        px, py = ctypes.c_double(), ctypes.c_double()
        pdfium_c.FPDF_DeviceToPage(page.raw, 0, 0, round(w * 100), round(h * 100), 0, round(x * 100), round(y * 100), ctypes.byref(px), ctypes.byref(py))
        return px.value, py.value
    (ex, ey), (ax, ay), (cx, cy) = at(0, 0), at(w, 0), at(0, h)
    return [round(v, 5) for v in ((ax - ex) / w, (ay - ey) / w, (cx - ex) / h, (cy - ey) / h, ex, ey)]


def _inherit(a, key):
    for _ in range(20):
        if a is None:
            return None
        if key in a:
            return a[key]
        a = a.get('/Parent')
        a = a.get_object() if a is not None else None
    return None


def _fields(src, reader):
    """Fillable form fields, per page, placed in displayed points."""
    out = {}
    if '/AcroForm' not in reader.trailer['/Root']:
        return out
    for i, page in enumerate(reader.pages):
        rows = []
        for ref in page.get('/Annots') or []:
            a = ref.get_object()
            ft = _inherit(a, '/FT')
            if a.get('/Subtype') != '/Widget' or ft not in ('/Tx', '/Btn', '/Ch') or '/Rect' not in a:
                continue
            ff = int(_inherit(a, '/Ff') or 0)
            if ft == '/Btn' and ff & 1 << 16:        # push buttons do nothing on paper
                continue
            parts, node = [], a
            for _ in range(20):
                if node is None:
                    break
                if '/T' in node:
                    parts.append(str(node['/T']))
                node = node.get('/Parent')
                node = node.get_object() if node is not None else None
            v = _inherit(a, '/V')
            f = {'name': '.'.join(reversed(parts)), 'value': '' if v is None else str(v), 'ro': bool(ff & 1)}
            if ft == '/Tx':
                f.update(kind='text', multi=bool(ff & 1 << 12), secret=bool(ff & 1 << 13), max=int(_inherit(a, '/MaxLen') or 0))
            elif ft == '/Ch':
                opts = [(str(o[1]) if isinstance(o, list) else str(o)) for o in (_inherit(a, '/Opt') or [])]
                f.update(kind='choice', opts=opts, combo=bool(ff & 1 << 17))
            else:
                on = [k for k in (a.get('/AP', {}).get('/N', {}) or {}).keys() if k != '/Off']
                f.update(kind='radio' if ff & 1 << 15 else 'check', on=on[0] if on else '/Yes')
            with LOCK:
                pg = src.pdf()[i]
                w, h = pg.get_size()
                r = [float(n) for n in a['/Rect']]
                (x0, y0), (x1, y1) = _dev(pg, w, h, r[0], r[1]), _dev(pg, w, h, r[2], r[3])
            f.update(x=min(x0, x1), y=min(y0, y1), w=abs(x1 - x0), h=abs(y1 - y0))
            if f['name'] and f['w'] > 1 and f['h'] > 1:
                rows.append(f)
        if rows:
            out[i] = rows
    return out


def _add(name, path, data, password=None):
    _need()
    image = b'%PDF' not in data[:1024]
    if image:
        data = _image_pdf(data, name)
    src = Source(name, path, data, password, image)
    with LOCK:
        try:
            pdf = src.pdf()
            pages = [[round(v, 2) for v in pdf.get_page_size(i)] for i in range(len(pdf))]
        except pdfium.PdfiumError as e:
            if 'password' in str(e).lower():
                token = uuid.uuid4().hex
                PENDING.clear()
                PENDING[token] = (name, path, data)
                return {'needPassword': token, 'name': name, 'wrong': bool(password)}
            raise ApiError('%s could not be opened. It may be damaged, or not a PDF.' % name)
    fields, meta = {}, {}
    try:
        reader = src.reader()
        info = reader.metadata or {}
        meta = {k: str(info.get('/' + k.capitalize()) or '') for k in ('title', 'author', 'subject', 'keywords')}
        fields = _fields(src, reader)
    except Exception:
        pass
    if not pages:
        raise ApiError('%s has no pages' % name)
    SRC[src.id] = src
    return {'id': src.id, 'name': name, 'path': path, 'pages': pages, 'fields': fields, 'meta': meta, 'password': password or '', 'image': image}


@api
def pdf_open(path, password=None):
    try:
        with open(path, 'rb') as f:
            data = f.read()
    except OSError as e:
        raise ApiError('Cannot read %s (%s)' % (path, e.strerror or e))
    return _add(os.path.basename(path), path, data, password)


@upload
def pdf_upload(q, body):
    return _add(q.get('name') or 'Untitled.pdf', None, body)


@api
def pdf_unlock(token, password):
    if token not in PENDING:
        raise ApiError('Open the file again')
    res = _add(*PENDING[token], password=password)
    if 'id' in res:
        PENDING.pop(token, None)
    return res


@api
def pdf_close(ids):
    with LOCK:
        for sid in ids:
            s = SRC.pop(sid, None)
            if s and s._pdf is not None:
                s._pdf.close()
    return True


# ---------------------------------------------------------------- looking at pages

@img
def pdfpage(rest, q):
    sid, _, n = rest.partition('/')
    src = _src(sid)
    with LOCK:
        page = src.pdf()[int(n)]
        pw, ph = page.get_size()
        scale = max(40, min(int(q.get('w', 300)), 5000)) / pw
        scale = min(scale, (36e6 / (pw * ph)) ** .5)        # never more than 36 megapixels
        im = page.render(scale=scale).to_pil().convert('RGB')
        page.close()
    buf = io.BytesIO()
    im.save(buf, 'JPEG', quality=90)
    return Binary(buf.getvalue(), 'image/jpeg', cache=True)


@api
def pdf_search(pages, q):
    """pages: [[source id, page index], ...] in document order. Each hit names its position in that list."""
    q, out = (q or '').strip(), []
    if not q:
        return out
    for pos, (sid, i) in enumerate(pages):
        if not sid:
            continue
        with LOCK:
            page = _src(sid).pdf()[i]
            w, h = page.get_size()
            tp = page.get_textpage()
            find = tp.search(q)
            while len(out) < 1000:
                m = find.get_next()
                if not m:
                    break
                rects = []
                for k in range(tp.count_rects(m[0], m[1])):
                    l, b, r, t = tp.get_rect(k)
                    (x0, y0), (x1, y1) = _dev(page, w, h, l, t), _dev(page, w, h, r, b)
                    rects.append([min(x0, x1), min(y0, y1), abs(x1 - x0), abs(y1 - y0)])
                out.append({'p': pos, 'r': rects})
            find.close()
            tp.close()
            page.close()
        if len(out) >= 1000:
            break
    return out


@api
def pdf_pagetext(src, i):
    with LOCK:
        page = _src(src).pdf()[i]
        tp = page.get_textpage()
        text = tp.get_text_range()
        tp.close()
        page.close()
    return text


# ---------------------------------------------------------------- building the PDF

def _n(*vals):
    return ' '.join(('%.3f' % v).rstrip('0').rstrip('.') for v in vals)


def _rgb(c, default='#000000'):
    c = (c or default).lstrip('#')
    if len(c) != 6:
        c = default.lstrip('#')
    return tuple(int(c[k:k + 2], 16) / 255 for k in (0, 2, 4))


def _xobject(writer, url):
    """An image XObject from a data: URL made by the UI."""
    raw = base64.b64decode(url.split(',', 1)[1])
    im = Image.open(io.BytesIO(raw))
    head = {'/Type': NameObject('/XObject'), '/Subtype': NameObject('/Image'), '/Width': NumberObject(im.width), '/Height': NumberObject(im.height), '/BitsPerComponent': NumberObject(8)}
    if im.format == 'JPEG' and im.mode in ('RGB', 'L'):
        st = StreamObject()
        st._data = raw
        st[NameObject('/Filter')] = NameObject('/DCTDecode')
        st[NameObject('/ColorSpace')] = NameObject('/DeviceRGB' if im.mode == 'RGB' else '/DeviceGray')
    else:
        im = im.convert('RGBA')
        plain = DecodedStreamObject()
        plain.set_data(im.convert('RGB').tobytes())
        st = plain.flate_encode()
        st[NameObject('/ColorSpace')] = NameObject('/DeviceRGB')
        alpha = im.getchannel('A')
        if alpha.getextrema()[0] < 255:
            plain = DecodedStreamObject()
            plain.set_data(alpha.tobytes())
            mask = plain.flate_encode()
            mask.update({NameObject(k): v for k, v in head.items()})
            mask[NameObject('/ColorSpace')] = NameObject('/DeviceGray')
            st[NameObject('/SMask')] = writer._add_object(mask)
    st.update({NameObject(k): v for k, v in head.items()})
    return writer._add_object(st)


def _stamp(writer, page, annots, m, assets, cache):
    """Draw what the user added onto the page. Everything is in displayed points; m takes those to the page's own coordinates."""
    ops, fonts, gstates, images = [b'q', (_n(*m) + ' cm').encode()], {}, {}, {}

    def put(s):
        ops.append(s.encode('ascii'))

    def alpha(a, multiply=False):
        key = 'Gs%d%s' % (round(a * 100), 'm' if multiply else '')
        gstates[key] = (a, multiply)
        put('/%s gs' % key)

    for a in annots:
        t, col = a.get('t'), _rgb(a.get('color'))
        x, y, w, h, lw = (float(a.get(k) or 0) for k in ('x', 'y', 'w', 'h', 'lw'))
        put('q')
        if t == 'hl':
            alpha(.4, True)
        elif float(a.get('a', 1)) < 1:
            alpha(max(.02, float(a['a'])))
        ang = float(a.get('ang') or 0)
        if ang and 'cx' in a:           # turned about a point, so it reads upright on a page the user rotated
            c, s = math.cos(math.radians(ang)), math.sin(math.radians(ang))
            put('1 0 0 1 %s cm %s 0 0 cm 1 0 0 1 %s cm' % (_n(a['cx'], a['cy']), _n(c, s, -s, c), _n(-a['cx'], -a['cy'])))
        put('%s RG %s rg %s w 1 J 1 j' % (_n(*col), _n(*col), _n(lw or 1)))
        if t in ('hl', 'white'):
            if t == 'white':
                put(_n(*_rgb(a.get('color'), '#ffffff')) + ' rg')
            put('%s re f' % _n(x, y, w, h))
        elif t == 'rect':
            put('0 J 0 j %s re S' % _n(x, y, w, h))
        elif t == 'oval':
            k, rx, ry = .5523, w / 2, h / 2
            cx, cy = x + rx, y + ry
            put('%s m %s c %s c %s c %s c S' % (_n(cx + rx, cy), _n(cx + rx, cy + k * ry, cx + k * rx, cy + ry, cx, cy + ry), _n(cx - k * rx, cy + ry, cx - rx, cy + k * ry, cx - rx, cy),
                                             _n(cx - rx, cy - k * ry, cx - k * rx, cy - ry, cx, cy - ry), _n(cx + k * rx, cy - ry, cx + rx, cy - k * ry, cx + rx, cy)))
        elif t in ('line', 'arrow'):
            x2, y2 = x + w, y + h
            put('%s m %s l S' % (_n(x, y), _n(x2, y2)))
            if t == 'arrow':
                ln = (w * w + h * h) ** .5 or 1
                ux, uy, s = w / ln, h / ln, max(8, (lw or 1) * 4)
                put('%s m %s l %s l f' % (_n(x2 + ux * s * .4, y2 + uy * s * .4), _n(x2 - ux * s - uy * s * .5, y2 - uy * s + ux * s * .5), _n(x2 - ux * s + uy * s * .5, y2 - uy * s - ux * s * .5)))
        elif t == 'ink':
            p = a.get('pts') or []
            if len(p) >= 4:
                put('%s m %s S' % (_n(p[0], p[1]), ' '.join(_n(p[k], p[k + 1]) + ' l' for k in range(2, len(p) - 1, 2)) or _n(p[0], p[1]) + ' l'))
        elif t == 'tick':
            put('%s w %s m %s l %s l S' % (_n(max(1, w * .13)), _n(x + w * .12, y + h * .55), _n(x + w * .4, y + h * .84), _n(x + w * .9, y + h * .16)))
        elif t == 'cross':
            put('%s w %s m %s l %s m %s l S' % (_n(max(1, w * .13)), _n(x + w * .15, y + h * .15), _n(x + w * .85, y + h * .85), _n(x + w * .85, y + h * .15), _n(x + w * .15, y + h * .85)))
        elif t == 'text':
            base = FONTS.get(a.get('font'), FONTS['sans'])[1 if a.get('bold') else 0]
            fonts['F' + base.replace('-', '')] = base
            put('BT /F%s %s Tf' % (base.replace('-', ''), _n(float(a.get('size') or 12))))
            for ln in a.get('lines') or []:
                s = str(ln['s']).encode('cp1252', 'replace').replace(b'\\', b'\\\\').replace(b'(', b'\\(').replace(b')', b'\\)')
                ops.append(('1 0 0 -1 %s Tm (' % _n(ln['x'], ln['y'])).encode() + s + b') Tj')
            put('ET')
        elif t == 'img' and a.get('asset') in assets:
            key = a['asset']
            if key not in cache:
                cache[key] = _xobject(writer, assets[key])
            images['Im' + key] = cache[key]
            put('%s cm /Im%s Do' % (_n(w, 0, 0, -h, x, y + h), key))
        put('Q')
    ops.append(b'Q')

    ov = pypdf.PageObject.create_blank_page(width=float(page.mediabox.width), height=float(page.mediabox.height))
    ov.mediabox = RectangleObject([float(v) for v in page.mediabox])
    res = DictionaryObject()
    if fonts:
        res[NameObject('/Font')] = DictionaryObject({NameObject('/' + k): DictionaryObject({NameObject('/Type'): NameObject('/Font'), NameObject('/Subtype'): NameObject('/Type1'),
                                                    NameObject('/BaseFont'): NameObject('/' + v), NameObject('/Encoding'): NameObject('/WinAnsiEncoding')}) for k, v in fonts.items()})
    if gstates:
        res[NameObject('/ExtGState')] = DictionaryObject({NameObject('/' + k): DictionaryObject({NameObject('/Type'): NameObject('/ExtGState'), NameObject('/ca'): FloatObject(a), NameObject('/CA'): FloatObject(a),
                                                         **({NameObject('/BM'): NameObject('/Multiply')} if mult else {})}) for k, (a, mult) in gstates.items()})
    if images:
        res[NameObject('/XObject')] = DictionaryObject({NameObject('/' + k): v for k, v in images.items()})
    ov[NameObject('/Resources')] = res
    body = DecodedStreamObject()
    body.set_data(b'\n'.join(ops))
    ov[NameObject('/Contents')] = body
    page.merge_page(ov)


def _shrink(writer, level):
    """Re-save the pictures inside the PDF smaller. Text and line art are untouched."""
    quality, cap = (72, 1800) if level == 'medium' else (48, 1100)
    seen = set()
    for page in writer.pages:
        try:
            for im in page.images:
                ref = getattr(im, 'indirect_reference', None)
                if ref is not None:
                    if ref.idnum in seen:
                        continue
                    seen.add(ref.idnum)
                pil = im.image
                if pil is None or pil.mode not in ('RGB', 'L', 'CMYK') or min(pil.size) < 80:
                    continue
                if max(pil.size) > cap:
                    pil = pil.copy()
                    pil.thumbnail((cap, cap), Image.LANCZOS)
                im.replace(pil, quality=quality)
        except Exception:
            pass                # an odd image is left as it was
        try:
            page.compress_content_streams()
        except Exception:
            pass
    writer.compress_identical_objects()


def _build(doc, opts=None, job=None, only=None):
    _need()
    opts = opts or {}
    refs = doc.get('pages') or []
    if only is not None:
        refs = [refs[i] for i in only]
    if not refs:
        raise ApiError('There are no pages to save')
    writer = pypdf.PdfWriter()
    readers, used, first = {}, set(), None
    k = 0
    while k < len(refs):
        r = refs[k]
        sid = r.get('src')
        if not sid:
            writer.add_blank_page(float(r['w']), float(r['h']))
            k += 1
            continue
        run = []
        while k + len(run) < len(refs) and refs[k + len(run)].get('src') == sid and refs[k + len(run)]['i'] not in run:
            run.append(int(refs[k + len(run)]['i']))
        keys = {(sid, i) for i in run}
        if sid not in readers or keys & used:       # a page used twice is read again, so the two copies stay separate
            readers[sid] = _src(sid).reader()
            used -= {u for u in used if u[0] == sid}
        used |= keys
        rd = readers[sid]
        first = first or rd
        whole = only is None and run == list(range(len(rd.pages)))
        writer.append(rd, pages=run, import_outline=whole)
        k += len(run)
    if len(writer.pages) != len(refs):
        raise ApiError('The PDF could not be put together (page count mismatch)')

    forms, assets, cache, filled = doc.get('forms') or {}, doc.get('assets') or {}, {}, False
    for r, page in zip(refs, writer.pages):
        sid = r.get('src')
        vals = forms.get(sid) if sid else None
        if vals:
            try:
                writer.update_page_form_field_values(page, vals, auto_regenerate=False)
                filled = True
            except Exception:
                pass
        if r.get('an'):
            if sid:
                with LOCK:
                    pg = _src(sid).pdf()[int(r['i'])]
                    m = _matrix(pg, *pg.get_size())
                    pg.close()
            else:
                m = [1, 0, 0, -1, 0, float(r['h'])]
            _stamp(writer, page, r['an'], m, assets, cache)
        if r.get('rot'):
            page.rotate(int(r['rot']) % 360)
            page[NameObject('/Rotate')] = NumberObject(page.rotation % 360)
        if job:
            job.step()
            if job.cancel:
                raise ApiError('Cancelled')
    if filled:
        writer.set_need_appearances_writer(True)

    meta = {}
    try:
        meta = {k: str(v) for k, v in ((first.metadata if first else None) or {}).items() if isinstance(v, str)}
    except Exception:
        pass
    for key, v in (doc.get('meta') or {}).items():
        if key in ('title', 'author', 'subject', 'keywords'):
            meta['/' + key.capitalize()] = str(v)
    meta['/Producer'] = 'Opia'
    writer.add_metadata(meta)
    if opts.get('compress') in ('medium', 'small'):
        _shrink(writer, opts['compress'])
    if doc.get('password'):
        writer.encrypt(str(doc['password']), algorithm='AES-256')
    buf = io.BytesIO()
    writer.write(buf)
    return buf.getvalue()


def _write(path, data):
    os.makedirs(os.path.dirname(path) or '.', exist_ok=True)
    tmp = path + '.tmp'
    with open(tmp, 'wb') as f:
        f.write(data)
    os.replace(tmp, path)


def _pdfname(path):
    return path if path.lower().endswith('.pdf') else path + '.pdf'


@api
def pdf_save(doc, path, opts=None):
    def run(job):
        job.total = len(doc.get('pages') or [])
        data = _build(doc, opts, job)
        _write(_pdfname(path), data)
        return {'path': _pdfname(path), 'size': len(data)}
    return core.start_job('Saving PDF', run)


@api
def pdf_split(doc, folder, parts, opts=None):
    """parts: [{'name': file name, 'pages': [positions]}, ...]"""
    def run(job):
        job.total = len(parts)
        out = []
        for p in parts:
            out.append(_pdfname(os.path.join(folder, p['name'])))
            _write(out[-1], _build(doc, opts, only=p['pages']))
            job.step(p['name'])
            if job.cancel:
                break
        return {'paths': out}
    return core.start_job('Splitting PDF', run)


@api
def pdf_images(doc, folder, base, fmt='png', dpi=150, only=None):
    def run(job):
        data = _build(doc, only=only)
        os.makedirs(folder, exist_ok=True)
        out = []
        with LOCK:
            pdf = pdfium.PdfDocument(data)
            pdf.init_forms()            # so filled-in form fields show in the pictures
            job.total = len(pdf)
            for i in range(len(pdf)):
                page = pdf[i]
                im = page.render(scale=max(36, min(int(dpi), 600)) / 72).to_pil().convert('RGB')
                page.close()
                out.append(os.path.join(folder, '%s - %03d.%s' % (base, i + 1, 'jpg' if fmt == 'jpg' else 'png')))
                im.save(out[-1], quality=92) if fmt == 'jpg' else im.save(out[-1])
                job.step()
                if job.cancel:
                    break
            pdf.close()
        return {'paths': out}
    return core.start_job('Saving pages as pictures', run)


@api
def pdf_textfile(doc, path):
    def run(job):
        data = _build(doc)
        chunks = []
        with LOCK:
            pdf = pdfium.PdfDocument(data)
            job.total = len(pdf)
            for i in range(len(pdf)):
                page = pdf[i]
                tp = page.get_textpage()
                chunks.append(tp.get_text_range().replace('\r\n', '\n').strip())
                tp.close()
                page.close()
                job.step()
            pdf.close()
        text = '\n\n\f'.join(chunks)
        _write(path, text.encode('utf-8'))
        return {'path': path, 'chars': len(text.replace('\f', '').strip())}
    return core.start_job('Saving text', run)

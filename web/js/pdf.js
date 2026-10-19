'use strict';
/* PDF workspace. A document is a list of pages; each page points at a page of a file that was opened (or is blank) and carries
   whatever was added on top: text, highlights, drawings, a signature. Nothing touches the opened files; saving builds a new PDF (server/pdf.py).
   Edit view is for reading, marking up and filling forms. Pages view is for putting pages in order, rotating, removing and combining. */

const SVGNS = 'http://www.w3.org/2000/svg';
function sv(tag, attrs, ...kids) {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs || {})) { if (v == null || v === false) continue; if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else el.setAttribute(k, v); }
  el.append(kids);
  return el;
}
const pid = () => Math.random().toString(36).slice(2, 10);
const PD_FONTS = { sans: ['Arial, Helvetica, sans-serif', .95, 'Plain'], serif: ['"Times New Roman", Times, serif', .94, 'Serif'], mono: ['"Courier New", Courier, monospace', .87, 'Typewriter'] };
const PD_COLORS = ['#111111', '#e5322d', '#1f6fe5', '#1a9c4b', '#f08a00', '#8a3fd1'], PD_HL = ['#ffe14d', '#8df27c', '#7fd6ff', '#ffa3d1'];
const PD_LATIN = /^[\x20-\x7e\xa0-\xff€‘’“”–—…•™]*$/;
const PD_TOOLS = [
  ['select', 'Select', 'Click something you added to move it, resize it from its corner, or delete it. Double-click text to change it. This is also the tool for typing into form fields.'],
  ['text', 'Text', 'Click anywhere on the page and type. Use it to fill in a form that has no real fields, or to add a note.'],
  ['hl', 'Highlight', 'Drag across the words you want to mark, like a highlighter pen.'],
  ['ink', 'Draw', 'Draw freehand on the page: circle something, underline it, or scribble a note.'],
  ['sign', 'Sign', 'Draw your signature once, then click where it should go. Opia keeps it on this computer for next time.'],
  ['tick', 'Tick', 'Click to drop a tick mark, for check boxes on a form.'],
  ['cross', 'Cross', 'Click to drop a cross mark.', 1],
  ['white', 'Cover Up', 'Drag a white box over something to hide it. It covers what is underneath but does not remove it from the file, so do not rely on it for secrets.', 1],
  ['rect', 'Box', 'Drag to draw a rectangle outline.', 1], ['oval', 'Oval', 'Drag to draw an oval outline.', 1],
  ['line', 'Line', 'Drag to draw a straight line.', 1], ['arrow', 'Arrow', 'Drag to draw an arrow. It points to where you let go.', 1],
  ['pic', 'Picture', 'Choose a picture, then click where it should go.', 1],
];

const Pdf = {
  id: 'pdf', name: 'Folio', exclusive: true, doc: null, srcs: new Map(), view: 'edit', zoom: 'fit', tool: 'select', sel: null, cur: 0, picked: new Set(), last: null,
  undo: [], redo: [], hits: [], hit: -1, q: '', boxes: new Map(), thumbs: new Map(), pending: null,
  style: { color: '#e5322d', hl: '#ffe14d', size: 14, lw: 2, font: 'sans' },

  /* ---- set-up */
  init(el) {
    el.left.remove(); el.right.remove(); el.center.classList.add('pdf');
    this.bar = h('div', { class: 'mu-bar pd-bar' }); this.tools = h('div', { class: 'mu-tools pd-tools' }); this.stage = h('div', { class: 'pd-stage' });
    this.picker = h('input', { type: 'file', multiple: true, accept: '.pdf,application/pdf,image/*', style: { display: 'none' } });
    this.imgPicker = h('input', { type: 'file', accept: 'image/*', style: { display: 'none' } });
    el.center.append(this.bar, this.tools, this.stage, this.picker, this.imgPicker);
    for (const b of [this.bar, this.tools]) b.addEventListener('mousedown', e => { if (!e.target.closest('input,select,textarea')) e.preventDefault(); });   // keep the focus in a note being typed, or its blur redraws the bar and swallows the click
    this.ctx = document.createElement('canvas').getContext('2d');
    this.io = new IntersectionObserver(es => { for (const e of es) if (e.isIntersecting) { e.target.src = e.target.dataset.src; this.io.unobserve(e.target); } }, { rootMargin: '700px' });
    this.stage.addEventListener('dragover', e => { if ([...e.dataTransfer.types].includes('Files')) e.preventDefault(); });
    this.stage.addEventListener('drop', e => { if (!e.dataTransfer.files.length) return; e.preventDefault(); const at = this.dropAt(e); (this.doc ? this.addFiles([...e.dataTransfer.files], at) : this.openFiles([...e.dataTransfer.files])).catch(UI.error); });
    App.on('prefs', k => { if (k === 'beginner') this.draw(); });
    addEventListener('resize', debounce(() => { if (App.module === 'pdf' && this.doc && this.view === 'edit' && this.zoom === 'fit') { this.drawStage(); this.drawBar(); } }, 150));
    this.keys = {
      'Ctrl+Z': 'pdf.undo', 'Ctrl+Y': 'pdf.redo', 'Ctrl+Shift+Z': 'pdf.redo', 'Ctrl+S': 'pdf.save', 'Ctrl+Shift+S': 'pdf.saveas', 'Ctrl+O': 'pdf.open',
      'Ctrl+A': 'pdf.selall', 'Ctrl+D': 'pdf.dup', 'Ctrl+F': () => { const s = $('.pd-find', this.bar); if (s) { s.focus(); s.select(); } },
      'Delete': () => this.del(), 'Backspace': () => this.del(), 'Escape': () => { if (this.sel) { this.sel = null; this.repaint(); this.drawTools(); } else this.setTool('select'); },
      'Ctrl+=': () => this.zoomBy(1.2), 'Ctrl++': () => this.zoomBy(1.2), 'Ctrl+-': () => this.zoomBy(1 / 1.2), 'Ctrl+0': () => this.setZoom('fit'),
    };
    this.draw();
  },
  show() { this.draw(); },
  hide() { this.endEdit(); },

  /* ---- opening and adding files */
  pickFiles(input = this.picker) { return new Promise(res => { input.value = ''; input.onchange = () => res([...input.files]); input.click(); }); },
  async source(file) {
    let r = file.path ? await api('pdf_open', { path: file.path }) : await upload('pdf_upload', { name: file.name }, file);
    while (r.needPassword) {
      const pw = await UI.prompt(r.wrong ? 'Wrong Password' : 'Password Needed', r.name + ' is locked. Type its password to open it.');
      if (!pw) return null;
      r = await api('pdf_unlock', { token: r.needPassword, password: pw });
    }
    this.srcs.set(r.id, r);
    return r;
  },
  async sources(files) {
    const out = [];
    for (const f of files) { try { const s = await this.source(f); if (s) out.push(s); } catch (e) { UI.error(e); } }
    return out;
  },
  pagesOf(s) { return s.pages.map(([w, h], i) => ({ id: pid(), src: s.id, i, w, h, rot: 0, an: [] })); },
  async open() { const files = await this.pickFiles(); if (files.length) await this.openFiles(files); },
  async openFiles(files) {
    if (!await this.leave()) return;
    const ss = await this.sources(files);
    if (!ss.length) return;
    const gone = [...this.srcs.keys()].filter(k => !ss.some(s => s.id === k));
    if (gone.length) { api('pdf_close', { ids: gone }).catch(() => {}); gone.forEach(k => this.srcs.delete(k)); }
    this.doc = { name: ss[0].name.replace(/\.[^.]+$/, ''), path: null, folder: ss[0].path ? ss[0].path.replace(/[\\/][^\\/]*$/, '') : null, pages: ss.flatMap(s => this.pagesOf(s)), forms: {}, assets: {}, meta: { ...ss[0].meta }, password: ss[0].password || '', dirty: ss.length > 1 || ss[0].image };
    this.undo = []; this.redo = []; this.sel = null; this.picked.clear(); this.hits = []; this.hit = -1; this.q = ''; this.cur = 0; this.zoom = 'fit'; this.tool = 'select';
    this.view = ss.length > 1 ? 'pages' : 'edit';
    this.draw();
    if (ss.length > 1) UI.toast(ss.length + ' files combined into one document. Drag pages to reorder them, then Save.');
  },
  async add() { if (!this.doc) return this.open(); const files = await this.pickFiles(); if (files.length) await this.addFiles(files); },
  async addFiles(files, at) {
    const ss = await this.sources(files); if (!ss.length) return;
    const pages = ss.flatMap(s => this.pagesOf(s));
    this.mark();
    this.doc.pages.splice(at == null ? this.doc.pages.length : at, 0, ...pages);
    this.picked = new Set(pages.map(p => p.id));
    this.after(true);
    UI.toast(pages.length + (pages.length === 1 ? ' page added' : ' pages added'));
    const first = this.find(pages[0].id); if (first) this.reveal(pages[0].id);
  },
  async openRecent(path) { await this.openFiles([{ path, name: path.split(/[\\/]/).pop() }]); },
  /* true when it is fine to drop the open document */
  async leave() { this.endEdit(); return !this.doc || !this.doc.dirty || await UI.confirm('Unsaved Changes', '"' + this.doc.name + '" has changes that are not saved. Carry on without saving?', 'Discard Changes'); },
  async close() { if (!this.doc || !await this.leave()) return; api('pdf_close', { ids: [...this.srcs.keys()] }).catch(() => {}); this.srcs.clear(); this.doc = null; this.draw(); },

  /* ---- undo */
  snap() { const d = this.doc; return JSON.stringify({ pages: d.pages, forms: d.forms, meta: d.meta, password: d.password, name: d.name }); },
  mark() { this.undo.push(this.snap()); if (this.undo.length > 80) this.undo.shift(); this.redo = []; },
  after(full) { this.doc.dirty = true; if (full) this.draw(); else { this.repaint(); this.drawBar(); this.drawTools(); } },
  step(from, to) {
    if (!this.doc || !from.length) return;
    this.endEdit(); to.push(this.snap()); Object.assign(this.doc, JSON.parse(from.pop()));
    this.sel = null; this.doc.dirty = true; const ids = new Set(this.doc.pages.map(p => p.id)); this.picked = new Set([...this.picked].filter(i => ids.has(i)));
    this.draw();
  },

  /* ---- geometry */
  dsize(p) { return p.rot % 180 ? [p.h, p.w] : [p.w, p.h]; },
  find(id) { return this.doc.pages.find(p => p.id === id); },
  fitZoom() { const sc = $('.pd-scroll', this.stage), w = (sc ? sc.clientWidth : this.stage.clientWidth - 150) - 70, widest = Math.max(...this.doc.pages.map(p => this.dsize(p)[0])); return clamp(w / widest, .15, 2.2); },
  z() { return this.zoom === 'fit' ? this.fitZoom() : this.zoom; },
  /* the pointer, in the page's own unrotated points */
  pt(e, p) {
    const b = this.boxes.get(p.id), r = b.box.getBoundingClientRect(), x = (e.clientX - r.left) / b.z, y = (e.clientY - r.top) / b.z;
    const q = p.rot === 90 ? [y, p.h - x] : p.rot === 180 ? [p.w - x, p.h - y] : p.rot === 270 ? [p.w - y, x] : [x, y];
    return { x: clamp(q[0], 0, p.w), y: clamp(q[1], 0, p.h) };
  },
  /* a point on the page as it is shown -> the same spot in unrotated points */
  unrot(p, x, y) { return p.rot === 90 ? [y, p.h - x] : p.rot === 180 ? [p.w - x, p.h - y] : p.rot === 270 ? [p.w - y, x] : [x, y]; },
  rot(deg, x, y) { const r = deg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r); return [x * c - y * s, x * s + y * c]; },
  /* the point something is turned about: text turns about where it starts, so it stays put as you type; the rest about its middle */
  pivot(a) { if (a.t === 'text') return [a.x, a.y]; const b = this.bbox(a); return [b.x + b.w / 2, b.y + b.h / 2]; },
  upright(p) { return (360 - p.rot) % 360; },
  font(a, scale = 1) { return (a.bold ? 'bold ' : '') + a.size * scale + 'px ' + PD_FONTS[a.font || 'sans'][0]; },
  layout(a) {
    const rows = (a.text || '').split('\n'); this.ctx.font = this.font(a);
    const asc = PD_FONTS[a.font || 'sans'][1], w = Math.max(4, ...rows.map(s => this.ctx.measureText(s).width));
    return { w, h: rows.length * a.size * 1.2, lines: rows.map((s, k) => ({ s, x: a.x, y: a.y + a.size * asc + k * a.size * 1.2 })) };
  },
  bbox(a) {
    if (a.t === 'text') { const l = this.layout(a); return { x: a.x, y: a.y, w: l.w, h: l.h }; }
    if (a.t === 'ink') { let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (let k = 0; k < a.pts.length; k += 2) { x0 = Math.min(x0, a.pts[k]); x1 = Math.max(x1, a.pts[k]); y0 = Math.min(y0, a.pts[k + 1]); y1 = Math.max(y1, a.pts[k + 1]); } return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }; }
    return { x: Math.min(a.x, a.x + a.w), y: Math.min(a.y, a.y + a.h), w: Math.abs(a.w), h: Math.abs(a.h) };
  },

  /* ---- drawing the interface */
  draw() { if (!this.bar) return; this.drawStage(); this.drawBar(); this.drawTools(); },
  btn(label, run, tip, cls) { const b = h('button', { class: 'btn ' + (cls || ''), onclick: () => { try { const r = run(); if (r && r.catch) r.catch(UI.error); } catch (e) { UI.error(e); } } }, label); if (tip) { b.dataset.tip = tip; b.dataset.tipName = label.replace(/…$/, ''); } return b; },
  drawBar() {
    const d = this.doc, sep = () => h('span', { class: 'mu-sep' });
    if (!d) return this.bar.replaceChildren(this.btn('Open…', () => this.open(), 'Open a PDF, or several files at once to combine them. Pictures can be opened too; each becomes a page.', 'primary'), h('span', { class: 'dim' }, 'Open a PDF to read it, write on it, sign it, or rearrange its pages.'));
    const n = d.pages.length, find = h('input', { type: 'search', class: 'pd-find', placeholder: 'Find in document', value: this.q, onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); this.search(find.value, e.shiftKey ? -1 : 1).catch(UI.error); } } });
    this.bar.replaceChildren(
      this.btn('Open…', () => this.open(), 'Open a different PDF.'), this.btn('Add Files…', () => this.add(), 'Add more PDFs or pictures to the end of this document. This is how you combine files into one PDF.'),
      this.btn(d.dirty ? 'Save *' : 'Save', () => this.save(), 'Save the document as a PDF. The first time, Opia asks where to put it; the files you opened are left as they were.', d.dirty ? 'primary' : ''),
      this.btn('Save As…', () => this.saveAs(), 'Save a copy under a new name, with options to make the file smaller.', 'adv'), sep(),
      h('b', { class: 'mu-name', title: 'Double-click to rename', data: { notr: 1 }, ondblclick: () => this.rename() }, d.name), h('span', { class: 'dim' }, n + (n === 1 ? ' page' : ' pages')), sep(),
      h('span', { class: 'seg' }, h('a', { class: this.view === 'edit' ? 'on' : '', title: 'Read, write on and sign the pages', onclick: () => this.setView('edit') }, 'Edit'), h('a', { class: this.view === 'pages' ? 'on' : '', title: 'Reorder, rotate, delete and combine pages', onclick: () => this.setView('pages') }, 'Pages')),
      this.view === 'edit' ? [sep(), h('button', { class: 'btn', title: 'Zoom out', onclick: () => this.zoomBy(1 / 1.2) }, '−'), h('span', { class: 'pd-zoom', title: 'Fit the page to the window', onclick: () => this.setZoom('fit') }, Math.round((this.zcur || 1) * 100) + '%'), h('button', { class: 'btn', title: 'Zoom in', onclick: () => this.zoomBy(1.2) }, '+'),
        h('span', { class: 'dim pd-where' }, 'Page ' + (this.cur + 1) + ' of ' + n)] : null,
      h('span', { style: { flex: 1 } }), find, this.hits.length ? h('span', { class: 'dim' }, (this.hit + 1) + ' of ' + this.hits.length) : null,
      h('button', { class: 'btn', title: 'Undo', disabled: !this.undo.length, onclick: () => this.step(this.undo, this.redo) }, '↶'), h('button', { class: 'btn', title: 'Redo', disabled: !this.redo.length, onclick: () => this.step(this.redo, this.undo) }, '↷'),
      h('button', { class: 'btn', onclick: e => { const r = e.currentTarget.getBoundingClientRect(); UI.menu(r.left, r.bottom + 4, this.moreItems()); } }, 'More ▾'));
  },
  moreItems() {
    const it = (label, run, adv) => (adv && Modes.beginner ? null : { label, run: () => { const r = run(); if (r && r.catch) r.catch(UI.error); } });
    return [it('Page Numbers…', () => this.numbers()), it('Watermark…', () => this.watermark(), 1), it('Password…', () => this.protect()), '-',
      it('Save Pages as Pictures…', () => this.exportImages()), it('Save All Text…', () => this.exportText(), 1), it('Split into Several Files…', () => this.split(), 1), it('Copy This Page’s Text', () => this.copyText(), 1), '-',
      it('Properties…', () => this.props(), 1), it('Close Document', () => this.close())].filter(Boolean);
  },
  drawTools() {
    const d = this.doc; if (!d) return this.tools.replaceChildren();
    const sep = () => h('span', { class: 'mu-sep' });
    if (this.view === 'pages') {
      const n = this.picked.size, need = fn => () => { if (!this.picked.size) return UI.toast('Click a page first. Ctrl-click or Shift-click picks several.'); return fn(); };
      return this.tools.replaceChildren(
        this.btn('Rotate Left', need(() => this.rotate(-90)), 'Turn the picked pages a quarter turn to the left.'), this.btn('Rotate Right', need(() => this.rotate(90)), 'Turn the picked pages a quarter turn to the right.'),
        this.btn('Duplicate', need(() => this.duplicate()), 'Make a copy of each picked page, right after it.'), this.btn('Delete', need(() => this.removePages()), 'Remove the picked pages from this document. The file you opened is not changed.'), sep(),
        this.btn('Add Files…', () => this.add(), 'Add more PDFs or pictures. You can also drop files between two pages.'), this.btn('Blank Page', () => this.blank(), 'Insert an empty page after the picked page.'),
        this.btn('Extract…', need(() => this.saveAs([...d.pages.filter(p => this.picked.has(p.id))])), 'Save just the picked pages as a new PDF.'), this.btn('Reverse Order', () => { this.mark(); d.pages.reverse(); this.after(true); }, 'Flip the order of all the pages, last to first.', 'adv'), sep(),
        this.btn('Select All', () => this.selectAll()), h('span', { class: 'dim' }, n ? n + ' picked' : 'Drag pages to put them in a new order. Double-click a page to open it.'));
    }
    const a = this.sel, isText = (a && a.t === 'text') || (!a && this.tool === 'text'), isHl = (a && a.t === 'hl') || (!a && this.tool === 'hl'), noStyle = (a && ['img', 'white'].includes(a.t)) || (!a && ['sign', 'pic', 'white', 'select'].includes(this.tool));
    const tools = PD_TOOLS.map(([id, label, tip, adv]) => { const b = h('a', { class: (this.tool === id ? 'on' : '') + (adv ? ' adv' : ''), onclick: () => this.setTool(id) }, label); b.dataset.tip = tip; b.dataset.tipName = label; return b; });
    const cur = a ? a.color : isHl ? this.style.hl : this.style.color, setStyle = (k, v) => { if (a) { this.mark(); a[k] = v; this.after(); } else { this.style[k === 'color' && isHl ? 'hl' : k] = v; this.drawTools(); } };
    const size = isText ? h('select', { title: 'Text size', onchange: e => setStyle('size', +e.target.value) }, [8, 10, 11, 12, 14, 16, 18, 24, 32, 48, 72].concat(a && a.t === 'text' ? [Math.round(a.size)] : []).filter((v, k, l) => l.indexOf(v) === k).sort((x, y) => x - y).map(v => h('option', { value: v, selected: v === Math.round(a ? a.size : this.style.size) }, v + ' pt')))
      : h('select', { title: 'Line thickness', onchange: e => setStyle('lw', +e.target.value) }, [1, 2, 3, 5, 8, 12].map(v => h('option', { value: v, selected: v === (a ? a.lw : this.style.lw) }, v + ' pt line')));
    this.tools.replaceChildren(h('span', { class: 'seg pd-toolseg' }, tools),
      noStyle ? null : [sep(), (isHl ? PD_HL : PD_COLORS).map(c => h('span', { class: 'swatch btn-sw' + (cur === c ? ' on' : ''), style: { background: c }, title: 'Colour', onclick: () => setStyle('color', c) })),
        isHl ? null : size, isText ? h('select', { title: 'Typeface', onchange: e => setStyle('font', e.target.value) }, Object.entries(PD_FONTS).map(([k, f]) => h('option', { value: k, selected: k === (a ? a.font || 'sans' : this.style.font) }, f[2]))) : null],
      this.tool === 'sign' ? [sep(), this.btn('Change Signature…', () => this.signature(true))] : null,
      a ? [sep(), this.btn('Delete', () => this.del())] : null,
      h('span', { class: 'dim pd-hint' }, a ? 'Drag to move. Drag the corner dot to resize.' : { select: d.pages.some(p => p.src && (this.srcs.get(p.src).fields || {})[p.i]) ? 'This PDF has form fields: click one and type.' : 'Pick a tool to write or draw on the page.', text: 'Click on the page and type.', hl: 'Drag across what you want to highlight.', ink: 'Draw on the page.', sign: 'Click where the signature should go.', tick: 'Click to place a tick.', cross: 'Click to place a cross.', white: 'Drag over what you want to hide.', pic: 'Click where the picture should go.' }[this.tool] || 'Drag on the page.'));
    this.stage.dataset.tool = this.tool;
  },
  welcome() {
    const recent = App.conf('pdf_recent', []);
    return h('div', { class: 'pd-welcome' }, h('img', { class: 'pd-logo', src: 'img/opia-pdf-icon.svg', alt: '' }), h('h2', {}, 'Folio'), h('p', { class: 'dim' }, 'Read a PDF, fill it in, sign it, highlight it, or put its pages in a new order. Open several files at once to combine them into one.'),
      h('div', { class: 'pd-big' }, this.btn('Open a PDF…', () => this.open(), null, 'primary big'), this.btn('Combine Files…', () => this.open(), null, 'big'), this.btn('Pictures to PDF…', () => this.open(), null, 'big')),
      h('p', { class: 'dim' }, 'Or drop files anywhere in this window.'),
      recent.length ? h('div', { class: 'pd-recent' }, h('div', { class: 'fsec' }, 'Saved recently'), recent.map(p => h('a', { title: p, data: { notr: 1 }, onclick: () => this.openRecent(p).catch(UI.error) }, p.split(/[\\/]/).pop()))) : null);
  },
  /* one page: the picture of it, what was added on top, and (in the Edit view) its form fields */
  pageBox(p, z, live) {
    const [dw, dh] = this.dsize(p), tf = p.rot === 90 ? `translate(${p.h * z}px,0) rotate(90deg)` : p.rot === 180 ? `translate(${p.w * z}px,${p.h * z}px) rotate(180deg)` : p.rot === 270 ? `translate(0,${p.w * z}px) rotate(270deg)` : '';
    const px = clamp(Math.ceil(p.w * z * (devicePixelRatio || 1) / 200) * 200, 200, 4000);
    const im = p.src ? h('img', { draggable: false, alt: '', data: { src: `/img/pdfpage/${p.src}/${p.i}?w=${px}&v=1` } }) : null;
    const svg = sv('svg', { viewBox: `0 0 ${p.w} ${p.h}`, class: 'pd-svg', 'data-notr': 1 }), inner = h('div', { class: 'pd-in', style: { width: p.w * z + 'px', height: p.h * z + 'px', transform: tf } }, im, svg);
    const box = h('div', { class: 'pd-page', style: { width: dw * z + 'px', height: dh * z + 'px' }, data: { id: p.id } }, inner);
    if (im) this.io.observe(im);
    if (live) { svg.addEventListener('pointerdown', e => this.down(e, p)); svg.addEventListener('dblclick', e => { const t = e.target.closest('[data-a]'), a = t && p.an.find(x => x.id === t.dataset.a); if (a && a.t === 'text') this.edit(a, p); }); inner.append(this.fieldLayer(p, z)); }
    (live ? this.boxes : this.thumbs).set(p.id, { box, inner, svg, z });
    this.paint(p);
    return box;
  },
  fieldLayer(p, z) {
    const s = p.src && this.srcs.get(p.src), fs = (s && s.fields && s.fields[p.i]) || [], d = this.doc;
    const get = f => (d.forms[p.src] && f.name in d.forms[p.src] ? d.forms[p.src][f.name] : f.value), set = (f, v) => { this.mark(); (d.forms[p.src] ??= {})[f.name] = v; d.dirty = true; this.drawBar(); };
    return h('div', { class: 'pd-fields', data: { notr: 1 } }, fs.map(f => {
      const st = { left: f.x * z + 'px', top: f.y * z + 'px', width: f.w * z + 'px', height: f.h * z + 'px', fontSize: clamp(f.h * .62, 6, 13) * z + 'px' };
      if (f.kind === 'check' || f.kind === 'radio') return h('input', { type: f.kind === 'radio' ? 'radio' : 'checkbox', name: p.id + f.name, style: st, disabled: f.ro, checked: get(f) === f.on, onchange: e => set(f, e.target.checked ? f.on : '/Off') });
      if (f.kind === 'choice') return h('select', { style: st, disabled: f.ro, onchange: e => set(f, e.target.value) }, h('option', { value: '' }, ''), f.opts.map(o => h('option', { value: o, selected: o === get(f) }, o)));
      return h(f.multi ? 'textarea' : 'input', { type: f.secret ? 'password' : 'text', style: st, value: get(f), readOnly: f.ro, maxLength: f.max || null, onchange: e => set(f, e.target.value) });
    }));
  },
  drawStage() {
    const d = this.doc, keep = $('.pd-scroll', this.stage), top = keep ? keep.scrollTop / Math.max(1, keep.scrollHeight) : 0;
    this.io.disconnect(); this.boxes.clear(); this.thumbs.clear(); this.editing = null;
    this.stage.className = 'pd-stage ' + (d ? this.view : 'empty'); this.stage.dataset.tool = this.tool;
    if (!d) return this.stage.replaceChildren(this.welcome());
    if (!d.pages.length) return this.stage.replaceChildren(h('div', { class: 'pd-welcome' }, h('p', { class: 'dim' }, 'Every page has been removed.'), h('div', { class: 'pd-big' }, this.btn('Add Files…', () => this.add(), null, 'primary big'), this.btn('Undo', () => this.step(this.undo, this.redo), null, 'big'))));
    this.cur = clamp(this.cur, 0, d.pages.length - 1);
    if (this.view === 'pages') {
      const grid = h('div', { class: 'pd-grid pd-scroll', tabindex: 0, role: 'region', 'aria-label': 'Pages', onclick: e => { if (e.target === grid) { this.picked.clear(); this.syncPicked(); } } }, d.pages.map((p, k) => this.cell(p, k)));
      this.stage.replaceChildren(grid); grid.scrollTop = top * grid.scrollHeight; return;
    }
    const strip = h('div', { class: 'pd-strip' }, d.pages.map((p, k) => { const [dw] = this.dsize(p); return h('a', { class: k === this.cur ? 'on' : '', data: { k }, onclick: () => this.goto(k) }, this.pageBox(p, 104 / dw, false), h('i', {}, k + 1)); }));
    const scroll = h('div', { class: 'pd-scroll pd-read', tabindex: 0, role: 'region', 'aria-label': 'Document' });
    this.stage.replaceChildren(strip, scroll);
    const z = this.zcur = this.z(); scroll.append(d.pages.map(p => this.pageBox(p, z, true)));
    scroll.scrollTop = top * scroll.scrollHeight;
    let tick = false; scroll.addEventListener('scroll', () => { if (tick) return; tick = true; requestAnimationFrame(() => { tick = false; this.track(scroll); }); });
    scroll.addEventListener('wheel', e => { if (e.ctrlKey) { e.preventDefault(); this.zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1); } }, { passive: false });
    scroll.addEventListener('pointerdown', e => { if (e.target === scroll && this.sel) { this.sel = null; this.repaint(); this.drawTools(); } });
  },
  track(scroll) {
    const mid = scroll.scrollTop + scroll.clientHeight * .4; let k = 0;
    [...scroll.children].forEach((b, i) => { if (b.offsetTop <= mid) k = i; });
    if (k === this.cur) return;
    this.cur = k; const w = $('.pd-where', this.bar); if (w) w.textContent = 'Page ' + (k + 1) + ' of ' + this.doc.pages.length;
    $$('.pd-strip a', this.stage).forEach((a, i) => a.classList.toggle('on', i === k));
    const on = $('.pd-strip a.on', this.stage); if (on) on.scrollIntoView({ block: 'nearest' });
  },
  goto(k) { this.cur = clamp(k, 0, this.doc.pages.length - 1); if (this.view !== 'edit') { this.picked.clear(); return this.setView('edit'); } const b = this.boxes.get(this.doc.pages[this.cur].id); if (b) b.box.scrollIntoView({ block: 'start' }); $$('.pd-strip a', this.stage).forEach((a, i) => a.classList.toggle('on', i === this.cur)); this.drawBar(); },
  reveal(id) { const b = $(`.pd-cell[data-id="${id}"]`, this.stage) || (this.boxes.get(id) || {}).box; if (b) b.scrollIntoView({ block: 'center' }); },
  setView(v) { this.endEdit(); if (v === 'edit' && this.picked.size) { const k = this.doc.pages.findIndex(p => this.picked.has(p.id)); if (k >= 0) this.cur = k; } this.view = v; this.sel = null; this.draw(); if (v === 'edit') { const b = this.boxes.get(this.doc.pages[this.cur].id); if (b) b.box.scrollIntoView({ block: 'start' }); } },
  setZoom(v) { this.zoom = v === 'fit' ? 'fit' : clamp(v, .15, 6); this.endEdit(); this.drawStage(); this.drawBar(); },
  zoomBy(f) { if (this.doc && this.view === 'edit') this.setZoom((this.zcur || 1) * f); },
  async setTool(t) {
    this.endEdit(); this.sel = null; this.pending = null;
    if (t === 'sign' && !App.conf('pdf_sig', null) && !await this.signature()) t = 'select';
    if (t === 'pic') { const [f] = await this.pickFiles(this.imgPicker); if (!f) t = 'select'; else { try { this.pending = await this.picture(f); } catch (e) { UI.toast(f.name + ' could not be read as a picture.', 'error'); t = 'select'; } } }
    if (t === 'sign') this.pending = await this.loadImage(App.conf('pdf_sig'));
    this.tool = t; if (this.view !== 'edit' && this.doc) return this.setView('edit');
    this.repaint(); this.drawTools();
  },

  /* ---- what is drawn on a page */
  shape(a) {
    const c = a.color, lw = a.lw || 1, st = { stroke: c, 'stroke-width': lw, fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
    let el; const n = ['hl', 'white', 'rect', 'oval'].includes(a.t) ? this.bbox(a) : null;
    if (a.t === 'hl') el = sv('rect', { x: n.x, y: n.y, width: n.w, height: n.h, fill: c, opacity: .4, style: 'mix-blend-mode:multiply' });
    else if (a.t === 'white') el = sv('rect', { x: n.x, y: n.y, width: n.w, height: n.h, fill: '#ffffff' });
    else if (a.t === 'rect') el = sv('rect', { x: n.x, y: n.y, width: n.w, height: n.h, ...st, 'stroke-linejoin': 'miter' });
    else if (a.t === 'oval') el = sv('ellipse', { cx: n.x + n.w / 2, cy: n.y + n.h / 2, rx: n.w / 2, ry: n.h / 2, ...st });
    else if (a.t === 'line' || a.t === 'arrow') {
      const x2 = a.x + a.w, y2 = a.y + a.h, ln = Math.hypot(a.w, a.h) || 1, ux = a.w / ln, uy = a.h / ln, s = Math.max(8, lw * 4);
      el = sv('g', {}, sv('line', { x1: a.x, y1: a.y, x2, y2, ...st }), sv('line', { x1: a.x, y1: a.y, x2, y2, stroke: 'transparent', 'stroke-width': Math.max(12, lw) }),
        a.t === 'arrow' ? sv('polygon', { fill: c, points: `${x2 + ux * s * .4},${y2 + uy * s * .4} ${x2 - ux * s - uy * s * .5},${y2 - uy * s + ux * s * .5} ${x2 - ux * s + uy * s * .5},${y2 - uy * s - ux * s * .5}` }) : null);
    } else if (a.t === 'ink') { const pts = []; for (let k = 0; k < a.pts.length; k += 2) pts.push(a.pts[k] + ',' + a.pts[k + 1]); el = sv('g', {}, sv('polyline', { points: pts.join(' '), ...st }), sv('polyline', { points: pts.join(' '), fill: 'none', stroke: 'transparent', 'stroke-width': Math.max(12, lw) })); }
    else if (a.t === 'tick') el = sv('g', {}, sv('rect', { x: a.x, y: a.y, width: a.w, height: a.h, fill: 'transparent' }), sv('polyline', { points: `${a.x + a.w * .12},${a.y + a.h * .55} ${a.x + a.w * .4},${a.y + a.h * .84} ${a.x + a.w * .9},${a.y + a.h * .16}`, ...st, 'stroke-width': Math.max(1, a.w * .13) }));
    else if (a.t === 'cross') el = sv('g', {}, sv('rect', { x: a.x, y: a.y, width: a.w, height: a.h, fill: 'transparent' }), sv('path', { d: `M${a.x + a.w * .15} ${a.y + a.h * .15}L${a.x + a.w * .85} ${a.y + a.h * .85}M${a.x + a.w * .85} ${a.y + a.h * .15}L${a.x + a.w * .15} ${a.y + a.h * .85}`, ...st, 'stroke-width': Math.max(1, a.w * .13) }));
    else if (a.t === 'img') el = sv('image', { x: a.x, y: a.y, width: a.w, height: a.h, href: this.doc.assets[a.asset], preserveAspectRatio: 'none' });
    else if (a.t === 'text') {
      if (this.editing === a) return null;
      const l = this.layout(a);
      el = sv('g', {}, sv('rect', { x: a.x, y: a.y, width: l.w, height: l.h, fill: 'transparent' }), sv('text', { fill: c, 'font-size': a.size, 'font-family': PD_FONTS[a.font || 'sans'][0], 'font-weight': a.bold ? 'bold' : null, style: 'white-space:pre' }, l.lines.map(r => sv('tspan', { x: r.x, y: r.y }, r.s))));
    }
    if (!el) return null;
    if (a.ang) { const [px, py] = this.pivot(a); el.setAttribute('transform', `rotate(${a.ang} ${px} ${py})`); }
    if (a.a != null && a.a < 1) el.setAttribute('opacity', a.a);
    el.dataset.a = a.id; el.classList.add('pd-a');
    return el;
  },
  paint(p) {
    for (const v of [this.boxes.get(p.id), this.thumbs.get(p.id)]) {
      if (!v) continue;
      const live = v === this.boxes.get(p.id), kids = p.an.map(a => this.shape(a));
      if (live) {
        this.hits.forEach((ht, k) => { if (ht.pid === p.id) for (const r of ht.r) kids.push(sv('rect', { x: r[0], y: r[1], width: r[2], height: r[3], class: 'pd-hit' + (k === this.hit ? ' on' : '') })); });
        const a = this.sel && p.an.includes(this.sel) ? this.sel : null;
        if (a && this.editing !== a) {
          const b = this.bbox(a), pad = 3 / v.z, line = a.t === 'line' || a.t === 'arrow', g = sv('g', { class: 'pd-chrome' },
            line ? null : sv('rect', { x: b.x - pad, y: b.y - pad, width: b.w + pad * 2, height: b.h + pad * 2, 'stroke-width': 1 / v.z, 'stroke-dasharray': `${4 / v.z} ${3 / v.z}` }),
            sv('circle', { class: 'pd-handle', cx: line ? a.x + a.w : b.x + b.w + pad, cy: line ? a.y + a.h : b.y + b.h + pad, r: 5.5 / v.z, 'stroke-width': 1.5 / v.z }));
          if (a.ang) { const [px, py] = this.pivot(a); g.setAttribute('transform', `rotate(${a.ang} ${px} ${py})`); }
          kids.push(g);
        }
      }
      v.svg.replaceChildren(kids);
    }
  },
  repaint() { if (this.doc) for (const p of this.doc.pages) this.paint(p); },

  /* ---- pointer work in the Edit view */
  down(e, p) {
    if (e.button !== 0) return;
    this.endEdit(); e.preventDefault();
    const s = this.pt(e, p), t = this.tool, st = this.style, svg = e.currentTarget;
    const drag = (move, up) => {
      try { svg.setPointerCapture(e.pointerId); } catch (err) { /* a pointer that cannot be captured still drags while it stays over the page */ }
      const mv = ev => { move(this.pt(ev, p)); this.paint(p); }, end = ev => { svg.removeEventListener('pointermove', mv); svg.removeEventListener('pointerup', end); svg.removeEventListener('pointercancel', end); up && up(this.pt(ev, p)); };
      svg.addEventListener('pointermove', mv); svg.addEventListener('pointerup', end); svg.addEventListener('pointercancel', end);
    };
    const add = a => { a.id = pid(); p.an.push(a); return a; };
    if (t === 'select') {
      const hit = e.target.closest('[data-a]'), handle = e.target.classList.contains('pd-handle') && this.sel, a = handle ? this.sel : hit && p.an.find(x => x.id === hit.dataset.a);
      if (!a) { if (this.sel) { this.sel = null; this.repaint(); this.drawTools(); } return; }
      const was = this.sel; this.sel = a; if (was !== a) { this.repaint(); this.drawTools(); }
      const o = clone(a), ob = this.bbox(a); let moved = false;
      const begin = () => { if (!moved) { moved = true; this.mark(); } };
      const [px, py] = this.pivot(o);
      if (handle) drag(q => {
        begin();
        if (a.t === 'line' || a.t === 'arrow') { a.w = q.x - a.x; a.h = q.y - a.y; return; }
        if (a.ang && a.t !== 'text') { const f = Math.max(.1, Math.hypot(q.x - px, q.y - py) / Math.max(1, Math.hypot(ob.w, ob.h) / 2)); a.w = o.w * f; a.h = o.h * f; a.x = px - a.w / 2; a.y = py - a.h / 2; return; }
        if (a.ang) { const [lx, ly] = this.rot(-a.ang, q.x - px, q.y - py); q = { x: px + lx, y: py + ly }; }
        const f = Math.max(.05, Math.max((q.x - ob.x) / Math.max(1, ob.w), (q.y - ob.y) / Math.max(1, ob.h)));
        if (a.t === 'text') a.size = clamp(Math.round(o.size * f * 2) / 2, 4, 400);
        else if (a.t === 'img' || a.t === 'tick' || a.t === 'cross') { a.w = Math.max(4, o.w * f); a.h = Math.max(4, o.h * f); }
        else if (a.t === 'ink') { const fx = Math.max(.05, (q.x - ob.x) / Math.max(1, ob.w)), fy = Math.max(.05, (q.y - ob.y) / Math.max(1, ob.h)); a.pts = o.pts.map((v, k) => (k % 2 ? ob.y + (v - ob.y) * fy : ob.x + (v - ob.x) * fx)); }
        else { a.x = ob.x; a.y = ob.y; a.w = Math.max(2, q.x - ob.x); a.h = Math.max(2, q.y - ob.y); }
      }, () => { if (moved) this.after(); });
      else drag(q => {
        const dx = q.x - s.x, dy = q.y - s.y; if (!moved && Math.hypot(dx, dy) * this.boxes.get(p.id).z < 3) return;
        begin();
        if (a.t === 'ink') a.pts = o.pts.map((v, k) => v + (k % 2 ? dy : dx)); else { a.x = o.x + dx; a.y = o.y + dy; }
      }, () => { if (moved) this.after(); });
      return;
    }
    const up = this.upright(p), turned = a => { if (up) a.ang = up; return a; };
    if (t === 'text') { this.mark(); const [ox, oy] = this.rot(up, 0, st.size * .6), a = add(turned({ t: 'text', x: s.x - ox, y: s.y - oy, size: st.size, color: st.color, font: st.font, text: '' })); this.sel = a; this.edit(a, p, true); return; }
    if (t === 'tick' || t === 'cross') { this.mark(); add(turned({ t, x: s.x - 8, y: s.y - 8, w: 16, h: 16, color: st.color })); this.after(); return; }
    if (t === 'sign' || t === 'pic') {
      const im = this.pending; if (!im) return this.setTool('select');
      this.mark(); const key = pid(); this.doc.assets[key] = im.url;
      const w = Math.min(t === 'sign' ? 150 : 260, Math.min(p.w, p.h) * .6), hh = w * im.h / im.w;
      this.sel = add(turned({ t: 'img', x: s.x - w / 2, y: s.y - hh / 2, w, h: hh, asset: key }));
      this.tool = 'select'; this.pending = null; this.after(); return;
    }
    this.mark();
    const a = add(t === 'ink' ? { t, pts: [s.x, s.y], color: st.color, lw: st.lw } : { t, x: s.x, y: s.y, w: 0, h: 0, color: t === 'hl' ? st.hl : t === 'white' ? '#ffffff' : st.color, lw: st.lw });
    drag(q => { if (t === 'ink') { const n = a.pts.length; if (Math.hypot(q.x - a.pts[n - 2], q.y - a.pts[n - 1]) > .7) a.pts.push(+q.x.toFixed(2), +q.y.toFixed(2)); } else { a.w = q.x - s.x; a.h = q.y - s.y; } }, () => {
      const b = this.bbox(a), tiny = t === 'ink' ? a.pts.length < 4 : Math.hypot(b.w, b.h) < 3;
      if (tiny) { p.an.pop(); this.undo.pop(); this.paint(p); return; }
      if (t !== 'line' && t !== 'arrow' && t !== 'ink') Object.assign(a, b);
      if (!['hl', 'ink'].includes(t)) { this.sel = a; this.tool = 'select'; }
      this.after();
    });
  },
  edit(a, p, fresh) {
    const v = this.boxes.get(p.id); if (!v) return;
    this.editing = a; this.sel = a; this.paint(p);
    const z = v.z, before = a.text, ta = h('textarea', { class: 'pd-edit', value: a.text, spellcheck: false, style: { left: a.x * z + 'px', top: a.y * z + 'px', font: this.font(a, z), lineHeight: 1.2, color: a.color, transform: a.ang ? `rotate(${a.ang}deg)` : '', transformOrigin: '0 0' } });
    const fit = () => { const rows = ta.value.split('\n'); this.ctx.font = this.font(a, z); ta.style.width = Math.max(a.size * z * 2, ...rows.map(s => this.ctx.measureText(s).width)) + a.size * z * 1.6 + 'px'; ta.style.height = rows.length * a.size * z * 1.2 + 2 + 'px'; };
    this.endEdit = cancel => {
      this.endEdit = () => {}; this.editing = null; ta.remove();
      const text = cancel ? before : ta.value.replace(/\s+$/, '');
      if (!text) { p.an.splice(p.an.indexOf(a), 1); this.sel = null; if (fresh) this.undo.pop(); else { a.text = before; this.mark(); p.an = p.an.filter(x => x !== a); } }
      else if (text !== before) { if (!fresh) { a.text = before; this.mark(); } a.text = text; }
      else if (fresh) this.undo.pop();
      if (text !== before || (!text && !fresh)) this.doc.dirty = true;
      this.paint(p); this.drawBar(); this.drawTools();
    };
    ta.addEventListener('input', fit);
    ta.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') { e.preventDefault(); this.endEdit(true); } else if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); this.endEdit(); } });
    const born = performance.now();
    ta.addEventListener('blur', () => { if (performance.now() - born < 250) setTimeout(() => ta.focus(), 0); else this.endEdit(); });   // the click that made the note must not also close it
    v.inner.append(ta); fit(); setTimeout(() => ta.focus(), 0);
  },
  endEdit() {},
  del() {
    if (!this.doc) return;
    if (this.view === 'pages') return this.removePages();
    const a = this.sel, p = a && this.doc.pages.find(x => x.an.includes(a)); if (!p) return;
    this.mark(); p.an.splice(p.an.indexOf(a), 1); this.sel = null; this.after();
  },

  /* ---- pictures and the signature */
  loadImage(url) { return new Promise((res, rej) => { const im = new Image(); im.onload = () => res({ url, w: im.naturalWidth, h: im.naturalHeight, im }); im.onerror = () => rej(new Error('That picture could not be read')); im.src = url; }); },
  async picture(file) {
    const src = await this.loadImage(URL.createObjectURL(file)), f = Math.min(1, 1800 / Math.max(src.w, src.h)), cv = h('canvas', { width: Math.round(src.w * f), height: Math.round(src.h * f) });
    cv.getContext('2d').drawImage(src.im, 0, 0, cv.width, cv.height); URL.revokeObjectURL(src.url);
    return { url: /jpe?g$/i.test(file.type) ? cv.toDataURL('image/jpeg', .9) : cv.toDataURL('image/png'), w: cv.width, h: cv.height };
  },
  async signature(change) {
    const cv = h('canvas', { class: 'pd-sig', width: 640, height: 240 }), g = cv.getContext('2d'); let drawn = false, lastp = null;
    g.lineWidth = 3.2; g.lineCap = g.lineJoin = 'round'; g.strokeStyle = '#10145a';
    const at = e => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * cv.width / r.width, (e.clientY - r.top) * cv.height / r.height]; };
    cv.addEventListener('pointerdown', e => { cv.setPointerCapture(e.pointerId); lastp = at(e); g.beginPath(); g.arc(lastp[0], lastp[1], 1.4, 0, 7); g.fillStyle = g.strokeStyle; g.fill(); drawn = true; });
    cv.addEventListener('pointermove', e => { if (!lastp) return; const q = at(e); g.beginPath(); g.moveTo(lastp[0], lastp[1]); g.lineTo(q[0], q[1]); g.stroke(); lastp = q; });
    const stop = () => { lastp = null; }; cv.addEventListener('pointerup', stop); cv.addEventListener('pointercancel', stop);
    const ok = await UI.dialog({ title: 'Your Signature', width: 700, body: h('div', {}, h('p', { class: 'msg' }, 'Sign in the box with the mouse, a finger or a pen.'), cv, h('p', { class: 'dim' }, 'Opia keeps the signature on this computer so you can use it again. Change it any time from the Sign tool.')),
      buttons: [['Clear', () => { g.clearRect(0, 0, cv.width, cv.height); drawn = false; return false; }], ['Cancel', null], ['Use This Signature', () => (drawn ? true : (UI.toast('Sign in the box first.'), false)), 'primary']] });
    if (!ok) return false;
    const px = g.getImageData(0, 0, cv.width, cv.height).data; let x0 = cv.width, y0 = cv.height, x1 = 0, y1 = 0;      // trim to the ink
    for (let y = 0; y < cv.height; y++) for (let x = 0; x < cv.width; x++) if (px[(y * cv.width + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    const out = h('canvas', { width: x1 - x0 + 13, height: y1 - y0 + 13 }); out.getContext('2d').drawImage(cv, x0 - 6, y0 - 6, out.width, out.height, 0, 0, out.width, out.height);
    App.setConf('pdf_sig', out.toDataURL('image/png'));
    if (change) { this.pending = await this.loadImage(App.conf('pdf_sig')); UI.toast('Signature changed. Click where it should go.'); }
    return true;
  },

  /* ---- the Pages view */
  cell(p, k) {
    const [dw, dh] = this.dsize(p), z = 150 / Math.max(dw, dh * .78);
    const c = h('div', { class: 'pd-cell' + (this.picked.has(p.id) ? ' sel' : ''), draggable: true, data: { id: p.id },
      onclick: e => { e.stopPropagation(); this.pick(p, k, e); }, ondblclick: () => { this.picked = new Set([p.id]); this.cur = k; this.setView('edit'); },
      ondragstart: e => { if (!this.picked.has(p.id)) { this.picked = new Set([p.id]); this.last = k; this.syncPicked(); } e.dataTransfer.setData('text/opia-pages', '1'); e.dataTransfer.effectAllowed = 'move'; },
      ondragover: e => { e.preventDefault(); const r = c.getBoundingClientRect(), after = e.clientX > r.left + r.width / 2; $$('.pd-cell', this.stage).forEach(x => x.classList.remove('drop-a', 'drop-b')); c.classList.add(after ? 'drop-a' : 'drop-b'); },
      ondragleave: () => c.classList.remove('drop-a', 'drop-b'),
      ondrop: e => { if (e.dataTransfer.files.length) return; e.preventDefault(); e.stopPropagation(); const after = c.classList.contains('drop-a'); c.classList.remove('drop-a', 'drop-b'); this.moveTo(k + (after ? 1 : 0)); } },
      this.pageBox(p, z, false), h('i', {}, k + 1));
    return c;
  },
  dropAt(e) { const c = e.target.closest && e.target.closest('.pd-cell'); if (!c || !this.doc) return null; const k = this.doc.pages.findIndex(p => p.id === c.dataset.id), r = c.getBoundingClientRect(); $$('.pd-cell', this.stage).forEach(x => x.classList.remove('drop-a', 'drop-b')); return k + (e.clientX > r.left + r.width / 2 ? 1 : 0); },
  pick(p, k, e) {
    if (e.shiftKey && this.last != null) { const [a, b] = [Math.min(this.last, k), Math.max(this.last, k)]; if (!e.ctrlKey) this.picked.clear(); this.doc.pages.slice(a, b + 1).forEach(x => this.picked.add(x.id)); }
    else if (e.ctrlKey || e.metaKey) { this.picked.has(p.id) ? this.picked.delete(p.id) : this.picked.add(p.id); this.last = k; }
    else { this.picked = new Set([p.id]); this.last = k; }
    this.syncPicked();
  },
  syncPicked() { $$('.pd-cell', this.stage).forEach(c => c.classList.toggle('sel', this.picked.has(c.dataset.id))); this.drawTools(); },
  selectAll() { if (!this.doc) return; if (this.view !== 'pages') this.setView('pages'); this.picked = new Set(this.doc.pages.map(p => p.id)); this.syncPicked(); },
  targets() { const d = this.doc; return this.view === 'pages' ? d.pages.filter(p => this.picked.has(p.id)) : d.pages[this.cur] ? [d.pages[this.cur]] : []; },
  moveTo(at) {
    const d = this.doc, mv = d.pages.filter(p => this.picked.has(p.id)); if (!mv.length) return;
    const before = d.pages.slice(0, at).filter(p => !this.picked.has(p.id)).length, rest = d.pages.filter(p => !this.picked.has(p.id)), next = [...rest.slice(0, before), ...mv, ...rest.slice(before)];
    if (next.every((p, k) => p === d.pages[k])) return;
    this.mark(); d.pages = next; this.after(true);
  },
  rotate(by) { const ps = this.targets(); if (!ps.length) return; this.mark(); for (const p of ps) p.rot = (p.rot + by + 360) % 360; this.after(true); },
  duplicate() {
    const d = this.doc, ps = this.targets(); if (!ps.length) return;
    this.mark(); const made = [];
    for (const p of ps) { const c = clone(p); c.id = pid(); c.an.forEach(a => { a.id = pid(); }); d.pages.splice(d.pages.indexOf(p) + 1, 0, c); made.push(c.id); }
    this.picked = new Set(made); this.after(true);
  },
  removePages() { const d = this.doc, ps = this.targets(); if (!ps.length) return; this.mark(); d.pages = d.pages.filter(p => !ps.includes(p)); this.picked.clear(); this.after(true); },
  blank() {
    const d = this.doc, ps = this.targets(), ref = ps[ps.length - 1] || d.pages[d.pages.length - 1], [w, hh] = ref ? this.dsize(ref) : [595, 842];
    this.mark(); const p = { id: pid(), src: null, i: 0, w, h: hh, rot: 0, an: [] }; d.pages.splice(ref ? d.pages.indexOf(ref) + 1 : 0, 0, p); this.picked = new Set([p.id]); this.after(true); this.reveal(p.id);
  },

  /* ---- finding text */
  async search(q, dir) {
    q = q.trim(); const d = this.doc; if (!d) return;
    if (!q) { this.q = ''; this.hits = []; this.hit = -1; this.repaint(); return this.drawBar(); }
    if (q === this.q && this.hits.length) this.hit = (this.hit + dir + this.hits.length) % this.hits.length;
    else {
      this.q = q; const found = await api('pdf_search', { pages: d.pages.map(p => [p.src, p.i]), q });
      this.hits = found.map(f => ({ pid: d.pages[f.p].id, r: f.r })); this.hit = this.hits.length ? 0 : -1;
      if (!this.hits.length) UI.toast('"' + q + '" was not found. Scanned pages have no text to search.');
    }
    if (this.view !== 'edit') this.setView('edit');
    this.repaint(); this.drawBar();
    const ht = this.hits[this.hit], f = $('.pd-find', this.bar); if (f) f.focus();
    if (ht) { const k = d.pages.findIndex(p => p.id === ht.pid), b = this.boxes.get(ht.pid), on = b && $('.pd-hit.on', b.svg); this.cur = k; (on || (b && b.box)).scrollIntoView({ block: 'center' }); }
  },
  async copyText() { const p = this.doc.pages[this.cur]; if (!p || !p.src) return UI.toast('This page has no text.'); const t = (await api('pdf_pagetext', { src: p.src, i: p.i })).trim(); if (!t) return UI.toast('This page has no text to copy. It may be a scan.'); await navigator.clipboard.writeText(t); UI.toast('Text of page ' + (this.cur + 1) + ' copied.'); },

  /* ---- saving */
  /* what the server needs: text is sent as finished lines, and anything outside Western European letters as a small picture */
  out(a, assets) {
    const [cx, cy] = a.ang ? this.pivot(a) : [0, 0];
    if (a.t === 'img') assets[a.asset] = this.doc.assets[a.asset];
    if (a.t !== 'text') return a.ang ? { ...a, cx, cy } : a;
    if (!a.text.trim()) return null;
    const l = this.layout(a);
    if (PD_LATIN.test(a.text.replace(/\n/g, ''))) return { ...a, lines: l.lines, cx, cy };
    const k = 4, cv = h('canvas', { width: Math.ceil(l.w * k) + 8, height: Math.ceil(l.h * k) + 8 }), g = cv.getContext('2d'), key = pid();
    g.font = this.font(a, k); g.fillStyle = a.color; for (const r of l.lines) g.fillText(r.s, (r.x - a.x) * k, (r.y - a.y) * k);
    assets[key] = cv.toDataURL('image/png');
    return { t: 'img', x: a.x, y: a.y, w: cv.width / k, h: cv.height / k, asset: key, a: a.a, ang: a.ang, cx, cy };
  },
  payload(pages) {
    const d = this.doc, assets = {};
    return { pages: (pages || d.pages).map(p => ({ src: p.src, i: p.i, w: p.w, h: p.h, rot: p.rot, an: p.an.map(a => this.out(a, assets)).filter(Boolean) })), forms: d.forms, assets, meta: d.meta, password: d.password };
  },
  docsFolder() { return (this.doc && this.doc.folder) || App.conf('pdf_out', App.boot.pictures.replace(/Pictures$/, 'Documents')); },
  async save() { if (!this.doc) return; this.endEdit(); if (!this.doc.path) return this.saveAs(); await this.write(this.doc.path, this.payload(), {}, true); },
  /* pages given: save just those as a new file (Extract) and leave the document as it is */
  async saveAs(pages) {
    const d = this.doc; if (!d) return; this.endEdit();
    const folder = h('input', { type: 'text', value: d.path ? d.path.replace(/[\\/][^\\/]*$/, '') : this.docsFolder() }), name = h('input', { type: 'text', value: pages ? d.name + ' (pages)' : d.name });
    const small = h('select', {}, h('option', { value: '' }, 'Keep pictures as they are'), h('option', { value: 'medium' }, 'Smaller file (good for email)'), h('option', { value: 'small' }, 'Smallest file (pictures lose detail)'));
    const go = await UI.dialog({ title: pages ? 'Extract Pages' : 'Save PDF', width: 560, body: h('div', { class: 'pd-form' },
      h('label', { class: 'frow' }, h('span', {}, 'Name'), name),
      h('div', { class: 'frow' }, h('span', {}, 'Folder'), h('div', { class: 'pd-row' }, folder, h('button', { class: 'btn', onclick: async () => { const f = await UI.pickFolder(folder.value); if (f) folder.value = f; } }, 'Browse…'))),
      h('label', { class: 'frow adv' }, h('span', {}, 'File size'), small),
      d.password ? h('p', { class: 'dim' }, 'This PDF will ask for its password when opened. Change that in More > Password.') : null),
      buttons: [['Cancel', null], ['Save', () => (name.value.trim() && folder.value.trim() ? true : false), 'primary']] });
    if (!go) return;
    const file = name.value.trim().replace(/[\\/:*?"<>|]/g, '').replace(/\.pdf$/i, '') + '.pdf', path = folder.value.trim().replace(/[\\/]+$/, '') + '\\' + file;
    if (path !== d.path && (await api('fs_exists', { paths: [path] }))[0] && !await UI.confirm('Replace File?', file + ' is already in that folder. Replace it?', 'Replace')) return;
    App.setConf('pdf_out', folder.value.trim());
    await this.write(path, this.payload(pages), { compress: small.value }, !pages);
  },
  async write(path, doc, opts, whole) {
    const r = await runJob(api('pdf_save', { doc, path, opts }), 'Saving PDF');
    App.setConf('pdf_recent', [r.path, ...App.conf('pdf_recent', []).filter(p => p !== r.path)].slice(0, 8));
    if (whole) { const d = this.doc; d.path = r.path; d.name = r.path.split(/[\\/]/).pop().replace(/\.pdf$/i, ''); d.dirty = false; this.drawBar(); }
    UI.toast('Saved ' + r.path.split(/[\\/]/).pop() + ' (' + fmt.bytes(r.size) + ')');
    return r;
  },
  async rename() { const d = this.doc, n = await UI.prompt('Rename', 'Document name', d.name); if (!n) return; this.mark(); d.name = n.replace(/[\\/:*?"<>|]/g, ''); d.path = null; this.after(); },
  async outFolder(title) { const f = await UI.pickFolder(this.docsFolder()); if (f) App.setConf('pdf_out', f); return f; },
  async exportImages() {
    const fmtSel = h('select', {}, h('option', { value: 'png' }, 'PNG (sharp, larger)'), h('option', { value: 'jpg' }, 'JPEG (smaller)')), dpi = h('select', {}, h('option', { value: 96 }, 'Screen'), h('option', { value: 150, selected: true }, 'Good'), h('option', { value: 300 }, 'Print (large)'));
    const which = h('select', {}, h('option', { value: 'all' }, 'Every page'), h('option', { value: 'cur' }, this.view === 'pages' && this.picked.size ? 'Picked pages' : 'This page only'));
    if (!await UI.dialog({ title: 'Save Pages as Pictures', width: 440, body: h('div', { class: 'pd-form' }, h('label', { class: 'frow' }, h('span', {}, 'Pages'), which), h('label', { class: 'frow' }, h('span', {}, 'Format'), fmtSel), h('label', { class: 'frow' }, h('span', {}, 'Quality'), dpi)), buttons: [['Cancel', null], ['Choose Folder…', true, 'primary']] })) return;
    const folder = await this.outFolder(); if (!folder) return;
    const only = which.value === 'all' ? null : this.targets().map(p => this.doc.pages.indexOf(p));
    const r = await runJob(api('pdf_images', { doc: this.payload(), folder, base: this.doc.name, fmt: fmtSel.value, dpi: +dpi.value, only }), 'Saving pictures');
    UI.toast(r.paths.length + (r.paths.length === 1 ? ' picture saved' : ' pictures saved')); api('fs_reveal', { path: r.paths[0] }).catch(() => {});
  },
  async exportText() {
    const folder = await this.outFolder(); if (!folder) return;
    const r = await runJob(api('pdf_textfile', { doc: this.payload(), path: folder + '\\' + this.doc.name + '.txt' }), 'Saving text');
    UI.toast(r.chars ? 'Saved ' + this.doc.name + '.txt' : 'Saved, but no text was found. Scanned pages are pictures of text, which Opia cannot read.'); api('fs_reveal', { path: r.path }).catch(() => {});
  },
  async split() {
    const d = this.doc, n = d.pages.length, every = h('input', { type: 'number', min: 1, max: n, value: 1, class: 'mu-num' });
    if (n < 2) return UI.toast('There is only one page.');
    if (!await UI.dialog({ title: 'Split into Several Files', width: 440, body: h('div', { class: 'pd-form' }, h('label', { class: 'frow' }, h('span', {}, 'Pages per file'), every), h('p', { class: 'dim' }, '1 makes a separate PDF for every page.')), buttons: [['Cancel', null], ['Choose Folder…', true, 'primary']] })) return;
    const size = clamp(Math.round(+every.value) || 1, 1, n), folder = await this.outFolder(); if (!folder) return;
    const parts = []; for (let k = 0; k < n; k += size) parts.push({ name: `${d.name} - part ${String(parts.length + 1).padStart(2, '0')}.pdf`, pages: d.pages.slice(k, k + size).map((p, j) => k + j) });
    const r = await runJob(api('pdf_split', { doc: this.payload(), folder, parts }), 'Splitting PDF');
    UI.toast(r.paths.length + ' files saved'); api('fs_reveal', { path: r.paths[0] }).catch(() => {});
  },

  /* ---- things added to every page */
  /* upright text centred on a spot given as fractions of the page as shown, whatever way the page is turned */
  stamp(p, tag, text, fx, fy, o) {
    const [dw, dh] = this.dsize(p), a = { id: pid(), t: 'text', tag, text, x: 0, y: 0, size: o.size, color: o.color, font: o.font || 'sans', bold: o.bold, a: o.a }, l = this.layout(a);
    const mx = o.margin || 0, dx = fx === 0 ? mx + l.w / 2 : fx === 1 ? dw - mx - l.w / 2 : dw / 2, dy = fy === 0 ? mx + l.h / 2 : fy === 1 ? dh - mx - l.h / 2 : dh / 2, [cx, cy] = this.unrot(p, dx, dy);
    const ang = ((o.ang || 0) - p.rot + 720) % 360, [ox, oy] = this.rot(ang, l.w / 2, l.h / 2); a.x = cx - ox; a.y = cy - oy; if (ang) a.ang = ang;
    p.an.push(a);
  },
  async numbers() {
    const d = this.doc, has = d.pages.some(p => p.an.some(a => a.tag === 'num'));
    const pos = h('select', {}, [['1,1', 'Bottom right'], ['.5,1', 'Bottom centre'], ['0,1', 'Bottom left'], ['1,0', 'Top right'], ['.5,0', 'Top centre'], ['0,0', 'Top left']].map(([v, l], k) => h('option', { value: v, selected: k === 1 }, l)));
    const style = h('select', {}, h('option', { value: 'n' }, '1, 2, 3'), h('option', { value: 'p' }, 'Page 1, Page 2'), h('option', { value: 'of' }, '1 of ' + d.pages.length)), start = h('input', { type: 'number', value: 1, class: 'mu-num' }), skip = h('input', { type: 'checkbox' });
    const go = await UI.dialog({ title: 'Page Numbers', width: 440, body: h('div', { class: 'pd-form' }, h('label', { class: 'frow' }, h('span', {}, 'Where'), pos), h('label', { class: 'frow' }, h('span', {}, 'Style'), style), h('label', { class: 'frow' }, h('span', {}, 'Start at'), start), h('label', { class: 'frow' }, h('span', {}, 'First page'), h('span', {}, skip, ' leave it without a number'))),
      buttons: [...(has ? [['Remove Numbers', 'remove']] : []), ['Cancel', null], ['Add Numbers', true, 'primary']] });
    if (!go) return;
    this.mark(); for (const p of d.pages) p.an = p.an.filter(a => a.tag !== 'num');
    if (go === true) { const [fx, fy] = pos.value.split(',').map(Number), s0 = Math.round(+start.value) || 1; d.pages.forEach((p, k) => { if (skip.checked && !k) return; const n = s0 + k - (skip.checked ? 1 : 0); this.stamp(p, 'num', style.value === 'p' ? 'Page ' + n : style.value === 'of' ? n + ' of ' + (d.pages.length - (skip.checked ? 1 : 0) + s0 - 1) : String(n), fx, fy, { size: 10, color: '#222222', margin: 26 }); }); }
    this.sel = null; this.after(true);
  },
  async watermark() {
    const d = this.doc, has = d.pages.some(p => p.an.some(a => a.tag === 'wm')), text = h('input', { type: 'text', value: 'DRAFT' }), col = h('input', { type: 'color', value: '#c22b2b' });
    const op = h('select', {}, [[.12, 'Faint'], [.25, 'Light'], [.5, 'Strong']].map(([v, l]) => h('option', { value: v, selected: v === .25 }, l))), dir = h('select', {}, h('option', { value: -35 }, 'Diagonal'), h('option', { value: 0 }, 'Straight across'));
    const go = await UI.dialog({ title: 'Watermark', width: 440, body: h('div', { class: 'pd-form' }, h('label', { class: 'frow' }, h('span', {}, 'Text'), text), h('label', { class: 'frow' }, h('span', {}, 'Colour'), col), h('label', { class: 'frow' }, h('span', {}, 'Strength'), op), h('label', { class: 'frow' }, h('span', {}, 'Direction'), dir), h('p', { class: 'dim' }, 'The text is printed across the middle of every page.')),
      buttons: [...(has ? [['Remove Watermark', 'remove']] : []), ['Cancel', null], ['Add Watermark', () => (text.value.trim() ? true : false), 'primary']] });
    if (!go) return;
    this.mark(); for (const p of d.pages) p.an = p.an.filter(a => a.tag !== 'wm');
    if (go === true) for (const p of d.pages) { const [dw, dh] = this.dsize(p), t = text.value.trim(), probe = { t: 'text', text: t, x: 0, y: 0, size: 100, font: 'sans', bold: true }; const size = clamp(Math.round(100 * Math.min(dw, dh) * .85 / this.layout(probe).w), 12, 160); this.stamp(p, 'wm', t, .5, .5, { size, color: col.value, bold: true, a: +op.value, ang: +dir.value }); }
    this.sel = null; this.after(true);
  },
  async protect() {
    const d = this.doc, pw = h('input', { type: 'text', value: d.password || '', placeholder: 'No password', autocomplete: 'off' });
    const ok = await UI.dialog({ title: 'Password', width: 460, body: h('div', { class: 'pd-form' }, h('label', { class: 'frow' }, h('span', {}, 'Password'), pw), h('p', { class: 'dim' }, 'Anyone opening the saved PDF will have to type this. Leave it empty for no password. If you forget it, the file cannot be opened, so write it down.')), buttons: [['Cancel', null], ['OK', true, 'primary']] });
    if (!ok || pw.value === (d.password || '')) return;
    this.mark(); d.password = pw.value; this.after(); UI.toast(pw.value ? 'The password takes effect when you save.' : 'The saved PDF will open without a password.');
  },
  async props() {
    const d = this.doc, f = {}, row = (k, label) => h('label', { class: 'frow' }, h('span', {}, label), f[k] = h('input', { type: 'text', value: d.meta[k] || '' }));
    const ok = await UI.dialog({ title: 'Properties', width: 500, body: h('div', { class: 'pd-form' }, row('title', 'Title'), row('author', 'Author'), row('subject', 'Subject'), row('keywords', 'Keywords'), h('p', { class: 'dim' }, d.pages.length + ' pages' + (d.path ? '\n' + d.path : ''))), buttons: [['Cancel', null], ['OK', true, 'primary']] });
    if (!ok) return; const next = Object.fromEntries(Object.entries(f).map(([k, el]) => [k, el.value.trim()])); if (same(next, { title: d.meta.title || '', author: d.meta.author || '', subject: d.meta.subject || '', keywords: d.meta.keywords || '' })) return;
    this.mark(); d.meta = next; this.after();
  },
};

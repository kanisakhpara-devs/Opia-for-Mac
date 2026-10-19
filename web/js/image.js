'use strict';
/* Image workspace: a layered picture editor, in the spirit of Photoshop.
   A document is a stack of layers. A pixel layer is a canvas placed somewhere on the document; a text or shape layer keeps what it is
   (the words, the rectangle) plus a transform, and is drawn again whenever that changes, so it stays editable.
   Undo keeps whole states. Layers share their canvases between states, and a canvas is copied only the first time it is changed
   after a step is recorded, so a step costs one copy of the layer that changed. Everything happens in the browser; the server
   (server/imageedit.py) only reads files the browser cannot, writes finished pictures, and keeps projects (.opiaimg). */

const IE_BLENDS = [['source-over', 'Normal'], ['multiply', 'Multiply'], ['screen', 'Screen'], ['overlay', 'Overlay'], ['darken', 'Darken'], ['lighten', 'Lighten'], ['color-dodge', 'Color Dodge'], ['color-burn', 'Color Burn'],
  ['hard-light', 'Hard Light'], ['soft-light', 'Soft Light'], ['difference', 'Difference'], ['exclusion', 'Exclusion'], ['hue', 'Hue'], ['saturation', 'Saturation'], ['color', 'Color'], ['luminosity', 'Luminosity']];
const IE_FONTS = [['Arial, Helvetica, sans-serif', 'Arial'], ['Nunito, sans-serif', 'Nunito'], ['Georgia, serif', 'Georgia'], ['"Times New Roman", Times, serif', 'Times'], ['Verdana, sans-serif', 'Verdana'], ['"Trebuchet MS", sans-serif', 'Trebuchet'],
  ['Impact, sans-serif', 'Impact'], ['"Courier New", Courier, monospace', 'Courier'], ['"Comic Sans MS", cursive', 'Comic Sans'], ['"Segoe Script", "Brush Script MT", cursive', 'Script']];
/* id, name, key, hover help, advanced-only */
const IE_TOOLS = [
  ['move', 'Move', 'V', 'Drag to move the layer that is picked in the Layers panel. Hold Ctrl and click to pick the layer under the pointer. Arrow keys nudge it.'],
  ['rect', 'Select', 'M', 'Drag a rectangle to choose the part of the picture to work on. Hold Shift to add to the selection, Alt to take away from it. Ctrl+D clears it.'],
  ['ellipse', 'Oval Select', '', 'Drag an oval to choose part of the picture. Shift adds to the selection, Alt takes away.', 1],
  ['lasso', 'Lasso', 'L', 'Draw around something freehand to select it. Let go to close the shape.'],
  ['wand', 'Magic Wand', 'W', 'Click a colour to select everything of a similar colour that touches it. Tolerance says how similar.'],
  ['brush', 'Brush', 'B', 'Paint with the colour on the left square. [ and ] change the size. A pen paints thinner when pressed lightly.'],
  ['eraser', 'Eraser', 'E', 'Rub out parts of the layer so what is below shows through.'],
  ['fill', 'Fill', 'G', 'Click to pour colour into an area of similar colour. Inside a selection it stays inside the selection.'],
  ['gradient', 'Gradient', '', 'Drag a line to fill with a blend from the left colour to the right one.', 1],
  ['picker', 'Eyedropper', 'I', 'Click the picture to take its colour. Alt-click sets the second colour.', 1],
  ['text', 'Text', 'T', 'Click where the words should start and type. Click existing words to change them. Text stays editable until you turn it into pixels.'],
  ['shape', 'Shape', 'U', 'Drag to draw a rectangle, an oval, a line or an arrow. Each shape gets a layer of its own and stays editable.'],
  ['crop', 'Crop', 'C', 'Drag the part of the picture to keep, then press Enter or Crop. Esc gives up.'],
  ['hand', 'Hand', 'H', 'Drag to look around a picture that is bigger than the window. Holding the space bar does the same with any tool.', 1],
];
const IE_SIZES = [['Screen (1920 × 1080)', 1920, 1080], ['Square post (1080 × 1080)', 1080, 1080], ['Portrait post (1080 × 1350)', 1080, 1350], ['Story (1080 × 1920)', 1080, 1920], ['A4 page at 300 dpi', 2480, 3508], ['Letter page at 300 dpi', 2550, 3300], ['Small (800 × 600)', 800, 600]];

const ImgEd = {
  id: 'image', name: 'Imagine', exclusive: true, doc: null, tool: 'brush', undo: [], redo: [], gen: 0, view: { s: 1, ox: 0, oy: 0 }, fit: true,
  style: { fg: '#1d1d1f', bg: '#ffffff', size: 24, hard: .8, flow: 1, tol: 32, contiguous: true, all: false, font: IE_FONTS[0][0], fsize: 64, bold: false, italic: false, align: 'left', shape: 'rect', fill: true, stroke: false, lw: 6, radius: 0, selMode: 'new', grad: 'fg' },
  clip: null, sel: null, tf: null, cropR: null, paintOp: null, preview: null, editing: null, space: false, ptr: null,

  /* ---- set-up */
  init(el) {
    el.left.remove(); el.right.remove(); el.center.classList.add('ie');
    this.bar = h('div', { class: 'mu-bar ie-bar' }); this.opts = h('div', { class: 'mu-tools ie-opts' });
    this.box = h('div', { class: 'ie-toolbox' }); this.port = h('div', { class: 'ie-port' }); this.side = h('div', { class: 'ie-side' });
    this.cv = h('canvas', { class: 'ie-cv', 'aria-hidden': 'true' }); this.ov = h('canvas', { class: 'ie-ov', role: 'img', 'aria-label': 'The picture being edited' }); this.port.append(this.cv, this.ov);
    this.picker = h('input', { type: 'file', multiple: true, accept: 'image/*,.opiaimg,.tif,.tiff,.heic,.heif,.cr2,.cr3,.nef,.arw,.dng,.orf,.raf,.rw2', style: { display: 'none' } });
    el.center.append(this.bar, this.opts, h('div', { class: 'ie-stage' }, this.box, this.port, this.side), this.picker);
    for (const b of [this.bar, this.opts, this.box]) b.addEventListener('mousedown', e => { if (!e.target.closest('input,select,textarea')) e.preventDefault(); });
    this.g = this.cv.getContext('2d'); this.og = this.ov.getContext('2d');
    this.comp = h('canvas'); this.cg = this.comp.getContext('2d'); this.tmp = h('canvas'); this.tg = this.tmp.getContext('2d'); this.tmp2 = h('canvas'); this.tg2 = this.tmp2.getContext('2d');
    this.ov.addEventListener('pointerdown', e => this.down(e)); this.ov.addEventListener('pointermove', e => this.hover(e)); this.ov.addEventListener('pointerleave', () => { this.ptr = null; this.drawOv(); });
    this.ov.addEventListener('dblclick', e => { if (this.tool === 'move' || this.tool === 'text') { const L = this.layerAt(this.pt(e)); if (L && L.kind === 'text') this.editText(L); } });
    this.port.addEventListener('wheel', e => this.wheel(e), { passive: false });
    this.port.addEventListener('dragover', e => { if ([...e.dataTransfer.types].includes('Files')) e.preventDefault(); });
    this.port.addEventListener('drop', e => { if (!e.dataTransfer.files.length) return; e.preventDefault(); (this.doc ? this.place([...e.dataTransfer.files]) : this.openFiles([...e.dataTransfer.files])).catch(UI.error); });
    addEventListener('paste', e => { if (App.module !== 'image' || e.target.closest('input,textarea')) return; const f = [...e.clipboardData.files].find(f => f.type.startsWith('image/')); if (f && (!this.clip || this.clip.stale)) { e.preventDefault(); this.pasteFile(f).catch(UI.error); } });
    addEventListener('copy', () => { if (this.clip) this.clip.stale = true; });   // something else was copied: a later paste should prefer it
    addEventListener('keydown', e => { if (e.code === 'Space' && App.module === 'image' && !e.target.closest('input,textarea,select') && !this.space) { this.space = true; this.cursor(); e.preventDefault(); } });
    addEventListener('keyup', e => { if (e.code === 'Space' && this.space) { this.space = false; this.cursor(); } });
    new ResizeObserver(() => { if (App.module === 'image') this.resize(); }).observe(this.port);
    App.on('prefs', k => { if (k === 'beginner' && this.bar) { if (Modes.beginner && IE_TOOLS.find(t => t[0] === this.tool)[4]) this.tool = 'brush'; this.draw(); } });
    App.on('theme', () => this.present());
    setInterval(() => { if (App.module === 'image' && this.sel && this.sel.segs) { this.ants = (this.ants || 0) + 1; this.drawOv(); } }, 140);
    const T = Object.fromEntries(IE_TOOLS.filter(t => t[2]).map(t => [t[2], () => this.setTool(t[0])]));
    this.keys = {
      ...T, 'Ctrl+Z': 'image.undo', 'Ctrl+Y': 'image.redo', 'Ctrl+Shift+Z': 'image.redo', 'Ctrl+S': 'image.save', 'Ctrl+Shift+S': 'image.saveas', 'Ctrl+O': 'image.open', 'Ctrl+N': 'image.new', 'Ctrl+Shift+E': 'image.export',
      'Ctrl+A': 'image.selall', 'Ctrl+D': 'image.deselect', 'Ctrl+Shift+I': 'image.invert', 'Ctrl+C': 'image.copy', 'Ctrl+X': 'image.cut', 'Ctrl+V': 'image.paste', 'Ctrl+J': 'image.layercopy', 'Ctrl+T': 'image.transform',
      'Ctrl+E': 'image.mergedown', 'Ctrl+Shift+N': 'image.newlayer', 'Ctrl+L': 'image.levels', 'Ctrl+M': 'image.curves', 'Ctrl+U': 'image.hsl', 'Ctrl+I': 'image.invertc',
      'Delete': () => this.del(), 'Backspace': () => this.del(), 'Alt+Backspace': 'image.fill', 'Enter': () => this.commit(), 'Escape': () => this.cancel(),
      '[': () => this.setStyle('size', clamp(Math.round(this.style.size / 1.15), 1, 2000)), ']': () => this.setStyle('size', clamp(Math.round(this.style.size * 1.15) + 1, 1, 2000)),
      'X': () => { [this.style.fg, this.style.bg] = [this.style.bg, this.style.fg]; this.drawBox(); this.drawOpts(); }, 'D': () => { this.style.fg = '#000000'; this.style.bg = '#ffffff'; this.drawBox(); this.drawOpts(); },
      'Ctrl+0': () => this.setZoom('fit'), 'Ctrl+1': () => this.setZoom(1), 'Ctrl+=': () => this.zoomBy(1.25), 'Ctrl++': () => this.zoomBy(1.25), 'Ctrl+-': () => this.zoomBy(.8),
      'ArrowLeft': () => this.nudge(-1, 0), 'ArrowRight': () => this.nudge(1, 0), 'ArrowUp': () => this.nudge(0, -1), 'ArrowDown': () => this.nudge(0, 1),
      'Shift+ArrowLeft': () => this.nudge(-10, 0), 'Shift+ArrowRight': () => this.nudge(10, 0), 'Shift+ArrowUp': () => this.nudge(0, -10), 'Shift+ArrowDown': () => this.nudge(0, 10),
    };
    this.draw();
  },
  show() { this.draw(); requestAnimationFrame(() => this.resize()); },
  hide() { this.endText(); },
  canvas(w, hh) { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(hh)); return c; },
  copyCv(src) { const c = this.canvas(src.width, src.height); c.getContext('2d').drawImage(src, 0, 0); return c; },
  ctx(c) { return c.getContext('2d', { willReadFrequently: false }); },
  lid() { return Math.random().toString(36).slice(2, 10); },

  /* ---- documents */
  makeDoc(w, hh, name) { return { w: Math.round(w), h: Math.round(hh), name, path: null, out: null, folder: null, fromPhoto: null, layers: [], active: null, dirty: false }; },
  pixelLayer(name, cv, x = 0, y = 0) { return { id: this.lid(), kind: 'pixel', name, vis: true, op: 1, blend: 'source-over', x, y, cv, gen: this.gen }; },
  start(doc) {
    this.endText(); this.doc = doc; this.sel = null; this.tf = null; this.cropR = null; this.preview = null; this.undo = []; this.redo = []; this.gen++;
    this.comp.width = this.tmp.width = this.tmp2.width = doc.w; this.comp.height = this.tmp.height = this.tmp2.height = doc.h;
    if (!doc.active || !this.layer(doc.active)) doc.active = doc.layers[doc.layers.length - 1].id;
    this.fit = true; this.draw(); this.resize();
  },
  async newDoc() {
    if (!await this.leave()) return;
    const last = App.conf('img_new', { w: 1920, h: 1080, bg: 'white' });
    const w = h('input', { type: 'number', min: 1, max: 20000, value: last.w, class: 'mu-num' }), hh = h('input', { type: 'number', min: 1, max: 20000, value: last.h, class: 'mu-num' });
    const preset = h('select', { onchange: () => { const p = IE_SIZES[preset.selectedIndex - 1]; if (p) { w.value = p[1]; hh.value = p[2]; } } }, h('option', {}, 'Custom'), IE_SIZES.map(p => h('option', {}, p[0])));
    const bg = h('select', {}, [['white', 'White'], ['transparent', 'Transparent'], ['fg', 'The left colour'], ['black', 'Black']].map(([v, l]) => h('option', { value: v, selected: v === last.bg }, l)));
    const ok = await UI.dialog({ title: 'New Picture', width: 440, body: h('div', { class: 'pd-form' }, h('label', { class: 'frow' }, h('span', {}, 'Size'), preset), h('label', { class: 'frow' }, h('span', {}, 'Width'), h('span', {}, w, ' pixels')), h('label', { class: 'frow' }, h('span', {}, 'Height'), h('span', {}, hh, ' pixels')), h('label', { class: 'frow' }, h('span', {}, 'Background'), bg)),
      buttons: [['Cancel', null], ['Create', () => (+w.value >= 1 && +hh.value >= 1 ? true : false), 'primary']] });
    if (!ok) return;
    const W = clamp(Math.round(+w.value), 1, 20000), H = clamp(Math.round(+hh.value), 1, 20000);
    if (W * H > 200e6) return UI.toast('That is too big: keep it under 200 megapixels.', 'error');
    App.setConf('img_new', { w: W, h: H, bg: bg.value });
    const doc = this.makeDoc(W, H, 'Untitled'), c = this.canvas(W, H);
    if (bg.value !== 'transparent') { const g = c.getContext('2d'); g.fillStyle = bg.value === 'fg' ? this.style.fg : bg.value; g.fillRect(0, 0, W, H); }
    doc.layers.push(this.pixelLayer(bg.value === 'transparent' ? 'Layer 1' : 'Background', c));
    this.start(doc);
  },
  pickFiles() { return new Promise(res => { this.picker.value = ''; this.picker.onchange = () => res([...this.picker.files]); this.picker.click(); }); },
  async open() { const f = await this.pickFiles(); if (f.length) await this.openFiles(f); },
  /* a file -> a canvas; projects come back as {project} */
  async readFile(file) {
    const name = file.name || file.path.split(/[\\/]/).pop();
    if (/\.opiaimg$/i.test(name)) return { project: file.path ? await api('image_project_open', { path: file.path }) : await upload('image_project_upload', { name }, file) };
    let blob = null;
    if (file.path) blob = await (await fetch('/img/imgfile?path=' + encodeURIComponent(file.path))).blob();
    else { try { return { cv: await this.toCanvas(file), name }; } catch (e) { blob = await (await fetch('/api/upload/image_decode?name=' + encodeURIComponent(name), { method: 'POST', body: file })).blob(); } }
    if (!blob.type.startsWith('image/')) throw new Error(name + ' could not be opened as a picture');
    return { cv: await this.toCanvas(blob), name };
  },
  async toCanvas(blob) {
    const bm = await createImageBitmap(blob, { imageOrientation: 'from-image' });
    if (bm.width * bm.height > 200e6) throw new Error('That picture is too big to edit here (over 200 megapixels).');
    const c = this.canvas(bm.width, bm.height); c.getContext('2d').drawImage(bm, 0, 0); bm.close(); return c;
  },
  async openFiles(files) {
    if (!await this.leave()) return;
    const first = await this.readFile(files[0]);
    if (first.project) await this.loadProject(first.project, files[0]);
    else { const d = this.makeDoc(first.cv.width, first.cv.height, first.name.replace(/\.[^.]+$/, '')); d.layers.push(this.pixelLayer('Background', first.cv)); d.folder = files[0].path ? files[0].path.replace(/[\\/][^\\/]*$/, '') : null; this.start(d); }
    if (files[0].path) App.setConf('img_recent', [files[0].path, ...App.conf('img_recent', []).filter(p => p !== files[0].path)].slice(0, 8));
    if (files.length > 1) await this.place(files.slice(1));
  },
  async openPath(path) { await this.openFiles([{ path, name: path.split(/[\\/]/).pop() }]); },
  /* open a photo from the Lens catalog, with its Develop edits */
  async fromPhoto(p) {
    if (!p) return UI.toast('Pick a photo in Lens first.');
    App.show('image');
    if (!await this.leave()) return;
    const c = await Exporter.render(p, {}), d = this.makeDoc(c.width, c.height, p.filename.replace(/\.[^.]+$/, '') + ' edit');
    d.layers.push(this.pixelLayer('Background', c)); d.folder = p.folder; d.fromPhoto = p.id; this.start(d);
    UI.toast('Opened with its Develop edits. Export adds the result to your catalog next to the original.');
  },
  async place(files) {
    for (const f of files) {
      const r = await this.readFile(f).catch(e => { UI.error(e); return null; });
      if (!r || r.project) { if (r) UI.toast('Projects cannot be placed into another picture.'); continue; }
      this.addPixels(r.cv, r.name.replace(/\.[^.]+$/, ''));
    }
  },
  /* a picture as a new layer, centred and shrunk to fit if it is bigger than the document */
  addPixels(cv, name, x, y) {
    const d = this.doc;
    if (!d) { const nd = this.makeDoc(cv.width, cv.height, name); nd.layers.push(this.pixelLayer('Background', cv)); return this.start(nd); }
    if (x == null) { const k = Math.min(1, d.w / cv.width, d.h / cv.height); if (k < 1) { const s = this.canvas(cv.width * k, cv.height * k), g = s.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(cv, 0, 0, s.width, s.height); cv = s; } x = Math.round((d.w - cv.width) / 2); y = Math.round((d.h - cv.height) / 2); }
    this.mark('Place ' + name);
    const L = this.pixelLayer(name, cv, x, y); this.insert(L); this.setTool('move'); this.after(true);
  },
  async pasteFile(f) { const cv = await this.toCanvas(f); this.addPixels(cv, 'Pasted', this.doc && cv.width <= this.doc.w && cv.height <= this.doc.h ? Math.round((this.doc.w - cv.width) / 2) : undefined, this.doc ? Math.round((this.doc.h - cv.height) / 2) : undefined); },
  async leave() { this.endText(); return !this.doc || !this.doc.dirty || await UI.confirm('Unsaved Changes', '"' + this.doc.name + '" has changes that are not saved. Carry on without saving them?', 'Discard Changes'); },
  async close() { if (!this.doc || !await this.leave()) return; this.doc = null; this.sel = null; this.undo = []; this.redo = []; this.draw(); },

  /* ---- layers */
  layer(id) { return this.doc && this.doc.layers.find(L => L.id === id); },
  get L() { return this.doc && this.layer(this.doc.active); },
  insert(L, at) { const ls = this.doc.layers, i = at ?? ls.indexOf(this.L) + 1; ls.splice(i || ls.length, 0, L); this.doc.active = L.id; },
  /* the canvas of a layer, safe to draw on: copied first if an earlier state still uses it */
  writable(L) { if (L.gen !== this.gen) { L.cv = this.copyCv(L.cv); L.gen = this.gen; } return L.cv.getContext('2d'); },
  /* grow a pixel layer so it covers the rectangle (document coordinates) */
  grow(L, x0 = 0, y0 = 0, x1 = this.doc.w, y1 = this.doc.h) {
    const nx = Math.min(L.x, Math.floor(x0)), ny = Math.min(L.y, Math.floor(y0)), nw = Math.max(L.x + L.cv.width, Math.ceil(x1)) - nx, nh = Math.max(L.y + L.cv.height, Math.ceil(y1)) - ny;
    if (nx === L.x && ny === L.y && nw === L.cv.width && nh === L.cv.height) return;
    const c = this.canvas(nw, nh); c.getContext('2d').drawImage(L.cv, L.x - nx, L.y - ny); L.cv = c; L.gen = this.gen; L.x = nx; L.y = ny;
  },
  /* text and shape layers have to become pixels before they can be painted on */
  async pixels(L, why) {
    if (!L) { UI.toast('Add a layer first.'); return null; }
    if (L.kind === 'pixel') return L;
    if (!await UI.confirm('Turn Into Pixels?', `"${L.name}" is a ${L.kind} layer. To ${why} it has to become an ordinary picture layer, and the ${L.kind === 'text' ? 'words' : 'shape'} can no longer be changed as ${L.kind === 'text' ? 'text' : 'a shape'}.`, 'Turn Into Pixels')) return null;
    this.mark('Turn into pixels'); this.rasterize(L); this.after(true); return L;
  },
  rasterize(L) { if (L.kind === 'pixel') return; this.render(L); L.kind = 'pixel'; delete L.text; delete L.shape; delete L.m; L.gen = this.gen; },
  newLayer() { if (!this.doc) return; this.mark('New layer'); this.insert(this.pixelLayer('Layer ' + (this.doc.layers.length + 1), this.canvas(this.doc.w, this.doc.h))); this.after(true); },
  dupLayer() { const L = this.L; if (!L) return; this.mark('Duplicate layer'); const c = { ...clone({ ...L, cv: null }), id: this.lid(), name: L.name + ' copy', cv: L.cv, gen: -1 }; this.insert(c); this.after(true); },
  delLayer() { const d = this.doc, L = this.L; if (!L) return; this.mark('Delete layer'); const i = d.layers.indexOf(L); d.layers.splice(i, 1); d.active = d.layers.length ? d.layers[Math.max(0, i - 1)].id : null; this.after(true); },
  moveLayer(by) { const ls = this.doc && this.doc.layers, L = this.L; if (!L) return; const i = ls.indexOf(L), j = clamp(i + by, 0, ls.length - 1); if (i === j) return; this.mark('Move layer'); ls.splice(i, 1); ls.splice(j, 0, L); this.after(true); },
  setProp(L, k, v, label) { if (!L || L[k] === v) return; this.mark(label); L[k] = v; this.after(true); },
  async mergeDown() {
    const ls = this.doc && this.doc.layers, L = this.L, i = ls ? ls.indexOf(L) : -1; if (i < 1) return UI.toast('There is no layer below this one to merge into.');
    const below = ls[i - 1]; this.mark('Merge down'); this.rasterize(below); this.rasterize(L);
    this.grow(below, L.x, L.y, L.x + L.cv.width, L.y + L.cv.height); const g = this.writable(below);
    if (L.vis) { g.globalAlpha = L.op; g.globalCompositeOperation = L.blend; g.drawImage(L.cv, L.x - below.x, L.y - below.y); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; }
    ls.splice(i, 1); this.doc.active = below.id; this.after(true);
  },
  flatten(visibleOnly) {
    const d = this.doc; if (!d || !d.layers.length) return; this.composite();
    this.mark(visibleOnly ? 'Merge visible' : 'Flatten');
    const L = this.pixelLayer(visibleOnly ? 'Merged' : 'Background', this.copyCv(this.comp));
    if (visibleOnly) { const keep = d.layers.filter(x => !x.vis); d.layers = [...keep, L]; } else d.layers = [L];
    d.active = L.id; this.after(true);
  },
  async renameLayer(L) { const n = await UI.prompt('Rename Layer', 'Name', L.name); if (n) this.setProp(L, 'name', n, 'Rename layer'); },

  /* ---- text and shape layers: drawn from what they are, through their transform m */
  render(L) {
    const d = this.doc; if (L.kind === 'pixel') return;
    if (!L.cv || L.cv.width !== d.w || L.cv.height !== d.h || L.gen !== this.gen) { L.cv = this.canvas(d.w, d.h); L.gen = this.gen; }
    L.x = 0; L.y = 0; const g = L.cv.getContext('2d'); g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, d.w, d.h); g.setTransform(...L.m);
    if (L.kind === 'text') {
      const t = L.text; g.font = this.font(t); g.fillStyle = t.color; g.textBaseline = 'top'; g.textAlign = t.align;
      const lines = t.s.split('\n'), w = this.textW(t), ax = t.align === 'center' ? w / 2 : t.align === 'right' ? w : 0;
      lines.forEach((s, k) => g.fillText(s, ax, k * t.size * 1.2));
    } else {
      const s = L.shape, x = Math.min(s.x, s.x + s.w), y = Math.min(s.y, s.y + s.h), w = Math.abs(s.w), hh = Math.abs(s.h);
      g.lineWidth = s.lw; g.strokeStyle = s.stroke; g.fillStyle = s.fill; g.lineJoin = 'round'; g.lineCap = 'round'; g.beginPath();
      if (s.t === 'rect') { if (g.roundRect && s.r) g.roundRect(x, y, w, hh, Math.min(s.r, w / 2, hh / 2)); else g.rect(x, y, w, hh); }
      else if (s.t === 'ellipse') g.ellipse(x + w / 2, y + hh / 2, w / 2, hh / 2, 0, 0, Math.PI * 2);
      else { g.moveTo(s.x, s.y); g.lineTo(s.x + s.w, s.y + s.h); }
      if (s.t === 'line' || s.t === 'arrow') { g.strokeStyle = s.stroke || s.fill; g.stroke(); if (s.t === 'arrow') { const a = Math.atan2(s.h, s.w), hl = Math.max(12, s.lw * 3.5), ex = s.x + s.w, ey = s.y + s.h; g.beginPath(); g.moveTo(ex + Math.cos(a) * s.lw * .5, ey + Math.sin(a) * s.lw * .5); g.lineTo(ex - Math.cos(a - .45) * hl, ey - Math.sin(a - .45) * hl); g.lineTo(ex - Math.cos(a + .45) * hl, ey - Math.sin(a + .45) * hl); g.closePath(); g.fillStyle = s.stroke || s.fill; g.fill(); } }
      else { if (s.fill) g.fill(); if (s.stroke && s.lw) g.stroke(); }
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
  },
  font(t, k = 1) { return (t.italic ? 'italic ' : '') + (t.bold ? 'bold ' : '') + t.size * k + 'px ' + t.font; },
  textW(t) { this.cg.font = this.font(t); return Math.max(t.size * .5, ...t.s.split('\n').map(s => this.cg.measureText(s).width)); },
  /* the box a layer covers, before its transform (local) and in the document (corners) */
  localBox(L) {
    if (L.kind === 'text') { const t = L.text; return { x: 0, y: 0, w: this.textW(t), h: t.s.split('\n').length * t.size * 1.2 }; }
    if (L.kind === 'shape') { const s = L.shape, p = s.t === 'line' || s.t === 'arrow' ? Math.max(s.lw, 12) : (s.stroke ? s.lw / 2 : 0); return { x: Math.min(s.x, s.x + s.w) - p, y: Math.min(s.y, s.y + s.h) - p, w: Math.abs(s.w) + p * 2, h: Math.abs(s.h) + p * 2 }; }
    const b = this.alphaBox(L.cv); return b ? { x: L.x + b.x, y: L.y + b.y, w: b.w, h: b.h } : null;
  },
  corners(L) { const b = this.localBox(L); if (!b) return null; const m = L.kind === 'pixel' ? new DOMMatrix() : new DOMMatrix(L.m); return [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]].map(([x, y]) => { const p = m.transformPoint({ x, y }); return [p.x, p.y]; }); },
  /* the smallest rectangle holding every pixel that is not fully transparent */
  alphaBox(cv) {
    const k = Math.max(1, Math.ceil(Math.max(cv.width, cv.height) / 1500)), w = Math.ceil(cv.width / k), hh = Math.ceil(cv.height / k), s = this.canvas(w, hh), g = s.getContext('2d', { willReadFrequently: true });
    g.drawImage(cv, 0, 0, w, hh); const a = g.getImageData(0, 0, w, hh).data; let x0 = w, y0 = hh, x1 = -1, y1 = -1;
    for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) if (a[(y * w + x) * 4 + 3] > 2) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 < 0) return null;
    return { x: Math.max(0, (x0 - 1) * k), y: Math.max(0, (y0 - 1) * k), w: Math.min(cv.width, (x1 + 2) * k) - Math.max(0, (x0 - 1) * k), h: Math.min(cv.height, (y1 + 2) * k) - Math.max(0, (y0 - 1) * k) };
  },

  /* ---- undo: whole states, sharing canvases */
  snap(label) { const d = this.doc; return { label, w: d.w, h: d.h, active: d.active, sel: this.sel, layers: d.layers.map(L => ({ ...L, text: L.text && { ...L.text }, shape: L.shape && { ...L.shape }, m: L.m && [...L.m] })) }; },
  restore(s) {
    const d = this.doc, resized = d.w !== s.w || d.h !== s.h;
    d.w = s.w; d.h = s.h; d.active = s.active; d.layers = s.layers.map(L => ({ ...L, text: L.text && { ...L.text }, shape: L.shape && { ...L.shape }, m: L.m && [...L.m] })); this.sel = s.sel; this.gen++;
    if (resized) { this.comp.width = this.tmp.width = this.tmp2.width = d.w; this.comp.height = this.tmp.height = this.tmp2.height = d.h; }
    return resized;
  },
  mark(label) {
    if (!this.doc) return; this.undo.push(this.snap(label)); this.redo = []; this.gen++;
    /* keep the history within about 60 steps and 400 megapixels of canvases no longer in use (each canvas counted once) */
    const live = new Set(this.doc.layers.map(L => L.cv)), seen = new Set(); let px = 0;
    for (let k = this.undo.length - 1; k >= 0; k--) {
      for (const L of this.undo[k].layers) if (!live.has(L.cv) && !seen.has(L.cv)) { seen.add(L.cv); px += L.cv.width * L.cv.height; }
      if (px > 400e6 || this.undo.length - k > 60) { this.undo.splice(0, k + 1); break; }
    }
  },
  step(from, to) {
    if (!this.doc || !from.length) return;
    this.endText(); this.tf = null; this.cropR = null; this.preview = null;
    const s = from.pop(); to.push(this.snap(s.label)); const resized = this.restore(s);
    this.doc.dirty = true; if (resized) this.fit = true; this.after(true); if (resized) this.resize();
    UI.toast((from === this.undo ? 'Undid ' : 'Redid ') + s.label.toLowerCase());
  },
  after(full) { this.doc.dirty = true; for (const L of this.doc.layers) if (L.kind !== 'pixel' && (L.gen !== this.gen || L.cv.width !== this.doc.w || L.cv.height !== this.doc.h || L.stale)) { this.render(L); L.stale = false; } this.present(); this.drawBar(); if (full) { this.drawSide(); this.drawOpts(); } else this.thumbsSoon(); },

  /* ---- drawing the picture */
  composite() {
    const d = this.doc, g = this.cg; g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; g.clearRect(0, 0, d.w, d.h);
    for (const L of d.layers) {
      if (!L.vis || L === this.editing) continue;
      let src = L.cv, x = L.x, y = L.y;
      if (this.preview && this.preview.L === L) src = this.preview.cv;
      if (this.paintOp && this.paintOp.L === L) { src = this.painted(L); x = 0; y = 0; }
      g.globalAlpha = L.op; g.globalCompositeOperation = L.blend;
      if (this.tf && this.tf.L === L) { g.setTransform(this.tfMatrix()); g.drawImage(src, x, y); g.setTransform(1, 0, 0, 1, 0, 0); } else g.drawImage(src, x, y);
    }
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
  },
  /* the layer as it looks with the stroke being painted on it */
  painted(L) {
    const op = this.paintOp, t = this.tg; t.globalCompositeOperation = 'source-over'; t.globalAlpha = 1; t.clearRect(0, 0, this.doc.w, this.doc.h); t.drawImage(L.cv, L.x, L.y);
    t.globalAlpha = op.alpha; t.globalCompositeOperation = op.erase ? 'destination-out' : 'source-over'; t.drawImage(this.masked(op.cv), 0, 0); t.globalAlpha = 1; t.globalCompositeOperation = 'source-over';
    return this.tmp;
  },
  /* a document-sized canvas cut down to the selection */
  masked(cv) { if (!this.sel) return cv; const t = this.tg2; t.globalCompositeOperation = 'source-over'; t.clearRect(0, 0, this.doc.w, this.doc.h); t.drawImage(cv, 0, 0); t.globalCompositeOperation = 'destination-in'; t.drawImage(this.sel.mask, 0, 0); t.globalCompositeOperation = 'source-over'; return this.tmp2; },
  resize() {
    const r = this.port.getBoundingClientRect(), dpr = devicePixelRatio || 1; if (!r.width) return;
    for (const c of [this.cv, this.ov]) { c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr); c.style.width = r.width + 'px'; c.style.height = r.height + 'px'; }
    this.pw = r.width; this.ph = r.height; if (this.fit) this.fitView(); this.present();
  },
  fitView() { const d = this.doc; if (!d || !this.pw) return; const s = Math.min((this.pw - 48) / d.w, (this.ph - 48) / d.h, 4); this.view = { s, ox: (this.pw - d.w * s) / 2, oy: (this.ph - d.h * s) / 2 }; },
  setZoom(z) { if (!this.doc) return; if (z === 'fit') { this.fit = true; this.fitView(); } else this.zoomAt(z / this.view.s, this.pw / 2, this.ph / 2); this.present(); this.drawBar(); },
  zoomBy(f) { if (this.doc) this.zoomAt(f, this.pw / 2, this.ph / 2); },
  zoomAt(f, cx, cy) { const v = this.view, s = clamp(v.s * f, .02, 32); f = s / v.s; v.ox = cx - (cx - v.ox) * f; v.oy = cy - (cy - v.oy) * f; v.s = s; this.fit = false; this.present(); this.drawBar(); },
  wheel(e) {
    if (!this.doc) return; e.preventDefault(); const r = this.port.getBoundingClientRect();
    if (Modes.trackpad && !e.ctrlKey) { this.view.ox -= e.deltaX; this.view.oy -= e.deltaY; this.fit = false; return this.present(); }
    this.zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? .01 : .0018)), e.clientX - r.left, e.clientY - r.top);
  },
  present() {
    if (!this.doc || !this.pw || App.module !== 'image') return;
    if (this.raf) return; this.raf = requestAnimationFrame(() => {
      this.raf = 0; if (!this.doc) return;
      const g = this.g, dpr = devicePixelRatio || 1, v = this.view, d = this.doc; this.composite();
      g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, this.pw, this.ph);
      g.fillStyle = this.checker || (this.checker = (() => { const c = this.canvas(16, 16), x = c.getContext('2d'); x.fillStyle = '#ffffff'; x.fillRect(0, 0, 16, 16); x.fillStyle = '#d6d6d6'; x.fillRect(0, 0, 8, 8); x.fillRect(8, 8, 8, 8); return g.createPattern(c, 'repeat'); })());
      g.shadowColor = 'rgba(0,0,0,.35)'; g.shadowBlur = 14; g.fillRect(v.ox, v.oy, d.w * v.s, d.h * v.s); g.shadowBlur = 0;
      g.imageSmoothingEnabled = v.s < 2; g.imageSmoothingQuality = 'high'; g.drawImage(this.comp, v.ox, v.oy, d.w * v.s, d.h * v.s);
      this.drawOv();
    });
  },
  /* the overlay: selection outline, transform box, crop frame, brush outline */
  drawOv() {
    const g = this.og, dpr = devicePixelRatio || 1, v = this.view, d = this.doc; if (!this.pw) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, this.pw, this.ph); if (!d) return;
    const X = x => v.ox + x * v.s, Y = y => v.oy + y * v.s;
    if (this.sel && this.sel.segs) {
      const sg = this.sel.segs; g.beginPath(); for (let k = 0; k < sg.length; k += 4) { g.moveTo(X(sg[k]), Y(sg[k + 1])); g.lineTo(X(sg[k + 2]), Y(sg[k + 3])); }
      g.lineWidth = 1; g.setLineDash([]); g.strokeStyle = '#ffffff'; g.stroke(); g.setLineDash([4, 4]); g.lineDashOffset = -(this.ants || 0) % 8; g.strokeStyle = '#000000'; g.stroke(); g.setLineDash([]);
    }
    const drag = this.dragShape; if (drag) { g.setLineDash([4, 4]); g.strokeStyle = '#000'; g.lineWidth = 1; g.beginPath(); if (drag.t === 'lasso') drag.pts.forEach((p, k) => (k ? g.lineTo(X(p[0]), Y(p[1])) : g.moveTo(X(p[0]), Y(p[1])))); else if (drag.t === 'ellipse') g.ellipse(X(drag.x + drag.w / 2), Y(drag.y + drag.h / 2), Math.abs(drag.w * v.s / 2), Math.abs(drag.h * v.s / 2), 0, 0, 7); else if (drag.t === 'line') { g.moveTo(X(drag.x), Y(drag.y)); g.lineTo(X(drag.x + drag.w), Y(drag.y + drag.h)); } else g.rect(X(drag.x), Y(drag.y), drag.w * v.s, drag.h * v.s); g.stroke(); g.strokeStyle = '#fff'; g.lineDashOffset = 4; g.stroke(); g.setLineDash([]); g.lineDashOffset = 0; }
    if (this.cropR) {
      const c = this.cropR, x = X(Math.min(c.x, c.x + c.w)), y = Y(Math.min(c.y, c.y + c.h)), w = Math.abs(c.w) * v.s, hh = Math.abs(c.h) * v.s;
      g.fillStyle = 'rgba(0,0,0,.55)'; g.beginPath(); g.rect(0, 0, this.pw, this.ph); g.rect(x, y, w, hh); g.fill('evenodd');
      g.strokeStyle = '#fff'; g.lineWidth = 1; g.strokeRect(x + .5, y + .5, w, hh); g.globalAlpha = .45; for (const f of [1 / 3, 2 / 3]) { g.beginPath(); g.moveTo(x + w * f, y); g.lineTo(x + w * f, y + hh); g.moveTo(x, y + hh * f); g.lineTo(x + w, y + hh * f); g.stroke(); } g.globalAlpha = 1;
      this.handles(g, [[x, y], [x + w, y], [x + w, y + hh], [x, y + hh]]);
    }
    if (this.tf) { const pts = this.tfCorners().map(([x, y]) => [X(x), Y(y)]); g.strokeStyle = '#2f6bff'; g.lineWidth = 1.5; g.beginPath(); pts.forEach((p, k) => (k ? g.lineTo(...p) : g.moveTo(...p))); g.closePath(); g.stroke(); this.handles(g, pts); }
    else if (this.tool === 'move' && this.L && !this.paintOp && this.L.vis) { const c = this.cornersCache(this.L); if (c) { g.strokeStyle = 'rgba(47,107,255,.55)'; g.lineWidth = 1; g.setLineDash([3, 3]); g.beginPath(); c.forEach(([x, y], k) => (k ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y)))); g.closePath(); g.stroke(); g.setLineDash([]); } }
    if (this.ptr && ['brush', 'eraser'].includes(this.tool) && !this.space) { const r = Math.max(.5, this.style.size / 2 * v.s); g.lineWidth = 1; g.strokeStyle = 'rgba(0,0,0,.7)'; g.beginPath(); g.arc(this.ptr[0], this.ptr[1], r, 0, 7); g.stroke(); g.strokeStyle = 'rgba(255,255,255,.85)'; g.beginPath(); g.arc(this.ptr[0], this.ptr[1], r + 1, 0, 7); g.stroke(); }
  },
  handles(g, pts) { g.fillStyle = '#fff'; g.strokeStyle = '#2f6bff'; g.lineWidth = 1.5; for (const [x, y] of pts) { g.beginPath(); g.rect(x - 4.5, y - 4.5, 9, 9); g.fill(); g.stroke(); } },
  cornersCache(L) { const key = L.id + ':' + L.gen + ':' + L.x + ':' + L.y + ':' + (L.m || '') + ':' + JSON.stringify(L.text || L.shape || ''); if (this._cc && this._cc.key === key) return this._cc.v; const v = this.corners(L); this._cc = { key, v }; return v; },

  /* ---- the selection: a document-sized mask, outlined by marching squares */
  setSel(mask) {
    if (!mask) { this.sel = null; return this.drawOv(); }
    this.sel = { mask, segs: this.edges(mask) }; if (!this.sel.segs.length) this.sel = null; this.drawOv();
  },
  edges(mask) {
    const d = this.doc, k = Math.max(1, Math.ceil(Math.max(d.w, d.h) / 1400)), w = Math.ceil(d.w / k), hh = Math.ceil(d.h / k), s = this.canvas(w, hh), g = s.getContext('2d', { willReadFrequently: true });
    g.drawImage(mask, 0, 0, w, hh); const a = g.getImageData(0, 0, w, hh).data, on = (x, y) => (x >= 0 && y >= 0 && x < w && y < hh && a[(y * w + x) * 4 + 3] > 127 ? 1 : 0), out = [];
    for (let y = -1; y < hh; y++) for (let x = -1; x < w; x++) {
      const c = on(x, y) * 8 + on(x + 1, y) * 4 + on(x + 1, y + 1) * 2 + on(x, y + 1); if (!c || c === 15) continue;
      const T = [x + 1, y + .5], R = [x + 1.5, y + 1], B = [x + 1, y + 1.5], Lf = [x + .5, y + 1], seg = (p, q) => out.push(p[0] * k, p[1] * k, q[0] * k, q[1] * k);
      switch (c) { case 1: case 14: seg(Lf, B); break; case 2: case 13: seg(B, R); break; case 3: case 12: seg(Lf, R); break; case 4: case 11: seg(T, R); break; case 6: case 9: seg(T, B); break; case 7: case 8: seg(Lf, T); break; case 5: seg(Lf, T); seg(B, R); break; case 10: seg(T, R); seg(Lf, B); break; }
      if (out.length > 600000) return out;
    }
    return out;
  },
  /* combine a new shape with the selection: replace, add, take away, or keep only the overlap */
  applySel(draw, mode, label) {
    const d = this.doc, m = this.canvas(d.w, d.h), g = m.getContext('2d'); g.fillStyle = '#fff';
    if (this.sel && mode !== 'new') g.drawImage(this.sel.mask, 0, 0);
    g.globalCompositeOperation = mode === 'sub' ? 'destination-out' : mode === 'and' ? 'destination-in' : 'source-over';
    if (mode === 'and') { const t = this.canvas(d.w, d.h), tg = t.getContext('2d'); tg.fillStyle = '#fff'; draw(tg); g.drawImage(t, 0, 0); } else draw(g);
    this.mark(label || 'Select'); this.setSel(m); this.drawBar();
  },
  selMode(e) { return e.shiftKey && e.altKey ? 'and' : e.shiftKey ? 'add' : e.altKey ? 'sub' : this.style.selMode; },
  selectAll() { if (!this.doc) return; this.applySel(g => g.fillRect(0, 0, this.doc.w, this.doc.h), 'new', 'Select all'); },
  deselect() { if (!this.sel) return; this.mark('Deselect'); this.setSel(null); },
  invertSel() { const d = this.doc; if (!d) return; const old = this.sel; this.applySel(g => { g.fillRect(0, 0, d.w, d.h); if (old) { g.globalCompositeOperation = 'destination-out'; g.drawImage(old.mask, 0, 0); } }, 'new', 'Invert selection'); },
  async feather() {
    if (!this.sel) return UI.toast('Select something first.');
    const r = await UI.prompt('Feather Selection', 'Soften the edge by (pixels)', '8'); if (!r || !(+r > 0)) return;
    const old = this.sel.mask; this.applySel(g => { g.filter = `blur(${+r / 2}px)`; g.drawImage(old, 0, 0); g.filter = 'none'; }, 'new', 'Feather');
  },
  layerToSel() { const L = this.L; if (!L) return; this.applySel(g => g.drawImage(L.cv, L.x, L.y), 'new', 'Select layer'); },
  /* the rectangle a selection covers */
  selBox() { const b = this.sel && this.alphaBox(this.sel.mask); return b ? { x: Math.floor(b.x), y: Math.floor(b.y), w: Math.ceil(b.w), h: Math.ceil(b.h) } : null; },

  /* ---- pointer work */
  pt(e) { const r = this.ov.getBoundingClientRect(), v = this.view; return [(e.clientX - r.left - v.ox) / v.s, (e.clientY - r.top - v.oy) / v.s]; },
  hover(e) { const r = this.ov.getBoundingClientRect(); this.ptr = [e.clientX - r.left, e.clientY - r.top]; if (['brush', 'eraser'].includes(this.tool) || this.tf || this.cropR) { this.drawOv(); this.cursor(e); } },
  cursor(e) {
    const t = this.space ? 'hand' : this.tool, map = { move: 'move', hand: 'grab', picker: 'crosshair', text: 'text', brush: 'none', eraser: 'none' };
    let c = map[t] || 'crosshair';
    if (this.tf && e) { const hit = this.tfHit(this.pt(e)); c = hit === 'in' ? 'move' : hit === 'rot' ? 'alias' : hit ? 'nwse-resize' : c; }
    this.ov.style.cursor = this.doc ? c : 'default';
  },
  /* the topmost visible layer with something drawn at the point */
  layerAt([x, y]) {
    for (const L of [...this.doc.layers].reverse()) {
      if (!L.vis) continue;
      if (L.kind !== 'pixel') { const inv = new DOMMatrix(L.m).inverse(), p = inv.transformPoint({ x, y }), b = this.localBox(L); if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) return L; continue; }
      const lx = Math.floor(x - L.x), ly = Math.floor(y - L.y); if (lx < 0 || ly < 0 || lx >= L.cv.width || ly >= L.cv.height) continue;
      if (L.cv.getContext('2d').getImageData(lx, ly, 1, 1).data[3] > 10) return L;
    }
    return null;
  },
  drag(e, move, up) {
    const el = this.ov; try { el.setPointerCapture(e.pointerId); } catch (err) { /* still works while the pointer stays over the picture */ }
    const mv = ev => move(this.pt(ev), ev), end = ev => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', end); el.removeEventListener('pointercancel', end); up && up(this.pt(ev), ev); };
    el.addEventListener('pointermove', mv); el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
  },
  down(e) {
    if (!this.doc || (e.button !== 0 && e.button !== 1)) return;
    const was = this.editing; this.endText(); e.preventDefault(); const p = this.pt(e), t = (this.space || e.button === 1) ? 'hand' : this.tool, d = this.doc;
    if (was && t === 'text') return;      // a click away from the words finishes them; the next click starts new ones
    if (t === 'hand') { const o = [e.clientX, e.clientY], v0 = { ...this.view }; this.ov.style.cursor = 'grabbing'; return this.drag(e, (q, ev) => { this.view.ox = v0.ox + ev.clientX - o[0]; this.view.oy = v0.oy + ev.clientY - o[1]; this.fit = false; this.present(); }, () => this.cursor()); }
    if (this.tf) return this.tfDown(e, p);
    if (t === 'crop') return this.cropDown(e, p);
    if (t === 'picker') { this.composite(); const px = this.cg.getImageData(clamp(Math.floor(p[0]), 0, d.w - 1), clamp(Math.floor(p[1]), 0, d.h - 1), 1, 1).data; const hex = '#' + [px[0], px[1], px[2]].map(v => v.toString(16).padStart(2, '0')).join(''); this.style[e.altKey ? 'bg' : 'fg'] = hex; this.drawBox(); this.drawOpts(); return; }
    if (t === 'move') return this.moveDown(e, p);
    if (t === 'rect' || t === 'ellipse' || t === 'shape' || t === 'gradient') {
      const sh = this.dragShape = { t: t === 'shape' ? (['line', 'arrow'].includes(this.style.shape) ? 'line' : this.style.shape === 'ellipse' ? 'ellipse' : 'rect') : t === 'gradient' ? 'line' : t, x: p[0], y: p[1], w: 0, h: 0 }, mode = this.selMode(e);
      return this.drag(e, (q, ev) => { let w = q[0] - p[0], hh = q[1] - p[1]; if (ev.shiftKey && sh.t !== 'line' && t !== 'rect' && t !== 'ellipse') { const m = Math.max(Math.abs(w), Math.abs(hh)); w = Math.sign(w || 1) * m; hh = Math.sign(hh || 1) * m; } if (ev.shiftKey && sh.t === 'line') { const a = Math.round(Math.atan2(hh, w) / (Math.PI / 4)) * Math.PI / 4, l = Math.hypot(w, hh); w = Math.cos(a) * l; hh = Math.sin(a) * l; } sh.w = w; sh.h = hh; this.drawOv(); }, () => {
        this.dragShape = null; const tiny = Math.hypot(sh.w * this.view.s, sh.h * this.view.s) < 3;
        if (t === 'rect' || t === 'ellipse') { if (tiny) { if (mode === 'new' && this.sel) this.deselect(); return this.drawOv(); } const x = Math.min(sh.x, sh.x + sh.w), y = Math.min(sh.y, sh.y + sh.h), w = Math.abs(sh.w), hh = Math.abs(sh.h); return this.applySel(g => { g.beginPath(); if (t === 'rect') g.rect(Math.round(x), Math.round(y), Math.round(w), Math.round(hh)); else g.ellipse(x + w / 2, y + hh / 2, w / 2, hh / 2, 0, 0, Math.PI * 2); g.fill(); }, mode); }
        if (tiny) return this.drawOv();
        if (t === 'gradient') return this.gradient(sh);
        this.addShape(sh);
      });
    }
    if (t === 'lasso') { const sh = this.dragShape = { t: 'lasso', pts: [p] }, mode = this.selMode(e); return this.drag(e, q => { const l = sh.pts[sh.pts.length - 1]; if (Math.hypot(q[0] - l[0], q[1] - l[1]) * this.view.s > 2) { sh.pts.push(q); this.drawOv(); } }, () => { this.dragShape = null; if (sh.pts.length < 3) { if (mode === 'new' && this.sel) this.deselect(); return this.drawOv(); } this.applySel(g => { g.beginPath(); sh.pts.forEach((q, k) => (k ? g.lineTo(...q) : g.moveTo(...q))); g.closePath(); g.fill(); }, mode); }); }
    if (t === 'wand') return this.wand(p, this.selMode(e));
    if (t === 'fill') return this.bucket(p).catch(UI.error);
    if (t === 'text') { const L = this.layerAt(p); if (L && L.kind === 'text') return this.editText(L); return this.addText(p); }
    if (t === 'brush' || t === 'eraser') return this.paint(e, p, t === 'eraser').catch(UI.error);
  },
  hitLayerOrActive(e, p) { if (e.ctrlKey) { const L = this.layerAt(p); if (L) { this.doc.active = L.id; this.drawSide(); this.drawOpts(); } } return this.L; },
  moveDown(e, p) {
    const L = this.hitLayerOrActive(e, p); if (!L) return; let moved = false; const o = { x: L.x, y: L.y, m: L.m && [...L.m] };
    this.drag(e, q => {
      const dx = q[0] - p[0], dy = q[1] - p[1]; if (!moved && Math.hypot(dx, dy) * this.view.s < 3) return;
      if (!moved) { moved = true; this.mark('Move'); }
      if (L.kind === 'pixel') { L.x = Math.round(o.x + dx); L.y = Math.round(o.y + dy); } else { L.m = [o.m[0], o.m[1], o.m[2], o.m[3], o.m[4] + dx, o.m[5] + dy]; L.stale = true; this.render(L); }
      this.present();
    }, () => { if (moved) this.after(); });
  },
  nudge(dx, dy) {
    const L = this.L; if (!L || this.tf) return; if (this.tool !== 'move') return;
    const last = this.undo[this.undo.length - 1]; if (!(last && last.label === 'Nudge' && performance.now() - (this.lastNudge || 0) < 800)) this.mark('Nudge'); this.lastNudge = performance.now();
    if (L.kind === 'pixel') { L.x += dx; L.y += dy; } else { L.m[4] += dx; L.m[5] += dy; L.stale = true; }
    this.after();
  },

  /* ---- painting */
  tip(erase) {
    const s = this.style, key = [s.size, s.hard, erase ? '#000' : s.fg].join(); if (this.tipC && this.tipC.key === key) return this.tipC.cv;
    const r = Math.max(.5, s.size / 2), n = Math.ceil(r * 2) + 2, c = this.canvas(n, n), g = c.getContext('2d'), gr = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, r), col = erase ? '#000000' : s.fg;
    gr.addColorStop(0, col); gr.addColorStop(clamp(s.hard, 0, .99), col); gr.addColorStop(1, col + '00'); g.fillStyle = gr; g.beginPath(); g.arc(n / 2, n / 2, r, 0, 7); g.fill();
    this.tipC = { key, cv: c }; return c;
  },
  async paint(e, p, erase) {
    const L = await this.pixels(this.L, erase ? 'erase on' : 'paint on'); if (!L) return;
    const d = this.doc, cv = this.canvas(d.w, d.h), g = cv.getContext('2d'), tip = this.tip(erase), pen = e.pointerType === 'pen';
    this.paintOp = { L, cv, alpha: this.style.flow, erase }; let last = null, left = 0;
    const stamp = (q, pr) => {
      const sz = pen ? Math.max(.15, pr || .5) : 1, w = tip.width * sz;
      if (!last) { g.drawImage(tip, q[0] - w / 2, q[1] - w / 2, w, w); last = q; return; }
      const dist = Math.hypot(q[0] - last[0], q[1] - last[1]), step = Math.max(.6, this.style.size * sz * .12);
      let k = step - left; while (k <= dist) { const f = k / dist; g.drawImage(tip, last[0] + (q[0] - last[0]) * f - w / 2, last[1] + (q[1] - last[1]) * f - w / 2, w, w); k += step; }
      left = dist - (k - step); last = q;
    };
    if (e.shiftKey && this.lastPaint) { last = this.lastPaint; } stamp(p, e.pressure); this.present();
    this.drag(e, (q, ev) => { const evs = ev.getCoalescedEvents ? ev.getCoalescedEvents() : [ev]; for (const x of evs.length ? evs : [ev]) stamp(this.pt(x), x.pressure); this.present(); }, q => {
      this.lastPaint = q; this.mark(erase ? 'Eraser' : 'Brush'); this.grow(L); const lg = this.writable(L);
      lg.globalAlpha = this.style.flow; lg.globalCompositeOperation = erase ? 'destination-out' : 'source-over'; lg.drawImage(this.masked(cv), -L.x, -L.y); lg.globalAlpha = 1; lg.globalCompositeOperation = 'source-over';
      this.paintOp = null; this.after();
    });
  },
  /* pixels of the active layer, or of everything visible, as one document-sized array */
  sample(all) {
    const d = this.doc;
    if (all) { this.composite(); return this.cg.getImageData(0, 0, d.w, d.h); }
    const L = this.L, t = this.tg; t.clearRect(0, 0, d.w, d.h); if (L) t.drawImage(L.cv, L.x, L.y); return t.getImageData(0, 0, d.w, d.h);
  },
  /* the area of similar colour around a point, as a document-sized mask */
  flood(img, x0, y0, tol, contiguous) {
    const { width: w, height: hh, data: a } = img, out = new Uint8Array(w * hh), i0 = (y0 * w + x0) * 4, r = a[i0], g = a[i0 + 1], b = a[i0 + 2], al = a[i0 + 3];
    const near = i => { const j = i * 4; return Math.abs(a[j] - r) <= tol && Math.abs(a[j + 1] - g) <= tol && Math.abs(a[j + 2] - b) <= tol && Math.abs(a[j + 3] - al) <= tol; };
    if (!contiguous) { for (let i = 0; i < w * hh; i++) if (near(i)) out[i] = 1; return out; }
    const stack = [x0, y0];
    while (stack.length) {
      const y = stack.pop(); let x = stack.pop(), i = y * w + x;
      while (x > 0 && !out[i - 1] && near(i - 1)) { x--; i--; }
      let up = false, dn = false;
      for (; x < w && !out[i] && near(i); x++, i++) {
        out[i] = 1;
        if (y > 0) { const u = i - w; if (!out[u] && near(u)) { if (!up) { stack.push(x, y - 1); up = true; } } else up = false; }
        if (y < hh - 1) { const v = i + w; if (!out[v] && near(v)) { if (!dn) { stack.push(x, y + 1); dn = true; } } else dn = false; }
      }
    }
    return out;
  },
  maskCanvas(bits, w, hh) { const c = this.canvas(w, hh), g = c.getContext('2d'), im = g.createImageData(w, hh), a = im.data; for (let i = 0; i < bits.length; i++) if (bits[i]) { const j = i * 4; a[j] = a[j + 1] = a[j + 2] = a[j + 3] = 255; } g.putImageData(im, 0, 0); return c; },
  inside(p) { const d = this.doc; return p[0] >= 0 && p[1] >= 0 && p[0] < d.w && p[1] < d.h; },
  wand(p, mode) {
    const d = this.doc; if (!this.inside(p)) return;
    const m = this.maskCanvas(this.flood(this.sample(this.style.all), Math.floor(p[0]), Math.floor(p[1]), this.style.tol, this.style.contiguous), d.w, d.h);
    this.applySel(g => g.drawImage(m, 0, 0), mode, 'Magic wand');
  },
  async bucket(p) {
    const d = this.doc; if (!this.inside(p)) return; const L = await this.pixels(this.L, 'fill'); if (!L) return;
    const m = this.maskCanvas(this.flood(this.sample(this.style.all), Math.floor(p[0]), Math.floor(p[1]), this.style.tol, this.style.contiguous), d.w, d.h), g = m.getContext('2d');
    g.globalCompositeOperation = 'source-in'; g.fillStyle = this.style.fg; g.fillRect(0, 0, d.w, d.h);
    this.mark('Fill'); this.grow(L); const lg = this.writable(L); lg.drawImage(this.masked(m), -L.x, -L.y); this.after();
  },
  async fillSel(color) {
    const d = this.doc; if (!d) return; const L = await this.pixels(this.L, 'fill'); if (!L) return;
    const c = this.canvas(d.w, d.h), g = c.getContext('2d'); g.fillStyle = color || this.style.fg; g.fillRect(0, 0, d.w, d.h);
    this.mark('Fill'); this.grow(L); this.writable(L).drawImage(this.masked(c), -L.x, -L.y); this.after();
  },
  async gradient(sh) {
    const d = this.doc, L = await this.pixels(this.L, 'fill'); if (!L) return;
    const c = this.canvas(d.w, d.h), g = c.getContext('2d'), gr = g.createLinearGradient(sh.x, sh.y, sh.x + sh.w, sh.y + sh.h);
    gr.addColorStop(0, this.style.fg); gr.addColorStop(1, this.style.grad === 'clear' ? this.style.fg + '00' : this.style.bg); g.fillStyle = gr; g.fillRect(0, 0, d.w, d.h);
    this.mark('Gradient'); this.grow(L); this.writable(L).drawImage(this.masked(c), -L.x, -L.y); this.after();
  },
  async del() {
    if (!this.doc) return; if (this.tf || this.cropR) return;
    const L = this.L; if (!L) return;
    if (!this.sel) { if (this.doc.layers.length < 2) return UI.toast('Select part of the picture first, or add another layer before deleting this one.'); this.delLayer(); return UI.toast('Layer deleted. Ctrl+Z brings it back.'); }
    if (!await this.pixels(L, 'delete part of')) return;
    this.mark('Delete'); const g = this.writable(L); g.globalCompositeOperation = 'destination-out'; g.drawImage(this.sel.mask, -L.x, -L.y); g.globalCompositeOperation = 'source-over'; this.after();
  },

  /* ---- copy and paste */
  copy(cut, merged) {
    const d = this.doc, L = this.L; if (!d || (!L && !merged)) return;
    const b = this.sel ? this.selBox() : { x: 0, y: 0, w: d.w, h: d.h }; if (!b) return UI.toast('The selection is empty.');
    const c = this.canvas(b.w, b.h), g = c.getContext('2d');
    if (merged) { this.composite(); g.drawImage(this.comp, -b.x, -b.y); } else { g.drawImage(L.cv, L.x - b.x, L.y - b.y); if (L.kind !== 'pixel') { g.clearRect(0, 0, b.w, b.h); g.drawImage(L.cv, -b.x, -b.y); } }
    if (this.sel) { g.globalCompositeOperation = 'destination-in'; g.drawImage(this.sel.mask, -b.x, -b.y); }
    this.clip = { cv: c, x: b.x, y: b.y };
    c.toBlob(bl => { try { navigator.clipboard.write([new ClipboardItem({ 'image/png': bl })]).catch(() => {}); } catch (e) { /* the system clipboard is a bonus */ } }, 'image/png');
    if (cut) { if (L.kind !== 'pixel') return UI.toast('Copied. Text and shape layers cannot be cut; delete the layer instead.'); this.mark('Cut'); const lg = this.writable(L); lg.globalCompositeOperation = 'destination-out'; if (this.sel) lg.drawImage(this.sel.mask, -L.x, -L.y); else lg.fillRect(0, 0, L.cv.width, L.cv.height); lg.globalCompositeOperation = 'source-over'; this.after(); }
    UI.toast(cut ? 'Cut' : 'Copied');
  },
  async paste() {
    if (this.clip && !this.clip.stale) return this.addPixels(this.copyCv(this.clip.cv), 'Pasted', this.clip.x, this.clip.y);
    try { for (const it of await navigator.clipboard.read()) { const ty = it.types.find(x => x.startsWith('image/')); if (ty) return this.pasteFile(await it.getType(ty)); } } catch (e) { /* no access: fall through */ }
    if (this.clip) return this.addPixels(this.copyCv(this.clip.cv), 'Pasted', this.clip.x, this.clip.y);
    UI.toast('There is no picture to paste. Copy one first.');
  },
  layerViaCopy(cut) {
    const L = this.L; if (!L) return; if (!this.sel) return this.dupLayer();
    const d = this.doc, c = this.canvas(d.w, d.h), g = c.getContext('2d'); g.drawImage(L.cv, L.x, L.y); g.globalCompositeOperation = 'destination-in'; g.drawImage(this.sel.mask, 0, 0);
    this.mark(cut ? 'Layer via cut' : 'Layer via copy');
    if (cut && L.kind === 'pixel') { const lg = this.writable(L); lg.globalCompositeOperation = 'destination-out'; lg.drawImage(this.sel.mask, -L.x, -L.y); lg.globalCompositeOperation = 'source-over'; }
    this.insert({ ...this.pixelLayer(L.name + ' part', c), blend: L.blend, op: L.op }); this.setSel(null); this.after(true);
  },

  /* ---- text and shapes */
  addText(p) {
    const s = this.style, L = { id: this.lid(), kind: 'text', name: 'Text', vis: true, op: 1, blend: 'source-over', x: 0, y: 0, gen: -1, m: [1, 0, 0, 1, p[0], p[1] - s.fsize * .6], text: { s: '', font: s.font, size: s.fsize, bold: s.bold, italic: s.italic, color: s.fg, align: s.align } };
    L.cv = this.canvas(this.doc.w, this.doc.h); this.mark('Text'); this.insert(L); this.drawSide(); this.editText(L, true);
  },
  editText(L, fresh) {
    this.endText(); this.doc.active = L.id; this.editing = L; this.present();
    const t = L.text, v = this.view, before = t.s, m = new DOMMatrix([v.s, 0, 0, v.s, v.ox, v.oy]).multiply(new DOMMatrix(L.m));
    const ta = h('textarea', { class: 'ie-text', value: t.s, spellcheck: false, data: { notr: 1 }, style: { font: this.font(t), lineHeight: 1.2, color: t.color, textAlign: t.align, transform: m.toString(), transformOrigin: '0 0' } });
    const fit = () => { t.s = ta.value; ta.style.width = this.textW(t) + t.size * 1.2 + 'px'; ta.style.height = t.s.split('\n').length * t.size * 1.2 + 2 + 'px'; };
    this.endText = cancel => {
      this.endText = () => {}; ta.remove(); this.editing = null;
      t.s = cancel ? before : ta.value.replace(/\s+$/, '');
      if (!t.s) { const i = this.doc.layers.indexOf(L); if (i >= 0) this.doc.layers.splice(i, 1); if (fresh) this.undo.pop(); else { t.s = before; this.mark('Delete text'); this.doc.layers = this.doc.layers.filter(x => x !== L); } this.doc.active = (this.doc.layers[this.doc.layers.length - 1] || {}).id || null; }
      else if (t.s !== before && !fresh) { const now = t.s; t.s = before; this.mark('Edit text'); t.s = now; }
      if (t.s && fresh) L.name = t.s.split('\n')[0].slice(0, 28);
      L.stale = true; this.after(true);
    };
    ta.addEventListener('input', () => { fit(); this.drawBar(); });
    ta.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') { e.preventDefault(); this.endText(true); } else if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); this.endText(); } });
    const born = performance.now(); ta.addEventListener('blur', () => { if (performance.now() - born < 250) setTimeout(() => ta.focus(), 0); else this.endText(); });
    this.port.append(ta); fit(); setTimeout(() => { ta.focus(); ta.select(); }, 0); this.drawOpts();
  },
  endText() {},
  addShape(sh) {
    const s = this.style, t = s.shape, line = t === 'line' || t === 'arrow', x = line ? sh.x : Math.min(sh.x, sh.x + sh.w), y = line ? sh.y : Math.min(sh.y, sh.y + sh.h);
    const L = { id: this.lid(), kind: 'shape', name: { rect: 'Rectangle', ellipse: 'Oval', line: 'Line', arrow: 'Arrow' }[t], vis: true, op: 1, blend: 'source-over', x: 0, y: 0, gen: -1, m: [1, 0, 0, 1, 0, 0],
      shape: { t, x, y, w: line ? sh.w : Math.abs(sh.w), h: line ? sh.h : Math.abs(sh.h), fill: line ? '' : (s.fill ? s.fg : ''), stroke: line ? s.fg : (s.stroke ? (s.fill ? s.bg : s.fg) : ''), lw: s.lw, r: t === 'rect' ? s.radius : 0 } };
    if (!line && !L.shape.fill && !L.shape.stroke) L.shape.fill = s.fg;
    L.cv = this.canvas(this.doc.w, this.doc.h); this.mark('Shape'); this.insert(L); this.after(true);
  },
  /* change a property of the selected text or shape layer, or of the tool for next time */
  setStyle(k, v) {
    this.style[k] = v; const L = this.L, map = { fg: 'color', font: 'font', fsize: 'size', bold: 'bold', italic: 'italic', align: 'align' };
    if (L && L.kind === 'text' && map[k] && (this.tool === 'text' || this.tool === 'move')) { if (L.text[map[k]] !== v) { if (!this.editing) this.mark('Text style'); L.text[map[k]] = v; L.stale = true; if (this.editing === L) { const ta = $('.ie-text', this.port); if (ta) { ta.style.font = this.font(L.text); ta.style.color = L.text.color; ta.style.textAlign = L.text.align; ta.dispatchEvent(new Event('input')); } } this.after(); } }
    if (L && L.kind === 'shape' && (this.tool === 'shape' || this.tool === 'move') && ['fg', 'bg', 'lw', 'radius', 'fill', 'stroke'].includes(k)) {
      const sh = L.shape, line = sh.t === 'line' || sh.t === 'arrow', s = this.style; this.mark('Shape style');
      if (k === 'lw') sh.lw = v; else if (k === 'radius') sh.r = v; else if (line) sh.stroke = s.fg; else { sh.fill = s.fill ? s.fg : ''; sh.stroke = s.stroke ? (s.fill ? s.bg : s.fg) : ''; if (!sh.fill && !sh.stroke) sh.fill = s.fg; }
      L.stale = true; this.after();
    }
    if (k === 'size' || k === 'hard') this.tipC = null;
    this.drawOpts(); this.drawBox(); this.drawOv();
  },

  /* ---- free transform */
  startTransform() {
    const L = this.L; if (!this.doc || !L) return; if (this.tf) return this.commit();
    this.endText(); const b = L.kind === 'pixel' ? this.localBox(L) : null, c = this.corners(L); if (!c) return UI.toast('This layer is empty.');
    const xs = c.map(p => p[0]), ys = c.map(p => p[1]);
    this.tf = { L, c, cx: (Math.min(...xs) + Math.max(...xs)) / 2, cy: (Math.min(...ys) + Math.max(...ys)) / 2, tx: 0, ty: 0, sx: 1, sy: 1, ang: 0, b };
    this.setTool('move', true); this.present(); this.drawOpts(); UI.toast('Drag a corner to resize, outside the box to turn, inside to move. Enter applies, Esc gives up.');
  },
  tfMatrix() { const f = this.tf; return new DOMMatrix().translate(f.cx + f.tx, f.cy + f.ty).rotate(f.ang).scale(f.sx, f.sy).translate(-f.cx, -f.cy); },
  tfCorners() { const m = this.tfMatrix(); return this.tf.c.map(([x, y]) => { const p = m.transformPoint({ x, y }); return [p.x, p.y]; }); },
  tfHit(p) {
    const pts = this.tfCorners(), s = this.view.s, near = pts.findIndex(q => Math.hypot(q[0] - p[0], q[1] - p[1]) * s < 9); if (near >= 0) return 'c' + near;
    let inside = false; for (let i = 0, j = 3; i < 4; j = i++) { const [xi, yi] = pts[i], [xj, yj] = pts[j]; if ((yi > p[1]) !== (yj > p[1]) && p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi) inside = !inside; }
    return inside ? 'in' : 'rot';
  },
  tfDown(e, p) {
    const f = this.tf, hit = this.tfHit(p), o = { ...f }, cx = f.cx + f.tx, cy = f.cy + f.ty;
    if (hit === 'in') return this.drag(e, q => { f.tx = o.tx + q[0] - p[0]; f.ty = o.ty + q[1] - p[1]; this.present(); });
    if (hit === 'rot') { const a0 = Math.atan2(p[1] - cy, p[0] - cx); return this.drag(e, (q, ev) => { let a = o.ang + (Math.atan2(q[1] - cy, q[0] - cx) - a0) * 180 / Math.PI; if (ev.shiftKey) a = Math.round(a / 15) * 15; f.ang = a; this.present(); }); }
    const inv = new DOMMatrix().rotate(-o.ang), loc = q => { const r = inv.transformPoint({ x: q[0] - cx, y: q[1] - cy }); return [r.x, r.y]; }, l0 = loc(p);
    this.drag(e, (q, ev) => { const l = loc(q); let sx = o.sx * (l0[0] ? l[0] / l0[0] : 1), sy = o.sy * (l0[1] ? l[1] / l0[1] : 1); if (!ev.shiftKey) { const k = Math.max(Math.abs(sx / o.sx), Math.abs(sy / o.sy)); sx = o.sx * k * Math.sign(sx || 1); sy = o.sy * k * Math.sign(sy || 1); } f.sx = sx; f.sy = sy; this.present(); });
  },
  applyTransform() {
    const f = this.tf, L = f.L, m = this.tfMatrix(); this.tf = null;
    if (f.tx === 0 && f.ty === 0 && f.sx === 1 && f.sy === 1 && f.ang === 0) return this.after(true);
    this.mark('Transform');
    if (L.kind !== 'pixel') { L.m = [...m.multiply(new DOMMatrix(L.m)).toFloat64Array()].filter((v, k) => [0, 1, 4, 5, 12, 13].includes(k)); L.stale = true; return this.after(true); }
    const pts = this.tfCorners(), x0 = Math.floor(Math.min(...pts.map(q => q[0]))), y0 = Math.floor(Math.min(...pts.map(q => q[1]))), x1 = Math.ceil(Math.max(...pts.map(q => q[0]))), y1 = Math.ceil(Math.max(...pts.map(q => q[1])));
    const c = this.canvas(x1 - x0, y1 - y0), g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.setTransform(new DOMMatrix().translate(-x0, -y0).multiply(m)); g.drawImage(L.cv, L.x, L.y);
    L.cv = c; L.gen = this.gen; L.x = x0; L.y = y0; this.after(true);
  },
  /* turn every layer the same way: rotate, flip, resample */
  docTransform(m, w, hh, label) {
    const d = this.doc; this.mark(label); d.w = Math.round(w); d.h = Math.round(hh);
    this.comp.width = this.tmp.width = this.tmp2.width = d.w; this.comp.height = this.tmp.height = this.tmp2.height = d.h;
    for (const L of d.layers) {
      if (L.kind !== 'pixel') { L.m = [...m.multiply(new DOMMatrix(L.m)).toFloat64Array()].filter((v, k) => [0, 1, 4, 5, 12, 13].includes(k)); L.stale = true; continue; }
      const pts = [[L.x, L.y], [L.x + L.cv.width, L.y], [L.x + L.cv.width, L.y + L.cv.height], [L.x, L.y + L.cv.height]].map(([x, y]) => { const p = m.transformPoint({ x, y }); return [p.x, p.y]; });
      const x0 = Math.round(Math.min(...pts.map(q => q[0]))), y0 = Math.round(Math.min(...pts.map(q => q[1]))), x1 = Math.round(Math.max(...pts.map(q => q[0]))), y1 = Math.round(Math.max(...pts.map(q => q[1])));
      const c = this.canvas(x1 - x0, y1 - y0), g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.setTransform(new DOMMatrix().translate(-x0, -y0).multiply(m)); g.drawImage(L.cv, L.x, L.y);
      L.cv = c; L.gen = this.gen; L.x = x0; L.y = y0;
    }
    if (this.sel) { const c = this.canvas(d.w, d.h), g = c.getContext('2d'); g.setTransform(m); g.drawImage(this.sel.mask, 0, 0); this.sel = null; this.setSel(c); }
    this.fit = true; this.after(true); this.resize();
  },
  rotateDoc(deg) { const d = this.doc; if (!d) return; const m = deg === 90 ? new DOMMatrix([0, 1, -1, 0, d.h, 0]) : deg === -90 ? new DOMMatrix([0, -1, 1, 0, 0, d.w]) : new DOMMatrix([-1, 0, 0, -1, d.w, d.h]); this.docTransform(m, deg === 180 ? d.w : d.h, deg === 180 ? d.h : d.w, deg === 180 ? 'Rotate 180°' : 'Rotate 90°'); },
  flipDoc(hz) { const d = this.doc; if (!d) return; this.docTransform(hz ? new DOMMatrix([-1, 0, 0, 1, d.w, 0]) : new DOMMatrix([1, 0, 0, -1, 0, d.h]), d.w, d.h, hz ? 'Flip horizontal' : 'Flip vertical'); },
  async flipLayer(hz) {
    const L = this.L; if (!L) return; const c = this.corners(L); if (!c) return;
    const cx = (Math.min(...c.map(p => p[0])) + Math.max(...c.map(p => p[0]))) / 2, cy = (Math.min(...c.map(p => p[1])) + Math.max(...c.map(p => p[1]))) / 2;
    this.tf = { L, c, cx, cy, tx: 0, ty: 0, sx: hz ? -1 : 1, sy: hz ? 1 : -1, ang: 0 }; this.applyTransform();
  },
  async imageSize() {
    const d = this.doc; if (!d) return; const w = h('input', { type: 'number', min: 1, value: d.w, class: 'mu-num' }), hh = h('input', { type: 'number', min: 1, value: d.h, class: 'mu-num' }), keep = h('input', { type: 'checkbox', checked: true });
    w.oninput = () => { if (keep.checked) hh.value = Math.max(1, Math.round(+w.value * d.h / d.w)); }; hh.oninput = () => { if (keep.checked) w.value = Math.max(1, Math.round(+hh.value * d.w / d.h)); };
    const pct = h('select', { onchange: () => { const k = +pct.value / 100; if (k) { w.value = Math.round(d.w * k); hh.value = Math.round(d.h * k); } } }, h('option', { value: 0 }, 'Scale…'), [25, 50, 75, 150, 200].map(v => h('option', { value: v }, v + '%')));
    if (!await UI.dialog({ title: 'Image Size', width: 420, body: h('div', { class: 'pd-form' }, h('label', { class: 'frow' }, h('span', {}, 'Width'), h('span', {}, w, ' pixels')), h('label', { class: 'frow' }, h('span', {}, 'Height'), h('span', {}, hh, ' pixels')), h('label', { class: 'frow' }, h('span', {}, 'Keep proportions'), keep), h('label', { class: 'frow' }, h('span', {}, 'Quick'), pct), h('p', { class: 'dim' }, 'Resizes the whole picture, every layer with it.')), buttons: [['Cancel', null], ['Resize', true, 'primary']] })) return;
    const W = clamp(Math.round(+w.value), 1, 20000), H = clamp(Math.round(+hh.value), 1, 20000); if (W === d.w && H === d.h) return;
    this.docTransform(new DOMMatrix().scale(W / d.w, H / d.h), W, H, 'Image size');
  },
  /* move every layer by (dx, dy) and give the document a new size; nothing is cut off the layers */
  reframe(dx, dy, w, hh, label) {
    const d = this.doc; this.mark(label); d.w = Math.round(w); d.h = Math.round(hh);
    this.comp.width = this.tmp.width = this.tmp2.width = d.w; this.comp.height = this.tmp.height = this.tmp2.height = d.h;
    for (const L of d.layers) { if (L.kind === 'pixel') { L.x += dx; L.y += dy; } else { L.m[4] += dx; L.m[5] += dy; L.stale = true; } }
    if (this.sel) { const c = this.canvas(d.w, d.h); c.getContext('2d').drawImage(this.sel.mask, dx, dy); this.sel = null; this.setSel(c); }
    this.fit = true; this.after(true); this.resize();
  },
  async canvasSize() {
    const d = this.doc; if (!d) return; const w = h('input', { type: 'number', min: 1, value: d.w, class: 'mu-num' }), hh = h('input', { type: 'number', min: 1, value: d.h, class: 'mu-num' }); let anchor = [.5, .5];
    const grid = h('div', { class: 'ie-anchor' }), drawGrid = () => grid.replaceChildren([0, .5, 1].flatMap(y => [0, .5, 1].map(x => h('a', { class: anchor[0] === x && anchor[1] === y ? 'on' : '', onclick: () => { anchor = [x, y]; drawGrid(); } }))));
    drawGrid();
    if (!await UI.dialog({ title: 'Canvas Size', width: 420, body: h('div', { class: 'pd-form' }, h('label', { class: 'frow' }, h('span', {}, 'Width'), h('span', {}, w, ' pixels')), h('label', { class: 'frow' }, h('span', {}, 'Height'), h('span', {}, hh, ' pixels')), h('div', { class: 'frow' }, h('span', {}, 'Keep the picture at'), grid), h('p', { class: 'dim' }, 'Adds empty space around the picture, or trims it. Layers keep everything outside the edge, so you can move it back in.')), buttons: [['Cancel', null], ['OK', true, 'primary']] })) return;
    const W = clamp(Math.round(+w.value), 1, 20000), H = clamp(Math.round(+hh.value), 1, 20000); if (W === d.w && H === d.h) return;
    this.reframe(Math.round((W - d.w) * anchor[0]), Math.round((H - d.h) * anchor[1]), W, H, 'Canvas size');
  },
  cropDown(e, p) {
    const c = this.cropR, s = this.view.s;
    if (c) {
      const x0 = Math.min(c.x, c.x + c.w), y0 = Math.min(c.y, c.y + c.h), x1 = Math.max(c.x, c.x + c.w), y1 = Math.max(c.y, c.y + c.h), corners = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], k = corners.findIndex(q => Math.hypot(q[0] - p[0], q[1] - p[1]) * s < 10);
      if (k >= 0) { const fx = corners[(k + 2) % 4]; return this.drag(e, q => { this.cropR = { x: fx[0], y: fx[1], w: q[0] - fx[0], h: q[1] - fx[1] }; this.drawOv(); }); }
      if (p[0] > x0 && p[0] < x1 && p[1] > y0 && p[1] < y1) { const o = { ...c }; return this.drag(e, q => { c.x = o.x + q[0] - p[0]; c.y = o.y + q[1] - p[1]; this.drawOv(); }); }
    }
    this.cropR = { x: p[0], y: p[1], w: 0, h: 0 }; this.drawOpts();
    this.drag(e, q => { this.cropR.w = q[0] - p[0]; this.cropR.h = q[1] - p[1]; this.drawOv(); }, () => { if (Math.abs(this.cropR.w * s) < 4 || Math.abs(this.cropR.h * s) < 4) this.cropR = null; this.drawOv(); this.drawOpts(); });
  },
  crop(r) {
    r = r || this.cropR; if (!r) return; this.cropR = null;
    const x = Math.round(Math.min(r.x, r.x + r.w)), y = Math.round(Math.min(r.y, r.y + r.h)), w = Math.round(Math.abs(r.w)), hh = Math.round(Math.abs(r.h));
    if (w < 1 || hh < 1) return this.drawOv();
    this.reframe(-x, -y, w, hh, 'Crop');
  },
  cropToSel() { const b = this.selBox(); if (!b) return UI.toast('Select something first.'); this.crop(b); this.setSel(null); },
  trimTransparent() { this.composite(); const b = this.alphaBox(this.comp); if (!b) return UI.toast('The picture is empty.'); this.crop(b); },
  commit() { if (this.editing) return this.endText(); if (this.tf) return this.applyTransform(); if (this.cropR) return this.crop(); },
  cancel() { if (this.editing) return this.endText(true); if (this.tf) { this.tf = null; this.after(true); return; } if (this.cropR) { this.cropR = null; this.drawOv(); return this.drawOpts(); } if (this.sel) this.deselect(); },

  /* ---- adjustments and filters: applied to the active layer, inside the selection, with a live preview */
  async adjust(title, fields, fn, extra) {
    const L = await this.pixels(this.L, 'change the colours of'); if (!L) return;
    if (this.tf || this.cropR) this.commit();
    const w = L.cv.width, hh = L.cv.height, src = L.cv.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, hh), pv = this.canvas(w, hh), pg = pv.getContext('2d');
    let mask = null; if (this.sel) { const m = this.canvas(w, hh), mg = m.getContext('2d', { willReadFrequently: true }); mg.drawImage(this.sel.mask, -L.x, -L.y); mask = mg.getImageData(0, 0, w, hh).data; }
    const vals = Object.fromEntries(fields.filter(f => f.k).map(f => [f.k, f.def ?? 0])); let pending = false, out = null;
    const run = () => {
      out = fn(src, vals, L.cv, w, hh);
      if (mask) { const o = out.data, s = src.data; for (let i = 0; i < o.length; i += 4) { const a = mask[i + 3] / 255; if (a < 1) for (let c = 0; c < 4; c++) o[i + c] = s[i + c] + (o[i + c] - s[i + c]) * a; } }
      pg.putImageData(out, 0, 0); this.preview = { L, cv: pv }; this.present();
    };
    const go = () => { if (pending) return; pending = true; requestAnimationFrame(() => { pending = false; run(); }); };
    const body = h('div', { class: 'ie-adj' }, extra ? extra(vals, go, src) : null, fields.map(f => f.t === 'check' ? h('label', { class: 'fcheck' }, h('input', { type: 'checkbox', checked: !!vals[f.k], onchange: e => { vals[f.k] = e.target.checked; go(); } }), f.label) : f.t === 'select' ? h('label', { class: 'frow' }, h('span', {}, f.label), h('select', { onchange: e => { vals[f.k] = e.target.value; go(); } }, f.opts.map(([v, l]) => h('option', { value: v, selected: v === vals[f.k] }, l)))) : UI.slider({ label: f.label, min: f.min, max: f.max, step: f.step || 1, value: vals[f.k], def: f.def ?? 0, oninput: v => { vals[f.k] = v; go(); } })));
    run();
    const ok = await UI.dialog({ title, width: 440, body, buttons: [['Cancel', null], ['OK', true, 'primary']] });
    if (this.preview && this.preview.L === L) this.preview = null;
    if (!ok) return this.present();
    this.mark(title.replace(/…$/, '')); this.writable(L).putImageData(out, 0, 0); this.after();
  },
  lutOp(build) { return (src, v) => { const lut = build(v), out = new ImageData(new Uint8ClampedArray(src.data), src.width, src.height), a = out.data, [lr, lg, lb] = lut.length === 3 ? lut : [lut, lut, lut]; for (let i = 0; i < a.length; i += 4) { a[i] = lr[a[i]]; a[i + 1] = lg[a[i + 1]]; a[i + 2] = lb[a[i + 2]]; } return out; }; },
  lut(f) { const l = new Uint8ClampedArray(256); for (let i = 0; i < 256; i++) l[i] = Math.round(f(i)); return l; },
  brightness() {
    this.adjust('Brightness / Contrast', [{ k: 'b', label: 'Brightness', min: -100, max: 100 }, { k: 'c', label: 'Contrast', min: -100, max: 100 }],
      this.lutOp(v => { const c = v.c >= 0 ? 1 + v.c / 40 : 1 + v.c / 100, gm = Math.pow(2, -v.b / 60); return this.lut(i => (Math.pow(i / 255, gm) * 255 - 128) * c + 128); }));
  },
  levels() {
    const histo = src => { const n = new Uint32Array(256), a = src.data; for (let i = 0; i < a.length; i += 4) if (a[i + 3]) n[(a[i] * 77 + a[i + 1] * 150 + a[i + 2] * 29) >> 8]++; const cv = h('canvas', { class: 'ie-histo', width: 256, height: 80 }), g = cv.getContext('2d'), mx = Math.max(1, ...[...n].sort((x, y) => y - x).slice(3, 4)); g.fillStyle = Theme.css('--dim') || '#888'; for (let i = 0; i < 256; i++) { const v = Math.min(80, n[i] / mx * 80); g.fillRect(i, 80 - v, 1, v); } return cv; };
    this.adjust('Levels', [{ k: 'ib', label: 'Shadows in', min: 0, max: 254, def: 0 }, { k: 'g', label: 'Midtones', min: .1, max: 4, step: .01, def: 1 }, { k: 'iw', label: 'Highlights in', min: 1, max: 255, def: 255 }, { k: 'ob', label: 'Darkest out', min: 0, max: 255, def: 0 }, { k: 'ow', label: 'Brightest out', min: 0, max: 255, def: 255 }],
      this.lutOp(v => this.lut(i => { const t = clamp((i - v.ib) / Math.max(1, v.iw - v.ib), 0, 1); return v.ob + Math.pow(t, 1 / v.g) * (v.ow - v.ob); })), (v, go, src) => histo(src));
  },
  curves() {
    const pts = { rgb: [[0, 0], [255, 255]], r: [[0, 0], [255, 255]], g: [[0, 0], [255, 255]], b: [[0, 0], [255, 255]] }; let ch = 'rgb', drawC = null;
    const curve = p => { const s = p.filter(q => !q.gone).sort((a, b) => a[0] - b[0]), n = s.length, xs = s.map(q => q[0]), ys = s.map(q => q[1]), d = [], m = new Array(n).fill(0);
      for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / Math.max(1e-6, xs[i + 1] - xs[i]));
      m[0] = d[0]; m[n - 1] = d[n - 2]; for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
      for (let i = 0; i < n - 1; i++) { if (!d[i]) { m[i] = m[i + 1] = 0; continue; } const a = m[i] / d[i], b = m[i + 1] / d[i], t = a * a + b * b; if (t > 9) { const k = 3 / Math.sqrt(t); m[i] = k * a * d[i]; m[i + 1] = k * b * d[i]; } }
      return this.lut(x => { if (x <= xs[0]) return ys[0]; if (x >= xs[n - 1]) return ys[n - 1]; let i = 0; while (x > xs[i + 1]) i++; const hh = xs[i + 1] - xs[i], t = (x - xs[i]) / hh, t2 = t * t, t3 = t2 * t; return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * hh * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * hh * m[i + 1]; }); };
    const fn = this.lutOp(() => { const M = curve(pts.rgb); return ['r', 'g', 'b'].map(c => { const C = curve(pts[c]); return this.lut(i => M[C[i]]); }); });
    this.adjust('Curves', [], fn, (v, go) => {
      const cv = h('canvas', { class: 'ie-curve', width: 256, height: 256 }), g = cv.getContext('2d'), sel = h('select', { onchange: () => { ch = sel.value; drawC(); } }, [['rgb', 'All colours'], ['r', 'Red'], ['g', 'Green'], ['b', 'Blue']].map(([k, l]) => h('option', { value: k }, l)));
      drawC = () => { g.clearRect(0, 0, 256, 256); g.strokeStyle = 'rgba(128,128,128,.35)'; for (let k = 64; k < 256; k += 64) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k, 256); g.moveTo(0, k); g.lineTo(256, k); g.stroke(); } const l = curve(pts[ch]); g.strokeStyle = { rgb: Theme.css('--hi') || '#eee', r: '#e5484d', g: '#3fb950', b: '#3b82f6' }[ch]; g.lineWidth = 2; g.beginPath(); for (let x = 0; x < 256; x++) (x ? g.lineTo : g.moveTo).call(g, x, 255 - l[x]); g.stroke(); g.fillStyle = g.strokeStyle; for (const [x, y] of pts[ch]) { g.beginPath(); g.arc(x, 255 - y, 4, 0, 7); g.fill(); } };
      const at = e => { const r = cv.getBoundingClientRect(); return [clamp((e.clientX - r.left) * 256 / r.width, 0, 255), clamp(255 - (e.clientY - r.top) * 256 / r.height, 0, 255)]; };
      cv.addEventListener('pointerdown', e => {
        const P = pts[ch], q = at(e); let k = P.findIndex(p => Math.hypot(p[0] - q[0], p[1] - q[1]) < 10);
        if (k < 0) { P.push(q); k = P.length - 1; } const pt = P[k], end = pt[0] === 0 || pt[0] === 255 ? pt[0] : null; cv.setPointerCapture(e.pointerId);
        const mv = ev => { const r = cv.getBoundingClientRect(), out = end == null && (ev.clientY < r.top - 24 || ev.clientY > r.bottom + 24); const n = at(ev); pt[0] = end ?? clamp(n[0], 1, 254); pt[1] = n[1]; pt.gone = out; drawC(); go(); };
        const up = () => { cv.removeEventListener('pointermove', mv); cv.removeEventListener('pointerup', up); pts[ch] = P.filter(p => !p.gone); drawC(); go(); };
        cv.addEventListener('pointermove', mv); cv.addEventListener('pointerup', up); drawC(); go();
      });
      fn.pts = pts; drawC();
      return h('div', {}, h('label', { class: 'frow' }, h('span', {}, 'Channel'), sel), cv, h('p', { class: 'dim' }, 'Click the line to add a point and drag it. Up brightens, down darkens; an S shape adds contrast. Drag a point off the box to remove it.'));
    });
  },
  hsl() {
    this.adjust('Hue / Saturation', [{ k: 'h', label: 'Hue', min: -180, max: 180 }, { k: 's', label: 'Saturation', min: -100, max: 100 }, { k: 'l', label: 'Lightness', min: -100, max: 100 }, { k: 'col', label: 'Colorize (tint the whole layer one colour)', t: 'check' }], (src, v) => {
      const out = new ImageData(new Uint8ClampedArray(src.data), src.width, src.height), a = out.data, dh = v.h / 360, ds = v.s / 100, dl = v.l / 100;
      for (let i = 0; i < a.length; i += 4) {
        let r = a[i] / 255, g = a[i + 1] / 255, b = a[i + 2] / 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b); let hh = 0, s = 0, l = (mx + mn) / 2; const dd = mx - mn;
        if (dd) { s = l > .5 ? dd / (2 - mx - mn) : dd / (mx + mn); hh = mx === r ? (g - b) / dd + (g < b ? 6 : 0) : mx === g ? (b - r) / dd + 2 : (r - g) / dd + 4; hh /= 6; }
        if (v.col) { hh = ((v.h + 360) % 360) / 360; s = clamp(.25 + ds * .75 + .25, 0, 1); } else { hh = (hh + dh + 1) % 1; s = clamp(ds >= 0 ? s + (1 - s) * ds * s : s * (1 + ds), 0, 1); }
        l = dl >= 0 ? l + (1 - l) * dl : l * (1 + dl);
        if (!s) { r = g = b = l; } else { const q = l < .5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q, f = t => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < .5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; }; r = f(hh + 1 / 3); g = f(hh); b = f(hh - 1 / 3); }
        a[i] = r * 255; a[i + 1] = g * 255; a[i + 2] = b * 255;
      }
      return out;
    });
  },
  colorBalance() {
    this.adjust('Colour Balance', [{ k: 'r', label: 'Cyan ↔ Red', min: -100, max: 100 }, { k: 'g', label: 'Magenta ↔ Green', min: -100, max: 100 }, { k: 'b', label: 'Yellow ↔ Blue', min: -100, max: 100 }],
      this.lutOp(v => ['r', 'g', 'b'].map(c => this.lut(i => i + v[c] * .6 * Math.sin(Math.PI * i / 255) + v[c] * .15))));
  },
  pixelOp(label, f, fields = []) { return this.adjust(label, fields, (src, v) => { const out = new ImageData(new Uint8ClampedArray(src.data), src.width, src.height), a = out.data; for (let i = 0; i < a.length; i += 4) f(a, i, v); return out; }); },
  async quick(label, f) {
    const L = await this.pixels(this.L, 'change'); if (!L) return; const w = L.cv.width, hh = L.cv.height, src = L.cv.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, hh), out = f(src);
    if (this.sel) { const m = this.canvas(w, hh), mg = m.getContext('2d', { willReadFrequently: true }); mg.drawImage(this.sel.mask, -L.x, -L.y); const k = mg.getImageData(0, 0, w, hh).data, o = out.data, s = src.data; for (let i = 0; i < o.length; i += 4) { const a = k[i + 3] / 255; if (a < 1) for (let c = 0; c < 4; c++) o[i + c] = s[i + c] + (o[i + c] - s[i + c]) * a; } }
    this.mark(label); this.writable(L).putImageData(out, 0, 0); this.after();
  },
  map(f) { return src => { const out = new ImageData(new Uint8ClampedArray(src.data), src.width, src.height), a = out.data; for (let i = 0; i < a.length; i += 4) f(a, i); return out; }; },
  invertColours() { this.quick('Invert', this.map((a, i) => { a[i] = 255 - a[i]; a[i + 1] = 255 - a[i + 1]; a[i + 2] = 255 - a[i + 2]; })); },
  desaturate() { this.quick('Black & white', this.map((a, i) => { a[i] = a[i + 1] = a[i + 2] = a[i] * .2126 + a[i + 1] * .7152 + a[i + 2] * .0722; })); },
  autoTone() {
    this.quick('Auto tone', src => {
      const a = src.data, n = [0, 1, 2].map(() => new Uint32Array(256)); let total = 0; for (let i = 0; i < a.length; i += 4) if (a[i + 3]) { n[0][a[i]]++; n[1][a[i + 1]]++; n[2][a[i + 2]]++; total++; }
      const ends = h_ => { let lo = 0, hi = 255, s = 0; while (lo < 255 && (s += h_[lo]) < total * .003) lo++; s = 0; while (hi > 0 && (s += h_[hi]) < total * .003) hi--; return [lo, Math.max(lo + 1, hi)]; };
      const luts = n.map(h_ => { const [lo, hi] = ends(h_); return this.lut(i => (i - lo) * 255 / (hi - lo)); });
      const out = new ImageData(new Uint8ClampedArray(a), src.width, src.height), o = out.data; for (let i = 0; i < o.length; i += 4) { o[i] = luts[0][o[i]]; o[i + 1] = luts[1][o[i + 1]]; o[i + 2] = luts[2][o[i + 2]]; } return out;
    });
  },
  posterize() { this.pixelOp('Posterize', (a, i, v) => { const k = 255 / (v.n - 1); for (let c = 0; c < 3; c++) a[i + c] = Math.round(Math.round(a[i + c] / k) * k); }, [{ k: 'n', label: 'Levels', min: 2, max: 16, def: 4 }]); },
  threshold() { this.pixelOp('Threshold', (a, i, v) => { a[i] = a[i + 1] = a[i + 2] = a[i] * .2126 + a[i + 1] * .7152 + a[i + 2] * .0722 >= v.t ? 255 : 0; }, [{ k: 't', label: 'Level', min: 1, max: 255, def: 128 }]); },
  /* a blurred copy of a canvas, with its edges carried outwards so the border does not fade */
  blurred(cv, r) {
    const w = cv.width, hh = cv.height, p = Math.ceil(r * 3), big = this.canvas(w + p * 2, hh + p * 2), g = big.getContext('2d');
    g.drawImage(cv, 0, 0, w, 1, p, 0, w, p); g.drawImage(cv, 0, hh - 1, w, 1, p, hh + p, w, p); g.drawImage(cv, 0, 0, 1, hh, 0, p, p, hh); g.drawImage(cv, w - 1, 0, 1, hh, w + p, p, p, hh); g.drawImage(cv, p, p);
    const out = this.canvas(w, hh), og = out.getContext('2d', { willReadFrequently: true }); og.filter = `blur(${r}px)`; og.drawImage(big, -p, -p); og.filter = 'none'; return og.getImageData(0, 0, w, hh);
  },
  blur() { this.adjust('Blur', [{ k: 'r', label: 'Radius', min: .5, max: 100, step: .5, def: 4 }], (src, v, cv) => { const b = this.blurred(cv, v.r), s = src.data, o = b.data; for (let i = 3; i < o.length; i += 4) if (!s[i]) o[i] = 0; return b; }); },
  sharpen() {
    let cache = null; this.adjust('Sharpen', [{ k: 'a', label: 'Amount', min: 0, max: 300, def: 80 }, { k: 'r', label: 'Radius', min: .3, max: 20, step: .1, def: 1.5 }], (src, v, cv) => {
      if (!cache || cache.r !== v.r) cache = { r: v.r, b: this.blurred(cv, v.r) };
      const out = new ImageData(new Uint8ClampedArray(src.data), src.width, src.height), a = out.data, b = cache.b.data, k = v.a / 100; for (let i = 0; i < a.length; i += 4) for (let c = 0; c < 3; c++) a[i + c] = a[i + c] + (a[i + c] - b[i + c]) * k; return out;
    });
  },
  noise() { this.pixelOp('Add Noise', (a, i, v) => { const n = (Math.random() - .5) * v.n * 2.55; if (v.mono) { a[i] += n; a[i + 1] += n; a[i + 2] += n; } else for (let c = 0; c < 3; c++) a[i + c] += (Math.random() - .5) * v.n * 2.55; }, [{ k: 'n', label: 'Amount', min: 0, max: 100, def: 12 }, { k: 'mono', label: 'Grey noise only', t: 'check', def: true }]); },
  pixelate() {
    this.adjust('Pixelate', [{ k: 's', label: 'Cell size', min: 2, max: 200, def: 12 }], (src, v, cv) => {
      const w = cv.width, hh = cv.height, sm = this.canvas(Math.max(1, Math.round(w / v.s)), Math.max(1, Math.round(hh / v.s))), sg = sm.getContext('2d'); sg.imageSmoothingQuality = 'high'; sg.drawImage(cv, 0, 0, sm.width, sm.height);
      const out = this.canvas(w, hh), og = out.getContext('2d', { willReadFrequently: true }); og.imageSmoothingEnabled = false; og.drawImage(sm, 0, 0, w, hh); return og.getImageData(0, 0, w, hh);
    });
  },

  /* ---- saving */
  folder() { const d = this.doc; return (d && (d.folder || (d.path && d.path.replace(/[\\/][^\\/]*$/, '')))) || App.conf('img_out', App.boot.pictures + '\\Opia Exports'); },
  async ask(title, ext, extra) {
    const d = this.doc, folder = h('input', { type: 'text', value: this.folder() }), name = h('input', { type: 'text', value: d.name });
    const ok = await UI.dialog({ title, width: 560, body: h('div', { class: 'pd-form' }, h('label', { class: 'frow' }, h('span', {}, 'Name'), name), h('div', { class: 'frow' }, h('span', {}, 'Folder'), h('div', { class: 'pd-row' }, folder, h('button', { class: 'btn', onclick: async () => { const f = await UI.pickFolder(folder.value); if (f) folder.value = f; } }, 'Browse…'))), extra || null),
      buttons: [['Cancel', null], ['Save', () => (name.value.trim() && folder.value.trim() ? true : false), 'primary']] });
    if (!ok) return null;
    const base = name.value.trim().replace(/[\\/:*?"<>|]/g, ''), file = base.replace(new RegExp('\\' + (typeof ext === 'function' ? ext() : ext) + '$', 'i'), '') + (typeof ext === 'function' ? ext() : ext), path = folder.value.trim().replace(/[\\/]+$/, '') + '\\' + file;
    if (path !== d.path && (await api('fs_exists', { paths: [path] }))[0] && !await UI.confirm('Replace File?', file + ' is already in that folder. Replace it?', 'Replace')) return null;
    App.setConf('img_out', folder.value.trim()); return { path, base: base.replace(/\.[^.]+$/, '') };
  },
  blob(cv, type = 'image/png', q) { return new Promise((res, rej) => cv.toBlob(b => (b ? res(b) : rej(new Error('The picture could not be encoded'))), type, q)); },
  dataURL(cv) { return this.blob(cv).then(b => new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(b); })); },
  async save() { if (!this.doc) return; this.commit(); if (!this.doc.path) return this.saveAs(); await this.writeProject(this.doc.path); },
  async saveAs() { if (!this.doc) return; this.commit(); const r = await this.ask('Save Project', '.opiaimg', h('p', { class: 'dim' }, 'A project keeps every layer, and text stays editable. To share the picture or use it elsewhere, use Export instead.')); if (r) await this.writeProject(r.path); },
  async writeProject(path) {
    const d = this.doc, row = $('#activity').appendChild(h('div', { class: 'job' }, h('span', {}, 'Saving project'), h('div', { class: 'bar' }, h('i', { style: { width: '50%' } }))));
    try {
      this.composite(); const k = Math.min(1, 512 / Math.max(d.w, d.h)), pv = this.canvas(d.w * k, d.h * k); pv.getContext('2d').drawImage(this.comp, 0, 0, pv.width, pv.height);
      const layers = []; for (const L of d.layers) layers.push({ id: L.id, kind: L.kind, name: L.name, vis: L.vis, op: L.op, blend: L.blend, x: L.x, y: L.y, text: L.text, shape: L.shape, m: L.m, png: L.kind === 'pixel' ? await this.dataURL(L.cv) : null });
      const r = await upload('image_project_save', { path }, JSON.stringify({ w: d.w, h: d.h, name: d.name, active: d.active, layers, preview: await this.dataURL(pv) }));
      d.path = r.path; d.name = r.path.split(/[\\/]/).pop().replace(/\.opiaimg$/i, ''); d.dirty = false; this.drawBar();
      App.setConf('img_recent', [r.path, ...App.conf('img_recent', []).filter(p => p !== r.path)].slice(0, 8));
      UI.toast('Saved ' + r.path.split(/[\\/]/).pop() + ' (' + fmt.bytes(r.size) + ')');
    } finally { row.remove(); }
  },
  async loadProject(p, file) {
    const d = this.makeDoc(p.w, p.h, p.name || (file.name || '').replace(/\.opiaimg$/i, '')); d.path = file.path || null; d.active = p.active;
    for (const l of p.layers) {
      const L = { ...l, gen: -1 }; delete L.png;
      if (l.png) { const im = await this.toCanvas(await (await fetch(l.png)).blob()); L.cv = im; } else L.cv = this.canvas(p.w, p.h);
      d.layers.push(L);
    }
    this.start(d); for (const L of d.layers) if (L.kind !== 'pixel') this.render(L); this.present(); this.drawSide();
  },
  async exportPic() {
    const d = this.doc; if (!d) return; this.commit();
    const fmtSel = h('select', {}, [['png', 'PNG (keeps transparency)'], ['jpeg', 'JPEG (smaller, for photos)'], ['webp', 'WebP (small, for the web)'], ['tiff', 'TIFF (for printing)']].map(([v, l]) => h('option', { value: v, selected: v === App.conf('img_fmt', 'png') }, l)));
    const q = UI.slider({ label: 'Quality', min: 40, max: 100, value: App.conf('img_q', 90), def: 90 }), scale = h('select', {}, [100, 75, 50, 25].map(v => h('option', { value: v }, v + '%')));
    const cat = h('input', { type: 'checkbox', checked: !!d.fromPhoto || App.conf('img_cat', false) });
    const showQ = () => { q.style.display = ['jpeg', 'webp'].includes(fmtSel.value) ? '' : 'none'; }; fmtSel.onchange = showQ; showQ();
    const ext = () => ({ png: '.png', jpeg: '.jpg', webp: '.webp', tiff: '.tif' })[fmtSel.value];
    const r = await this.ask('Export Picture', ext, h('div', { class: 'pd-form' }, h('label', { class: 'frow' }, h('span', {}, 'Format'), fmtSel), q, h('label', { class: 'frow adv' }, h('span', {}, 'Size'), scale), h('label', { class: 'fcheck' }, cat, 'Add it to the Lens catalog'), h('p', { class: 'dim' }, 'Export makes one flat picture with every visible layer. Keep a project too if you want to change the layers later.')));
    if (!r) return;
    App.setConf('img_fmt', fmtSel.value); App.setConf('img_q', q.get()); App.setConf('img_cat', cat.checked);
    this.composite(); let cv = this.comp; const k = +scale.value / 100; if (k < 1) { const s = this.canvas(d.w * k, d.h * k), g = s.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(cv, 0, 0, s.width, s.height); cv = s; }
    const res = await upload('image_export', { path: r.path, fmt: fmtSel.value, quality: q.get(), catalog: cat.checked ? '1' : '0' }, await this.blob(cv));
    d.out = res.path; if (res.photos && res.photos.length) { App.addPhotos(res.photos); App.refreshList(true); }
    UI.toast('Exported ' + res.path.split(/[\\/]/).pop() + ' (' + fmt.bytes(res.size) + ')' + (res.photos && res.photos.length ? ', and added to Photos' : '') + (res.note ? ' (' + res.note + ')' : ''));
  },

  /* ---- the interface */
  draw() { if (!this.bar) return; this.drawBar(); this.drawOpts(); this.drawBox(); this.drawSide(); this.port.classList.toggle('empty', !this.doc); if (!this.doc) this.drawWelcome(); else { const w = $('.ie-welcome', this.port); if (w) w.remove(); this.present(); } },
  btn(label, run, tip, cls) { const b = h('button', { class: 'btn ' + (cls || ''), onclick: () => { try { const r = run(); if (r && r.catch) r.catch(UI.error); } catch (e) { UI.error(e); } } }, label); if (tip) { b.dataset.tip = tip; b.dataset.tipName = label.replace(/…$/, ''); } return b; },
  drawWelcome() {
    $$('.ie-welcome', this.port).forEach(x => x.remove()); this.g.setTransform(1, 0, 0, 1, 0, 0); this.g.clearRect(0, 0, this.cv.width, this.cv.height); this.og.setTransform(1, 0, 0, 1, 0, 0); this.og.clearRect(0, 0, this.ov.width, this.ov.height);
    const recent = App.conf('img_recent', []);
    this.port.append(h('div', { class: 'pd-welcome ie-welcome' }, h('img', { class: 'pd-logo', src: 'img/opia-image-icon.svg', alt: '' }), h('h2', {}, 'Imagine'), h('p', { class: 'dim' }, 'Paint, cut out, combine pictures in layers, add text and shapes, and fix colours. Open a picture, start a blank one, or bring in a photo from Lens.'),
      h('div', { class: 'pd-big' }, this.btn('Open a Picture…', () => this.open(), null, 'primary big'), this.btn('New Blank Picture…', () => this.newDoc(), null, 'big'), this.btn('Edit the Selected Photo', () => this.fromPhoto(App.cur()), 'Open the photo that is selected in Lens, with its Develop edits.', 'big')),
      h('p', { class: 'dim' }, 'Or drop a picture here, or paste one with Ctrl+V.'),
      recent.length ? h('div', { class: 'pd-recent' }, h('div', { class: 'fsec' }, 'Opened recently'), recent.map(p => h('a', { title: p, data: { notr: 1 }, onclick: () => this.openPath(p).catch(UI.error) }, p.split(/[\\/]/).pop()))) : null));
  },
  drawBar() {
    const d = this.doc, sep = () => h('span', { class: 'mu-sep' });
    if (!d) return this.bar.replaceChildren(this.btn('Open…', () => this.open(), 'Open a picture or a saved project.', 'primary'), this.btn('New…', () => this.newDoc(), 'Start a blank picture.'), h('span', { class: 'dim' }, 'Open a picture to edit it in layers.'));
    const z = Math.round(this.view.s * 100);
    this.bar.replaceChildren(
      this.btn('Open…', () => this.open(), 'Open a picture or a saved project.'), this.btn('New…', () => this.newDoc(), 'Start a blank picture.', 'adv'),
      this.btn(d.dirty ? 'Save *' : 'Save', () => this.save(), 'Save a project that keeps the layers, so you can carry on later. The picture you opened is not changed.', d.dirty ? 'primary' : ''),
      this.btn('Export…', () => this.exportPic(), 'Save a finished picture (PNG, JPEG, WebP or TIFF) to use anywhere. It can go straight into your Lens catalog.'), sep(),
      h('b', { class: 'mu-name', title: 'Double-click to rename', data: { notr: 1 }, ondblclick: async () => { const n = await UI.prompt('Rename', 'Name', d.name); if (n) { d.name = n.replace(/[\\/:*?"<>|]/g, ''); d.path = null; this.drawBar(); } } }, d.name), h('span', { class: 'dim' }, d.w + ' × ' + d.h), sep(),
      h('button', { class: 'btn', title: 'Zoom out', onclick: () => this.zoomBy(.8) }, '−'), h('span', { class: 'pd-zoom', title: 'Fit the picture to the window (Ctrl+0)', onclick: () => this.setZoom('fit') }, z + '%'), h('button', { class: 'btn', title: 'Zoom in', onclick: () => this.zoomBy(1.25) }, '+'),
      h('button', { class: 'btn adv', title: 'Actual pixels (Ctrl+1)', onclick: () => this.setZoom(1) }, '1:1'),
      h('span', { style: { flex: 1 } }),
      this.sel ? this.btn('Deselect', () => this.deselect(), 'Clear the selection so tools work on the whole layer (Ctrl+D).') : null,
      h('button', { class: 'btn', title: 'Undo' + (this.undo.length ? ': ' + this.undo[this.undo.length - 1].label : ''), disabled: !this.undo.length, onclick: () => this.step(this.undo, this.redo) }, '↶'), h('button', { class: 'btn', title: 'Redo', disabled: !this.redo.length, onclick: () => this.step(this.redo, this.undo) }, '↷'),
      h('button', { class: 'btn', onclick: e => { const r = e.currentTarget.getBoundingClientRect(); UI.menu(r.left, r.bottom + 4, this.moreItems()); } }, 'More ▾'));
  },
  moreItems() {
    const it = (label, run, adv) => (adv && Modes.beginner ? null : { label, run: () => { const r = run(); if (r && r.catch) r.catch(UI.error); } });
    return [it('Image Size…', () => this.imageSize()), it('Canvas Size…', () => this.canvasSize(), 1), it('Rotate Right', () => this.rotateDoc(90)), it('Rotate Left', () => this.rotateDoc(-90)), it('Flip Horizontal', () => this.flipDoc(true), 1), it('Crop to Selection', () => this.cropToSel()), it('Trim Empty Edges', () => this.trimTransparent(), 1), '-',
      it('Brightness / Contrast…', () => this.brightness()), it('Hue / Saturation…', () => this.hsl()), it('Levels…', () => this.levels(), 1), it('Curves…', () => this.curves(), 1), it('Auto Tone', () => this.autoTone()), it('Black & White', () => this.desaturate()), '-',
      it('Blur…', () => this.blur()), it('Sharpen…', () => this.sharpen()), '-', it('Save As…', () => this.saveAs(), 1), it('Close Picture', () => this.close())].filter(Boolean);
  },
  drawBox() {
    const s = this.style, tools = IE_TOOLS.map(([id, label, key, tip, adv]) => { const b = h('a', { class: 'ie-tool' + (this.tool === id ? ' on' : '') + (adv ? ' adv' : ''), 'aria-pressed': String(this.tool === id), 'aria-keyshortcuts': key || null, onclick: () => this.setTool(id) }, h('i', { class: 'ie-ic ie-ic-' + id, 'aria-hidden': 'true' }), h('span', {}, label)); b.dataset.tip = tip + (key ? ' (' + key + ')' : ''); b.dataset.tipName = label; return b; });
    const pick = k => { const inp = h('input', { type: 'color', value: s[k], oninput: e => this.setStyle(k, e.target.value) }); inp.click(); };
    this.box.replaceChildren(...tools, h('div', { class: 'ie-colors', data: { tip: 'The left square is the colour you paint, fill and write with; the right one is the second colour, used by gradients and shape outlines. Click one to change it. X swaps them, D resets to black and white.', tipName: 'Colours' } },
      h('span', { class: 'ie-fg', title: 'First colour ' + s.fg, style: { background: s.fg }, onclick: () => pick('fg') }), h('span', { class: 'ie-bg', title: 'Second colour ' + s.bg, style: { background: s.bg }, onclick: () => pick('bg') }), h('b', { title: 'Swap the colours (X)', onclick: () => this.keys.X() }, '⇄')));
  },
  drawOpts() {
    const s = this.style, t = this.tool, d = this.doc, sep = () => h('span', { class: 'mu-sep' }), out = [];
    const num = (k, label, min, max, unit = '', step = 1) => h('label', { class: 'ie-num' }, h('span', { class: 'dim' }, label), h('input', { type: 'number', class: 'mu-num', min, max, step, value: Math.round(s[k] * (unit === '%' ? 100 : 1)), onchange: e => this.setStyle(k, clamp(+e.target.value, min, max) / (unit === '%' ? 100 : 1)) }), unit);
    const chk = (k, label) => h('label', { class: 'fcheck ie-chk' }, h('input', { type: 'checkbox', checked: !!s[k], onchange: e => this.setStyle(k, e.target.checked) }), label);
    const L = d && this.L;
    if (this.tf) out.push(h('span', { class: 'dim' }, 'Transform: drag a corner to resize (Shift stretches freely), outside to turn, inside to move.'), this.btn('Apply', () => this.commit(), null, 'primary'), this.btn('Cancel', () => this.cancel()));
    else if (t === 'crop') out.push(h('span', { class: 'dim' }, this.cropR ? 'Adjust the frame, then crop.' : 'Drag over the part to keep.'), this.cropR ? [this.btn('Crop', () => this.crop(), null, 'primary'), this.btn('Cancel', () => this.cancel())] : null, sep(), this.btn('Crop to Selection', () => this.cropToSel()));
    else if (t === 'brush' || t === 'eraser') out.push(num('size', 'Size', 1, 2000, 'px'), num('hard', 'Hardness', 0, 100, '%'), num('flow', 'Opacity', 1, 100, '%'), h('span', { class: 'dim' }, '[ and ] change the size. Shift-click draws a straight line from the last point.'));
    else if (t === 'fill' || t === 'wand') out.push(num('tol', 'Tolerance', 0, 255), chk('contiguous', 'Touching only'), chk('all', 'Look at all layers'), t === 'wand' ? this.selSeg() : null);
    else if (t === 'rect' || t === 'ellipse' || t === 'lasso') out.push(this.selSeg(), h('span', { class: 'dim' }, 'Shift adds, Alt takes away.'), this.sel ? [sep(), this.btn('Feather…', () => this.feather(), 'Soften the edge of the selection.', 'adv'), this.btn('Invert', () => this.invertSel(), 'Select everything that is not selected now.'), this.btn('Fill', () => this.fillSel(), 'Fill the selection with the left colour.'), this.btn('Layer from It', () => this.layerViaCopy(), 'Copy what is selected onto a new layer of its own (Ctrl+J).')] : null);
    else if (t === 'gradient') out.push(h('span', { class: 'seg' }, h('a', { class: s.grad === 'fg' ? 'on' : '', onclick: () => this.setStyle('grad', 'fg') }, 'Left to right colour'), h('a', { class: s.grad === 'clear' ? 'on' : '', onclick: () => this.setStyle('grad', 'clear') }, 'Left colour to clear')));
    else if (t === 'picker') out.push(h('span', { class: 'dim' }, 'Click to take a colour. Alt-click sets the second colour.'));
    else if (t === 'text' || (t === 'move' && L && L.kind === 'text')) {
      const tx = L && L.kind === 'text' ? L.text : { font: s.font, size: s.fsize, bold: s.bold, italic: s.italic, align: s.align, color: s.fg };
      out.push(h('select', { title: 'Typeface', onchange: e => this.setStyle('font', e.target.value) }, IE_FONTS.map(([v, l]) => h('option', { value: v, selected: v === tx.font, style: { fontFamily: v } }, l))),
        h('label', { class: 'ie-num' }, h('input', { type: 'number', class: 'mu-num', min: 4, max: 2000, value: Math.round(tx.size), onchange: e => this.setStyle('fsize', clamp(+e.target.value, 4, 2000)) }), 'px'),
        h('button', { class: 'btn' + (tx.bold ? ' on' : ''), title: 'Bold', onclick: () => this.setStyle('bold', !tx.bold) }, h('b', {}, 'B')), h('button', { class: 'btn' + (tx.italic ? ' on' : ''), title: 'Italic', onclick: () => this.setStyle('italic', !tx.italic) }, h('i', {}, 'I')),
        h('span', { class: 'seg' }, [['left', 'Left'], ['center', 'Centre'], ['right', 'Right']].map(([v, l]) => h('a', { class: tx.align === v ? 'on' : '', onclick: () => this.setStyle('align', v) }, l))),
        h('span', { class: 'swatch btn-sw', style: { background: tx.color }, title: 'Text colour: the left colour square', onclick: () => { const inp = h('input', { type: 'color', value: tx.color, oninput: e => this.setStyle('fg', e.target.value) }); inp.click(); } }),
        L && L.kind === 'text' ? [sep(), this.btn('Edit Text', () => this.editText(L), 'Change the words.'), this.btn('Turn Into Pixels', () => this.pixels(L, 'paint on'), 'Make this an ordinary picture layer so you can paint on it. The words stop being editable.', 'adv')] : h('span', { class: 'dim' }, 'Click the picture and type. Ctrl+Enter or a click elsewhere finishes.'));
    } else if (t === 'shape' || (t === 'move' && L && L.kind === 'shape')) {
      out.push(h('span', { class: 'seg' }, [['rect', 'Rectangle'], ['ellipse', 'Oval'], ['line', 'Line'], ['arrow', 'Arrow']].map(([v, l]) => h('a', { class: s.shape === v ? 'on' : '', onclick: () => this.setStyle('shape', v) }, l))),
        chk('fill', 'Fill'), chk('stroke', 'Outline'), num('lw', 'Line', 1, 400, 'px'), s.shape === 'rect' ? num('radius', 'Corners', 0, 2000, 'px') : null,
        h('span', { class: 'dim' }, 'Fills use the left colour; an outline uses the right one. Shift keeps it square.'));
    } else if (t === 'move') out.push(h('span', { class: 'dim' }, L ? 'Drag to move "' + L.name + '". Ctrl-click picks the layer under the pointer.' : 'Pick a layer to move.'), L ? [sep(), this.btn('Transform', () => this.startTransform(), 'Resize, turn and move the layer with handles (Ctrl+T).'), this.btn('Flip', () => this.flipLayer(true), 'Mirror the layer left to right.')] : null);
    else if (t === 'hand') out.push(h('span', { class: 'dim' }, 'Drag to look around. The mouse wheel zooms.'));
    this.opts.replaceChildren(...out.flat(3).filter(Boolean));
  },
  selSeg() { return h('span', { class: 'seg', title: 'What a new selection does' }, [['new', 'New'], ['add', 'Add'], ['sub', 'Subtract'], ['and', 'Overlap']].map(([v, l]) => h('a', { class: this.style.selMode === v ? 'on' : '', onclick: () => this.setStyle('selMode', v) }, l))); },
  setTool(t, keep) {
    if (Modes.beginner && IE_TOOLS.find(x => x[0] === t)[4] && !keep) Modes.set('beginner', false);
    if (this.tf && !keep) this.applyTransform(); if (this.cropR && t !== 'crop') this.cropR = null;
    this.endText(); this.tool = t; this.cursor(); this.drawBox(); this.drawOpts(); this.drawOv();
  },
  drawSide() {
    const d = this.doc; if (!d) return this.side.replaceChildren();
    const L = this.L, list = h('div', { class: 'ie-layers', role: 'listbox', 'aria-label': 'Layers, top first. Up and Down pick a layer, Space shows or hides it, Alt+Up and Alt+Down move it.' }, [...d.layers].reverse().map(x => this.row(x)));
    this.side.replaceChildren(h('div', { class: 'panel-h ie-ph' }, h('span', { class: 'pt', data: { tip: 'A picture is a stack of layers, top to bottom. Tools work on the picked layer. Drag layers to reorder them; the eye hides one.' } }, 'Layers')),
      L ? h('div', { class: 'ie-lprops' },
        h('select', { class: 'adv', title: 'Blend mode: how this layer mixes with the ones below', onchange: e => this.setProp(L, 'blend', e.target.value, 'Blend mode') }, IE_BLENDS.map(([v, l]) => h('option', { value: v, selected: v === L.blend }, l))),
        UI.slider({ label: 'Opacity', min: 0, max: 100, value: Math.round(L.op * 100), def: 100, tip: 'How solid the layer is. Lower lets the layers below show through.', oninput: v => { if (!this.opDrag) { this.opDrag = true; this.mark('Opacity'); } L.op = v / 100; this.present(); }, onchange: () => { this.opDrag = false; this.after(); } })) : null,
      list,
      h('div', { class: 'ie-lbtns' }, this.btn('+ Layer', () => this.newLayer(), 'Add an empty layer above the picked one.'), this.btn('Duplicate', () => this.dupLayer(), 'Copy the picked layer.'), this.btn('Delete', () => this.delLayer(), 'Remove the picked layer.'),
        this.btn('↑', () => this.moveLayer(1), 'Move the layer up.'), this.btn('↓', () => this.moveLayer(-1), 'Move the layer down.'), this.btn('Merge Down', () => this.mergeDown(), 'Combine this layer with the one below it.', 'adv'), this.btn('Flatten', () => this.flatten(), 'Combine every layer into one.', 'adv')));
    this.thumbsSoon();
  },
  row(L) {
    const d = this.doc, th = h('canvas', { class: 'ie-thumb', width: 48, height: 36 }); th.layer = L;
    const r = h('div', { class: 'ie-layer' + (L.id === d.active ? ' on' : '') + (L.vis ? '' : ' off'), draggable: true, data: { id: L.id }, tabindex: 0, role: 'option', 'aria-selected': String(L.id === d.active), 'aria-label': L.name + (L.kind === 'pixel' ? '' : ', ' + L.kind + ' layer') + (L.vis ? '' : ', hidden'),
      onkeydown: e => { if (e.target !== r) return; if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); r.click(); } else if (e.key === ' ') { e.preventDefault(); e.stopPropagation(); this.setProp(L, 'vis', !L.vis, L.vis ? 'Hide layer' : 'Show layer'); const f = $(`.ie-layer[data-id="${L.id}"]`, this.side); if (f) f.focus(); } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); const rows = $$('.ie-layer', this.side), i = rows.indexOf(r), n = rows[clamp(i + (e.key === 'ArrowUp' ? -1 : 1), 0, rows.length - 1)]; if (e.altKey) this.moveLayer(e.key === 'ArrowUp' ? 1 : -1); else if (n) { n.click(); const f = $(`.ie-layer[data-id="${n.dataset.id}"]`, this.side); if (f) f.focus(); } if (e.altKey) { const f = $(`.ie-layer[data-id="${L.id}"]`, this.side); if (f) f.focus(); } } },
      onclick: () => { if (d.active === L.id) return; this.endText(); d.active = L.id; this.drawSide(); this.drawOpts(); this.drawOv(); },
      ondblclick: e => { if (e.target.closest('.ie-eye')) return; if (L.kind === 'text') this.editText(L); else this.renameLayer(L); },
      oncontextmenu: e => { d.active = L.id; this.drawSide(); UI.menu(e.clientX, e.clientY, [{ label: 'Rename…', run: () => this.renameLayer(L) }, { label: 'Duplicate', run: () => this.dupLayer() }, { label: 'Delete', run: () => this.delLayer() }, '-', { label: 'Select Its Pixels', run: () => this.layerToSel() }, { label: 'Merge Down', run: () => this.mergeDown() }, L.kind !== 'pixel' ? { label: 'Turn Into Pixels', run: () => this.pixels(L, 'paint on') } : null, '-', { label: 'Flip Horizontal', run: () => this.flipLayer(true) }, { label: 'Flip Vertical', run: () => this.flipLayer(false) }].filter(Boolean)); },
      ondragstart: e => { e.dataTransfer.setData('text/opia-layer', L.id); e.dataTransfer.effectAllowed = 'move'; },
      ondragover: e => { if (![...e.dataTransfer.types].includes('text/opia-layer')) return; e.preventDefault(); const b = r.getBoundingClientRect(); $$('.ie-layer', this.side).forEach(x => x.classList.remove('drop-a', 'drop-b')); r.classList.add(e.clientY < b.top + b.height / 2 ? 'drop-a' : 'drop-b'); },
      ondragleave: () => r.classList.remove('drop-a', 'drop-b'),
      ondrop: e => { const id = e.dataTransfer.getData('text/opia-layer'), M = this.layer(id); if (!M) return; e.preventDefault(); const above = r.classList.contains('drop-a'); r.classList.remove('drop-a', 'drop-b'); if (M === L) return; this.mark('Move layer'); const ls = d.layers; ls.splice(ls.indexOf(M), 1); ls.splice(ls.indexOf(L) + (above ? 1 : 0), 0, M); this.after(true); } },
      h('a', { class: 'ie-eye', role: 'none', 'aria-hidden': 'true', title: L.vis ? 'Hide this layer' : 'Show this layer', onclick: e => { e.stopPropagation(); this.setProp(L, 'vis', !L.vis, L.vis ? 'Hide layer' : 'Show layer'); } }, L.vis ? '◉' : '○'), th,
      h('span', { class: 'ie-lname', data: { notr: 1 } }, L.name), h('i', { class: 'ie-kind' }, L.kind === 'text' ? 'T' : L.kind === 'shape' ? '◇' : ''), L.blend !== 'source-over' || L.op < 1 ? h('i', { class: 'ie-kind adv' }, (L.op < 1 ? Math.round(L.op * 100) + '%' : '')) : null);
    return r;
  },
  thumbsSoon: debounce(function () { ImgEd.thumbs(); }, 250),
  thumbs() {
    const d = this.doc; if (!d) return;
    for (const th of $$('.ie-thumb', this.side)) {
      const L = th.layer, g = th.getContext('2d'), k = Math.min(48 / d.w, 36 / d.h), w = d.w * k, hh = d.h * k, x = (48 - w) / 2, y = (36 - hh) / 2;
      g.clearRect(0, 0, 48, 36); g.fillStyle = '#fff'; g.fillRect(x, y, w, hh); g.fillStyle = '#ddd'; for (let i = 0; i < w; i += 6) for (let j = 0; j < hh; j += 6) if (((i + j) / 6) % 2 === 0) g.fillRect(x + i, y + j, Math.min(6, w - i), Math.min(6, hh - j));
      g.save(); g.beginPath(); g.rect(x, y, w, hh); g.clip(); g.drawImage(L.cv, x + L.x * k, y + L.y * k, L.cv.width * k, L.cv.height * k); g.restore();
    }
  },
};

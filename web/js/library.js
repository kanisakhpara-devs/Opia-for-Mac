'use strict';
/* Library module: grid, loupe, compare, survey, filter bar, toolbar, painter, filmstrip. Panels live in panels.js. */

const Overlay = {   // loupe grid + guides, shared by Library and Develop
  get s() { return { grid: false, guides: false, gridSize: 90, opacity: 45, gx: 0.5, gy: 0.5, ...App.pref('overlay', {}) }; },
  set(k, v) { App.setPref('overlay', { ...this.s, [k]: v }); App.emit('overlay'); },
  draw(ctx, r) {   // r = image rect on the canvas {x,y,w,h}
    const s = this.s;
    ctx.save(); ctx.beginPath(); ctx.rect(r.x, r.y, r.w, r.h); ctx.clip();
    if (s.grid) {
      ctx.strokeStyle = `rgba(255,255,255,${s.opacity / 100})`; ctx.lineWidth = 1; ctx.beginPath();
      const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
      for (let x = cx % s.gridSize; x < r.x + r.w; x += s.gridSize) { ctx.moveTo(Math.round(x) + 0.5, r.y); ctx.lineTo(Math.round(x) + 0.5, r.y + r.h); }
      for (let y = cy % s.gridSize; y < r.y + r.h; y += s.gridSize) { ctx.moveTo(r.x, Math.round(y) + 0.5); ctx.lineTo(r.x + r.w, Math.round(y) + 0.5); }
      ctx.stroke();
    }
    if (s.guides) {
      const gx = Math.round(r.x + s.gx * r.w) + 0.5, gy = Math.round(r.y + s.gy * r.h) + 0.5;
      ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(gx, r.y); ctx.lineTo(gx, r.y + r.h); ctx.moveTo(r.x, gy); ctx.lineTo(r.x + r.w, gy); ctx.stroke();
      ctx.strokeStyle = 'rgba(120,220,255,.95)'; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = 'rgba(120,220,255,.95)'; ctx.fillRect(gx - 4, gy - 4, 8, 8);
    }
    ctx.restore();
  },
  /* Ctrl-drag near the guide crossing moves it. Returns true when the event was taken. */
  grab(e, r, redraw) {
    const s = this.s;
    if (!s.guides || !(e.ctrlKey || e.metaKey)) return false;
    const move = ev => { const b = e.currentTarget.getBoundingClientRect(); this.set('gx', clamp((ev.clientX - b.left - r.x) / r.w, 0, 1)); this.set('gy', clamp((ev.clientY - b.top - r.y) / r.h, 0, 1)); redraw(); };
    const up = () => { removeEventListener('mousemove', move); removeEventListener('mouseup', up); };
    addEventListener('mousemove', move); addEventListener('mouseup', up); move(e);
    return true;
  },
  controls() {
    const s = this.s;
    return h('span', { class: 'tb-group adv' },
      h('label', { class: 'tb-check', title: 'Loupe overlay: Grid' }, h('input', { type: 'checkbox', checked: s.grid, onchange: e => this.set('grid', e.target.checked) }), 'Grid'),
      h('input', { type: 'range', class: 'mini', min: 20, max: 240, value: s.gridSize, title: 'Grid size', oninput: e => this.set('gridSize', +e.target.value) }),
      h('input', { type: 'range', class: 'mini', min: 5, max: 100, value: s.opacity, title: 'Grid opacity', oninput: e => this.set('opacity', +e.target.value) }),
      h('label', { class: 'tb-check', title: 'Loupe overlay: Guides (Ctrl-drag to move)' }, h('input', { type: 'checkbox', checked: s.guides, onchange: e => this.set('guides', e.target.checked) }), 'Guides'));
  },
};

/* Zoomable single-image viewer used by Loupe, Compare and Reference views. */
class LoupeView {
  constructor(host, opts = {}) {
    this.opts = opts; this.zoom = 'fit'; this.cx = 0.5; this.cy = 0.5; this.photo = null;
    this.img = h('img', { draggable: false, onload: () => this.layout() });
    this.ov = h('canvas', { class: 'lv-ov' });
    this.info = h('div', { class: 'lv-info' });
    this.el = h('div', { class: 'loupe', onmousedown: e => this.down(e), onwheel: e => { e.preventDefault(); if (Modes.trackpad) return this.gesture(e); this.setZoom(e.deltaY < 0 ? Math.min(8, this.scale() * 1.25) : Math.max(this.fit() * 0.5, this.scale() / 1.25), e); }, ondblclick: () => opts.ondbl && opts.ondbl() }, this.img, this.ov, this.info);
    host.append(this.el);
    new ResizeObserver(() => this.layout()).observe(this.el);
    App.on('overlay', () => this.layout());
  }
  async show(p) {
    this.photo = p;
    if (!p) { this.img.removeAttribute('src'); this.info.textContent = ''; return; }
    const want = this.zoom === 'fit' ? Math.min(2560, Math.max(1024, Math.ceil(Math.max(this.el.clientWidth, this.el.clientHeight) * devicePixelRatio / 512) * 512)) : Math.max(p.w, p.h);
    const tok = this.tok = {};
    if (this.img.dataset.id !== String(p.id)) { this.img.src = App.thumb(p); this.img.dataset.id = p.id; }
    try { const url = await Render.url(p, want); if (this.tok === tok) this.img.src = url; } catch (e) { if (this.tok === tok) this.info.textContent = e.message; }
    this.drawInfo();
  }
  drawInfo() {
    const p = this.photo;
    this.info.replaceChildren();
    if (!p || !App.pref('loupeInfo', true)) return;
    const c = devFull(p.develop).crop;
    this.info.append(h('b', {}, p.filename + (p.copy_name ? ' / ' + p.copy_name : '')), h('span', {}, fmt.datetime(p.capture_time)), h('span', {}, `${Math.round(p.w * c.w)} × ${Math.round(p.h * c.h)}`), h('span', {}, fmt.exif(p)));
    if (this.opts.label) this.info.prepend(h('i', {}, this.opts.label));
  }
  dims() { const p = this.photo; if (!p) return [1, 1]; const c = devFull(p.develop).crop; return [p.w * c.w, p.h * c.h]; }
  fit() { const [w, hh] = this.dims(); return Math.min((this.el.clientWidth - 24) / w, (this.el.clientHeight - 24) / hh) || 1; }
  scale() { return this.zoom === 'fit' ? this.fit() : this.zoom; }
  rect() { const [w, hh] = this.dims(), s = this.scale(), dw = w * s, dh = hh * s, W = this.el.clientWidth, H = this.el.clientHeight;
    const x = dw <= W ? (W - dw) / 2 : clamp(W / 2 - this.cx * dw, W - dw, 0), y = dh <= H ? (H - dh) / 2 : clamp(H / 2 - this.cy * dh, H - dh, 0); return { x, y, w: dw, h: dh }; }
  layout() {
    const r = this.rect();
    Object.assign(this.img.style, { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' });
    this.ov.width = this.el.clientWidth; this.ov.height = this.el.clientHeight;
    Overlay.draw(this.ov.getContext('2d'), r);
    this.el.classList.toggle('zoomed', this.zoom !== 'fit');
  }
  setZoom(z, e, silent) {
    const was = this.zoom;
    if (e && z !== 'fit') { const b = this.el.getBoundingClientRect(), r = this.rect(); this.cx = clamp((e.clientX - b.left - r.x) / r.w, 0, 1); this.cy = clamp((e.clientY - b.top - r.y) / r.h, 0, 1); }
    this.zoom = z === 'fit' || z <= this.fit() * 1.01 ? 'fit' : z;
    this.layout();
    if ((was === 'fit') !== (this.zoom === 'fit') || (this.zoom !== 'fit' && this.zoom > 0.6)) this.show(this.photo);
    if (!silent && this.opts.onview) this.opts.onview(this);
  }
  /* trackpad: a pinch zooms about the pointer, two fingers pan */
  gesture(e) {
    const b = this.el.getBoundingClientRect(), r = this.rect(), px = e.clientX - b.left, py = e.clientY - b.top;
    if (e.ctrlKey) {
      const u = (px - r.x) / r.w, v = (py - r.y) / r.h, z = Math.min(8, this.scale() * Math.exp(-e.deltaY * .01)), [w, hh] = this.dims();
      this.zoom = e.deltaY > 0 && z <= this.fit() * 1.01 ? 'fit' : z;
      this.cx = clamp(u + (b.width / 2 - px) / (w * z), 0, 1); this.cy = clamp(v + (b.height / 2 - py) / (hh * z), 0, 1);
    } else if (this.zoom !== 'fit') { this.cx = clamp(this.cx + e.deltaX / r.w, 0, 1); this.cy = clamp(this.cy + e.deltaY / r.h, 0, 1); }
    else return;
    this.layout(); this.opts.onview && this.opts.onview(this);
    (this.sharpen || (this.sharpen = debounce(() => this.show(this.photo), 180)))();
  }
  down(e) {
    if (e.button) return;
    if (Overlay.grab(e, this.rect(), () => this.layout())) return;
    const sx = e.clientX, sy = e.clientY, r = this.rect(), cx0 = this.cx, cy0 = this.cy; let moved = false;
    const move = ev => { if (Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) > 3) moved = true; if (this.zoom === 'fit') return; this.cx = clamp(cx0 - (ev.clientX - sx) / r.w, 0, 1); this.cy = clamp(cy0 - (ev.clientY - sy) / r.h, 0, 1); this.layout(); this.opts.onview && this.opts.onview(this); };
    const up = ev => { removeEventListener('mousemove', move); removeEventListener('mouseup', up); if (!moved) { this.opts.onclick ? this.opts.onclick(ev) : this.setZoom(this.zoom === 'fit' ? 1 : 'fit', ev); } };
    addEventListener('mousemove', move); addEventListener('mouseup', up);
  }
}

function drawHistogram(cv, H) {
  const ctx = cv.getContext('2d'), W = cv.width, Hh = cv.height;
  ctx.clearRect(0, 0, W, Hh); ctx.fillStyle = Theme.css('--input'); ctx.fillRect(0, 0, W, Hh);
  if (!H) return;
  let mx = 1; for (const k of 'rgb') for (let i = 2; i < 254; i++) mx = Math.max(mx, H[k][i]);
  ctx.globalCompositeOperation = 'lighter';
  for (const [k, col] of [['r', '#d23c3c'], ['g', '#3cb44a'], ['b', '#3c64d2']]) {
    ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(0, Hh);
    for (let i = 0; i < 256; i++) ctx.lineTo(i / 255 * W, Hh - Math.min(1, Math.pow(H[k][i] / mx, 0.6)) * (Hh - 2));
    ctx.lineTo(W, Hh); ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
}
function histogramOf(img) {
  const c = h('canvas', { width: 160, height: Math.max(1, Math.round(160 * img.naturalHeight / (img.naturalWidth || 1))) }), x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(img, 0, 0, c.width, c.height);
  const d = x.getImageData(0, 0, c.width, c.height).data, H = { r: new Uint32Array(256), g: new Uint32Array(256), b: new Uint32Array(256) };
  for (let i = 0; i < d.length; i += 4) { H.r[d[i]]++; H.g[d[i + 1]]++; H.b[d[i + 2]]++; }
  return H;
}

/* Spray-can tool: click or drag across thumbnails to apply one thing. */
const Painter = {
  on: false, mode: 'keywords', value: { keywords: '', label: 'red', flag: 1, rating: 3, metadata: '', settings: '', rotation: 'cw', target: '' }, done: new Set(),
  modes: [['keywords', 'Keywords'], ['label', 'Label'], ['flag', 'Flag'], ['rating', 'Rating'], ['metadata', 'Metadata'], ['settings', 'Settings'], ['rotation', 'Rotation'], ['target', 'Target Collection']],
  toggle(on) { this.on = on ?? !this.on; document.body.classList.toggle('painting', this.on); Lib.toolbar(); },
  async apply(p, erase) {
    if (this.done.has(p.id)) return;
    this.done.add(p.id);
    const v = this.value[this.mode], ids = [p.id];
    switch (this.mode) {
      case 'keywords': { const ks = String(v).split(',').map(s => s.trim()).filter(Boolean); if (!ks.length) return UI.toast('Type the keywords to paint first'); await App.assignKeywords(ids, erase ? ks.map(k => [...App.keywords.values()].find(x => x.name.toLowerCase() === k.split('>').pop().trim().toLowerCase())?.id).filter(Boolean) : ks, erase); break; }
      case 'label': App.setMeta(ids, { label: erase ? '' : v }, true); break;
      case 'flag': App.setMeta(ids, { flag: erase ? 0 : +v }, true); break;
      case 'rating': App.setMeta(ids, { rating: erase ? 0 : +v }, true); break;
      case 'metadata': { const pre = App.conf('metadata_presets', {})[v]; if (!pre) return UI.toast('Choose a metadata preset to paint'); const { title, caption, ...iptc } = pre; App.setMeta(ids, { ...(title ? { title } : {}), ...(caption ? { caption } : {}), iptc }, true); break; }
      case 'settings': { const pre = Dev.presets()[v]; if (!pre && !erase) return UI.toast('Choose a develop preset to paint'); await Dev.adjustMany(ids, s => (erase ? clone(DEFAULTS) : Object.assign(s, clone(pre))), 'Painted preset'); break; }
      case 'rotation': await Lib.rotate(v, ids); break;
      case 'target': await (App.cget('target', null) && App.collections.get(App.cget('target')) ? App.collectionToggle(App.cget('target'), ids, !erase) : App.quickToggle(ids)); break;
    }
  },
  options() {
    const v = this.value, set = (k, val) => { v[k] = val; };
    const sel = (k, opts) => h('select', { onchange: e => set(k, opts[e.target.selectedIndex][0]) }, opts.map(([val, l]) => h('option', { selected: String(v[k]) === String(val) }, l)));
    switch (this.mode) {
      case 'keywords': return h('input', { type: 'text', class: 'paint-kw', placeholder: 'keywords, comma separated', value: v.keywords, oninput: e => set('keywords', e.target.value) });
      case 'label': return sel('label', Object.keys(LABELS).map(l => [l, l[0].toUpperCase() + l.slice(1)]));
      case 'flag': return sel('flag', [[1, 'Flagged'], [0, 'Unflagged'], [-1, 'Rejected']]);
      case 'rating': return sel('rating', [1, 2, 3, 4, 5].map(n => [n, '★'.repeat(n)]));
      case 'metadata': return sel('metadata', [['', 'Choose preset…'], ...Object.keys(App.conf('metadata_presets', {})).map(n => [n, n])]);
      case 'settings': return sel('settings', [['', 'Choose preset…'], ...Object.keys(Dev.presets()).map(n => [n, n])]);
      case 'rotation': return sel('rotation', [['ccw', 'Rotate Left (CCW)'], ['cw', 'Rotate Right (CW)'], ['fliph', 'Flip Horizontal'], ['flipv', 'Flip Vertical']]);
      default: return h('span', { class: 'dim' }, App.collections.get(App.cget('target', null))?.name || 'Quick Collection');
    }
  },
};

const Lib = {
  id: 'library', name: 'Library', view: 'grid', size: 170, cells: new Map(), compare: { select: null, candidate: null, link: true },
  keys: {
    G: 'view.grid', E: 'view.loupe', C: 'view.compare', N: 'view.survey', O: 'view.people', Enter: 'view.loupe', Space: () => Lib.setView(Lib.view === 'loupe' ? 'grid' : 'loupe'),
    Escape: () => (Painter.on ? Painter.toggle(false) : Lib.setView('grid')), '\\': () => Lib.toggleFilterBar(), '=': () => Lib.setSize(Lib.size + 20), '-': () => Lib.setSize(Lib.size - 20), I: 'view.info',
    ArrowRight: e => Lib.arrow(1, e), ArrowLeft: e => Lib.arrow(-1, e), ArrowDown: e => Lib.arrow(Lib.view === 'grid' ? Lib.cols : 1, e), ArrowUp: e => Lib.arrow(Lib.view === 'grid' ? -Lib.cols : -1, e),
    'Shift+ArrowRight': e => Lib.arrow(1, e), 'Shift+ArrowLeft': e => Lib.arrow(-1, e), Home: () => App.list[0] && App.select(App.list[0].id), End: () => App.list.length && App.select(App.list[App.list.length - 1].id),
  },
  init(el) {
    this.el = el; this.size = App.pref('thumbSize', 170);
    this.filterEl = h('div', { id: 'lib-filter' });
    this.gridEl = h('div', { class: 'lib-view grid', onscroll: () => this.drawGrid() }, this.spacer = h('div', { class: 'grid-space' }));
    this.loupeEl = h('div', { class: 'lib-view' });
    this.compareEl = h('div', { class: 'lib-view compare' });
    this.surveyEl = h('div', { class: 'lib-view survey' });
    this.peopleEl = h('div', { class: 'lib-view people' });
    this.tb = h('div', { class: 'toolbar' });
    el.center.append(this.filterEl, h('div', { id: 'lib-views' }, this.gridEl, this.loupeEl, this.compareEl, this.surveyEl, this.peopleEl), this.tb);
    this.loupe = new LoupeView(this.loupeEl, { ondbl: () => this.setView('grid') });
    const sync = v => { if (!this.compare.link) return; const o = v === this.cmpA ? this.cmpB : this.cmpA; o.cx = v.cx; o.cy = v.cy; o.setZoom(v.zoom, null, true); o.layout(); };
    this.cmpA = new LoupeView(this.compareEl, { label: 'Select', onview: sync }); this.cmpB = new LoupeView(this.compareEl, { label: 'Candidate', onview: sync });
    new ResizeObserver(() => { if (this.view === 'grid') this.layoutGrid(); if (this.view === 'survey') this.drawSurvey(); }).observe(this.gridEl.parentNode);
    this.gridEl.addEventListener('wheel', e => { if (!e.ctrlKey || !Modes.trackpad) return; e.preventDefault(); this.pinch = clamp((Math.round(this.pinch) === this.size ? this.pinch : this.size) * Math.exp(-e.deltaY * .01), 80, 420); this.setSize(Math.round(this.pinch)); }, { passive: false });   // trackpad: pinch resizes thumbnails
    this.gridEl.addEventListener('mousedown', e => { if (e.target === this.gridEl || e.target === this.spacer) App.selectNone(); });
    App.on('list', () => { this.cells.clear(); this.spacer.replaceChildren(); this.layoutGrid(); this.refreshView(); });
    App.on('selection', () => { this.markSelection(); this.refreshView(); this.scrollToActive(); });
    App.on('meta', ids => { for (const id of ids || []) { const c = this.cells.get(id); if (c) { c.remove(); this.cells.delete(id); } } this.drawGrid(); if (this.view !== 'grid') this.refreshView(true); });
    App.on('thumb', id => { const c = this.cells.get(id); if (c) { c.remove(); this.cells.delete(id); this.drawGrid(); } if (this.view !== 'grid' && App.selection.has(id)) this.refreshView(true); });
    App.on('filter', () => this.drawFilterBar());
    App.on('catalog', () => { this.drawFilterBar(); Panels.refreshAll(); });
    addEventListener('mouseup', () => Painter.done.clear());
    Panels.build(el);
    this.drawFilterBar(); this.toolbar(); this.setView('grid');
  },
  show() { this.layoutGrid(); this.refreshView(); },
  arrow(d, e) { if (this.view === 'compare') { this.compareStep(Math.sign(d)); return; } App.step(d, e); },
  setSize(v) { this.size = clamp(v, 80, 420); App.setPref('thumbSize', this.size); this.cells.clear(); this.spacer.replaceChildren(); this.layoutGrid(); this.toolbar(); },
  setView(v) {
    if (v === 'compare') {
      const sel = App.selected(), i = App.list.findIndex(p => p.id === App.active);
      this.compare.select = App.active; this.compare.candidate = (sel.find(p => p.id !== App.active) || App.list[i + 1] || App.list[i - 1] || {}).id ?? null;
    }
    this.view = v;
    for (const [k, el] of [['grid', this.gridEl], ['loupe', this.loupeEl], ['compare', this.compareEl], ['survey', this.surveyEl], ['people', this.peopleEl]]) el.classList.toggle('on', k === v);
    this.filterEl.style.display = v === 'grid' && App.pref('filterBar', true) ? '' : 'none';
    this.toolbar();
    if (v === 'grid') { this.layoutGrid(); this.scrollToActive(); }
    this.refreshView();
  },
  refreshView(force) {
    if (App.module !== 'library') return;
    if (this.view === 'loupe') { if (force || this.loupe.photo !== App.cur()) this.loupe.show(App.cur()); else this.loupe.drawInfo(); }
    else if (this.view === 'compare') { this.cmpA.show(App.photo(this.compare.select)); this.cmpB.show(App.photo(this.compare.candidate)); }
    else if (this.view === 'survey') this.drawSurvey();
    else if (this.view === 'people') People.draw(this.peopleEl);
  },
  compareStep(d) { const i = App.list.findIndex(p => p.id === this.compare.candidate); let n = App.list[clamp(i + d, 0, App.list.length - 1)]; if (n && n.id === this.compare.select) n = App.list[clamp(i + 2 * d, 0, App.list.length - 1)]; if (n) { this.compare.candidate = n.id; this.refreshView(); this.toolbar(); } },

  /* ---- grid (virtualised) */
  layoutGrid() {
    if (this.view !== 'grid' || !this.gridEl.clientWidth) return;
    const W = this.gridEl.clientWidth - 14;
    this.cols = Math.max(1, Math.floor(W / (this.size + 14))); this.cw = Math.floor(W / this.cols); this.ch = this.size + 46;
    this.spacer.style.height = Math.ceil(App.list.length / this.cols) * this.ch + 8 + 'px';
    for (const c of this.cells.values()) c.remove();
    this.cells.clear();
    this.drawGrid();
  },
  drawGrid() {
    if (this.view !== 'grid' || !this.cols) return;
    const top = this.gridEl.scrollTop, r0 = Math.max(0, Math.floor(top / this.ch) - 1), r1 = Math.ceil((top + this.gridEl.clientHeight) / this.ch) + 1;
    const keep = new Set();
    for (let i = r0 * this.cols; i < Math.min(App.list.length, r1 * this.cols); i++) {
      const p = App.list[i]; keep.add(p.id);
      let c = this.cells.get(p.id);
      if (!c) { c = this.cell(p, i); this.cells.set(p.id, c); this.spacer.append(c); }
      Object.assign(c.style, { left: (i % this.cols) * this.cw + 4 + 'px', top: Math.floor(i / this.cols) * this.ch + 4 + 'px', width: this.cw - 6 + 'px', height: this.ch - 6 + 'px' });
    }
    for (const [id, c] of this.cells) if (!keep.has(id)) { c.remove(); this.cells.delete(id); }
  },
  badges(p) {
    const out = [];
    if (p.missing) out.push(h('b', { class: 'bd miss', title: p.smart ? 'Original offline — using Smart Preview' : 'Original file is missing' }, '!'));
    if (p.smart) out.push(h('b', { class: 'bd', title: 'Has Smart Preview' }, '▣'));
    if (p.keywords.length) out.push(h('b', { class: 'bd', title: 'Keywords: ' + App.kwNames(p).join(', ') }, '☰'));
    if (p.gps) out.push(h('b', { class: 'bd', title: 'Has GPS location' }, '⌖'));
    if (App.isEdited(p)) out.push(h('b', { class: 'bd', title: 'Has develop adjustments' }, '±'));
    const c = (p.develop || {}).crop; if (c && (c.w < 0.999 || c.h < 0.999 || c.angle)) out.push(h('b', { class: 'bd', title: 'Cropped' }, '⧉'));
    return out;
  },
  cell(p, i) {
    const sel = App.selection.has(p.id);
    const stars = h('span', { class: 'stars' }, [1, 2, 3, 4, 5].map(n => h('i', { class: n <= p.rating ? 'on' : '', onclick: e => { e.stopPropagation(); App.setMeta(App.selection.has(p.id) ? App.selIds() : [p.id], { rating: p.rating === n ? 0 : n }); } }, '★')));
    const flag = h('b', { class: 'flag f' + p.flag, title: 'Flag (click to cycle)', onclick: e => { e.stopPropagation(); App.setMeta([p.id], { flag: p.flag === 1 ? 0 : 1 }); } }, p.flag === -1 ? '⚑' : '⚑');
    const el = h('div', { class: 'cell' + (sel ? ' sel' : '') + (p.id === App.active ? ' act' : '') + (p.flag === -1 ? ' rej' : '') + (p.label ? ' lab' : ''), draggable: true, data: { id: p.id },
      style: p.label ? { '--lab': LABELS[p.label] || '#888' } : null,
      onmousedown: e => { if (Painter.on && !e.button) { e.preventDefault(); Painter.apply(p, e.altKey); return; } if (e.button === 2 && sel) return; if (!e.button || e.button === 2) App.select(p.id, e.button === 2 ? null : (sel && !e.ctrlKey && !e.shiftKey ? { keepMulti: true } : e)); },
      onmouseup: e => { if (!e.button && !Painter.on && !e.ctrlKey && !e.shiftKey && App.selection.size > 1 && !this.dragging) App.select(p.id); },
      onmouseenter: e => { if (Painter.on && e.buttons === 1) Painter.apply(p, e.altKey); },
      ondblclick: () => !Painter.on && this.setView('loupe'),
      oncontextmenu: e => Lib.photoMenu(e),
      ondragstart: e => { if (Painter.on) return e.preventDefault(); this.dragging = true; e.dataTransfer.setData('text/opia-photos', JSON.stringify(App.selIds())); e.dataTransfer.effectAllowed = 'copyMove'; },
      ondragend: () => { this.dragging = false; },
    },
      h('div', { class: 'c-top' }, h('span', { class: 'idx' }, i + 1), h('span', { class: 'fn', title: p.path }, p.filename + (p.copy_name ? ' • ' + p.copy_name : ''))),
      h('div', { class: 'c-img' }, h('img', { src: App.thumb(p), draggable: false, loading: 'lazy', alt: p.filename }),
        flag, p._stackN > 1 ? h('b', { class: 'stack', title: 'Stack of ' + p._stackN + ' (click to expand/collapse)', onclick: e => { e.stopPropagation(); Lib.toggleStack(p); } }, p._stackI === 0 ? p._stackN : (p._stackI + 1) + '/' + p._stackN) : null,
        p.master_id ? h('b', { class: 'vc', title: 'Virtual copy' }) : null,
        h('b', { class: 'tgt' + (App.inTarget(p) ? ' on' : ''), title: 'Target / Quick Collection (B)', onclick: e => { e.stopPropagation(); App.quickToggle([p.id]); } }),
        h('span', { class: 'bds' }, this.badges(p))),
      h('div', { class: 'c-bot' }, stars, h('span', { class: 'dim ex' }, p.format), p.label ? h('i', { class: 'swatch', style: { background: LABELS[p.label] }, title: p.label }) : null));
    return el;
  },
  markSelection() { for (const [id, c] of this.cells) { c.classList.toggle('sel', App.selection.has(id)); c.classList.toggle('act', id === App.active); } },
  scrollToActive() {
    if (this.view !== 'grid' || !this.cols) return;
    const i = App.list.findIndex(p => p.id === App.active); if (i < 0) return;
    const y = Math.floor(i / this.cols) * this.ch, g = this.gridEl;
    if (y < g.scrollTop) g.scrollTop = y; else if (y + this.ch > g.scrollTop + g.clientHeight) g.scrollTop = y + this.ch - g.clientHeight;
  },
  toggleStack(p) { const s = p.stack_id; App.expanded.has(s) ? App.expanded.delete(s) : App.expanded.add(s); App.refreshList(true); },

  /* ---- survey */
  drawSurvey() {
    const ps = App.selected(), el = this.surveyEl, n = ps.length || 1, W = el.clientWidth, H = el.clientHeight;
    let best = { s: 0, cols: 1 };
    for (let cols = 1; cols <= n; cols++) { const rows = Math.ceil(n / cols), s = Math.min(W / cols, H / rows * 1.4); if (s > best.s) best = { s, cols }; }
    const rows = Math.ceil(n / best.cols);
    el.style.gridTemplateColumns = `repeat(${best.cols}, 1fr)`; el.style.gridTemplateRows = `repeat(${rows}, 1fr)`;
    el.replaceChildren(...ps.map(p => {
      const img = h('img', { src: App.thumb(p), draggable: false, alt: p.filename });
      Render.url(p, 1280).then(u => { img.src = u; }).catch(() => {});
      return h('div', { class: 'sv' + (p.id === App.active ? ' act' : ''), onclick: () => { App.active = p.id; App.emit('selection'); }, oncontextmenu: e => Lib.photoMenu(e) }, img,
        h('div', { class: 'sv-bar' }, h('span', { class: 'stars' }, [1, 2, 3, 4, 5].map(k => h('i', { class: k <= p.rating ? 'on' : '', onclick: e => { e.stopPropagation(); App.setMeta([p.id], { rating: p.rating === k ? 0 : k }, true); } }, '★'))),
          h('b', { class: 'flag f' + p.flag, onclick: e => { e.stopPropagation(); App.setMeta([p.id], { flag: p.flag === 1 ? 0 : 1 }, true); } }, '⚑'),
          p.label ? h('i', { class: 'swatch', style: { background: LABELS[p.label] } }) : null, h('span', { class: 'fn' }, p.filename),
          h('b', { class: 'sv-x', title: 'Remove from Survey', onclick: e => { e.stopPropagation(); if (App.selection.size > 1) { App.selection.delete(p.id); if (App.active === p.id) App.active = [...App.selection][0]; App.emit('selection'); } } }, '×')));
    }));
    if (!ps.length) el.append(h('div', { class: 'empty' }, 'Select two or more photos to survey them side by side.'));
  },

  /* ---- toolbar */
  toolbar() {
    const v = this.view, p = App.cur(), tb = this.tb;
    const vb = (id, label, key, adv) => h('button', { class: 'tbtn' + (v === id ? ' on' : '') + (adv ? ' adv' : ''), title: label + ' (' + key + ')', onclick: () => this.setView(id) }, label);
    const sortOpts = [['capture_time', 'Capture Time'], ['import_time', 'Added Order'], ['filename', 'File Name'], ['rating', 'Rating'], ['flag', 'Pick'], ['label', 'Label Color'], ['format', 'File Type'], ['pixels', 'Megapixels'], ['filesize', 'File Size'], ['custom', 'Custom Order']];
    tb.replaceChildren(
      h('span', { class: 'tb-group' }, vb('grid', 'Grid', 'G'), vb('loupe', 'Loupe', 'E'), vb('compare', 'Compare', 'C', 1), vb('survey', 'Survey', 'N', 1), vb('people', 'People', 'O', 1)),
      v === 'grid' ? h('span', { class: 'tb-group adv' },
        h('button', { class: 'tbtn spray' + (Painter.on ? ' on' : ''), title: 'Painter (spray can): click or drag over photos to apply. Alt = erase. Esc to finish.', onclick: () => Painter.toggle() }, '🖌 Painter'),
        Painter.on ? [h('select', { onchange: e => { Painter.mode = Painter.modes[e.target.selectedIndex][0]; this.toolbar(); } }, Painter.modes.map(([m, l]) => h('option', { selected: m === Painter.mode }, l))), Painter.options(), h('button', { class: 'tbtn', onclick: () => Painter.toggle(false) }, 'Done')] : null) : null,
      v === 'grid' ? h('span', { class: 'tb-group' }, h('span', { class: 'dim' }, 'Sort:'),
        h('select', { onchange: e => { App.sort.key = sortOpts[e.target.selectedIndex][0]; App.refreshList(true); } }, sortOpts.map(([k, l]) => h('option', { selected: App.sort.key === k }, l))),
        h('button', { class: 'tbtn', title: 'Sort direction', onclick: () => { App.sort.dir *= -1; App.refreshList(true); this.toolbar(); } }, App.sort.dir > 0 ? 'a→z' : 'z→a')) : null,
      v === 'compare' ? h('span', { class: 'tb-group' },
        h('label', { class: 'tb-check' }, h('input', { type: 'checkbox', checked: this.compare.link, onchange: e => { this.compare.link = e.target.checked; } }), 'Link Focus'),
        h('button', { class: 'tbtn', title: 'Swap Select and Candidate', onclick: () => { [this.compare.select, this.compare.candidate] = [this.compare.candidate, this.compare.select]; App.active = this.compare.select; this.refreshView(); } }, 'X|Y Swap'),
        h('button', { class: 'tbtn', title: 'Make the Candidate the new Select', onclick: () => { this.compare.select = this.compare.candidate; App.select(this.compare.select); this.compareStep(1); } }, 'Make Select'),
        h('button', { class: 'tbtn', onclick: () => this.compareStep(-1) }, '←'), h('button', { class: 'tbtn', onclick: () => this.compareStep(1) }, '→'),
        h('button', { class: 'tbtn', onclick: () => this.setView('loupe') }, 'Done')) : null,
      v === 'loupe' || v === 'compare' ? Overlay.controls() : null,
      v === 'people' ? h('span', { class: 'tb-group' }, h('button', { class: 'tbtn', onclick: () => People.scan() }, 'Find Faces'), h('button', { class: 'tbtn', onclick: () => People.scan(true) }, 'Re-scan Selected')) : null,
      h('span', { class: 'tb-fill' }),
      h('span', { class: 'tb-group' },
        h('button', { class: 'tbtn flag f1', title: 'Flag as Pick (P)', onclick: () => App.rate({ flag: 1 }) }, '⚑'), h('button', { class: 'tbtn', title: 'Unflag (U)', onclick: () => App.rate({ flag: 0 }) }, '⚐'),
        h('button', { class: 'tbtn flag f-1', title: 'Set as Rejected (X)', onclick: () => App.rate({ flag: -1 }) }, '⚑'),
        h('span', { class: 'stars big' }, [1, 2, 3, 4, 5].map(n => h('i', { class: p && n <= p.rating ? 'on' : '', onclick: () => App.rate({ rating: n }, true) }, '★'))),
        Object.entries(LABELS).map(([l, c]) => h('i', { class: 'swatch btn-sw' + (p && p.label === l ? ' on' : ''), style: { background: c }, title: 'Label ' + l, onclick: () => App.rate({ label: l }, true) })),
        h('button', { class: 'tbtn', title: 'Rotate left (Ctrl+[)', onclick: () => Lib.rotate('ccw') }, '↺'), h('button', { class: 'tbtn', title: 'Rotate right (Ctrl+])', onclick: () => Lib.rotate('cw') }, '↻'),
        h('label', { class: 'tb-check adv', title: 'Move to the next photo after rating, flagging or labelling' }, h('input', { type: 'checkbox', checked: App.pref('autoAdvance', false), onchange: e => App.setPref('autoAdvance', e.target.checked) }), 'Auto Advance')),
      v === 'grid' ? h('span', { class: 'tb-group' }, h('span', { class: 'dim' }, 'Thumbnails'), h('input', { type: 'range', class: 'mini', min: 80, max: 420, value: this.size, oninput: e => this.setSize(+e.target.value) })) : null);
  },

  /* ---- library filter bar: Text | Attribute | Metadata | None */
  toggleFilterBar() { App.setPref('filterBar', !App.pref('filterBar', true)); this.filterEl.style.display = this.view === 'grid' && App.pref('filterBar', true) ? '' : 'none'; },
  drawFilterBar() {
    const f = App.filter, open = this.fbOpen ??= new Set(App.pref('filterTabs', []));
    const tab = (k, l, adv) => h('a', { class: (open.has(k) ? 'on' : '') + (adv ? ' adv' : ''), onclick: e => { if (!e.shiftKey && !e.ctrlKey) { const had = open.has(k) && open.size === 1; open.clear(); if (!had) open.add(k); } else open.has(k) ? open.delete(k) : open.add(k); App.setPref('filterTabs', [...open]); this.drawFilterBar(); } }, l);
    const fire = () => { App.refreshList(true); App.emit('filter'); };
    const rows = [];
    if (open.has('text')) {
      const fields = [['any', 'Any Searchable Field'], ['filename', 'Filename'], ['title', 'Title'], ['caption', 'Caption'], ['keywords', 'Keywords'], ['creator', 'Creator'], ['camera', 'Camera'], ['lens', 'Lens'], ['people', 'People'], ['folder', 'Folder']];
      const inp = h('input', { type: 'search', placeholder: 'Search…  (space = and, !word = exclude)', value: f.text, oninput: debounce(() => { f.text = inp.value; App.refreshList(true); App.emit('filmfilter'); }, 180) });
      rows.push(h('div', { class: 'fb-row' }, h('span', { class: 'dim' }, 'Text'), h('select', { onchange: e => { f.field = fields[e.target.selectedIndex][0]; fire(); } }, fields.map(([k, l]) => h('option', { selected: f.field === k }, l))), inp));
    }
    if (open.has('attr')) rows.push(h('div', { class: 'fb-row' }, h('span', { class: 'dim' }, 'Attribute'), FilterUI.attributes(fire, true)));
    if (open.has('meta')) {
      if (!f.meta.length) f.meta = ['month', 'camera', 'lens', 'labelname'].map(field => ({ field, values: new Set() }));
      const all = [['month', 'Date'], ['year', 'Year'], ['camera', 'Camera'], ['lens', 'Lens'], ['labelname', 'Label'], ['flagname', 'Flag'], ['stars', 'Rating'], ['format', 'File Type'], ['iso', 'ISO Speed'], ['aperture', 'Aperture'], ['focal', 'Focal Length'], ['keywords', 'Keyword'], ['aspect', 'Aspect Ratio'], ['creator', 'Creator'], ['city', 'City'], ['country', 'Country'], ['people', 'People']];
      const base = App.sourceIds();
      rows.push(h('div', { class: 'fb-meta' }, f.meta.map((m, ci) => {
        const saved = f.meta.slice(); const counts = new Map();
        for (const p of base) { if (!App.passes(p, ci)) continue; const vals = m.field === 'keywords' || m.field === 'people' ? (String(App.field(p, m.field)).split(', ').filter(Boolean)) : [String(App.field(p, m.field) || 'Unknown')]; if (!vals.length) vals.push('None'); for (const v of vals) counts.set(v, (counts.get(v) || 0) + 1); }
        void saved;
        const keys = [...counts.keys()].sort((a, b) => (isNaN(a) || isNaN(b) ? a.localeCompare(b) : a - b));
        return h('div', { class: 'fm-col' },
          h('select', { class: 'fm-h', onchange: e => { m.field = all[e.target.selectedIndex][0]; m.values.clear(); fire(); } }, all.map(([k, l]) => h('option', { selected: m.field === k }, l))),
          h('div', { class: 'fm-list' }, h('div', { class: 'fm-i' + (m.values.size ? '' : ' on'), onclick: () => { m.values.clear(); for (const later of f.meta.slice(ci + 1)) later.values.clear(); fire(); } }, h('span', {}, 'All (' + keys.length + ')'), h('b', {}, [...counts.values()].reduce((a, b) => a + b, 0))),
            keys.map(k => h('div', { class: 'fm-i' + (m.values.has(k) ? ' on' : ''), onclick: e => { if (!(e.ctrlKey || e.metaKey)) { const only = m.values.has(k) && m.values.size === 1; m.values.clear(); if (!only) m.values.add(k); } else m.values.has(k) ? m.values.delete(k) : m.values.add(k); for (const later of f.meta.slice(ci + 1)) later.values.clear(); fire(); } }, h('span', {}, k), h('b', {}, counts.get(k))))));
      })));
    }
    this.filterEl.replaceChildren(h('div', { class: 'fb-tabs' }, h('span', { class: 'dim' }, 'Library Filter:'), tab('text', 'Text'), tab('attr', 'Attribute'), tab('meta', 'Metadata', 1),
      h('a', { class: open.size ? '' : 'on', onclick: () => { open.clear(); FilterUI.clear(); App.setPref('filterTabs', []); fire(); } }, 'None'), h('span', { class: 'tb-fill' }), FilterUI.presets(fire)), ...rows);
  },

  /* ---- actions */
  async rotate(op, ids) {
    ids = ids || App.selIds();
    const orients = [], items = [];
    for (const id of ids) {
      const p = App.photo(id); let r = p.orient & 3, f = p.orient & 4;
      if (op === 'cw') r = (r + 1) & 3; else if (op === 'ccw') r = (r + 3) & 3; else if (op === 'fliph') { r = (4 - r) & 3; f ^= 4; } else { r = (6 - r) & 3; f ^= 4; }
      orients.push(r | f);
      if ((op === 'cw' || op === 'ccw')) [p.w, p.h] = [p.h, p.w];
      p.orient = r | f; p.ver++;
      if (p.develop) { p.develop = Dev.transformSettings(p.develop, op); items.push({ id, develop: p.develop }); }
    }
    await api('photo_rotate', { ids, orients });
    if (items.length) await api('photos_develop', { items });
    App.emit('meta', ids);
    Render.thumbs(ids.filter(id => App.isEdited(App.photo(id))));
    App.emit('rotated', ids);
  },
  async virtualCopy() {
    const ids = App.selIds(); if (!ids.length) return;
    const rows = await api('photos_virtual_copy', { ids });
    App.addPhotos(rows);
    for (const r of rows) for (const [cid, list] of App.colPhotos) if (App.source.type === 'collection' && App.source.id === cid) { await api('collection_add', { id: cid, photo_ids: [r.id] }); list.push(r.id); }
    App.refreshList(true); App.select(rows[0].id);
    Render.thumbs(rows.map(r => r.id));
    UI.toast(rows.length + ' virtual cop' + (rows.length > 1 ? 'ies' : 'y') + ' created');
  },
  async stack() {
    const ps = App.selected(); if (ps.length < 2) return UI.toast('Select two or more photos to stack');
    const ids = [App.active, ...ps.map(p => p.id).filter(i => i !== App.active)];
    const sid = await api('photos_stack', { ids });
    ids.forEach((id, n) => { const p = App.photo(id); p.stack_id = sid; p.stack_pos = n; });
    App.refreshList(true); UI.toast('Stacked ' + ids.length + ' photos');
  },
  async unstack() {
    const ids = App.selIds(), sids = new Set(ids.map(i => App.photo(i).stack_id).filter(Boolean)); if (!sids.size) return;
    await api('photos_unstack', { ids });
    for (const p of App.photos.values()) if (sids.has(p.stack_id)) { p.stack_id = null; p.stack_pos = 0; }
    App.refreshList(true);
  },
  async autoStack() {
    const gap = +(await UI.prompt('Auto-Stack by Capture Time', 'Seconds between stacks', '3')); if (!gap) return;
    const ps = [...App.sourceIds()].filter(p => !p.stack_id).sort((a, b) => a.capture_time - b.capture_time); let run = [], made = 0;
    const flush = async () => { if (run.length > 1) { const ids = run.map(p => p.id), sid = await api('photos_stack', { ids }); run.forEach((p, n) => { p.stack_id = sid; p.stack_pos = n; }); made++; } run = []; };
    for (const p of ps) { if (run.length && p.capture_time - run[run.length - 1].capture_time > gap) await flush(); run.push(p); }
    await flush(); App.refreshList(true); UI.toast(made + ' stack' + (made === 1 ? '' : 's') + ' created');
  },
  async remove() {
    const ids = App.selIds(); if (!ids.length) return;
    if (App.source.type === 'collection' && App.collections.get(App.source.id)?.type === 'collection') return App.collectionToggle(App.source.id, ids);
    const masters = ids.filter(i => !App.photo(i).master_id).length;
    const choice = await UI.dialog({ title: 'Remove Photos', width: 460, body: h('p', { class: 'msg' }, `Remove ${ids.length} selected photo${ids.length > 1 ? 's' : ''} from the catalog?` + (masters ? ' "Delete from Disk" also moves the original files to the Trash.' : ' Virtual copies only exist in the catalog.')),
      buttons: [['Cancel', null], masters ? ['Delete from Disk', 'disk'] : null, ['Remove from Catalog', 'cat', 'primary']].filter(Boolean) });
    if (!choice) return;
    const r = await api('photos_remove', { ids, delete_files: choice === 'disk' });
    for (const id of r.removed) App.photos.delete(id);
    App.refreshList(); Panels.refreshAll();
    UI.toast(r.removed.length + ' removed' + (r.trashed ? ', ' + r.trashed + ' file(s) moved to the Trash' : ''));
  },
  photoMenu(e) {
    e.preventDefault();
    const n = App.selIds().length, c = id => { const k = App.commands[id]; return k ? { label: k.label, key: k.key, run: () => App.run(id) } : null; };
    const eds = App.conf('editors', []);
    UI.menu(e.clientX, e.clientY, [
      c('view.loupe'), c('go.develop'), c('view.compare'), c('view.survey'), '-',
      { label: 'Set Flag', sub: [c('flag.pick'), c('flag.none'), c('flag.reject')] },
      { label: 'Set Rating', sub: [0, 1, 2, 3, 4, 5].map(r => ({ label: r ? '★'.repeat(r) : 'None', key: String(r), run: () => App.rate({ rating: r }) })) },
      { label: 'Set Color Label', sub: [...Object.keys(LABELS).map(l => ({ label: l[0].toUpperCase() + l.slice(1), run: () => App.rate({ label: l }) })), { label: 'None', run: () => App.rate({ label: '' }) }] }, '-',
      c('col.quick'), c('photo.vcopy'), { label: 'Stacking', sub: [c('stack.group'), c('stack.ungroup'), c('stack.toggle'), c('stack.auto')] }, '-',
      { label: 'Develop Settings', sub: [c('dev.copy'), c('dev.paste'), c('dev.sync'), c('dev.reset')] },
      { label: 'Metadata', sub: [c('meta.xmpwrite'), c('meta.xmpread'), c('meta.exif')] },
      { label: 'Edit In', sub: [...eds.map(ed => ({ label: ed.name, run: () => Ext.editIn(ed) })), eds.length ? '-' : null, { label: 'Configure External Editors…', run: () => App.run('prefs.editors') }] },
      { label: 'Photo Merge', sub: [c('merge.pano'), c('merge.hdr')] }, c('file.export'), c('photo.rename'), c('photo.dng'), c('photo.smart'), '-',
      { label: 'Show in Finder', run: () => api('fs_reveal', { path: App.cur().path }) }, App.cur() && App.cur().missing ? c('photo.locate') : null,
      { label: n > 1 ? `Remove ${n} Photos…` : 'Remove Photo…', key: 'Delete', run: () => Lib.remove() }]);
  },
};

/* Attribute filter widgets, shared by the Library Filter bar and the filmstrip. */
const FilterUI = {
  clear() { const f = App.filter; f.text = ''; f.flags.clear(); f.rating = 0; f.ratingOp = '>='; f.labels.clear(); f.kind.clear(); f.edited = null; f.meta.forEach(m => m.values.clear()); },
  attributes(fire, full) {
    const f = App.filter, tog = (set, v) => { set.has(v) ? set.delete(v) : set.add(v); fire(); };
    const ops = ['>=', '<=', '='];
    return h('span', { class: 'fattr' },
      h('span', { class: 'fa-g', title: 'Filter by flag status' }, [[1, 'f1', 'Flagged'], [0, 'f0', 'Unflagged'], [-1, 'f-1', 'Rejected']].map(([v, c, t]) => h('b', { class: 'flag ' + c + (f.flags.has(v) ? ' on' : ''), title: t, onclick: () => tog(f.flags, v) }, v === 0 ? '⚐' : '⚑'))),
      h('span', { class: 'fa-g' }, h('a', { class: 'op', title: 'Rating is greater / less than or equal to / equal to', onclick: () => { f.ratingOp = ops[(ops.indexOf(f.ratingOp) + 1) % 3]; fire(); } }, { '>=': '≥', '<=': '≤', '=': '=' }[f.ratingOp]),
        h('span', { class: 'stars' }, [1, 2, 3, 4, 5].map(n => h('i', { class: n <= f.rating ? 'on' : '', onclick: () => { f.rating = f.rating === n ? 0 : n; fire(); } }, '★')))),
      h('span', { class: 'fa-g' }, [...Object.entries(LABELS), ['none', '#666']].map(([l, c]) => h('i', { class: 'swatch btn-sw' + (f.labels.has(l) ? ' on' : ''), style: { background: c }, title: l === 'none' ? 'No label' : l, onclick: () => tog(f.labels, l) }))),
      full ? h('span', { class: 'fa-g' }, h('a', { class: 'kind' + (f.kind.has('master') ? ' on' : ''), title: 'Master photos', onclick: () => tog(f.kind, 'master') }, 'Masters'), h('a', { class: 'kind' + (f.kind.has('virtual') ? ' on' : ''), title: 'Virtual copies', onclick: () => tog(f.kind, 'virtual') }, 'Virtual Copies'),
        h('a', { class: 'kind' + (f.edited === true ? ' on' : ''), onclick: () => { f.edited = f.edited === true ? null : true; fire(); } }, 'Edited'), h('a', { class: 'kind' + (f.edited === false ? ' on' : ''), onclick: () => { f.edited = f.edited === false ? null : false; fire(); } }, 'Unedited')) : null);
  },
  snapshot() { const f = App.filter; return { text: f.text, field: f.field, flags: [...f.flags], rating: f.rating, ratingOp: f.ratingOp, labels: [...f.labels], kind: [...f.kind], edited: f.edited, meta: f.meta.map(m => ({ field: m.field, values: [...m.values] })) }; },
  load(s) { const f = App.filter; Object.assign(f, { on: true, text: s.text || '', field: s.field || 'any', flags: new Set(s.flags || []), rating: s.rating || 0, ratingOp: s.ratingOp || '>=', labels: new Set(s.labels || []), kind: new Set(s.kind || []), edited: s.edited ?? null, meta: (s.meta || []).map(m => ({ field: m.field, values: new Set(m.values) })) }); },
  builtin: { Flagged: { flags: [1] }, 'Unflagged & Unrated': { flags: [0], ratingOp: '=', rating: 0 }, Rated: { rating: 1 }, 'Rejected': { flags: [-1] }, 'Edited': { edited: true }, 'Virtual Copies': { kind: ['virtual'] } },
  presets(fire) {
    const all = () => ({ ...this.builtin, ...App.conf('filter_presets', {}) });
    const sel = h('select', { title: 'Filter presets', onchange: async () => {
      const v = sel.value;
      if (v === '__off') { this.clear(); App.filter.on = true; }
      else if (v === '__save') { const n = await UI.prompt('Save Filter Preset', 'Preset name'); if (n) App.setConf('filter_presets', { ...App.conf('filter_presets', {}), [n]: this.snapshot() }); }
      else if (v === '__del') { const n = await UI.prompt('Delete Filter Preset', 'Name of the custom preset to delete'); const c = { ...App.conf('filter_presets', {}) }; if (n && c[n]) { delete c[n]; App.setConf('filter_presets', c); } }
      else if (all()[v]) this.load(all()[v]);
      fire();
    } }, h('option', { value: '' }, App.filterActive() ? 'Custom Filter' : 'Filters Off'), h('option', { value: '__off' }, 'Filters Off'), Object.keys(all()).map(n => h('option', { value: n }, n)), h('option', { value: '__save' }, 'Save Current Settings as New Preset…'), h('option', { value: '__del' }, 'Delete Preset…'));
    return h('span', { class: 'fpre' }, sel, h('b', { class: 'switch' + (App.filter.on ? ' on' : ''), title: 'Turn filters on or off (Ctrl+L)', onclick: () => { App.filter.on = !App.filter.on; fire(); } }));
  },
};

/* Bottom filmstrip: current source, navigation, filtering, thumbnails for every module. */
const Film = {
  cw: 96, cells: new Map(),
  init() {
    this.info = h('div', { class: 'film-info' });
    this.filt = h('div', { class: 'film-filter' });
    this.strip = h('div', { class: 'film-strip', onscroll: () => this.draw(), onwheel: e => { if (e.deltaY) { this.strip.scrollLeft += e.deltaY; e.preventDefault(); } } }, this.space = h('div', { class: 'film-space' }));
    $('#filmstrip').append(h('div', { class: 'film-head' }, this.info, h('span', { class: 'tb-fill' }), this.filt), this.strip);
    const head = () => { this.drawInfo(); this.drawFilter(); };
    App.on('list', () => { this.cells.forEach(c => c.remove()); this.cells.clear(); head(); this.draw(); });
    App.on('selection', () => { for (const [id, c] of this.cells) { c.classList.toggle('sel', App.selection.has(id)); c.classList.toggle('act', id === App.active); } this.drawInfo(); this.reveal(); });
    App.on('meta', ids => { for (const id of ids || []) { const c = this.cells.get(id); if (c) { c.remove(); this.cells.delete(id); } } this.draw(); });
    App.on('thumb', id => { const c = this.cells.get(id); if (c) { c.remove(); this.cells.delete(id); this.draw(); } });
    App.on('filter', head); App.on('filmfilter', () => this.drawFilter()); App.on('source', head);
    new ResizeObserver(() => this.draw()).observe(this.strip);
  },
  drawInfo() {
    const p = App.cur(), n = App.selection.size;
    this.info.replaceChildren(h('button', { class: 'tbtn', title: 'Previous photo', onclick: () => App.step(-1) }, '◀'), h('button', { class: 'tbtn', title: 'Next photo', onclick: () => App.step(1) }, '▶'),
      h('b', {}, App.sourceName()), h('span', { class: 'dim' }, `${App.list.length} photo${App.list.length === 1 ? '' : 's'}` + (n > 1 ? ` / ${n} selected` : '') + (p ? ' / ' + p.filename + (p.copy_name ? ' / ' + p.copy_name : '') : '')));
  },
  drawFilter() {
    const fire = () => { App.refreshList(true); App.emit('filter'); };
    this.filt.replaceChildren(h('span', { class: 'dim' }, 'Filter:'), FilterUI.attributes(fire, false), FilterUI.presets(fire));
  },
  draw() {
    const n = App.list.length, s = this.strip;
    this.space.style.width = n * this.cw + 'px';
    const i0 = Math.max(0, Math.floor(s.scrollLeft / this.cw) - 2), i1 = Math.min(n, Math.ceil((s.scrollLeft + s.clientWidth) / this.cw) + 2), keep = new Set();
    for (let i = i0; i < i1; i++) {
      const p = App.list[i]; keep.add(p.id);
      let c = this.cells.get(p.id);
      if (!c) {
        c = h('div', { class: 'fcell' + (App.selection.has(p.id) ? ' sel' : '') + (p.id === App.active ? ' act' : '') + (p.flag === -1 ? ' rej' : ''), draggable: true, style: p.label ? { '--lab': LABELS[p.label], borderBottomColor: LABELS[p.label] } : null,
          onmousedown: e => { if (e.button === 2 && App.selection.has(p.id)) return; App.select(p.id, e); }, ondblclick: () => { if (App.module === 'library') Lib.setView('loupe'); }, oncontextmenu: e => Lib.photoMenu(e),
          ondragstart: e => { e.dataTransfer.setData('text/opia-photos', JSON.stringify(App.selIds())); e.dataTransfer.effectAllowed = 'copyMove'; } },
          h('img', { src: App.thumb(p), draggable: false, alt: p.filename }), p.flag ? h('b', { class: 'flag f' + p.flag }, '⚑') : null, p.rating ? h('span', { class: 'fst' }, '★'.repeat(p.rating)) : null,
          p._stackN > 1 ? h('b', { class: 'stack' }, p._stackN) : null, p.master_id ? h('b', { class: 'vc' }) : null, App.isEdited(p) ? h('b', { class: 'bd ed' }, '±') : null);
        this.cells.set(p.id, c); this.space.append(c);
      }
      c.style.left = i * this.cw + 'px';
    }
    for (const [id, c] of this.cells) if (!keep.has(id)) { c.remove(); this.cells.delete(id); }
  },
  reveal() { const i = App.list.findIndex(p => p.id === App.active), s = this.strip; if (i < 0) return; const x = i * this.cw; if (x < s.scrollLeft) s.scrollLeft = x - 20; else if (x + this.cw > s.scrollLeft + s.clientWidth) s.scrollLeft = x + this.cw - s.clientWidth + 20; this.draw(); },
};

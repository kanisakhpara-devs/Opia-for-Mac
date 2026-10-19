'use strict';
/* Develop module: state, rendering loop, history, presets and all adjustment panels. Tools are in devtools.js. */

const GROUPS = {
  'White Balance': ['wb', 'temp', 'tint'], 'Basic Tone': ['exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks'], Presence: ['texture', 'clarity', 'dehaze', 'vibrance', 'saturation'],
  'Treatment & Profile': ['treatment', 'profile', 'bwMix'], 'Tone Curve': ['curve', 'pcHighlights', 'pcLights', 'pcDarks', 'pcShadows', 'pcSplit'], 'HSL / Color': ['hsl'], 'Color Grading': ['cg'],
  Detail: ['sharpAmount', 'sharpRadius', 'sharpDetail', 'sharpMasking', 'nrLum', 'nrLumDetail', 'nrLumContrast', 'nrColor', 'nrColorDetail', 'nrColorSmooth'],
  'Lens Corrections': ['lensProfileEnable', 'lensProfile', 'lensDistScale', 'lensVigScale', 'caRemove', 'caR', 'caB', 'defringePurple', 'defringePurpleHue', 'defringeGreen', 'defringeGreenHue', 'distortion', 'lensVignette', 'lensVigMid'],
  Transform: ['upright', 'uprightH', 'guides', 'tVertical', 'tHorizontal', 'tRotate', 'tAspect', 'tScale', 'tX', 'tY', 'constrainCrop'],
  Effects: ['vigAmount', 'vigMid', 'vigRound', 'vigFeather', 'vigHighlights', 'grain', 'grainSize', 'grainRough'],
  Calibration: ['calShadowTint', 'calRedHue', 'calRedSat', 'calGreenHue', 'calGreenSat', 'calBlueHue', 'calBlueSat'],
  Crop: ['crop', 'cropAspect'], 'Spot Removal': ['spots'], 'Red Eye': ['redeyes'], Masking: ['masks'],
};
const BUILTIN_PRESETS = {
  'Auto Punch': { contrast: 22, clarity: 18, vibrance: 22, blacks: -12, whites: 10 },
  'Soft Matte': { contrast: -18, blacks: 28, highlights: -25, saturation: -10, curve: { rgb: [[0, 22], [64, 68], [192, 196], [255, 240]], r: LINE(), g: LINE(), b: LINE() } },
  'B&W High Contrast': { treatment: 'bw', contrast: 45, clarity: 25, blacks: -20, whites: 15 },
  'B&W Soft': { treatment: 'bw', contrast: -8, highlights: -20, shadows: 20, grain: 25 },
  'Warm Sunset': { temp: 22, tint: 6, vibrance: 20, highlights: -20, cg: { ...clone(DEFAULTS.cg), highlights: { h: 40, s: 30, l: 0 }, shadows: { h: 260, s: 14, l: 0 } } },
  'Cool Blue Hour': { temp: -24, tint: -4, contrast: 12, cg: { ...clone(DEFAULTS.cg), shadows: { h: 220, s: 28, l: 0 } } },
  'Cinematic Teal & Orange': { contrast: 15, cg: { ...clone(DEFAULTS.cg), shadows: { h: 190, s: 38, l: -4 }, highlights: { h: 32, s: 34, l: 0 }, blending: 65 }, vigAmount: -18 },
  'Vintage Fade': { contrast: -10, saturation: -18, temp: 10, blacks: 30, grain: 30, vigAmount: -22, curve: { rgb: [[0, 28], [128, 128], [255, 236]], r: LINE(), g: LINE(), b: LINE() } },
  'Landscape Pop': { profile: 'landscape', dehaze: 18, clarity: 14, vibrance: 26, highlights: -35, shadows: 30 },
  'Portrait Glow': { profile: 'portrait', texture: -22, clarity: -10, shadows: 14, vibrance: 6 },
  'Sharpen – Scenic': { sharpAmount: 60, sharpRadius: 0.8, sharpDetail: 45, sharpMasking: 20 },
  'Sharpen – Faces': { sharpAmount: 35, sharpRadius: 1.4, sharpDetail: 15, sharpMasking: 60 },
  'Noise Reduction – Medium': { nrLum: 35, nrColor: 30 }, 'Grain – Heavy': { grain: 60, grainSize: 45, grainRough: 60 }, 'Vignette – Medium': { vigAmount: -30, vigMid: 45 },
};

const Dev = {
  id: 'develop', name: 'Develop', s: clone(DEFAULTS), photo: null, src: null, view: { zoom: 'fit', cx: 0.5, cy: 0.5 }, mode: 'loupe', tool: null,
  proof: { on: false, profile: 'sRGB', intent: 'perceptual', paper: false, gamut: false }, clip: false, showBefore: false, hist: [], histPos: 0, snaps: [],
  controls: [], refreshers: [], need: {}, prev: null, clipboard: null, refPhoto: null,
  WB: { asshot: { name: 'As Shot', t: 0, ti: 0 }, auto: { name: 'Auto' }, daylight: { name: 'Daylight', t: 6, ti: 0 }, cloudy: { name: 'Cloudy', t: 14, ti: 2 }, shade: { name: 'Shade', t: 24, ti: 4 },
    tungsten: { name: 'Tungsten', t: -32, ti: 0 }, fluorescent: { name: 'Fluorescent', t: -18, ti: 12 }, flash: { name: 'Flash', t: 8, ti: 0 }, custom: { name: 'Custom' } },
  keys: {
    R: () => Tools.set('crop'), Q: () => Tools.set('spot'), K: () => Tools.addMask('brush'), M: () => Tools.addMask('linear'), 'Shift+M': () => Tools.addMask('radial'), W: () => Tools.set('wb'),
    '\\': () => { Dev.showBefore = !Dev.showBefore; Dev.render(); Dev.toolbar(); }, Y: () => Dev.setMode(Dev.mode === 'before-lr' ? 'loupe' : 'before-lr'), 'Shift+Y': () => Dev.setMode(Dev.mode === 'before-split' ? 'loupe' : 'before-split'),
    'Shift+R': () => Dev.setMode(Dev.mode === 'reference' ? 'loupe' : 'reference'), J: () => { Dev.clip = !Dev.clip; Dev.render(); Dev.drawHistoPanel(); }, S: () => Dev.toggleProof(),
    Z: () => Dev.setZoom(Dev.view.zoom === 'fit' ? 1 : 'fit'), Space: () => Dev.setZoom(Dev.view.zoom === 'fit' ? 1 : 'fit'), O: () => Tools.cycleOverlay(), H: () => { Tools.hide = !Tools.hide; Dev.render(); },
    Enter: () => Tools.done(), Escape: () => Tools.done(), Delete: () => Tools.deleteSelected(), Backspace: () => Tools.deleteSelected(),
    ArrowRight: () => App.step(1), ArrowLeft: () => App.step(-1), G: 'go.grid', E: 'go.loupe',
    '[': () => Tools.brushSize(-1), ']': () => Tools.brushSize(1),
  },
  presets() { return { ...BUILTIN_PRESETS, ...App.conf('develop_presets', {}) }; },

  init(el) {
    this.el = el;
    this.cv = h('canvas', { class: 'dev-gl' }); this.ov = h('canvas', { class: 'dev-ov' });
    this.msg = h('div', { class: 'dev-msg' });
    this.host = h('div', { class: 'dev-host' }, this.cv, this.ov, this.msg);
    this.tb = h('div', { class: 'toolbar' });
    el.center.append(this.host, this.tb);
    Tools.bind(this.ov);
    new ResizeObserver(() => this.render()).observe(this.host);
    this.buildLeft(); this.buildRight();
    App.on('selection', () => { if (App.module === 'develop') this.load(App.cur()); });
    App.on('rotated', ids => { if (this.photo && ids.includes(this.photo.id)) this.load(this.photo, true); });
    App.on('overlay', () => this.render());
    App.on('catalog', () => { this.photo = null; this.src = null; });
    this.toolbar();
  },
  show() { this.load(App.cur()); },
  hide() { Tools.set(null, true); this.flushThumb(); },

  /* ---- loading & saving */
  async load(p, force) {
    if (!p) { this.photo = null; this.src = null; this.msg.textContent = 'Select a photo in the filmstrip to develop it.'; this.render(); return; }
    if (this.photo && this.photo.id === p.id && !force) return;
    this.flushThumb();
    if (this.photo && this.photo.id !== p.id) { this.prev = clone(this.photo.develop); Tools.set(null, true); this.view = { zoom: 'fit', cx: 0.5, cy: 0.5 }; }
    this.photo = p; this.s = devFull(p.develop); this.srcBefore = null; this.msg.textContent = '';
    this.syncUI();
    const tok = this.tok = {};
    api('history_list', { photo_id: p.id }).then(r => { if (this.tok !== tok) return; this.hist = r.history; this.histPos = 0; this.snaps = r.snapshots; this.drawHistory(); this.drawSnaps(); });
    try {
      const src = await GLR.source(p, this.previewSize(), this.s.spots);
      if (this.tok !== tok) return;
      this.src = src; this.need = await GLR.prepare(src, this.s, { proof: this.proof.on ? this.proof : null });
      this.render();
    } catch (e) { if (this.tok === tok) { this.src = null; this.msg.textContent = e.message; this.render(); } }
  },
  previewSize() { return Math.min(2560, Math.max(1536, Math.ceil(Math.max(this.host.clientWidth, this.host.clientHeight) * devicePixelRatio / 512) * 512)); },
  async reloadSource(full) {
    const p = this.photo; if (!p) return;
    const tok = this.srcTok = {};
    try { const src = await GLR.source(p, full || this.wantFull ? 0 : this.previewSize(), this.s.spots); if (this.srcTok === tok && this.photo === p) { this.src = src; this.render(); } } catch (e) { UI.error(e); }
  },
  async refreshNeed() { if (!this.src) return; this.need = await GLR.prepare(this.src, this.s, { proof: this.proof.on ? this.proof : null }); this.render(); },
  /* Persist the current settings as a new history step. */
  commit(label) {
    const p = this.photo; if (!p) return;
    const out = devDiff(this.s);
    if (same(out, p.develop)) return;
    const first = !this.hist.length ? { photo_id: p.id, label: 'Original state', develop: p.develop } : null;
    if (this.histPos > 0) { const keep = this.hist[this.histPos]; api('history_clear', { photo_id: p.id, above: keep.id }); this.hist = this.hist.slice(this.histPos); this.histPos = 0; }
    p.develop = out; p.ver++;
    api('photos_update', { ids: [p.id], fields: { develop: out } }).catch(UI.error);
    (async () => {
      if (first) { const id = await api('history_add', first); this.hist.unshift({ id, time: Date.now() / 1000, label: first.label, develop: first.develop }); }
      const id = await api('history_add', { photo_id: p.id, label, develop: out });
      if (this.photo === p) { this.hist.unshift({ id, time: Date.now() / 1000, label, develop: out }); this.drawHistory(); }
    })().catch(UI.error);
    this.thumbDirty = p; this.thumbSoon();
    App.emit('develop', p.id);
  },
  thumbSoon: debounce(() => Dev.flushThumb(), 1500),
  flushThumb() { const p = this.thumbDirty; if (!p) return; this.thumbDirty = null; Render.thumb(p).then(() => App.emit('meta', [p.id])); },
  /* Replace all settings (history click, preset, reset, paste) */
  apply(settings, label, keepHist) {
    const spots = JSON.stringify(this.s.spots);
    this.s = devFull(settings); this.syncUI();
    if (!keepHist) this.commit(label);
    else { const p = this.photo; p.develop = devDiff(this.s); p.ver++; api('photos_update', { ids: [p.id], fields: { develop: p.develop } }); this.thumbDirty = p; this.thumbSoon(); }
    if (JSON.stringify(this.s.spots) !== spots) this.reloadSource(); this.refreshNeed();
  },
  set(key, value, live) { setPath(this.s, key, value); this.render(); if (!live) this.commit(key); },
  goHistory(i) { if (i < 0 || i >= this.hist.length) return; this.histPos = i; this.apply(this.hist[i].develop, '', true); this.drawHistory(); },
  undo() { this.goHistory(this.histPos + 1); }, redo() { this.goHistory(this.histPos - 1); },
  reset() { if (!this.photo) return; this.apply(null, 'Reset Settings'); Tools.set(null, true); },
  before() { const b = {}; for (const k of GEOMETRY_KEYS) b[k] = this.s[k]; return devFull(b); },

  /* Apply a change to many photos at once (Quick Develop, sync, presets, painter). fn mutates or returns settings. */
  async adjustMany(ids, fn, label) {
    if (!ids.length) return;
    const items = [];
    for (const id of ids) {
      const p = App.photo(id); if (!p) continue;
      const s = devFull(p.develop), out = devDiff(devFull(fn(s, p) || s));
      p.develop = out; p.ver++; items.push({ id, develop: out });
      api('history_add', { photo_id: id, label: label || 'Adjust', develop: out }).catch(() => {});
    }
    await api('photos_develop', { items });
    App.emit('meta', ids);
    if (this.photo && ids.includes(this.photo.id) && App.module === 'develop') this.load(this.photo, true);
    Render.thumbs(ids);
  },
  pick(settings, groups) { const out = {}; const full = devFull(settings); for (const g of groups) for (const k of GROUPS[g]) out[k] = clone(full[k]); return out; },
  async chooseGroups(title, okLabel, def) {
    const st = Object.fromEntries(Object.keys(GROUPS).map(g => [g, def ? def.includes(g) : !['Crop', 'Spot Removal', 'Red Eye', 'Masking', 'Transform'].includes(g)]));
    const form = UI.form(Object.keys(GROUPS).map(g => ({ k: g, label: g, t: 'check' })), st);
    form.classList.add('cols2');
    const ok = await UI.dialog({ title, width: 480, body: h('div', {}, form, h('div', { class: 'dlg-inline' }, h('button', { class: 'btn', onclick: () => { Object.keys(st).forEach(k => { st[k] = true; }); form.render(); } }, 'Check All'), h('button', { class: 'btn', onclick: () => { Object.keys(st).forEach(k => { st[k] = false; }); form.render(); } }, 'Check None'))),
      buttons: [['Cancel', null], [okLabel, true, 'primary']] });
    return ok ? Object.keys(st).filter(k => st[k]) : null;
  },
  async copy() { const p = App.cur(); if (!p) return; const g = await this.chooseGroups('Copy Settings', 'Copy'); if (g) { this.clipboard = this.pick(p.develop, g); UI.toast('Settings copied'); } },
  paste() { if (!this.clipboard) return UI.toast('Nothing copied yet (Ctrl+Shift+C)'); const c = this.clipboard; return this.adjustMany(App.selIds(), s => Object.assign(s, clone(c)), 'Paste Settings'); },
  async sync() {
    const src = App.cur(), ids = App.selIds().filter(i => i !== src.id); if (!ids.length) return UI.toast('Select more photos; the active photo is the source');
    const g = await this.chooseGroups(`Synchronize Settings to ${ids.length} photo(s)`, 'Synchronize'); if (!g) return;
    const c = this.pick(src.develop, g); await this.adjustMany(ids, s => Object.assign(s, clone(c)), 'Synchronize Settings'); UI.toast('Settings synchronized');
  },
  resetMany() { return this.adjustMany(App.selIds(), () => clone(DEFAULTS), 'Reset Settings'); },
  applyWB(s, name, mean) {
    s.wb = name; const w = this.WB[name];
    if (name === 'auto' && mean) { const [t, ti] = this.neutral(mean); s.temp = Math.round(t * 70); s.tint = Math.round(ti * 70); } else if (w && w.t != null) { s.temp = w.t; s.tint = w.ti; }
    return s;
  },
  /* temp/tint (as -1..1 fractions) that make a linear RGB colour neutral under the shader's white-balance model */
  neutral(rgb) {
    const lin = rgb.map(c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)).map(c => Math.max(c, 1e-4));
    const T = -Math.log2(lin[0] / lin[2]) / 0.84, Ti = (Math.log2(lin[1]) - Math.log2(lin[0]) - 0.42 * T) / 0.37;
    return [clamp(T, -1, 1), clamp(Ti, -1, 1)];
  },
  toneFromHist(H) {
    const pct = q => { let acc = 0; const tot = H.r.reduce((a, b) => a + b, 0); for (let i = 0; i < 256; i++) { acc += (H.r[i] + H.g[i] + H.b[i]) / 3; if (acc >= tot * q) return i / 255; } return 1; };
    const p1 = pct(0.01), p10 = pct(0.1), p50 = pct(0.5), p99 = pct(0.99);
    return { exposure: +clamp(Math.log2(0.46 / Math.max(p50, 0.03)) * 0.55, -1.5, 1.5).toFixed(2), whites: Math.round(clamp((0.96 - p99) * 140, -30, 60)), blacks: Math.round(clamp((0.03 - p1) * 300, -50, 30)),
      highlights: -Math.round(clamp((p99 - 0.88) * 300, 0, 45)), shadows: Math.round(clamp((0.2 - p10) * 220, 0, 45)), contrast: 6, vibrance: 10 };
  },
  async autoTone(ids) {
    const tones = new Map();
    for (const id of ids) { const p = App.photo(id); const img = new Image(); img.src = `/img/thumb/${p.id}?raw=1&v=${p.orient}`; await img.decode().catch(() => {}); if (img.naturalWidth) tones.set(id, this.toneFromHist(histogramOf(img))); }
    return this.adjustMany(ids, (s, p) => Object.assign(s, tones.get(p.id) || {}), 'Auto Tone');
  },
  /* Rotating/flipping the source moves everything that is stored in source coordinates. */
  transformSettings(dev, op) {
    const s = devFull(dev), pt = (x, y) => (op === 'cw' ? [1 - y, x] : op === 'ccw' ? [y, 1 - x] : op === 'fliph' ? [1 - x, y] : [x, 1 - y]), quarter = op === 'cw' || op === 'ccw';
    const c = s.crop, [cx, cy] = pt(c.cx, c.cy);
    s.crop = { cx, cy, w: quarter ? c.h : c.w, h: quarter ? c.w : c.h, angle: quarter ? c.angle : -c.angle };
    for (const sp of s.spots) { [sp.x, sp.y] = pt(sp.x, sp.y); if (sp.sx != null) [sp.sx, sp.sy] = pt(sp.sx, sp.sy); if (sp.pts) sp.pts = sp.pts.map(q => pt(q[0], q[1])); }
    for (const r of s.redeyes) [r.x, r.y] = pt(r.x, r.y);
    s.guides = s.guides.map(g => [...pt(g[0], g[1]), ...pt(g[2], g[3])]);
    for (const m of s.masks) {
      if (m.type === 'linear') { [m.x1, m.y1] = pt(m.x1, m.y1); [m.x2, m.y2] = pt(m.x2, m.y2); }
      if (m.type === 'radial') { [m.cx, m.cy] = pt(m.cx, m.cy); if (quarter) [m.rx, m.ry] = [m.ry, m.rx]; else m.angle = -(m.angle || 0); }
      if (m.type === 'brush') for (const st of m.strokes || []) st.pts = st.pts.map(q => pt(q[0], q[1]));
    }
    if (s.upright !== 'off') { s.upright = 'off'; s.uprightH = null; }
    return devDiff(s);
  },

  /* ---- drawing */
  render() {   // next animation frame, with a timer fallback because frames stop while the window is hidden
    if (this.raf) return;
    const run = () => { if (!this.raf) return; cancelAnimationFrame(this.raf); clearTimeout(this.rafT); this.raf = 0; this.draw(); };
    this.raf = requestAnimationFrame(run); this.rafT = setTimeout(run, 90);
  },
  viewports(W, H) {
    const g = Math.round(4 * devicePixelRatio), half = Math.floor((W - g) / 2);
    if (this.mode === 'before-lr') return [{ x: 0, y: 0, w: half, h: H, kind: 'before', label: 'Before' }, { x: W - half, y: 0, w: half, h: H, kind: 'after', label: 'After' }];
    if (this.mode === 'reference') return [{ x: 0, y: 0, w: half, h: H, kind: 'ref', label: 'Reference' }, { x: W - half, y: 0, w: half, h: H, kind: 'after', label: 'Active' }];
    if (this.mode === 'before-split') return [{ x: 0, y: 0, w: W, h: H, kind: 'after' }, { x: 0, y: 0, w: W, h: H, kind: 'before', scissor: [0, 0, Math.floor(W / 2), H], label: 'Before | After' }];
    return [{ x: 0, y: 0, w: W, h: H, kind: this.showBefore ? 'before' : 'after', label: this.showBefore ? 'Before' : '' }];
  },
  regionFor(s, a, kind) {
    if (this.tool === 'crop' && kind === 'after') { const r = s.crop.angle * Math.PI / 180, c = Math.abs(Math.cos(r)), sn = Math.abs(Math.sin(r)); return { x: 0, y: 0, W: (a * c + sn) * 1.04, H: (a * sn + c) * 1.04, angle: s.crop.angle }; }
    return Geo.region(s, a);
  },
  rectFor(vp, region, src) {
    const Wpx = region.W * src.fullH, Hpx = region.H * src.fullH, pad = 28 * devicePixelRatio, v = this.view;
    const fit = Math.min((vp.w - pad) / Wpx, (vp.h - pad) / Hpx);
    const scale = v.zoom === 'fit' ? fit : v.zoom === 'fill' ? Math.max(vp.w / Wpx, vp.h / Hpx) : v.zoom;
    const dw = Wpx * scale, dh = Hpx * scale;
    return { dw, dh, scale, fit, ox: dw <= vp.w ? (vp.w - dw) / 2 : clamp(vp.w / 2 - v.cx * dw, vp.w - dw, 0), oy: dh <= vp.h ? (vp.h - dh) / 2 : clamp(vp.h / 2 - v.cy * dh, vp.h - dh, 0) };
  },
  draw() {
    const dpr = devicePixelRatio, W = Math.max(2, Math.round(this.host.clientWidth * dpr)), H = Math.max(2, Math.round(this.host.clientHeight * dpr)), gl = GLR.gl;
    if (!gl || App.module !== 'develop') return;
    for (const c of [this.cv, this.ov]) if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.disable(gl.SCISSOR_TEST); gl.viewport(0, 0, W, H);
    const paper = this.proof.on ? [0.93, 0.93, 0.93, 1] : Theme.rgb('--canvas');
    gl.clearColor(...paper); gl.clear(gl.COLOR_BUFFER_BIT);
    this.vps = [];
    if (!this.src || !this.photo) { this.ov.getContext('2d').clearRect(0, 0, W, H); return; }
    const sel = Tools.mask();
    for (const vp of this.viewports(W, H)) {
      let s = this.s, src = this.src;
      if (vp.kind === 'before') { s = this.before(); if (this.s.spots.length) { if (!this.srcBefore) { this.srcBefore = 'loading'; GLR.source(this.photo, this.previewSize(), null).then(b => { this.srcBefore = b; this.render(); }); } if (this.srcBefore && this.srcBefore !== 'loading') src = this.srcBefore; } }
      if (vp.kind === 'ref') { const rp = this.refPhoto && App.photo(this.refPhoto); if (!rp) { vp.empty = true; this.vps.push(vp); continue; } if (!this.refSrc || this.refSrc.id !== rp.id || this.refVer !== rp.ver) { this.refVer = rp.ver; GLR.source(rp, this.previewSize(), devFull(rp.develop).spots).then(b => { this.refSrc = b; this.render(); }); if (!this.refSrc) { this.vps.push(vp); continue; } } src = this.refSrc; s = devFull(rp.develop); }
      const a = src.w / src.h, region = this.regionFor(s, a, vp.kind), rect = this.rectFor(vp, region, src);
      Object.assign(vp, { rect, region, a, s, src });
      if (vp.scissor) { gl.enable(gl.SCISSOR_TEST); gl.scissor(vp.scissor[0], H - vp.scissor[1] - vp.scissor[3], vp.scissor[2], vp.scissor[3]); }
      GLR.draw(src, s, { x: vp.x, y: H - vp.y - vp.h, w: vp.w, h: vp.h, rect, region, fx: !(this.tool === 'crop' && vp.kind === 'after'), sel: vp.kind === 'after' && sel ? sel.id : null,
        overlay: Tools.showOverlay && vp.kind === 'after', clip: this.clip && vp.kind === 'after', proof: this.proof.on && vp.kind === 'after' ? this.proof : null, need: this.need, bg: paper });
      gl.disable(gl.SCISSOR_TEST);
      this.vps.push(vp);
      if (vp.kind === 'after' && rect.scale * src.fullW / src.w > 1.35 && src.w < src.fullW * 0.98 && !this.wantFull) { this.wantFull = this.photo.id; this.reloadSource(true); }
    }
    if (this.wantFull && this.wantFull !== this.photo.id) this.wantFull = null;
    Tools.drawOverlay(this.ov.getContext('2d'), W, H);
    this.histoSoon();
  },
  after() { return (this.vps || []).find(v => v.kind === 'after' && v.rect); },
  /* pointer event -> coordinates in the active view */
  at(e) {
    const vp = this.after(); if (!vp) return null;
    const b = this.ov.getBoundingClientRect(), dpr = devicePixelRatio, px = (e.clientX - b.left) * dpr, py = (e.clientY - b.top) * dpr;
    const u = (px - vp.x - vp.rect.ox) / vp.rect.dw, v = (py - vp.y - vp.rect.oy) / vp.rect.dh, m = Geo.mapper(this.s, vp.a, vp.region), sp = m.toSrc(u, v);
    return { px, py, u, v, sx: sp[0], sy: sp[1], vp, m, inside: u >= 0 && u <= 1 && v >= 0 && v <= 1 };
  },
  /* source uv -> overlay canvas pixels */
  toPx(sx, sy, vp) { vp = vp || this.after(); const m = Geo.mapper(this.s, vp.a, vp.region), o = m.toOut(sx, sy); return [vp.x + vp.rect.ox + o[0] * vp.rect.dw, vp.y + vp.rect.oy + o[1] * vp.rect.dh]; },
  /* trackpad: a pinch zooms about the pointer, two fingers pan */
  gesture(e, at, vp) {
    const r = vp.rect, v = this.view;
    if (e.ctrlKey) {
      const z = Math.min(8, (typeof v.zoom === 'number' ? v.zoom : r.scale) * Math.exp(-e.deltaY * .01)), k = z / r.scale, fit = e.deltaY > 0 && z <= r.fit * 1.02;
      v.cx = clamp(at.u + (vp.x + vp.w / 2 - at.px) / (r.dw * k), 0, 1); v.cy = clamp(at.v + (vp.y + vp.h / 2 - at.py) / (r.dh * k), 0, 1);
      v.zoom = fit ? 'fit' : z; if (fit) this.wantFull = null;
    } else if (v.zoom !== 'fit') { v.cx = clamp(v.cx + e.deltaX * devicePixelRatio / r.dw, 0, 1); v.cy = clamp(v.cy + e.deltaY * devicePixelRatio / r.dh, 0, 1); }
    else return;
    this.render(); (this.tbSoon || (this.tbSoon = debounce(() => this.toolbar(), 200)))();
  },
  setZoom(z, at) {
    if (at) { this.view.cx = clamp(at.u, 0, 1); this.view.cy = clamp(at.v, 0, 1); }
    this.view.zoom = z; if (z === 'fit') this.wantFull = null;
    this.render(); this.toolbar();
  },
  setMode(m) { if (m === 'reference' && !this.refPhoto) this.refPhoto = App.active; this.mode = m; this.showBefore = false; this.render(); this.toolbar(); },
  /* average source colour (sRGB 0..1) around a source point, ignoring every adjustment */
  sample(sx, sy) {
    const src = this.src, a = src.w / src.h, k = 6 / Math.max(src.w, src.h);
    const { data } = GLR.toCanvas(src, devFull(null), 3, 3, { raw: true, region: { x: (sx - 0.5) * a, y: sy - 0.5, W: k * a, H: k, angle: 0 }, fx: false });
    const out = [0, 0, 0]; for (let i = 0; i < data.length; i += 4) { out[0] += data[i]; out[1] += data[i + 1]; out[2] += data[i + 2]; }
    this.render();
    return out.map(v => v / (data.length / 4) / 255);
  },
  histoSoon: debounce(() => Dev.drawHistoPanel(), 140),
  drawHistoPanel() {
    if (!this.src || !this.histC || App.module !== 'develop') return;
    const H = GLR.histogram(this.src, this.s, { need: this.need, proof: this.proof.on ? this.proof : null });
    this.lastHist = H; drawHistogram(this.histC, H); this.curveDraw && this.curveDraw();
    const tot = H.n, lo = (H.l[0] + H.l[1]) / tot, hi = (H.l[254] + H.l[255]) / tot, p = this.photo, e = p.exif || {};
    this.histInfo.replaceChildren(h('div', { class: 'hi-row' }, h('span', {}, e.iso ? 'ISO ' + e.iso : ''), h('span', {}, e.focal ? Math.round(e.focal) + ' mm' : ''), h('span', {}, e.aperture ? 'f / ' + e.aperture : ''), h('span', {}, fmt.shutter(e.exposure))),
      h('div', { class: 'hi-row' }, h('a', { class: this.clip ? 'on' : '', title: 'Show shadow / highlight clipping (J)', onclick: () => { this.clip = !this.clip; this.render(); this.drawHistoPanel(); } }, `◤ ${(lo * 100).toFixed(1)}% shadows   ${(hi * 100).toFixed(1)}% highlights ◥`),
        h('span', { class: 'dim' }, p.missing ? 'Smart Preview' : this.src.w >= this.src.fullW * 0.98 ? 'Full resolution' : 'Preview ' + this.src.w + ' px')));
    gl_restore();
  },
  toggleProof(on) { this.proof.on = on ?? !this.proof.on; this.proofPanel.style.display = this.proof.on ? '' : 'none'; this.drawProof(); this.refreshNeed(); this.toolbar(); },

  toolbar() {
    const mb = (m, label, title, adv) => h('button', { class: 'tbtn' + (this.mode === m ? ' on' : '') + (adv ? ' adv' : ''), title, onclick: () => this.setMode(this.mode === m && m !== 'loupe' ? 'loupe' : m) }, label);
    const z = this.view.zoom, zs = [['fit', 'Fit'], ['fill', 'Fill'], [0.5, '50%'], [1, '100%'], [2, '200%'], [4, '400%']];
    this.tb.replaceChildren(
      h('span', { class: 'tb-group' }, mb('loupe', 'Loupe', 'Loupe view'), mb('before-lr', 'Before | After', 'Before/After side by side (Y)'), mb('before-split', 'Split', 'Before/After split (Shift+Y)', 1), mb('reference', 'Reference', 'Reference view: compare against another photo (Shift+R)', 1),
        this.mode === 'reference' ? h('button', { class: 'tbtn', title: 'Use the active photo as the reference; then pick another photo to edit', onclick: () => { this.refPhoto = App.active; this.refSrc = null; this.render(); UI.toast('Reference set. Select another photo to edit against it.'); } }, 'Set Reference') : null,
        h('button', { class: 'tbtn' + (this.showBefore ? ' on' : ''), title: 'Toggle Before (\\)', onclick: () => { this.showBefore = !this.showBefore; this.render(); this.toolbar(); } }, 'Before')),
      h('span', { class: 'tb-group adv' }, h('label', { class: 'tb-check', title: 'Soft Proofing (S)' }, h('input', { type: 'checkbox', checked: this.proof.on, onchange: e => this.toggleProof(e.target.checked) }), 'Soft Proofing')),
      Overlay.controls(), h('span', { class: 'tb-fill' }), Tools.toolbarExtra(),
      h('span', { class: 'tb-group' }, h('span', { class: 'dim' }, 'Zoom'), h('select', { onchange: e => this.setZoom(zs[e.target.selectedIndex][0]) }, zs.map(([v, l]) => h('option', { selected: v === z }, l)))));
  },

  /* ---- control registry: every slider knows its settings path so the UI can be refreshed from state */
  slider(key, label, min, max, step, opts = {}) {
    const def = getPath(DEFAULTS, key) ?? opts.def ?? 0;
    const el = UI.slider({ label, min, max, step, value: def, def, cls: opts.cls, tip: TIPS.key[key], oninput: v => { setPath(this.s, key, v); opts.live && opts.live(v); this.render(); }, onchange: v => { opts.done && opts.done(v); this.commit(label + ' ' + (v > 0 && min < 0 ? '+' : '') + (+v).toFixed(step < 1 ? 2 : 0)); } });
    this.controls.push([key, el]);
    return el;
  },
  syncUI() { for (const [k, el] of this.controls) el.set(getPath(this.s, k) ?? 0); for (const f of this.refreshers) f(); Tools.panel(); },
  section(label) { return h('div', { class: 'sub', data: TIPS.section[label] ? { tip: TIPS.section[label] } : null }, label); },

  buildLeft() {
    const L = this.el.left;
    this.navImg = h('img', { draggable: false });
    this.presetB = h('div'); this.snapB = h('div'); this.histB = h('div');
    L.append(UI.panel('Navigator', h('div', { class: 'nav' }, this.navImg), { key: 'dnav', tools: ['fit', 'fill', 1, 2].map(z => h('a', { onclick: () => this.setZoom(z) }, z === 'fit' ? 'FIT' : z === 'fill' ? 'FILL' : z * 100 + '%')) }),
      UI.panel('Presets', this.presetB, { key: 'dpre', tools: h('a', { title: 'Create preset from current settings', onclick: () => this.createPreset() }, '+') }),
      UI.panel('Snapshots', this.snapB, { key: 'dsnap', tools: h('a', { title: 'Create snapshot', onclick: () => this.createSnap() }, '+') }),
      UI.panel('History', this.histB, { key: 'dhist', tools: h('a', { title: 'Clear history', onclick: async () => { if (this.photo && await UI.confirm('Clear History', 'Remove all history steps for this photo? Current settings are kept.', 'Clear')) { await api('history_clear', { photo_id: this.photo.id }); this.hist = []; this.drawHistory(); } } }, '×') }),
      h('div', { class: 'side-foot' }, h('button', { class: 'btn', onclick: () => this.copy() }, 'Copy…'), h('button', { class: 'btn', onclick: () => this.paste() }, 'Paste')));
    this.refreshers.push(() => { this.navImg.src = this.photo ? App.thumb(this.photo) : ''; });
    this.drawPresets();
  },
  drawPresets() {
    const user = App.conf('develop_presets', {}), def = App.conf('import_preset', '');
    const row = (n, set, isUser) => h('div', { class: 'trow', title: 'Click to apply', onclick: () => { if (!this.photo) return; this.apply({ ...devDiff(this.s), ...clone(set) }, 'Preset: ' + n); },
      oncontextmenu: e => { e.preventDefault(); UI.menu(e.clientX, e.clientY, [{ label: 'Apply to All Selected Photos', run: () => this.adjustMany(App.selIds(), s => Object.assign(s, clone(set)), 'Preset: ' + n) },
        { label: 'Apply on Import', checked: def === n, run: () => { App.setConf('import_preset', def === n ? '' : n); this.drawPresets(); } },
        isUser ? { label: 'Update with Current Settings', run: () => this.createPreset(n) } : null, isUser ? { label: 'Rename…', run: async () => { const nn = await UI.prompt('Rename Preset', 'Name', n); if (nn && nn !== n) { const u = { ...user }; u[nn] = u[n]; delete u[n]; App.setConf('develop_presets', u); this.drawPresets(); } } } : null,
        isUser ? { label: 'Delete', run: () => { const u = { ...user }; delete u[n]; App.setConf('develop_presets', u); this.drawPresets(); } } : null]); } }, h('span', { class: 'tw none' }), h('span', { class: 'tl' }, n + (def === n ? '  • on import' : '')));
    this.presetB.replaceChildren(h('div', { class: 'sub' }, 'User Presets'), ...(Object.keys(user).length ? Object.entries(user).map(([n, s]) => row(n, s, true)) : [h('div', { class: 'empty small' }, 'Click + to save your settings as a preset.')]),
      h('div', { class: 'sub' }, 'Opia Presets'), ...Object.entries(BUILTIN_PRESETS).map(([n, s]) => row(n, s, false)));
  },
  async createPreset(update) {
    if (!this.photo) return;
    const name = update || await UI.prompt('New Develop Preset', 'Preset name'); if (!name) return;
    const g = await this.chooseGroups('Settings to include in "' + name + '"', 'Save Preset'); if (!g) return;
    App.setConf('develop_presets', { ...App.conf('develop_presets', {}), [name]: this.pick(devDiff(this.s), g) }); this.drawPresets(); UI.toast('Preset saved');
  },
  drawSnaps() {
    this.snapB.replaceChildren(...(this.snaps.length ? this.snaps.map(sn => h('div', { class: 'trow', title: fmt.datetime(sn.time), onclick: () => this.apply(sn.develop, 'Snapshot: ' + sn.name),
      oncontextmenu: e => { e.preventDefault(); UI.menu(e.clientX, e.clientY, [{ label: 'Rename…', run: async () => { const n = await UI.prompt('Rename Snapshot', 'Name', sn.name); if (n) { await api('snapshot_update', { id: sn.id, fields: { name: n } }); sn.name = n; this.drawSnaps(); } } },
        { label: 'Update with Current Settings', run: async () => { sn.develop = devDiff(this.s); await api('snapshot_update', { id: sn.id, fields: { develop: sn.develop } }); UI.toast('Snapshot updated'); } },
        { label: 'Delete', run: async () => { await api('snapshot_delete', { id: sn.id }); this.snaps = this.snaps.filter(x => x !== sn); this.drawSnaps(); } }]); } }, h('span', { class: 'tw none' }), h('span', { class: 'tl' }, sn.name)))
      : [h('div', { class: 'empty small' }, 'Snapshots keep named versions of your edit. Click + to add one.')]));
  },
  async createSnap() {
    if (!this.photo) return;
    const name = await UI.prompt('New Snapshot', 'Snapshot name', 'Untitled ' + new Date().toLocaleString()); if (!name) return;
    const develop = devDiff(this.s), id = await api('snapshot_add', { photo_id: this.photo.id, name, develop });
    this.snaps.push({ id, name, develop, time: Date.now() / 1000 }); this.snaps.sort((a, b) => a.name.localeCompare(b.name)); this.drawSnaps();
  },
  drawHistory() {
    this.histB.replaceChildren(...(this.hist.length ? this.hist.map((hs, i) => h('div', { class: 'trow' + (i === this.histPos ? ' on' : '') + (i < this.histPos ? ' undone' : ''), title: fmt.datetime(hs.time), onclick: () => this.goHistory(i) }, h('span', { class: 'tw none' }), h('span', { class: 'tl' }, hs.label)))
      : [h('div', { class: 'empty small' }, 'Every adjustment is recorded here and kept in the catalog.')]));
  },

  buildRight() {
    const R = this.el.right, S = (...a) => this.slider(...a), sec = l => this.section(l);
    // ---- histogram + soft proofing
    this.histC = h('canvas', { width: 256, height: 96, class: 'histo' }); this.histInfo = h('div', { class: 'hist-info' });
    this.proofB = h('div'); this.proofPanel = UI.panel('Soft Proofing', this.proofB, { key: 'dproof' }); this.proofPanel.style.display = 'none';
    this.toolB = h('div', { class: 'tool-panel' });
    const strip = h('div', { class: 'tool-strip' }, [['crop', '⧉ Crop', 'Crop & Straighten (R)'], ['spot', '◎ Heal', 'Spot Removal: Clone, Heal, Content-Aware Remove (Q)'], ['redeye', '◉ Red Eye', 'Red Eye Correction'], ['mask', '◐ Masking', 'Masking: Brush (K), Linear Gradient (M), Radial Gradient (Shift+M)']]
      .map(([t, l, tip]) => h('button', { class: 'tbtn' + (t === 'redeye' || t === 'mask' ? ' adv' : ''), data: { tool: t, tip: TIPS.tool[t][1], tipName: TIPS.tool[t][0] }, onclick: () => Tools.set(this.tool === t ? null : t) }, l)));
    this.strip = strip;
    // ---- basic
    const treat = h('span', { class: 'seg' }, [['color', 'Color'], ['bw', 'Black & White']].map(([v, l]) => h('a', { data: { v }, onclick: () => { this.s.treatment = v; this.syncUI(); this.render(); this.commit('Treatment: ' + l); } }, l)));
    const profSel = h('select', { onchange: () => { const v = profSel.value; if (v.startsWith('cam:')) { Object.assign(this.s, clone(App.conf('camera_profiles', {})[v.slice(4)])); } else this.s.profile = v; this.syncUI(); this.render(); this.commit('Profile: ' + profSel.selectedOptions[0].textContent); } });
    const wbSel = h('select', { onchange: () => { const v = wbSel.value; this.applyWB(this.s, v, v === 'auto' && this.src ? GLR.histogram(this.src, this.before()).mean : null); gl_restore(); this.syncUI(); this.render(); this.commit('White Balance: ' + this.WB[v].name); } }, Object.entries(this.WB).map(([k, w]) => h('option', { value: k }, w.name)));
    this.refreshers.push(() => {
      $$('a', treat).forEach(a => a.classList.toggle('on', a.dataset.v === this.s.treatment));
      const cams = App.conf('camera_profiles', {});
      profSel.replaceChildren(...Object.entries(PROFILES).map(([k, p]) => h('option', { value: k, selected: this.s.profile === k }, p.name)), ...Object.keys(cams).map(n => h('option', { value: 'cam:' + n }, 'Camera: ' + n)));
      wbSel.value = this.WB[this.s.wb] ? this.s.wb : 'custom';
      hslDraw(); cgDraw(); lensDraw(); upDraw(); this.curveDraw(); this.drawProof();
      $$('button', strip).forEach(b => b.classList.toggle('on', b.dataset.tool === this.tool));
    });
    const wbCustom = () => { this.s.wb = 'custom'; wbSel.value = 'custom'; };
    const basic = h('div', {}, h('div', { class: 'frow adv' }, h('span', {}, 'Treatment'), treat), h('label', { class: 'frow adv' }, h('span', {}, 'Profile'), profSel),
      h('div', { class: 'frow' }, h('span', {}, 'WB'), h('span', { class: 'fpick' }, wbSel, h('button', { class: 'btn', title: 'White Balance Selector (W): click something neutral', onclick: () => Tools.set(this.tool === 'wb' ? null : 'wb') }, '✎'))),
      S('temp', 'Temp', -100, 100, 1, { cls: 'g-temp', live: wbCustom }), S('tint', 'Tint', -100, 100, 1, { cls: 'g-tint', live: wbCustom }),
      h('div', { class: 'sub row', data: { tip: TIPS.section.Tone, tipName: 'Tone' } }, 'Tone', h('button', { class: 'btn', onclick: () => { if (!this.src) return; const t = this.toneFromHist(GLR.histogram(this.src, this.before())); gl_restore(); Object.assign(this.s, t); this.syncUI(); this.render(); this.commit('Auto Tone'); } }, 'Auto')),
      S('exposure', 'Exposure', -5, 5, 0.01), S('contrast', 'Contrast', -100, 100, 1), S('highlights', 'Highlights', -100, 100, 1), S('shadows', 'Shadows', -100, 100, 1), S('whites', 'Whites', -100, 100, 1), S('blacks', 'Blacks', -100, 100, 1),
      sec('Presence'), S('texture', 'Texture', -100, 100, 1), S('clarity', 'Clarity', -100, 100, 1), S('dehaze', 'Dehaze', -100, 100, 1), S('vibrance', 'Vibrance', -100, 100, 1), S('saturation', 'Saturation', -100, 100, 1));
    // ---- tone curve
    const curve = this.buildCurve();
    // ---- HSL / color
    let hslTab = 'hue';
    const hslB = h('div'), hslTabs = h('div', { class: 'seg' });
    const hslDraw = () => {
      const bw = this.s.treatment === 'bw' || (PROFILES[this.s.profile] || {}).bw;
      const tabs = bw ? [['bw', 'B&W Mix']] : [['hue', 'Hue'], ['sat', 'Saturation'], ['lum', 'Luminance'], ['all', 'All']];
      if (bw) hslTab = 'bw'; else if (hslTab === 'bw') hslTab = 'hue';
      hslTabs.replaceChildren(...tabs.map(([k, l]) => h('a', { class: hslTab === k ? 'on' : '', onclick: () => { hslTab = k; hslDraw(); } }, l)));
      const group = part => HSL_BANDS.map((n, i) => { const key = part === 'bw' ? 'bwMix.' + i : `hsl.${part}.${i}`; return UI.slider({ label: n, min: -100, max: 100, step: 1, value: getPath(this.s, key), def: 0, cls: 'hsl-' + i, tip: TIPS.hsl[part](n), oninput: v => { setPath(this.s, key, v); this.render(); }, onchange: v => this.commit(`${part === 'bw' ? 'B&W' : part} ${n} ${v}`) }); });
      hslB.replaceChildren(...(hslTab === 'all' ? [sec('Hue'), ...group('hue'), sec('Saturation'), ...group('sat'), sec('Luminance'), ...group('lum')] : group(hslTab)));
    };
    // ---- color grading
    const cgB = h('div');
    const wheel = (zone, label) => {
      const cv = h('canvas', { width: 108, height: 108, class: 'wheel', title: 'Drag to set hue and saturation. Double-click to reset.' }), z = () => this.s.cg[zone];
      const paint = () => { const x = cv.getContext('2d'), R0 = 50, c = 54; x.clearRect(0, 0, 108, 108);
        for (let a = 0; a < 360; a += 2) { const g = x.createRadialGradient(c, c, 0, c, c, R0); g.addColorStop(0, '#777'); g.addColorStop(1, `hsl(${a},90%,50%)`); x.fillStyle = g; x.beginPath(); x.moveTo(c, c); x.arc(c, c, R0, (a - 1.2) * Math.PI / 180, (a + 1.2) * Math.PI / 180); x.fill(); }
        const r = z().s / 100 * R0, an = z().h * Math.PI / 180; x.strokeStyle = '#fff'; x.lineWidth = 2; x.beginPath(); x.arc(c + Math.cos(an) * r, c - Math.sin(an) * r, 5, 0, 7); x.stroke(); x.strokeStyle = '#000'; x.lineWidth = 1; x.beginPath(); x.arc(c + Math.cos(an) * r, c - Math.sin(an) * r, 6.5, 0, 7); x.stroke(); };
      const drag = e => { const b = cv.getBoundingClientRect(), dx = e.clientX - b.left - 54, dy = 54 - (e.clientY - b.top); z().h = Math.round((Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360); z().s = Math.round(clamp(Math.hypot(dx, dy) / 50, 0, 1) * 100); paint(); read.textContent = `H ${z().h}  S ${z().s}`; this.render(); };
      cv.onmousedown = e => { drag(e); const up = () => { removeEventListener('mousemove', drag); removeEventListener('mouseup', up); this.commit('Color Grading: ' + label); }; addEventListener('mousemove', drag); addEventListener('mouseup', up); };
      cv.ondblclick = () => { z().h = 0; z().s = 0; paint(); this.render(); this.commit('Color Grading reset: ' + label); };
      const read = h('span', { class: 'dim' }, `H ${z().h}  S ${z().s}`);
      paint();
      return h('div', { class: 'cg-w' }, h('b', {}, label), cv, read, UI.slider({ label: 'Lum', min: -100, max: 100, step: 1, value: z().l, def: 0, oninput: v => { z().l = v; this.render(); }, onchange: () => this.commit('Color Grading Luminance: ' + label) }));
    };
    const cgDraw = () => cgB.replaceChildren(h('div', { class: 'cg-grid' }, wheel('shadows', 'Shadows'), wheel('midtones', 'Midtones'), wheel('highlights', 'Highlights'), wheel('global', 'Global')),
      UI.slider({ label: 'Blending', min: 0, max: 100, step: 1, value: this.s.cg.blending, def: 50, oninput: v => { this.s.cg.blending = v; this.render(); }, onchange: () => this.commit('Color Grading Blending') }),
      UI.slider({ label: 'Balance', min: -100, max: 100, step: 1, value: this.s.cg.balance, def: 0, oninput: v => { this.s.cg.balance = v; this.render(); }, onchange: () => this.commit('Color Grading Balance') }));
    // ---- detail
    const detail = h('div', {}, sec('Sharpening'), S('sharpAmount', 'Amount', 0, 150, 1), S('sharpRadius', 'Radius', 0.5, 3, 0.1), S('sharpDetail', 'Detail', 0, 100, 1), S('sharpMasking', 'Masking', 0, 100, 1),
      sec('Noise Reduction'), S('nrLum', 'Luminance', 0, 100, 1), S('nrLumDetail', 'Detail', 0, 100, 1), S('nrLumContrast', 'Contrast', 0, 100, 1), S('nrColor', 'Color', 0, 100, 1), S('nrColorDetail', 'Detail', 0, 100, 1), S('nrColorSmooth', 'Smoothness', 0, 100, 1),
      h('div', { class: 'fnote' }, 'Judge sharpening and noise at 100% zoom; fit view shows a scaled approximation.'));
    // ---- lens corrections
    const lensB = h('div');
    const pair = (key, label) => h('div', { class: 'srow2' }, h('label', {}, label), [0, 1].map(i => h('input', { type: 'range', min: 0, max: 100, value: this.s[key][i], oninput: e => { this.s[key][i] = +e.target.value; if (this.s[key][0] > this.s[key][1]) this.s[key][1 - i] = +e.target.value; this.render(); }, onchange: () => this.commit(label) })));
    const lensDraw = () => {
      const s = this.s, profs = Geo.lensProfiles(), lensName = (this.photo?.exif || {}).lens || '', auto = Geo.lensProfile('auto', lensName);
      lensB.replaceChildren(
        h('label', { class: 'fcheck' }, h('input', { type: 'checkbox', checked: s.caRemove, onchange: async e => { s.caRemove = e.target.checked; if (s.caRemove && !s.caR && !s.caB && this.photo) { try { const r = await api('ca_estimate', { id: this.photo.id }); s.caR = r.r; s.caB = r.b; } catch (er) { UI.error(er); } } this.syncUI(); this.render(); this.commit('Remove Chromatic Aberration'); } }), 'Remove Chromatic Aberration'),
        h('label', { class: 'fcheck' }, h('input', { type: 'checkbox', checked: s.lensProfileEnable, onchange: e => { s.lensProfileEnable = e.target.checked; lensDraw(); this.render(); this.commit('Enable Profile Corrections'); } }), 'Enable Profile Corrections'),
        h('label', { class: 'frow' }, h('span', {}, 'Lens Profile'), h('select', { onchange: e => { s.lensProfile = e.target.value; s.lensProfileEnable = true; lensDraw(); this.render(); this.commit('Lens Profile'); } }, h('option', { value: 'auto', selected: s.lensProfile === 'auto' }, 'Auto' + (auto ? ' — ' + auto.name : lensName ? ' (no match)' : '')), Object.entries(profs).map(([k, p]) => h('option', { value: k, selected: s.lensProfile === k }, p.name)))),
        h('div', { class: 'fnote' }, lensName ? 'Lens: ' + lensName : 'No lens name in this file’s EXIF.'),
        h('div', { class: 'dlg-inline' }, h('button', { class: 'btn', title: 'Save the manual distortion and vignetting amounts as a profile for this lens', onclick: () => Ext.saveLensProfile() }, 'Save as Profile…'), h('button', { class: 'btn', title: 'Import an Adobe .lcp lens profile', onclick: () => Ext.importLcp() }, 'Import LCP…'), h('button', { class: 'btn', onclick: () => Ext.manageLensProfiles() }, 'Manage…')));
    };
    const lens = h('div', {}, sec('Profile'), lensB, S('lensDistScale', 'Distortion', 0, 200, 1), S('lensVigScale', 'Vignetting', 0, 200, 1),
      sec('Manual'), S('distortion', 'Distortion', -100, 100, 1), S('caR', 'CA Red/Cyan', -0.004, 0.004, 0.0001), S('caB', 'CA Blue/Yel', -0.004, 0.004, 0.0001),
      sec('Defringe'), S('defringePurple', 'Purple Amt', 0, 20, 1), pair('defringePurpleHue', 'Purple Hue'), S('defringeGreen', 'Green Amt', 0, 20, 1), pair('defringeGreenHue', 'Green Hue'),
      sec('Vignetting'), S('lensVignette', 'Amount', -100, 100, 1), S('lensVigMid', 'Midpoint', 0, 100, 1));
    // ---- transform
    const upB = h('div', { class: 'seg wrap' });
    const upDraw = () => upB.replaceChildren(...[['off', 'Off'], ['auto', 'Auto'], ['guided', 'Guided'], ['level', 'Level'], ['vertical', 'Vertical'], ['full', 'Full']].map(([m, l]) => h('a', { class: this.s.upright === m ? 'on' : '', onclick: () => Tools.upright(m) }, l)));
    const refit = () => { if (this.s.constrainCrop && this.src) { Geo.fitCrop(this.s, this.src.w / this.src.h); } };
    const T = (k, l, a, b, st) => S(k, l, a, b, st, { live: refit });
    const transform = h('div', {}, sec('Upright'), upB, h('div', { class: 'fnote' }, 'Guided: draw two or more lines along edges that should be vertical or horizontal.'),
      sec('Transform'), T('tVertical', 'Vertical', -100, 100, 1), T('tHorizontal', 'Horizontal', -100, 100, 1), T('tRotate', 'Rotate', -10, 10, 0.1), T('tAspect', 'Aspect', -100, 100, 1), T('tScale', 'Scale', 50, 150, 1), T('tX', 'X Offset', -100, 100, 0.1), T('tY', 'Y Offset', -100, 100, 0.1),
      (() => { const cb = h('input', { type: 'checkbox', onchange: () => { this.s.constrainCrop = cb.checked; refit(); this.render(); this.commit('Constrain Crop'); } }); this.refreshers.push(() => { cb.checked = this.s.constrainCrop; }); return h('label', { class: 'fcheck' }, cb, 'Constrain Crop'); })());
    // ---- effects, calibration
    const effects = h('div', {}, sec('Post-Crop Vignetting'), S('vigAmount', 'Amount', -100, 100, 1), S('vigMid', 'Midpoint', 0, 100, 1), S('vigRound', 'Roundness', -100, 100, 1), S('vigFeather', 'Feather', 0, 100, 1), S('vigHighlights', 'Highlights', 0, 100, 1),
      sec('Grain'), S('grain', 'Amount', 0, 100, 1), S('grainSize', 'Size', 0, 100, 1), S('grainRough', 'Roughness', 0, 100, 1));
    const calib = h('div', {}, S('calShadowTint', 'Shadows Tint', -100, 100, 1), sec('Red Primary'), S('calRedHue', 'Hue', -100, 100, 1), S('calRedSat', 'Saturation', -100, 100, 1), sec('Green Primary'), S('calGreenHue', 'Hue', -100, 100, 1), S('calGreenSat', 'Saturation', -100, 100, 1),
      sec('Blue Primary'), S('calBlueHue', 'Hue', -100, 100, 1), S('calBlueSat', 'Saturation', -100, 100, 1),
      h('div', { class: 'dlg-inline' }, h('button', { class: 'btn', title: 'Save profile + calibration as a named camera profile', onclick: () => Ext.saveCameraProfile() }, 'Save Camera Profile…'), h('button', { class: 'btn', onclick: () => Ext.manageCameraProfiles() }, 'Manage…')));
    R.append(UI.panel('Histogram', h('div', {}, this.histC, this.histInfo), { key: 'dhisto' }), this.proofPanel, strip, this.toolB,
      UI.panel('Basic', basic, { key: 'dbasic' }), UI.panel('Tone Curve', curve, { key: 'dcurve', closed: true }), UI.panel('HSL / Color', h('div', {}, hslTabs, hslB), { key: 'dhsl', closed: true }),
      UI.panel('Color Grading', cgB, { key: 'dcg', closed: true }), UI.panel('Detail', detail, { key: 'ddetail', closed: true }), UI.panel('Lens Corrections', lens, { key: 'dlens', closed: true }),
      UI.panel('Transform', transform, { key: 'dtrans', closed: true }), UI.panel('Effects', effects, { key: 'dfx', closed: true }), UI.panel('Calibration', calib, { key: 'dcal', closed: true }),
      h('div', { class: 'side-foot' }, h('button', { class: 'btn', title: 'Apply the settings of the previously viewed photo', onclick: () => { if (this.photo) this.apply(this.prev, 'Previous Settings'); } }, 'Previous'), h('button', { class: 'btn', onclick: () => this.reset() }, 'Reset')));
  },
  drawProof() {
    if (!this.proofB) return;
    const pr = this.proof, profs = App.boot.profiles || [], cur = profs.find(p => p.id === pr.profile);
    const ck = (k, label) => h('label', { class: 'fcheck' }, h('input', { type: 'checkbox', checked: pr[k], onchange: e => { pr[k] = e.target.checked; this.refreshNeed(); } }), label);
    this.proofB.replaceChildren(
      h('label', { class: 'frow' }, h('span', {}, 'Profile'), h('select', { onchange: e => { pr.profile = profs[e.target.selectedIndex].id; this.drawProof(); this.refreshNeed(); } }, profs.map(p => h('option', { selected: p.id === pr.profile }, `${p.name} (${p.space})`)))),
      h('label', { class: 'frow' }, h('span', {}, 'Intent'), h('select', { onchange: e => { pr.intent = e.target.value; this.refreshNeed(); } }, h('option', { value: 'perceptual', selected: pr.intent === 'perceptual' }, 'Perceptual'), h('option', { value: 'relative', selected: pr.intent === 'relative' }, 'Relative'))),
      ck('paper', 'Simulate Paper & Ink'), ck('gamut', 'Show Destination Gamut Warning'),
      h('div', { class: 'fnote' }, cur && cur.space === 'CMYK' ? 'CMYK proof: colours are shown as this press/printer profile would reproduce them.' : 'Preview of how the photo will look in the chosen output profile.'),
      h('div', { class: 'dlg-inline' }, h('button', { class: 'btn', title: 'Make a virtual copy to hold proof-specific adjustments', onclick: async () => { await Lib.virtualCopy(); const p = App.cur(); if (p && p.master_id) App.setMeta([p.id], { copy_name: 'Proof – ' + (cur ? cur.name : pr.profile).slice(0, 40) }); } }, 'Create Proof Copy'),
        h('button', { class: 'btn', title: 'Add an .icc / .icm profile from disk', onclick: async () => { const f = await UI.pickFile('', ['.icc', '.icm']); if (f) { App.boot.profiles = await api('profile_add', { path: f }); this.drawProof(); } } }, 'Add Profile…')));
  },
  /* Tone curve editor: point curve per channel over the histogram, plus parametric region sliders. */
  buildCurve() {
    let ch = 'rgb', drag = -1;
    const N = 236, cv = h('canvas', { width: N, height: N, class: 'curve' }), S = (...a) => this.slider(...a);
    const pts = () => this.s.curve[ch], toC = p => [p[0] / 255 * N, N - p[1] / 255 * N];
    const draw = this.curveDraw = () => {
      const x = cv.getContext('2d'); x.fillStyle = Theme.css('--input'); x.fillRect(0, 0, N, N);
      const H = this.lastHist; if (H) { let mx = 1; for (let i = 3; i < 253; i++) mx = Math.max(mx, H.l[i]); x.fillStyle = '#333'; x.beginPath(); x.moveTo(0, N); for (let i = 0; i < 256; i++) x.lineTo(i / 255 * N, N - Math.min(1, H.l[i] / mx) * N * 0.9); x.lineTo(N, N); x.fill(); }
      x.strokeStyle = '#3a3a3a'; x.lineWidth = 1; x.beginPath(); for (let i = 1; i < 4; i++) { x.moveTo(i * N / 4 + 0.5, 0); x.lineTo(i * N / 4 + 0.5, N); x.moveTo(0, i * N / 4 + 0.5); x.lineTo(N, i * N / 4 + 0.5); } x.moveTo(0, N); x.lineTo(N, 0); x.stroke();
      const lut = curveLUT(this.s), idx = { rgb: 3, r: 0, g: 1, b: 2 }[ch];
      x.strokeStyle = { rgb: '#ddd', r: '#e55', g: '#5c5', b: '#58f' }[ch]; x.lineWidth = 1.6; x.beginPath();
      for (let i = 0; i < 256; i++) { const y = N - lut[i * 4 + idx] / 255 * N; i ? x.lineTo(i / 255 * N, y) : x.moveTo(0, y); } x.stroke();
      for (const p of pts()) { const [cx, cy] = toC(p); x.fillStyle = '#fff'; x.beginPath(); x.arc(cx, cy, 3.5, 0, 7); x.fill(); }
      $$('a', tabs).forEach(a => a.classList.toggle('on', a.dataset.c === ch));
    };
    const pos = e => { const b = cv.getBoundingClientRect(); return [clamp((e.clientX - b.left) / b.width * 255, 0, 255), clamp(255 - (e.clientY - b.top) / b.height * 255, 0, 255)]; };
    cv.onmousedown = e => {
      const [px, py] = pos(e), P = pts(); drag = P.findIndex(p => Math.hypot(p[0] - px, p[1] - py) < 9);
      if (e.button === 2 || e.detail > 1) { if (drag > 0 && drag < P.length - 1) { P.splice(drag, 1); draw(); this.render(); this.commit('Tone Curve point removed'); } drag = -1; return; }
      if (drag < 0) { P.push([Math.round(px), Math.round(py)]); P.sort((a, b) => a[0] - b[0]); drag = P.findIndex(p => p[0] === Math.round(px)); }
      const move = ev => { const [mx, my] = pos(ev), q = pts(); const lo = drag > 0 ? q[drag - 1][0] + 2 : 0, hi = drag < q.length - 1 ? q[drag + 1][0] - 2 : 255; q[drag] = [drag === 0 ? Math.min(Math.round(mx), hi) : drag === q.length - 1 ? Math.max(Math.round(mx), lo) : clamp(Math.round(mx), lo, hi), Math.round(my)]; draw(); this.render(); };
      const up = () => { removeEventListener('mousemove', move); removeEventListener('mouseup', up); this.commit('Tone Curve'); };
      addEventListener('mousemove', move); addEventListener('mouseup', up); move(e);
    };
    const tabs = h('div', { class: 'seg' }, [['rgb', 'RGB'], ['r', 'Red'], ['g', 'Green'], ['b', 'Blue']].map(([c, l]) => h('a', { data: { c }, onclick: () => { ch = c; draw(); } }, l)));
    const presets = { Linear: LINE(), 'Medium Contrast': [[0, 0], [64, 52], [128, 128], [192, 204], [255, 255]], 'Strong Contrast': [[0, 0], [64, 40], [128, 128], [192, 218], [255, 255]], 'Lift Shadows': [[0, 18], [70, 86], [255, 255]], Negative: [[0, 255], [255, 0]] };
    const preSel = h('select', { onchange: () => { if (presets[preSel.value]) { this.s.curve[ch] = clone(presets[preSel.value]); draw(); this.render(); this.commit('Point Curve: ' + preSel.value); } preSel.value = ''; } }, h('option', { value: '' }, 'Point Curve…'), Object.keys(presets).map(n => h('option', {}, n)));
    const live = { live: () => draw() };
    return h('div', {}, h('div', { class: 'frow' }, tabs, preSel), cv, h('div', { class: 'fnote' }, 'Click to add a point, drag to shape, right-click or double-click a point to remove it.'),
      this.section('Region'), S('pcHighlights', 'Highlights', -100, 100, 1, live), S('pcLights', 'Lights', -100, 100, 1, live), S('pcDarks', 'Darks', -100, 100, 1, live), S('pcShadows', 'Shadows', -100, 100, 1, live),
      this.section('Split Points'), S('pcSplit.0', 'Shadows', 5, 45, 1, live), S('pcSplit.1', 'Midtones', 30, 70, 1, live), S('pcSplit.2', 'Highlights', 55, 95, 1, live));
  },
};
/* Off-screen renders use their own framebuffer and the main view resets its viewport on every draw, so nothing to restore. */
function gl_restore() {}

'use strict';
/* Slideshow, Print and Web modules. */

const FONTS = ['Segoe UI', 'Georgia', 'Arial', 'Times New Roman', 'Palatino Linotype', 'Trebuchet MS', 'Verdana', 'Courier New', 'Segoe Script'];
const POS9 = ANCHORS;
const place = (anchor, W, H, w, hh, m) => [anchor[1] === 'l' ? m : anchor[1] === 'r' ? W - m - w : (W - w) / 2, anchor[0] === 't' ? m : anchor[0] === 'b' ? H - m - hh : (H - hh) / 2];

/* ------------------------------------------------------------------ Slideshow */
const Slideshow = {
  id: 'slideshow', name: 'Slideshow', idx: 0, playing: false,
  keys: { ArrowRight: () => Slideshow.go(1), ArrowLeft: () => Slideshow.go(-1), Enter: () => Slideshow.play(true), Space: () => (Slideshow.playing ? Slideshow.stop() : Slideshow.play(false)), Escape: () => Slideshow.stop() },
  defaults: { fill: false, stroke: true, strokeColor: '#ffffff', strokeWidth: 2, shadow: true, shadowOpacity: 45, shadowRadius: 30, mL: 6, mR: 6, mT: 6, mB: 10, aspect: 'screen', bg: '#101010', wash: true, washColor: '#3a3a3a', washAngle: 45, bgImage: '',
    plate: true, plateScale: 4, plateOpacity: 90, platePos: 'tl', wm: false, wmPreset: 'Simple Copyright', stars: false, text: true, textTpl: '{title}', textPos: 'bc', textSize: 2.6, textColor: '#e6e6e6', textFont: 'Segoe UI',
    intro: true, introText: '', ending: true, music: '', length: 4, fade: 1.2, kenBurns: 25, repeat: true, random: false },
  init(el) {
    this.st = Mod.store('slideshow', this.defaults);
    this.cv = h('canvas', { class: 'ss-cv' }); this.host = h('div', { class: 'ss-host', ondblclick: () => this.play(true) }, this.cv); this.tb = h('div', { class: 'toolbar' });
    el.center.append(this.host, this.tb);
    const form = h('div'), ch = () => { this.st._save(); this.draw(); };
    const draw = () => form.replaceChildren(UI.form(this.spec(), this.st, ch));
    this.redrawForm = draw;
    el.left.append(UI.panel('Template Browser', h('div', {}, UI.presetBar('slideshow_templates', () => { const { _save, ...r } = this.st; return r; }, t => { Object.assign(this.st, this.defaults, t); draw(); ch(); }, { 'Default': this.defaults, 'Widescreen Black': { ...this.defaults, wash: false, bg: '#000000', mL: 0, mR: 0, mT: 0, mB: 0, stroke: false, shadow: false, fill: true, text: false, plate: false }, 'Gallery White': { ...this.defaults, bg: '#f4f4f2', wash: false, strokeColor: '#222222', textColor: '#333333', mL: 12, mR: 12, mT: 10, mB: 16 }, 'Caption & Rating': { ...this.defaults, stars: true, textTpl: '{title}  •  {date}' } }),
      h('div', { class: 'fnote' }, 'Save your layout as a template to reuse it for other collections.')), { key: 'sstpl' }));
    el.right.append(UI.panel('Slideshow Settings', form, { key: 'ssopt' }), h('div', { class: 'side-foot' }, h('button', { class: 'btn', onclick: () => this.export('pdf') }, 'Export PDF…'), h('button', { class: 'btn', onclick: () => this.export('video') }, 'Export Video…'), h('button', { class: 'btn', onclick: () => this.export('jpeg') }, 'Export JPEGs…')));
    draw();
    new ResizeObserver(() => this.draw()).observe(this.host);
    App.on('selection', () => { if (App.module === 'slideshow' && !this.playing) { const i = Mod.photos().findIndex(p => p.id === App.active); if (i >= 0) this.idx = i; this.draw(); } });
    document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && this.full) { this.full = false; this.stop(); } this.draw(); });
    this.toolbar();
  },
  spec() {
    const T = o => o.text;
    return [{ t: 'section', label: 'Options' }, { k: 'fill', label: 'Zoom to Fill Frame', t: 'check' }, { k: 'stroke', label: 'Stroke Border', t: 'check' }, { k: 'strokeColor', label: 'Stroke Colour', t: 'color', show: o => o.stroke }, { k: 'strokeWidth', label: 'Stroke Width', t: 'range', min: 1, max: 20, def: 2, show: o => o.stroke },
      { k: 'shadow', label: 'Cast Shadow', t: 'check' }, { k: 'shadowOpacity', label: 'Shadow Opacity', t: 'range', min: 0, max: 100, def: 45, show: o => o.shadow }, { k: 'shadowRadius', label: 'Shadow Radius', t: 'range', min: 0, max: 100, def: 30, show: o => o.shadow },
      { t: 'section', label: 'Layout' }, { k: 'aspect', label: 'Aspect Preview', t: 'select', opts: [['screen', 'Screen'], ['16:9', '16:9'], ['4:3', '4:3'], ['1:1', '1:1']] }, { k: 'mL', label: 'Left', t: 'range', min: 0, max: 40, def: 6 }, { k: 'mR', label: 'Right', t: 'range', min: 0, max: 40, def: 6 }, { k: 'mT', label: 'Top', t: 'range', min: 0, max: 40, def: 6 }, { k: 'mB', label: 'Bottom', t: 'range', min: 0, max: 40, def: 10 },
      { t: 'section', label: 'Overlays' }, { k: 'plate', label: 'Identity Plate', t: 'check' }, { k: 'platePos', label: 'Plate Position', t: 'select', opts: POS9, show: o => o.plate }, { k: 'plateScale', label: 'Plate Scale', t: 'range', min: 1, max: 20, step: 0.5, def: 4, show: o => o.plate }, { k: 'plateOpacity', label: 'Plate Opacity', t: 'range', min: 0, max: 100, def: 90, show: o => o.plate },
      { t: 'button', label: 'Edit Identity Plate…', show: o => o.plate, run: async () => { await Identity.edit(); this.draw(); } }, { k: 'wm', label: 'Watermarking', t: 'check' }, { k: 'wmPreset', label: 'Watermark', t: 'select', opts: () => Object.keys(Watermark.all()), show: o => o.wm }, { k: 'stars', label: 'Rating Stars', t: 'check' },
      { k: 'text', label: 'Text Overlay', t: 'check' }, { k: 'textTpl', label: 'Text', show: T, ph: '{title} {caption} {filename} {date} {exif}' }, { k: 'textPos', label: 'Text Position', t: 'select', opts: POS9, show: T }, { k: 'textFont', label: 'Font', t: 'select', opts: FONTS, show: T }, { k: 'textSize', label: 'Text Size', t: 'range', min: 1, max: 8, step: 0.1, def: 2.6, show: T }, { k: 'textColor', label: 'Text Colour', t: 'color', show: T },
      { t: 'section', label: 'Backdrop' }, { k: 'bg', label: 'Background Colour', t: 'color' }, { k: 'wash', label: 'Colour Wash', t: 'check' }, { k: 'washColor', label: 'Wash Colour', t: 'color', show: o => o.wash }, { k: 'washAngle', label: 'Wash Angle', t: 'range', min: 0, max: 360, def: 45, show: o => o.wash }, { k: 'bgImage', label: 'Background Image', t: 'file', exts: ['.jpg', '.jpeg', '.png', '.webp'] },
      { t: 'section', label: 'Titles' }, { k: 'intro', label: 'Intro Screen', t: 'check' }, { k: 'introText', label: 'Intro Text', ph: '(identity plate)', show: o => o.intro }, { k: 'ending', label: 'Ending Screen', t: 'check' },
      { t: 'section', label: 'Music' }, { k: 'music', label: 'Audio File', t: 'file', exts: ['.mp3', '.wav', '.m4a', '.ogg', '.flac', '.aac'] },
      { t: 'section', label: 'Playback' }, { k: 'length', label: 'Slide Length (s)', t: 'range', min: 1, max: 20, step: 0.5, def: 4 }, { k: 'fade', label: 'Crossfade (s)', t: 'range', min: 0, max: 5, step: 0.1, def: 1.2 }, { k: 'kenBurns', label: 'Pan and Zoom', t: 'range', min: 0, max: 100, def: 25 }, { k: 'repeat', label: 'Repeat Slideshow', t: 'check' }, { k: 'random', label: 'Random Order', t: 'check' }];
  },
  size() { const W = this.host.clientWidth, H = this.host.clientHeight, a = { '16:9': 16 / 9, '4:3': 4 / 3, '1:1': 1 }[this.st.aspect]; if (document.fullscreenElement || !a) return [W, H]; return W / H > a ? [H * a, H] : [W, W / a]; },
  async backdrop(x, W, H) {
    const st = this.st; x.globalAlpha = 1; x.fillStyle = st.bg; x.fillRect(0, 0, W, H);
    if (st.bgImage) { try { const im = await Watermark.image(st.bgImage), f = Mod.fit(im.naturalWidth, im.naturalHeight, W, H, true); x.drawImage(im, f.x, f.y, f.w, f.h); } catch (e) { /* missing */ } }
    if (st.wash) { const r = st.washAngle * Math.PI / 180, dx = Math.cos(r) * W / 2, dy = Math.sin(r) * H / 2, g = x.createLinearGradient(W / 2 - dx, H / 2 - dy, W / 2 + dx, H / 2 + dy); g.addColorStop(0, st.washColor); g.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = g; x.fillRect(0, 0, W, H); }
  },
  /* one slide: photo within margins + overlays. t = 0..1 progress for pan & zoom */
  async slide(x, W, H, p, i, n, t = 0, alpha = 1) {
    const st = this.st, ax = st.mL / 100 * W, ay = st.mT / 100 * H, aw = W - ax - st.mR / 100 * W, ah = H - ay - st.mB / 100 * H;
    const im = await Mod.image(p, Math.min(4096, Math.max(1024, Math.ceil(Math.max(aw, ah) * 1.3 / 512) * 512)));
    let f = Mod.fit(im.naturalWidth, im.naturalHeight, aw, ah, st.fill); const box = st.fill ? { x: 0, y: 0, w: aw, h: ah } : f;
    x.save(); x.globalAlpha = alpha;
    if (st.shadow) { x.shadowColor = `rgba(0,0,0,${st.shadowOpacity / 100})`; x.shadowBlur = st.shadowRadius / 100 * W * 0.06; x.shadowOffsetX = x.shadowOffsetY = W * 0.006; x.fillStyle = '#000'; x.fillRect(ax + box.x, ay + box.y, box.w, box.h); x.shadowColor = 'transparent'; }
    x.save(); x.beginPath(); x.rect(ax + box.x, ay + box.y, box.w, box.h); x.clip();
    const k = 1 + st.kenBurns / 100 * 0.18 * t, dir = i % 2 ? -1 : 1, zx = ax + f.x + f.w / 2 + dir * st.kenBurns / 100 * f.w * 0.03 * t, zy = ay + f.y + f.h / 2;
    x.drawImage(im, zx - f.w * k / 2, zy - f.h * k / 2, f.w * k, f.h * k); x.restore();
    if (st.stroke) { x.strokeStyle = st.strokeColor; x.lineWidth = st.strokeWidth * W / 1600; x.strokeRect(ax + box.x, ay + box.y, box.w, box.h); }
    const m = W * 0.03;
    if (st.text) { const txt = Mod.text(p, st.textTpl, i, n); if (txt) { const px = st.textSize / 100 * H; x.font = `${px}px "${st.textFont}", sans-serif`; const tw = x.measureText(txt).width, [tx, ty] = place(st.textPos, W, H, tw, px, m); x.fillStyle = st.textColor; x.textBaseline = 'top'; x.textAlign = 'left'; x.fillText(txt, tx, ty); } }
    if (st.stars && p.rating) { const px = H * 0.03; x.font = `${px}px Segoe UI`; x.fillStyle = '#f3c63f'; x.textBaseline = 'top'; x.fillText('★'.repeat(p.rating), ax + box.x, ay + box.y + box.h + px * 0.4); }
    x.restore();
    if (st.plate) { const ph = st.plateScale / 100 * H, [px, py] = place(st.platePos, W, H, 0, ph, m + ph); await Identity.draw(x, st.platePos[1] === 'c' ? W / 2 : px + (st.platePos[1] === 'l' ? ph * 2 : -ph * 2), py + ph / 2, ph, st.plateOpacity / 100 * alpha); }
    if (st.wm) { x.save(); x.globalAlpha = alpha; await Watermark.draw(x.canvas, Watermark.all()[st.wmPreset] || WM_DEFAULT, p); x.restore(); }
  },
  async title(x, W, H, text, alpha) { x.save(); x.globalAlpha = alpha; x.fillStyle = '#000'; x.fillRect(0, 0, W, H); x.restore(); if (text) { x.save(); x.globalAlpha = alpha; x.fillStyle = '#eee'; x.font = `${H * 0.06}px Georgia`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(text, W / 2, H / 2); x.restore(); } else await Identity.draw(x, W / 2, H / 2, H * 0.07, alpha, '#eeeeee'); },
  async draw() {
    if (App.module !== 'slideshow' || this.playing) return;
    const ps = Mod.photos(), [W, H] = this.size(), dpr = devicePixelRatio, cv = this.cv;
    cv.style.width = W + 'px'; cv.style.height = H + 'px'; cv.width = W * dpr; cv.height = H * dpr;
    const x = cv.getContext('2d'); await this.backdrop(x, cv.width, cv.height);
    this.idx = clamp(this.idx, 0, Math.max(0, ps.length - 1));
    if (ps[this.idx]) { try { await this.slide(x, cv.width, cv.height, ps[this.idx], this.idx, ps.length); } catch (e) { /* offline */ } } else { x.fillStyle = '#888'; x.font = '14px Segoe UI'; x.fillText('No photos in the filmstrip', 20, 30); }
    this.toolbar();
  },
  go(d) { if (this.playing) { this.skip = d; return; } const ps = Mod.photos(); this.idx = clamp(this.idx + d, 0, ps.length - 1); if (ps[this.idx]) App.select(ps[this.idx].id); this.draw(); },
  timeline() { const ps = [...Mod.photos()]; if (this.st.random) ps.sort(() => Math.random() - 0.5); const seq = ps.map(p => ({ p })); if (this.st.intro) seq.unshift({ title: this.st.introText || '' }); if (this.st.ending) seq.push({ title: '', end: true }); return seq; },
  /* play: canvas animation with crossfades; `full` uses the whole screen. Resolves when the show ends. */
  async play(full, target, record) {
    if (this.playing) return; const seq = this.timeline(); if (!seq.length) return;
    this.playing = true; this.full = !!full; this.toolbar();
    if (full) { try { await this.host.requestFullscreen(); } catch (e) { /* not allowed */ } }
    const st = this.st, cv = target || this.cv, x = cv.getContext('2d');
    if (!target) { const [W, H] = this.size(), d = devicePixelRatio; cv.style.width = W + 'px'; cv.style.height = H + 'px'; cv.width = W * d; cv.height = H * d; }
    const W = cv.width, H = cv.height, idxOf = s => (s.p ? Mod.photos().indexOf(s.p) : 0), n = Mod.photos().length;
    if (st.music && !this.audio) { this.audio = new Audio('/img/media?path=' + encodeURIComponent(st.music)); this.audio.loop = true; }
    if (st.music && this.audio) { this.audio.currentTime = 0; this.audio.play().catch(() => {}); }
    const paint = async (s, t, a) => { if (s.title != null) await this.title(x, W, H, s.end ? '' : s.title, a); else { try { await this.slide(x, W, H, s.p, idxOf(s), n, t, a); } catch (e) { /* skip unreadable */ } } };
    let i = 0;
    while (this.playing) {
      const cur = seq[i], next = seq[i + 1] || (st.repeat && !record ? seq[0] : null), len = cur.title != null ? Math.min(st.length, 2.5) : st.length, t0 = performance.now();
      this.skip = 0;
      if (cur.p) await Mod.image(cur.p, 2048).catch(() => {});
      while (this.playing && !this.skip) {
        const el = (performance.now() - t0) / 1000; if (el >= len) break;
        const fadeIn = next && el > len - st.fade ? (el - (len - st.fade)) / st.fade : 0;
        await this.backdrop(x, W, H); await paint(cur, el / len, 1); if (fadeIn > 0) await paint(next, 0, fadeIn);
        await new Promise(r => requestAnimationFrame(r));
      }
      if (!this.playing) break;
      if (this.skip < 0) i = Math.max(0, i - 1); else { i++; if (i >= seq.length) { if (st.repeat && !record) i = 0; else break; } }
    }
    this.stop();
  },
  stop() { const was = this.playing; this.playing = false; if (this.audio) this.audio.pause(); if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); this.full = false; if (was) setTimeout(() => this.draw(), 60); this.toolbar(); },
  toolbar() {
    const ps = Mod.photos();
    this.tb.replaceChildren(h('span', { class: 'tb-group' }, h('button', { class: 'tbtn', onclick: () => this.go(-1) }, '◀'), h('button', { class: 'tbtn', onclick: () => this.go(1) }, '▶'),
      this.playing ? h('button', { class: 'tbtn on', onclick: () => this.stop() }, '■ Stop') : [h('button', { class: 'tbtn', title: 'Preview in this window (Space)', onclick: () => this.play(false) }, '▷ Preview'), h('button', { class: 'tbtn', title: 'Play full screen (Enter). Esc stops.', onclick: () => this.play(true) }, '▶ Play')]),
      h('span', { class: 'tb-fill' }), h('span', { class: 'dim' }, ps.length ? `Slide ${this.idx + 1} of ${ps.length}  •  about ${Math.round(ps.length * this.st.length)} s` : ''), Mod.useSelect(() => { this.idx = 0; this.draw(); }));
  },
  async export(kind) {
    const ps = Mod.photos(); if (!ps.length) return;
    const folder = await UI.pickFolder(App.boot.pictures); if (!folder) return;
    const { session } = await api('session_begin', { staging: true }), cv = h('canvas', { width: 1920, height: 1080 }), x = cv.getContext('2d'), name = App.sourceName().replace(/[\\/:*?"<>|]/g, '_').slice(0, 60) || 'Slideshow';
    if (kind === 'video') {
      if (!window.MediaRecorder) return UI.alert('Export Video', 'This browser cannot record video.');
      const stream = cv.captureStream(30), mime = ['video/mp4;codecs=avc1', 'video/webm;codecs=vp9', 'video/webm'].find(m => MediaRecorder.isTypeSupported(m)), rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8e6 }), chunks = [];
      rec.ondataavailable = e => chunks.push(e.data); const done = new Promise(r => { rec.onstop = r; });
      const prog = Progress('Recording slideshow (plays in real time)'); prog.set(0, 0, 'Esc cancels');
      rec.start(500); await this.play(false, cv, true); rec.stop(); await done; prog.done();
      const file = name + (mime.includes('mp4') ? '.mp4' : '.webm'); await upload('session_put', { session, name: file }, new Blob(chunks, { type: mime }));
      const r = await runJob(api('session_finish', { session, deliver: { dest: 'folder', folder, post: 'reveal' } }), 'Saving video'); return UI.toast('Video saved to ' + r.dir + ' (silent: add the music track in a video editor if needed)');
    }
    const prog = Progress('Rendering slides'), names = [];
    try { for (let i = 0; i < ps.length; i++) { prog.set(i, ps.length, ps[i].filename); await this.backdrop(x, 1920, 1080); await this.slide(x, 1920, 1080, ps[i], i, ps.length); const nm = `slide-${String(i + 1).padStart(3, '0')}.jpg`; await upload('session_put', { session, name: nm }, await Render.blob(cv, 'image/jpeg', 0.92)); names.push(nm); } } finally { prog.done(); }
    if (kind === 'pdf') { const r = await api('pdf_build', { session, pages: names, dest: folder + '\\' + name + ' Slideshow.pdf', dpi: 144 }); UI.toast('PDF slideshow saved: ' + r.path); }
    else { const r = await runJob(api('session_finish', { session, deliver: { dest: 'folder', folder: folder + '\\' + name + ' Slides', post: 'reveal' } }), 'Saving slides'); UI.toast(`${r.files.length} slides saved to ${r.dir}`); }
  },
};

/* ------------------------------------------------------------------ Print */
const PAPERS = { Letter: [8.5, 11], Legal: [8.5, 14], Tabloid: [11, 17], A5: [5.83, 8.27], A4: [8.27, 11.69], A3: [11.69, 16.54], '4 × 6 in': [4, 6], '5 × 7 in': [5, 7], '8 × 10 in': [8, 10], '11 × 14 in': [11, 14], '13 × 19 in': [13, 19] };
const PACKAGES = { '(1) 5×7, (4) 2.5×3.5': [[7, 5], [3.5, 2.5], [3.5, 2.5], [3.5, 2.5], [3.5, 2.5]], '(2) 5×7': [[7, 5], [7, 5]], '(4) 4×5': [[4, 5], [4, 5], [4, 5], [4, 5]], '(1) 8×10': [[8, 10]], '(9) Wallets 2.5×3.5': Array(9).fill([2.5, 3.5]), '(2) 4×6, (4) 2×3': [[6, 4], [6, 4], [3, 2], [3, 2], [3, 2], [3, 2]] };
const Print = {
  id: 'print', name: 'Print', page: 0, keys: { ArrowRight: () => Print.turn(1), ArrowLeft: () => Print.turn(-1) },
  defaults: { style: 'grid', paper: 'A4', landscape: false, rows: 1, cols: 1, mL: 0.5, mR: 0.5, mT: 0.5, mB: 0.5, gapH: 0.2, gapV: 0.2, square: false, fill: false, rotate: true, repeat: false, stroke: false, strokeWidth: 1, strokeColor: '#000000', pack: '(1) 5×7, (4) 2.5×3.5', cells: [],
    bg: '#ffffff', plate: false, plateScale: 3, platePos: 'bc', plateOpacity: 100, wm: false, wmPreset: 'Simple Copyright', numbers: false, info: false, marks: false, caption: false, captionTpl: '{filename}', captionSize: 9, guides: true,
    printTo: 'printer', ppi: 240, sharpen: 'standard', media: 'glossy', profile: 'sRGB', intent: 'perceptual', quality: 92 },
  init(el) {
    this.st = Mod.store('print', this.defaults);
    this.cv = h('canvas', { class: 'pr-cv' }); this.host = h('div', { class: 'pr-host' }, this.cv); this.tb = h('div', { class: 'toolbar' }); el.center.append(this.host, this.tb);
    const form = h('div'), ch = () => { this.st._save(); this.draw(); }, draw = () => form.replaceChildren(UI.form(this.spec(), this.st, ch));
    const strip = o => { const { _save, cells, ...r } = o; return r; };
    el.left.append(UI.panel('Template Browser', h('div', {}, UI.presetBar('print_templates', () => strip(this.st), t => { Object.assign(this.st, this.defaults, t); draw(); ch(); }, { 'Fine Art Mat': { ...this.defaults, mL: 1.2, mR: 1.2, mT: 1.2, mB: 1.8 }, 'Maximize Size': { ...this.defaults, mL: 0.25, mR: 0.25, mT: 0.25, mB: 0.25 }, '4×5 Contact Sheet': { ...this.defaults, rows: 5, cols: 4, caption: true, gapH: 0.12, gapV: 0.12 }, '2×2 Cells': { ...this.defaults, rows: 2, cols: 2 }, 'Triptych': { ...this.defaults, landscape: true, rows: 1, cols: 3, mT: 1.5, mB: 1.5 }, 'Picture Package 5×7 + Wallets': { ...this.defaults, style: 'package' } }),
      h('div', { class: 'fnote' }, 'Templates store the whole layout. Pick one, adjust, and save your own.')), { key: 'prtpl' }));
    el.right.append(UI.panel('Print Settings', form, { key: 'propt' }), h('div', { class: 'side-foot' }, h('button', { class: 'btn primary', onclick: () => this.print() }, 'Print…'), h('button', { class: 'btn', onclick: () => this.toFile() }, 'Print to File…')));
    draw(); this.toolbar();
    new ResizeObserver(() => this.draw()).observe(this.host);
    App.on('selection', () => { if (App.module === 'print') this.draw(); });
    const cv = this.cv;
    cv.ondragover = e => { if (this.st.style === 'custom' && e.dataTransfer.types.includes('text/opia-photos')) e.preventDefault(); };
    cv.ondrop = e => { const d = e.dataTransfer.getData('text/opia-photos'); if (!d) return; e.preventDefault(); const [ix, iy] = this.inch(e), c = this.st.cells.find(k => ix >= k.x && ix <= k.x + k.w && iy >= k.y && iy <= k.y + k.h); const id = JSON.parse(d)[0]; if (c) c.photo = id; else this.st.cells.push({ x: Math.max(0, ix - 2), y: Math.max(0, iy - 1.5), w: 4, h: 3, photo: id }); ch(); };
    cv.onmousedown = e => { if (this.st.style !== 'custom') return; const [ix, iy] = this.inch(e), c = [...this.st.cells].reverse().find(k => ix >= k.x && ix <= k.x + k.w && iy >= k.y && iy <= k.y + k.h); if (!c) return; this.selCell = c; const resize = ix > c.x + c.w - 0.35 && iy > c.y + c.h - 0.35, o = { ...c };
      const mv = ev => { const [mx, my] = this.inch(ev); if (resize) { c.w = Math.max(0.5, o.w + mx - ix); c.h = Math.max(0.5, o.h + my - iy); } else { c.x = o.x + mx - ix; c.y = o.y + my - iy; } this.draw(); }, up = () => { removeEventListener('mousemove', mv); removeEventListener('mouseup', up); this.st._save(); };
      addEventListener('mousemove', mv); addEventListener('mouseup', up); this.draw(); };
    cv.oncontextmenu = e => { if (this.st.style !== 'custom') return; const [ix, iy] = this.inch(e), c = this.st.cells.find(k => ix >= k.x && ix <= k.x + k.w && iy >= k.y && iy <= k.y + k.h); if (c) UI.menu(e.clientX, e.clientY, [{ label: 'Rotate Cell', run: () => { [c.w, c.h] = [c.h, c.w]; ch(); } }, { label: 'Delete Cell', run: () => { this.st.cells = this.st.cells.filter(k => k !== c); ch(); } }]); };
  },
  spec() {
    const G = o => o.style === 'grid', profs = [['printer', 'Managed by Printer'], ...(App.boot.profiles || []).map(p => [p.id, p.name + (p.space !== 'RGB' ? ` (${p.space})` : '')])];
    return [{ t: 'section', label: 'Layout Style' }, { k: 'style', label: 'Style', t: 'select', opts: [['grid', 'Single Image / Contact Sheet'], ['package', 'Picture Package'], ['custom', 'Custom Package']] },
      { k: 'pack', label: 'Package', t: 'select', opts: Object.keys(PACKAGES), show: o => o.style === 'package' }, { t: 'note', label: 'Drag photos from the filmstrip onto the page. Drag cells to move them, their bottom-right corner to resize, right-click for more.', show: o => o.style === 'custom' },
      { t: 'custom', show: o => o.style === 'custom', el: (o, re) => h('div', { class: 'dlg-inline' }, [[2, 3], [4, 6], [5, 7], [8, 10]].map(([a, b]) => h('button', { class: 'btn', onclick: () => { o.cells.push({ x: 0.5 + o.cells.length * 0.25, y: 0.5 + o.cells.length * 0.25, w: b, h: a, photo: App.active }); this.st._save(); this.draw(); } }, `+ ${a}×${b}`)), h('button', { class: 'btn', onclick: () => { o.cells = []; this.st._save(); this.draw(); re(); } }, 'Clear')) },
      { t: 'section', label: 'Page Setup' }, { k: 'paper', label: 'Paper Size', t: 'select', opts: Object.keys(PAPERS) }, { k: 'landscape', label: 'Landscape Orientation', t: 'check' },
      { t: 'section', label: 'Image Settings' }, { k: 'fill', label: 'Zoom to Fill', t: 'check' }, { k: 'rotate', label: 'Rotate to Fit', t: 'check' }, { k: 'repeat', label: 'Repeat One Photo per Page', t: 'check', show: G }, { k: 'stroke', label: 'Stroke Border', t: 'check' }, { k: 'strokeWidth', label: 'Width (pt)', t: 'range', min: 0.5, max: 20, step: 0.5, def: 1, show: o => o.stroke }, { k: 'strokeColor', label: 'Stroke Colour', t: 'color', show: o => o.stroke },
      { t: 'section', label: 'Layout (inches)', show: G }, ...['mL:Left', 'mR:Right', 'mT:Top', 'mB:Bottom'].map(s => { const [k, label] = s.split(':'); return { k, label: 'Margin ' + label, t: 'range', min: 0, max: 4, step: 0.05, def: 0.5, show: G }; }),
      { k: 'rows', label: 'Rows', t: 'range', min: 1, max: 12, def: 1, show: G }, { k: 'cols', label: 'Columns', t: 'range', min: 1, max: 12, def: 1, show: G }, { k: 'gapV', label: 'Cell Spacing Vertical', t: 'range', min: 0, max: 2, step: 0.05, def: 0.2, show: G }, { k: 'gapH', label: 'Cell Spacing Horizontal', t: 'range', min: 0, max: 2, step: 0.05, def: 0.2, show: G }, { k: 'square', label: 'Keep Square', t: 'check', show: G },
      { t: 'section', label: 'Guides' }, { k: 'guides', label: 'Show Margins, Gutters and Image Cells', t: 'check' },
      { t: 'section', label: 'Page' }, { k: 'bg', label: 'Page Background Colour', t: 'color' }, { k: 'plate', label: 'Identity Plate', t: 'check' }, { k: 'platePos', label: 'Plate Position', t: 'select', opts: POS9, show: o => o.plate }, { k: 'plateScale', label: 'Plate Scale', t: 'range', min: 1, max: 15, step: 0.5, def: 3, show: o => o.plate }, { k: 'plateOpacity', label: 'Plate Opacity', t: 'range', min: 5, max: 100, def: 100, show: o => o.plate },
      { k: 'wm', label: 'Watermarking', t: 'check' }, { k: 'wmPreset', label: 'Watermark', t: 'select', opts: () => Object.keys(Watermark.all()), show: o => o.wm }, { k: 'numbers', label: 'Page Numbers', t: 'check' }, { k: 'info', label: 'Page Info', t: 'check' }, { k: 'marks', label: 'Crop Marks', t: 'check' },
      { k: 'caption', label: 'Photo Info', t: 'check' }, { k: 'captionTpl', label: 'Text', show: o => o.caption, ph: '{filename} {title} {caption} {date} {exif}' }, { k: 'captionSize', label: 'Font Size (pt)', t: 'range', min: 6, max: 24, def: 9, show: o => o.caption },
      { t: 'section', label: 'Print Job' }, { k: 'printTo', label: 'Print to', t: 'select', opts: [['printer', 'Printer'], ['jpeg', 'JPEG File'], ['pdf', 'PDF File']] }, { k: 'ppi', label: 'Print Resolution (ppi)', t: 'number', min: 72, max: 720 },
      { k: 'sharpen', label: 'Print Sharpening', t: 'select', opts: [['off', 'Off'], ['low', 'Low'], ['standard', 'Standard'], ['high', 'High']] }, { k: 'media', label: 'Media Type', t: 'select', opts: [['glossy', 'Glossy'], ['matte', 'Matte']], show: o => o.sharpen !== 'off' },
      { k: 'profile', label: 'Colour Profile', t: 'select', opts: profs }, { k: 'intent', label: 'Intent', t: 'select', opts: [['perceptual', 'Perceptual'], ['relative', 'Relative']], show: o => o.profile !== 'printer' },
      { t: 'note', label: o => (o.printTo === 'printer' ? 'Printing to a printer goes through the system print dialog, where the printer driver manages colour.' : 'Files are converted to the chosen profile, with the profile embedded.') }];
  },
  paper() { const [w, hh] = PAPERS[this.st.paper] || PAPERS.A4; return this.st.landscape ? [hh, w] : [w, hh]; },
  inch(e) { const b = this.cv.getBoundingClientRect(), [pw] = this.paper(); return [(e.clientX - b.left) / b.width * pw, (e.clientY - b.top) / b.width * pw]; },
  /* layout of one page in inches */
  cellsFor(pi) {
    const st = this.st, [pw, ph] = this.paper(), ps = Mod.photos();
    if (st.style === 'custom') return st.cells.map(c => ({ ...c, p: App.photo(c.photo) }));
    if (st.style === 'package') { const out = []; let x = 0.25, y = 0.25, rowH = 0; for (const [w, hh] of PACKAGES[st.pack] || []) { let cw = w, c2 = hh; if (x + cw > pw - 0.2 && x + c2 <= pw - 0.2) [cw, c2] = [c2, cw]; if (x + cw > pw - 0.2) { x = 0.25; y += rowH + 0.15; rowH = 0; } if (y + c2 > ph - 0.2 && cw !== c2 && y + cw <= ph - 0.2) [cw, c2] = [c2, cw]; out.push({ x, y, w: cw, h: c2, p: ps[pi] }); x += cw + 0.15; rowH = Math.max(rowH, c2); } return out; }
    const aw = pw - st.mL - st.mR - st.gapH * (st.cols - 1), ah = ph - st.mT - st.mB - st.gapV * (st.rows - 1); let cw = Math.max(0.2, aw / st.cols), chh = Math.max(0.2, ah / st.rows);
    if (st.square) cw = chh = Math.min(cw, chh);
    const per = st.rows * st.cols, out = [];
    for (let r = 0; r < st.rows; r++) for (let c = 0; c < st.cols; c++) out.push({ x: st.mL + c * (cw + st.gapH), y: st.mT + r * (chh + st.gapV), w: cw, h: chh, p: st.repeat ? ps[pi] : ps[pi * per + r * st.cols + c] });
    return out;
  },
  pages() { const st = this.st, n = Mod.photos().length; if (st.style === 'custom') return 1; if (st.style === 'package' || st.repeat) return Math.max(1, n); return Math.max(1, Math.ceil(n / (st.rows * st.cols))); },
  async render(cv, pi, ppi, guides) {
    const st = this.st, [pw, ph] = this.paper(), W = Math.round(pw * ppi), H = Math.round(ph * ppi), pt = ppi / 72; cv.width = W; cv.height = H;
    const x = cv.getContext('2d'); x.fillStyle = st.bg; x.fillRect(0, 0, W, H);
    for (const c of this.cellsFor(pi)) {
      const cx = c.x * ppi, cy = c.y * ppi, cw = c.w * ppi, capH = st.caption ? st.captionSize * pt * 1.5 : 0, chh = c.h * ppi - capH;
      if (guides && st.guides) { x.strokeStyle = c === this.selCell || (this.selCell && c.x === this.selCell.x && c.y === this.selCell.y && st.style === 'custom') ? '#f5a623' : 'rgba(0,0,0,.25)'; x.lineWidth = 1; x.strokeRect(cx + 0.5, cy + 0.5, cw - 1, c.h * ppi - 1); }
      if (!c.p) continue;
      let im; try { im = await Mod.image(c.p, Math.min(GLR.maxTex, Math.max(512, Math.ceil(Math.max(cw, chh) * 1.1 / 512) * 512))); } catch (e) { continue; }
      const iw = im.naturalWidth, ih = im.naturalHeight, turn = st.rotate && (iw > ih) !== (cw > chh) && Math.abs(cw - chh) > 2, sw = turn ? ih : iw, sh = turn ? iw : ih, f = Mod.fit(sw, sh, cw, chh, st.fill), bx = st.fill ? 0 : f.x, by = st.fill ? 0 : f.y, bw = st.fill ? cw : f.w, bh = st.fill ? chh : f.h;
      let srcIm = im;
      if (st.wm) { const t = h('canvas', { width: iw, height: ih }); t.getContext('2d').drawImage(im, 0, 0); await Watermark.draw(t, Watermark.all()[st.wmPreset] || WM_DEFAULT, c.p); srcIm = t; }
      x.save(); x.beginPath(); x.rect(cx + bx, cy + by, bw, bh); x.clip(); x.translate(cx + f.x + f.w / 2, cy + f.y + f.h / 2); if (turn) x.rotate(Math.PI / 2); x.imageSmoothingQuality = 'high'; x.drawImage(srcIm, -(turn ? f.h : f.w) / 2, -(turn ? f.w : f.h) / 2, turn ? f.h : f.w, turn ? f.w : f.h); x.restore();
      if (st.stroke) { x.strokeStyle = st.strokeColor; x.lineWidth = st.strokeWidth * pt; x.strokeRect(cx + bx, cy + by, bw, bh); }
      if (st.caption) { x.fillStyle = '#222'; x.font = `${st.captionSize * pt}px Segoe UI, sans-serif`; x.textAlign = 'center'; x.textBaseline = 'top'; x.fillText(Mod.text(c.p, st.captionTpl), cx + cw / 2, cy + by + bh + st.captionSize * pt * 0.3, cw); x.textAlign = 'left'; }
      if (st.marks) { x.strokeStyle = '#000'; x.lineWidth = 0.5 * pt; const m = 0.12 * ppi, g = 0.04 * ppi; x.beginPath(); for (const [px, py, dx, dy] of [[cx + bx, cy + by, -1, -1], [cx + bx + bw, cy + by, 1, -1], [cx + bx, cy + by + bh, -1, 1], [cx + bx + bw, cy + by + bh, 1, 1]]) { x.moveTo(px + dx * g, py); x.lineTo(px + dx * (g + m), py); x.moveTo(px, py + dy * g); x.lineTo(px, py + dy * (g + m)); } x.stroke(); }
    }
    if (guides && st.guides && st.style === 'grid') { x.strokeStyle = 'rgba(0,120,255,.35)'; x.lineWidth = 1; x.setLineDash([5, 4]); x.strokeRect(st.mL * ppi, st.mT * ppi, W - (st.mL + st.mR) * ppi, H - (st.mT + st.mB) * ppi); x.setLineDash([]); }
    if (st.plate) { const hgt = st.plateScale / 100 * H, [px, py] = place(st.platePos, W, H, 0, hgt, 0.3 * ppi); await Identity.draw(x, st.platePos[1] === 'c' ? W / 2 : px + (st.platePos[1] === 'l' ? hgt * 2.2 : -hgt * 2.2), py + hgt / 2, hgt, st.plateOpacity / 100, '#222222'); }
    x.fillStyle = '#333'; x.font = `${8 * pt}px Segoe UI, sans-serif`; x.textBaseline = 'alphabetic';
    if (st.numbers) { x.textAlign = 'right'; x.fillText(`Page ${pi + 1} of ${this.pages()}`, W - 0.3 * ppi, H - 0.2 * ppi); }
    if (st.info) { x.textAlign = 'left'; x.fillText(`${st.paper}  •  ${st.ppi} ppi  •  ${st.profile === 'printer' ? 'Managed by Printer' : st.profile.split(/[\\/]/).pop()}  •  Sharpening: ${st.sharpen}`, 0.3 * ppi, H - 0.2 * ppi); }
    x.textAlign = 'left';
  },
  async draw() {
    if (App.module !== 'print' || !this.host.clientWidth) return;
    const [pw, ph] = this.paper(), k = Math.min((this.host.clientWidth - 50) / pw, (this.host.clientHeight - 50) / ph);
    this.page = clamp(this.page, 0, this.pages() - 1);
    const tmp = h('canvas'), tok = this.tok = {}; await this.render(tmp, this.page, k * devicePixelRatio, true); if (this.tok !== tok) return;
    this.cv.width = tmp.width; this.cv.height = tmp.height; this.cv.getContext('2d').drawImage(tmp, 0, 0); this.cv.style.width = pw * k + 'px'; this.cv.style.height = ph * k + 'px';
    this.toolbar();
  },
  turn(d) { this.page = clamp(this.page + d, 0, this.pages() - 1); this.draw(); },
  toolbar() { const [pw, ph] = this.paper(); this.tb.replaceChildren(h('span', { class: 'tb-group' }, h('button', { class: 'tbtn', onclick: () => this.turn(-1) }, '◀'), h('span', {}, `Page ${this.page + 1} of ${this.pages()}`), h('button', { class: 'tbtn', onclick: () => this.turn(1) }, '▶')), h('span', { class: 'tb-fill' }), h('span', { class: 'dim' }, `${this.st.paper}  ${pw} × ${ph} in`), Mod.useSelect(() => { this.page = 0; this.draw(); })); },
  async renderAll(ppi, each) { const prog = Progress('Preparing print'), n = this.pages(); try { for (let i = 0; i < n; i++) { if (prog.cancel) return false; prog.set(i, n, 'page ' + (i + 1)); const cv = h('canvas'); await this.render(cv, i, ppi, false); await each(cv, i); } } finally { prog.done(); } return true; },
  async print() {
    if (this.st.printTo !== 'printer') return this.toFile();
    const [pw, ph] = this.paper(), urls = [];
    if (!(await this.renderAll(Math.min(this.st.ppi, 300), async cv => { urls.push(URL.createObjectURL(await Render.blob(cv, 'image/jpeg', 0.95))); }))) return;
    const fr = h('iframe', { class: 'print-frame', title: 'Print' }); document.body.append(fr);
    const d = fr.contentDocument; d.open(); d.write(`<!doctype html><html><head><style>@page{size:${pw}in ${ph}in;margin:0}html,body{margin:0}img{display:block;width:${pw}in;height:${ph}in;page-break-after:always}</style></head><body>${urls.map(u => `<img src="${u}">`).join('')}</body></html>`); d.close();
    await Promise.all([...d.images].map(im => im.decode().catch(() => {})));
    fr.contentWindow.focus(); fr.contentWindow.print();
    setTimeout(() => { fr.remove(); urls.forEach(u => URL.revokeObjectURL(u)); }, 60000);
  },
  async toFile() {
    const st = this.st, kind = st.printTo === 'pdf' ? 'pdf' : 'jpeg', folder = await UI.pickFolder(App.boot.pictures); if (!folder) return;
    const { session } = await api('session_begin', { staging: true }), names = [];
    if (!(await this.renderAll(st.ppi, async (cv, i) => { const name = `print-${String(i + 1).padStart(3, '0')}.png`; await upload('session_put', { session, name }, await Render.blob(cv, 'image/png')); names.push(name); }))) return api('session_cancel', { session });
    const out = await api('session_process', { session, format: 'jpeg', quality: st.quality, colorSpace: st.profile === 'printer' ? 'sRGB' : st.profile, intent: st.intent, sharpen: st.sharpen === 'off' ? null : { enabled: true, target: st.media, amount: st.sharpen }, dpi: st.ppi });
    if (kind === 'pdf') { const r = await api('pdf_build', { session, pages: out.files, dest: folder + '\\Opia Print.pdf', dpi: st.ppi }); UI.toast('Print file saved: ' + r.path); }
    else { const r = await runJob(api('session_finish', { session, deliver: { dest: 'folder', folder, post: 'reveal' } }), 'Saving print files'); UI.toast(`${r.files.length} page file(s) saved to ${r.dir}`); }
  },
};

/* ------------------------------------------------------------------ Web */
const WebMod = {
  id: 'web', name: 'Web',
  defaults: { style: 'grid', title: 'Site Title', collection: 'My Photographs', description: '', contact: '', link: '', plate: false, cText: '#dcdcdc', cBg: '#141414', cAccent: '#f0a030', cCell: '#1f1f1f', cBorder: '#333333', cols: 4, thumb: 240, gap: 10, round: 2, shadows: false, numbers: false,
    showTitle: true, titleTpl: '{title}', showCaption: true, captionTpl: '{caption}', large: 1600, quality: 82, wm: false, wmPreset: 'Simple Copyright', meta: 'copyright', sharpen: true, ftp: { host: '', port: 21, user: '', pass: '', path: '', tls: false, passive: true }, subfolder: 'gallery' },
  init(el) {
    this.st = Mod.store('web', this.defaults);
    this.frame = h('iframe', { class: 'web-frame', title: 'Web gallery preview', sandbox: 'allow-scripts allow-same-origin' }); this.tb = h('div', { class: 'toolbar' }); el.center.append(this.frame, this.tb);
    const form = h('div'), ch = debounce(() => { this.st._save(); this.preview(); }, 350), draw = () => form.replaceChildren(UI.form(this.spec(), this.st, ch));
    const strip = o => { const { _save, ftp, ...r } = o; return r; };
    el.left.append(UI.panel('Template Browser', h('div', {}, UI.presetBar('web_templates', () => strip(this.st), t => { Object.assign(this.st, t); draw(); ch(); }, { 'Classic Grid – Dark': strip(this.defaults), 'Classic Grid – Light': { ...strip(this.defaults), cText: '#222222', cBg: '#f5f5f3', cCell: '#ffffff', cBorder: '#dddddd', cAccent: '#1a6fd0', shadows: true }, 'Justified Wall': { ...strip(this.defaults), style: 'masonry', gap: 6, showTitle: false, showCaption: false }, 'Slideshow Gallery': { ...strip(this.defaults), style: 'slideshow' }, 'Paper White Squares': { ...strip(this.defaults), style: 'square', cText: '#333333', cBg: '#ffffff', cCell: '#ffffff', cBorder: '#eeeeee', gap: 4, cols: 5 } }),
      h('div', { class: 'fnote' }, 'The gallery is plain HTML, CSS and a little JavaScript. It works from a folder or any web host, with no server code.')), { key: 'wbtpl' }));
    el.right.append(UI.panel('Web Gallery Settings', form, { key: 'wbopt' }), h('div', { class: 'side-foot' }, h('button', { class: 'btn', onclick: () => this.export('preview') }, 'Preview in Browser…'), h('button', { class: 'btn primary', onclick: () => this.export('folder') }, 'Export…'), h('button', { class: 'btn', onclick: () => this.export('ftp') }, 'Upload')));
    draw(); this.toolbar();
    App.on('list', () => { if (App.module === 'web') this.preview(); });
  },
  show() { this.preview(); },
  spec() {
    return [{ t: 'section', label: 'Layout Style' }, { k: 'style', label: 'Gallery', t: 'select', opts: [['grid', 'Classic Grid'], ['square', 'Square Grid'], ['masonry', 'Justified Wall'], ['slideshow', 'Slideshow']] },
      { t: 'section', label: 'Site Info' }, { k: 'title', label: 'Site Title' }, { k: 'collection', label: 'Collection Title' }, { k: 'description', label: 'Description', t: 'textarea' }, { k: 'contact', label: 'Contact Info' }, { k: 'link', label: 'Web or Mail Link', ph: 'mailto:you@example.com' }, { k: 'plate', label: 'Use Identity Plate as Site Title', t: 'check' },
      { t: 'section', label: 'Color Palette' }, { k: 'cText', label: 'Text', t: 'color' }, { k: 'cBg', label: 'Background', t: 'color' }, { k: 'cCell', label: 'Cells', t: 'color' }, { k: 'cBorder', label: 'Borders', t: 'color' }, { k: 'cAccent', label: 'Accent / Rollover', t: 'color' },
      { t: 'section', label: 'Appearance' }, { k: 'cols', label: 'Columns', t: 'range', min: 2, max: 8, def: 4, show: o => o.style === 'grid' || o.style === 'square' }, { k: 'thumb', label: 'Thumbnail Size', t: 'range', min: 120, max: 480, step: 10, def: 240 }, { k: 'gap', label: 'Spacing', t: 'range', min: 0, max: 40, def: 10 }, { k: 'round', label: 'Corner Radius', t: 'range', min: 0, max: 24, def: 2 }, { k: 'shadows', label: 'Drop Shadows', t: 'check' }, { k: 'numbers', label: 'Show Cell Numbers', t: 'check' },
      { t: 'section', label: 'Image Info' }, { k: 'showTitle', label: 'Title', t: 'check' }, { k: 'titleTpl', label: 'Title Text', show: o => o.showTitle, ph: '{title} {filename}' }, { k: 'showCaption', label: 'Caption', t: 'check' }, { k: 'captionTpl', label: 'Caption Text', show: o => o.showCaption, ph: '{caption} {date} {exif}' },
      { t: 'section', label: 'Output Settings' }, { k: 'large', label: 'Large Images (px)', t: 'range', min: 800, max: 3840, step: 80, def: 1600 }, { k: 'quality', label: 'JPEG Quality', t: 'range', min: 40, max: 100, def: 82 }, { k: 'meta', label: 'Metadata', t: 'select', opts: [['copyright', 'Copyright Only'], ['all', 'All'], ['none', 'None']] }, { k: 'wm', label: 'Watermarking', t: 'check' }, { k: 'wmPreset', label: 'Watermark', t: 'select', opts: () => Object.keys(Watermark.all()), show: o => o.wm }, { k: 'sharpen', label: 'Sharpen for Screen', t: 'check' },
      { t: 'section', label: 'Upload Settings (FTP)' }, { k: 'ftp.host', label: 'Server', ph: 'ftp.example.com' }, { k: 'ftp.port', label: 'Port', t: 'number' }, { k: 'ftp.user', label: 'User Name' }, { k: 'ftp.pass', label: 'Password', t: 'password' }, { k: 'ftp.path', label: 'Server Path', ph: '/public_html' }, { k: 'subfolder', label: 'Put in Subfolder' }, { k: 'ftp.tls', label: 'Use FTPS (explicit TLS)', t: 'check' },
      { t: 'button', label: 'Test Connection', run: async o => { try { const r = await api('ftp_test', { conn: o.ftp }); UI.alert('FTP connection OK', 'Connected. Remote folder: ' + r.cwd); } catch (e) { UI.error(e); } } }];
  },
  /* items: [{full, thumb, title, caption, w, h}] -> one self-contained HTML document */
  html(items) {
    const s = this.st, E = Mod.esc, sq = s.style === 'square', wall = s.style === 'masonry', show = s.style === 'slideshow';
    const cells = items.map((it, i) => `<a class="c" href="${E(it.full)}" data-i="${i}" style="${wall ? `flex-grow:${(it.w / it.h * 100).toFixed(0)};flex-basis:${Math.round(s.thumb * it.w / it.h)}px` : ''}">${s.numbers ? `<i>${i + 1}</i>` : ''}<img loading="lazy" src="${E(it.thumb)}" alt="${E(it.title)}" ${wall ? '' : `style="aspect-ratio:${sq ? '1' : '3/2'}"`}>${!wall && (it.title || it.caption) ? `<span>${it.title ? `<b>${E(it.title)}</b>` : ''}${it.caption ? `<em>${E(it.caption)}</em>` : ''}</span>` : ''}</a>`).join('');
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${E(s.collection)} — ${E(s.title)}</title><meta name="generator" content="Opia"><style>
:root{--t:${s.cText};--bg:${s.cBg};--cell:${s.cCell};--bd:${s.cBorder};--ac:${s.cAccent}}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--t);font:15px/1.5 "Segoe UI",system-ui,sans-serif}
header{padding:28px 4vw 14px;border-bottom:1px solid var(--bd)}header h1{margin:0;font-size:22px;font-weight:600;letter-spacing:.02em}header h2{margin:6px 0 0;font-size:16px;font-weight:400;opacity:.85}header p{margin:8px 0 0;max-width:70ch;opacity:.7;white-space:pre-line}
main{padding:${s.gap + 12}px 4vw 40px}.g{display:grid;grid-template-columns:repeat(${s.cols},1fr);gap:${s.gap}px}.g.wall{display:flex;flex-wrap:wrap}.g.wall::after{content:"";flex-grow:1e4}
.c{position:relative;display:block;background:var(--cell);border:1px solid var(--bd);border-radius:${s.round}px;overflow:hidden;color:inherit;text-decoration:none;${s.shadows ? 'box-shadow:0 3px 12px rgba(0,0,0,.25);' : ''}transition:border-color .15s,transform .15s}.c:hover,.c:focus-visible{border-color:var(--ac);outline:none}
.c img{display:block;width:100%;height:100%;object-fit:${sq || wall ? 'cover' : 'contain'};${wall ? `height:${s.thumb}px;` : 'padding:' + (sq ? 0 : 8) + 'px;'}}.c span{display:block;padding:6px 10px 9px;border-top:1px solid var(--bd)}.c b{display:block;font-weight:600;font-size:13px}.c em{display:block;font-style:normal;font-size:12px;opacity:.7}.c i{position:absolute;left:6px;top:4px;font:italic 26px Georgia,serif;opacity:.25}
footer{padding:16px 4vw 30px;border-top:1px solid var(--bd);font-size:13px;opacity:.75}footer a{color:var(--ac)}
#lb{position:fixed;inset:0;background:rgba(0,0,0,.94);display:none;align-items:center;justify-content:center;flex-direction:column;z-index:9}#lb.on{display:flex}#lb img{max-width:94vw;max-height:84vh;object-fit:contain}#lb p{color:#ddd;margin:10px 20px 0;text-align:center;max-width:80ch}#lb p small{display:block;opacity:.65}
#lb button{position:absolute;background:none;border:0;color:#fff;font-size:34px;cursor:pointer;padding:14px 18px;opacity:.7}#lb button:hover{opacity:1;color:var(--ac)}#x{top:4px;right:8px}#pv{left:4px;top:45%}#nx{right:4px;top:45%}
.show{display:flex;flex-direction:column;align-items:center;gap:12px}.show #big{max-width:100%;max-height:70vh;border:1px solid var(--bd)}.show .strip{display:flex;gap:${Math.max(3, s.gap / 2)}px;overflow-x:auto;max-width:100%;padding-bottom:8px}.show .strip img{height:64px;cursor:pointer;opacity:.55;border:2px solid transparent}.show .strip img.on{opacity:1;border-color:var(--ac)}
@media(max-width:900px){.g{grid-template-columns:repeat(${Math.min(3, s.cols)},1fr)}}@media(max-width:560px){.g{grid-template-columns:repeat(2,1fr)}}</style></head><body>
<header><h1>${s.plate ? Identity.html() || E(s.title) : E(s.title)}</h1><h2>${E(s.collection)}</h2>${s.description ? `<p>${E(s.description)}</p>` : ''}</header><main>${show ? `<div class="show"><img id="big" alt=""><p id="cap"></p><div class="strip">${items.map((it, i) => `<img src="${E(it.thumb)}" data-i="${i}" alt="${E(it.title)}">`).join('')}</div></div>` : `<div class="g${wall ? ' wall' : ''}">${cells}</div>`}</main>
<footer>${s.contact ? (s.link ? `<a href="${E(s.link)}">${E(s.contact)}</a>` : E(s.contact)) + ' • ' : ''}${items.length} photographs</footer>
<div id="lb"><button id="x" aria-label="Close">×</button><button id="pv" aria-label="Previous">‹</button><button id="nx" aria-label="Next">›</button><img alt=""><p></p></div>
<script>const D=${JSON.stringify(items.map(it => ({ f: it.full, t: it.title, c: it.caption }))).replace(/</g, '\\u003c')};let k=0;const lb=document.getElementById('lb'),li=lb.querySelector('img'),lp=lb.querySelector('p');
function sh(i){k=(i+D.length)%D.length;const d=D[k];${show ? `document.getElementById('big').src=d.f;document.getElementById('cap').textContent=[d.t,d.c].filter(Boolean).join(' \\u2014 ');document.querySelectorAll('.strip img').forEach((e,j)=>e.classList.toggle('on',j===k));` : `li.src=d.f;lp.textContent='';const b=document.createElement('b');b.textContent=d.t||'';const s=document.createElement('small');s.textContent=d.c||'';lp.append(b,s);lb.classList.add('on');`}}
document.querySelectorAll('.c').forEach(a=>a.onclick=e=>{e.preventDefault();sh(+a.dataset.i)});document.querySelectorAll('.strip img').forEach(a=>a.onclick=()=>sh(+a.dataset.i));
document.getElementById('x').onclick=()=>lb.classList.remove('on');document.getElementById('pv').onclick=()=>sh(k-1);document.getElementById('nx').onclick=()=>sh(k+1);lb.onclick=e=>{if(e.target===lb)lb.classList.remove('on')};
addEventListener('keydown',e=>{if(e.key==='Escape')lb.classList.remove('on');if(e.key==='ArrowLeft')sh(k-1);if(e.key==='ArrowRight')sh(k+1)});${show ? 'if(D.length)sh(0);' : ''}</script></body></html>`;
  },
  info(p, i, n) { return { title: this.st.showTitle ? Mod.text(p, this.st.titleTpl, i, n) : '', caption: this.st.showCaption ? Mod.text(p, this.st.captionTpl, i, n) : '', w: Math.round(Mod.sizeAspect(p) * 100), h: 100 }; },
  async preview() {
    if (App.module !== 'web') return;
    const ps = Mod.photos().slice(0, 120), tok = this.tok = {}, items = [];
    for (let i = 0; i < ps.length; i++) { const p = ps[i]; items.push({ ...this.info(p, i, ps.length), thumb: App.isEdited(p) ? location.origin + App.thumb(p) : location.origin + App.thumb(p), full: App.isEdited(p) ? await Render.url(p, 1280) : location.origin + `/img/src/${p.id}?size=1280&v=${p.orient}_${p.filesize}` }); if (this.tok !== tok) return; }
    this.frame.srcdoc = this.html(items); this.toolbar();
  },
  toolbar() { const n = Mod.photos().length; this.tb.replaceChildren(h('span', { class: 'tb-group' }, h('button', { class: 'tbtn', onclick: () => this.preview() }, 'Reload Preview')), h('span', { class: 'tb-fill' }), h('span', { class: 'dim' }, `${n} photo${n === 1 ? '' : 's'} in this gallery` + (n > 120 ? ' (preview shows the first 120)' : '')), Mod.useSelect(() => this.preview())); },
  async export(mode) {
    const ps = Mod.photos(), st = this.st; if (!ps.length) return UI.toast('No photos to publish');
    let folder = null;
    if (mode === 'folder') { folder = await UI.pickFolder(App.boot.pictures); if (!folder) return; folder += '\\' + (st.collection.replace(/[\\/:*?"<>|]/g, '_').trim() || 'Web Gallery'); }
    if (mode === 'ftp' && !st.ftp.host) return UI.toast('Fill in the FTP server under Upload Settings first');
    const settings = { format: 'jpeg', quality: st.quality, metadata: st.meta, colorSpace: 'sRGB', sharpen: { enabled: st.sharpen, target: 'screen', amount: 'standard' }, naming: { enabled: true, template: '{seq:0000}-{name}', start: 1 }, count: ps.length };
    const { session } = await api('session_begin', { settings, staging: true }), prog = Progress('Building web gallery'), items = [], wm = st.wm ? Watermark.all()[st.wmPreset] || WM_DEFAULT : null;
    try {
      for (let i = 0; i < ps.length; i++) {
        if (prog.cancel) { await api('session_cancel', { session }); return; }
        const p = ps[i]; prog.set(i, ps.length, p.filename);
        const big = await Render.canvas(p, st.large); if (wm) await Watermark.draw(big, wm, p);
        const r = await upload('export_put', { session, id: p.id, index: i, sub: 'images' }, await Render.blob(big, 'image/png')), file = r.path.split(/[\\/]/).pop();
        const k = Math.min(1, st.thumb * 2 / Math.max(big.width, big.height)), th = h('canvas', { width: Math.round(big.width * k), height: Math.round(big.height * k) }), x = th.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(big, 0, 0, th.width, th.height);
        await upload('session_put', { session, name: 'thumbs/' + file }, await Render.blob(th, 'image/jpeg', 0.8));
        items.push({ ...this.info(p, i, ps.length), w: big.width, h: big.height, full: 'images/' + encodeURIComponent(file), thumb: 'thumbs/' + encodeURIComponent(file) });
      }
      await upload('session_put', { session, name: 'index.html' }, new Blob([this.html(items)], { type: 'text/html' }));
    } finally { prog.done(); }
    if (mode === 'ftp') { const conn = { ...st.ftp, path: [st.ftp.path, st.subfolder].filter(Boolean).join('/') }; const r = await runJob(api('session_finish', { session, deliver: { dest: 'ftp', ftp: conn } }), 'Uploading gallery'); return UI.toast(r.messages.join('; ')); }
    if (mode === 'preview') folder = App.boot.home + '\\Web Preview';
    const r = await runJob(api('session_finish', { session, deliver: { dest: 'folder', folder, post: 'open', open: folder + '\\index.html' } }), 'Saving gallery');
    UI.toast(`Web gallery saved to ${r.dir}`);
  },
};

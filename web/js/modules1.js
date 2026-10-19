'use strict';
/* Shared helpers for the output modules, Identity Plate, Map module, Book module. */

const Mod = {
  use: 'auto', imgs: new Map(),
  photos() { const sel = App.selected(), u = this.use; if (u === 'selected' || (u === 'auto' && sel.length > 1)) return sel; if (u === 'flagged') return App.list.filter(p => p.flag === 1); return App.list; },
  useSelect(onchange) { const opts = [['auto', 'Use: Selected (or all)'], ['all', 'Use: All Filmstrip Photos'], ['selected', 'Use: Selected Photos'], ['flagged', 'Use: Flagged Photos']]; return h('select', { onchange: e => { this.use = opts[e.target.selectedIndex][0]; onchange(); } }, opts.map(([v, l]) => h('option', { selected: v === this.use }, l))); },
  /* decoded <img> of a photo with its edits, cached */
  image(p, size) {
    const key = [p.id, p.ver, p.orient, size].join('|');
    if (!this.imgs.has(key)) { this.imgs.set(key, Render.url(p, size).then(async u => { const im = new Image(); im.src = u; await im.decode(); return im; })); if (this.imgs.size > 300) this.imgs.delete(this.imgs.keys().next().value); }
    return this.imgs.get(key);
  },
  text(p, tpl, i, n) {
    const e = p.exif || {};
    return String(tpl || '').replace(/\{(\w+)\}/g, (_, k) => ({ title: p.title, caption: p.caption, filename: p.filename, name: p.filename.replace(/\.[^.]+$/, ''), date: fmt.date(p.capture_time), datetime: fmt.datetime(p.capture_time), exif: fmt.exif(p),
      creator: p.iptc.creator, copyright: p.iptc.copyright, rating: '★'.repeat(p.rating), camera: e.model, lens: e.lens, index: i != null ? i + 1 : '', total: n ?? '', keywords: App.kwNames(p).join(', '), city: p.iptc.city, country: p.iptc.country, dims: `${p.w} × ${p.h}` }[k] ?? '')).trim();
  },
  fit(sw, sh, dw, dh, cover) { const k = cover ? Math.max(dw / sw, dh / sh) : Math.min(dw / sw, dh / sh), w = sw * k, hh = sh * k; return { x: (dw - w) / 2, y: (dh - hh) / 2, w, h: hh }; },
  /* per-catalog module state with debounced save */
  store(key, defaults) { const st = Exporter.merge(defaults, App.cget(key, {})); st._save = debounce(() => { const { _save, ...rest } = st; App.cset(key, rest); }, 400); return st; },
  wrap(ctx, text, x, y, maxW, lh, align = 'left', maxLines = 99) {
    const lines = [];
    for (const para of String(text).split('\n')) { let line = ''; for (const w of para.split(' ')) { const t = line ? line + ' ' + w : w; if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t; } lines.push(line); }
    ctx.textAlign = align; const ax = align === 'center' ? x + maxW / 2 : align === 'right' ? x + maxW : x;
    lines.slice(0, maxLines).forEach((l, i) => ctx.fillText(l, ax, y + i * lh));
    return Math.min(lines.length, maxLines) * lh;
  },
  esc: s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
  sizeAspect(p) { const c = devFull(p.develop).crop; return (p.w * c.w) / (p.h * c.h || 1); },
};

/* Identity Plate: your name or logo in the top-left corner, also usable in Slideshow, Print and Web output. */
const WORDMARK = '<svg class="wordmark" viewBox="0 6 260 134" role="img" aria-label="opia"><circle cx="32" cy="75" r="25"/><circle class="wm-dot" cx="38" cy="69" r="7"/><path d="M86 50V128"/><circle cx="111" cy="75" r="25"/><path d="M166 50V100"/><circle class="wm-i" cx="166" cy="22" r="9"/><circle cx="221" cy="75" r="25"/><path d="M246 50V100"/></svg>';
const Identity = {
  get() { return { mode: 'text', text: 'Opia', font: 'Georgia', size: 21, color: '#d6d6d6', bold: false, italic: false, image: '', ...App.conf('identity', {}) }; },
  el() { const c = this.get(); if (!App.conf('identity', null)) { const m = h('span', { class: 'ip-mark' }); m.innerHTML = WORDMARK; return m; } return c.mode === 'image' && c.image ? h('img', { src: '/img/file?path=' + encodeURIComponent(c.image), class: 'ip-img', draggable: false }) : h('span', { class: 'ip-text', style: { fontFamily: `"${c.font}", serif`, fontSize: c.size + 'px', color: c.color, fontWeight: c.bold ? 700 : 400, fontStyle: c.italic ? 'italic' : 'normal' } }, c.text); },
  /* draw centred on (cx, cy); height = pixel height of the plate */
  async draw(ctx, cx, cy, height, opacity = 1, color) {
    const c = this.get(); ctx.save(); ctx.globalAlpha = opacity;
    if (c.mode === 'image' && c.image) { try { const im = await Watermark.image(c.image), w = height * im.naturalWidth / im.naturalHeight; ctx.drawImage(im, cx - w / 2, cy - height / 2, w, height); } catch (e) { /* missing file */ } }
    else { ctx.font = `${c.italic ? 'italic ' : ''}${c.bold ? 'bold ' : ''}${height}px "${c.font}", serif`; ctx.fillStyle = color || c.color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(c.text, cx, cy); }
    ctx.restore();
  },
  html() { const c = this.get(); return c.mode === 'image' ? '' : `<span style="font-family:'${Mod.esc(c.font)}',serif;font-weight:${c.bold ? 700 : 400};font-style:${c.italic ? 'italic' : 'normal'}">${Mod.esc(c.text)}</span>`; },
  edit() {
    const c = this.get(), pv = h('div', { class: 'ip-prev' });
    const paint = () => { App.cfg.identity = { ...c }; pv.replaceChildren(this.el()); $('#identity').replaceChildren(this.el()); };
    paint();
    return UI.dialog({ title: 'Identity Plate Editor', width: 520, body: h('div', {}, pv, UI.presetBar('identity_presets', () => c, v => { Object.assign(c, v); paint(); }),
      UI.form([{ k: 'mode', label: 'Style', t: 'select', opts: [['text', 'Use a styled text identity plate'], ['image', 'Use a graphical identity plate']] }, { k: 'text', label: 'Text', show: o => o.mode === 'text' },
        { k: 'font', label: 'Font', t: 'select', opts: ['Georgia', 'Segoe UI', 'Arial', 'Times New Roman', 'Palatino Linotype', 'Trebuchet MS', 'Verdana', 'Courier New', 'Segoe Script', 'Impact'], show: o => o.mode === 'text' },
        { k: 'size', label: 'Size', t: 'range', min: 10, max: 34, def: 21, show: o => o.mode === 'text' }, { k: 'color', label: 'Colour', t: 'color', show: o => o.mode === 'text' }, { k: 'bold', label: 'Bold', t: 'check', show: o => o.mode === 'text' }, { k: 'italic', label: 'Italic', t: 'check', show: o => o.mode === 'text' },
        { k: 'image', label: 'Graphic', t: 'file', exts: ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'], show: o => o.mode === 'image' }, { t: 'note', label: 'Graphics look best as PNG with a transparent background, about 40 pixels tall.', show: o => o.mode === 'image' }], c, paint)),
      buttons: [['Done', null, 'primary']] }).then(() => { App.setConf('identity', { ...c }); App.emit('identity'); });
  },
};

/* ------------------------------------------------------------------ Map */
const MapMod = {
  id: 'map', name: 'Map', z: 2, lat: 25, lon: 10, tiles: new Map(), track: null, hover: null,
  keys: { '=': () => MapMod.zoom(1), '-': () => MapMod.zoom(-1), ArrowRight: () => App.step(1), ArrowLeft: () => App.step(-1) },
  init(el) {
    this.cv = h('canvas', { class: 'map-cv' }); this.tb = h('div', { class: 'toolbar' }); this.host = h('div', { class: 'map-host' }, this.cv, this.tip = h('div', { class: 'map-tip' }));
    el.center.append(this.host, this.tb);
    this.locB = h('div'); this.savedB = h('div'); this.trackB = h('div');
    el.left.append(UI.panel('Saved Locations', this.savedB, { key: 'msaved', tools: h('a', { title: 'Save the current map view as a location', onclick: () => this.saveLocation() }, '+') }), UI.panel('GPS Tracklog', this.trackB, { key: 'mtrack' }));
    el.right.append(UI.panel('Location', this.locB, { key: 'mloc' }));
    Object.assign(this, App.cget('map_view', {}));
    new ResizeObserver(() => this.draw()).observe(this.host);
    const cv = this.cv;
    cv.onwheel = e => {
      e.preventDefault();
      if (!Modes.trackpad) return this.zoom(e.deltaY < 0 ? 1 : -1, e);
      if (e.ctrlKey) { this.pinch = (this.pinch || 0) - e.deltaY; if (Math.abs(this.pinch) >= 30) { this.zoom(Math.sign(this.pinch), e); this.pinch = 0; } return; }   // trackpad: pinch steps the zoom, two fingers pan
      const w = this.world(this.lat, this.lon); [this.lat, this.lon] = this.unworld(w[0] + e.deltaX, w[1] + e.deltaY); this.draw();
      (this.persistSoon || (this.persistSoon = debounce(() => this.persist(), 400)))();
    };
    cv.ondblclick = e => this.zoom(1, e);
    cv.onmousedown = e => {
      const s = [e.clientX, e.clientY], w0 = this.world(this.lat, this.lon); let moved = false;
      const mv = ev => { const dx = ev.clientX - s[0], dy = ev.clientY - s[1]; if (Math.abs(dx) + Math.abs(dy) > 3) moved = true; [this.lat, this.lon] = this.unworld(w0[0] - dx, w0[1] - dy); this.draw(); };
      const up = ev => { removeEventListener('mousemove', mv); removeEventListener('mouseup', up); if (!moved) this.click(ev); else this.persist(); };
      addEventListener('mousemove', mv); addEventListener('mouseup', up);
    };
    cv.onmousemove = e => { const m = this.markerAt(e); this.hover = m; cv.style.cursor = m ? 'pointer' : 'grab'; this.tip.style.display = m ? '' : 'none'; if (m) { this.tip.replaceChildren(h('img', { src: App.thumb(m.photos[0]) }), h('div', {}, m.photos.length > 1 ? m.photos.length + ' photos' : m.photos[0].filename)); Object.assign(this.tip.style, { left: m.x + 14 + 'px', top: m.y - 20 + 'px' }); } };
    cv.ondragover = e => { if (e.dataTransfer.types.includes('text/opia-photos')) e.preventDefault(); };
    cv.ondrop = e => { const d = e.dataTransfer.getData('text/opia-photos'); if (!d) return; e.preventDefault(); const [lat, lon] = this.at(e); const ids = JSON.parse(d); App.setMeta(ids, { gps: [+lat.toFixed(6), +lon.toFixed(6)] }); UI.toast(`${ids.length} photo(s) placed at ${lat.toFixed(4)}, ${lon.toFixed(4)}`); };
    cv.oncontextmenu = e => { const [lat, lon] = this.at(e); UI.menu(e.clientX, e.clientY, [{ label: `Add GPS Coordinates to Selected Photos (${App.selIds().length})`, run: () => App.setMeta(App.selIds(), { gps: [+lat.toFixed(6), +lon.toFixed(6)] }) }, { label: 'Save Location Here…', run: () => this.saveLocation(lat, lon) }, { label: 'Copy Coordinates', run: () => navigator.clipboard.writeText(lat.toFixed(6) + ', ' + lon.toFixed(6)) }]); };
    App.on('selection', () => { if (App.module === 'map') { this.draw(); this.drawLoc(); } }); App.on('meta', () => { if (App.module === 'map') { this.draw(); this.drawLoc(); this.drawSaved(); } }); App.on('list', () => { if (App.module === 'map') this.draw(); });
    this.toolbar(); this.drawSaved(); this.drawTrack();
  },
  show() { this.draw(); this.drawLoc(); this.drawSaved(); },
  persist: debounce(() => App.cset('map_view', { z: MapMod.z, lat: MapMod.lat, lon: MapMod.lon }), 500),
  world(lat, lon, z = this.z) { const n = 256 * 2 ** z, s = Math.sin(clamp(lat, -85.05, 85.05) * Math.PI / 180); return [(lon + 180) / 360 * n, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n]; },
  unworld(x, y, z = this.z) { const n = 256 * 2 ** z; return [clamp(Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n))) * 180 / Math.PI, -85, 85), ((x / n * 360 - 180 + 540) % 360) - 180]; },
  at(e) { const b = this.cv.getBoundingClientRect(), c = this.world(this.lat, this.lon); return this.unworld(c[0] + e.clientX - b.left - b.width / 2, c[1] + e.clientY - b.top - b.height / 2); },
  screen(lat, lon) { const c = this.world(this.lat, this.lon), p = this.world(lat, lon), n = 256 * 2 ** this.z; let dx = p[0] - c[0]; if (dx > n / 2) dx -= n; if (dx < -n / 2) dx += n; return [this.host.clientWidth / 2 + dx, this.host.clientHeight / 2 + p[1] - c[1]]; },
  zoom(d, e) { const z = clamp(this.z + d, 1, 19); if (z === this.z) return; if (e) { const [lat, lon] = this.at(e), b = this.cv.getBoundingClientRect(), ox = e.clientX - b.left - b.width / 2, oy = e.clientY - b.top - b.height / 2; this.z = z; const w = this.world(lat, lon); [this.lat, this.lon] = this.unworld(w[0] - ox, w[1] - oy); } else this.z = z; this.draw(); this.toolbar(); this.persist(); },
  go(lat, lon, z) { this.lat = lat; this.lon = lon; if (z) this.z = z; this.draw(); this.toolbar(); this.persist(); },
  tile(z, x, y) {
    const n = 2 ** z; x = ((x % n) + n) % n; if (y < 0 || y >= n) return null;
    const key = `${z}/${x}/${y}`; let t = this.tiles.get(key);
    if (!t) { t = new Image(); t.crossOrigin = 'anonymous'; t.onload = () => { t.ok = true; this.drawSoon(); }; t.onerror = () => { t.bad = true; this.failed = (this.failed || 0) + 1; this.drawSoon(); };
      t.src = App.pref('mapTiles', 'https://tile.openstreetmap.org/{z}/{x}/{y}.png').replace('{z}', z).replace('{x}', x).replace('{y}', y); this.tiles.set(key, t); if (this.tiles.size > 600) this.tiles.delete(this.tiles.keys().next().value); }
    return t;
  },
  drawSoon: debounce(() => MapMod.draw(), 30),
  markers() {
    const cells = new Map();
    for (const p of App.list) { if (!p.gps) continue; const [x, y] = this.screen(p.gps[0], p.gps[1]); if (x < -40 || y < -40 || x > this.host.clientWidth + 40 || y > this.host.clientHeight + 40) continue; const k = Math.round(x / 44) + ':' + Math.round(y / 44); const c = cells.get(k) || cells.set(k, { x: 0, y: 0, photos: [] }).get(k); c.photos.push(p); c.x += x; c.y += y; }
    return [...cells.values()].map(c => ({ x: c.x / c.photos.length, y: c.y / c.photos.length, photos: c.photos }));
  },
  markerAt(e) { const b = this.cv.getBoundingClientRect(), x = e.clientX - b.left, y = e.clientY - b.top; return (this.mk || []).find(m => Math.hypot(m.x - x, m.y - y) < 15) || null; },
  click(e) { const m = this.markerAt(e); if (!m) return; App.selection = new Set(m.photos.map(p => p.id)); App.active = m.photos[0].id; App.emit('selection'); },
  draw() {
    if (App.module !== 'map' || !this.host.clientWidth) return;
    const W = this.host.clientWidth, H = this.host.clientHeight, dpr = devicePixelRatio, cv = this.cv;
    if (cv.width !== W * dpr || cv.height !== H * dpr) { cv.width = W * dpr; cv.height = H * dpr; }
    const x = cv.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0); x.fillStyle = '#aad3df'; x.fillRect(0, 0, W, H);
    const c = this.world(this.lat, this.lon), x0 = c[0] - W / 2, y0 = c[1] - H / 2, noTiles = App.pref('mapTiles', '') === 'none'; let drawn = 0, wanted = 0;
    if (!noTiles) for (let tx = Math.floor(x0 / 256); tx * 256 < x0 + W; tx++) for (let ty = Math.floor(y0 / 256); ty * 256 < y0 + H; ty++) { const t = this.tile(this.z, tx, ty); if (!t) continue; wanted++; if (t.ok) { x.drawImage(t, Math.round(tx * 256 - x0), Math.round(ty * 256 - y0), 256, 256); drawn++; } }
    if (!drawn) {   // offline: plain graticule so positions still mean something
      x.fillStyle = '#26323a'; x.fillRect(0, 0, W, H); x.strokeStyle = 'rgba(255,255,255,.14)'; x.fillStyle = 'rgba(255,255,255,.5)'; x.font = '10px Segoe UI'; x.lineWidth = 1;
      const step = [90, 45, 30, 15, 10, 5, 2, 1, 0.5, 0.25, 0.1, 0.05, 0.02, 0.01][Math.min(13, Math.max(0, this.z - 1))];
      for (let lo = -180; lo <= 180; lo += step) { const [sx] = this.screen(0, lo); if (sx < 0 || sx > W) continue; x.beginPath(); x.moveTo(sx, 0); x.lineTo(sx, H); x.stroke(); x.fillText(lo.toFixed(step < 1 ? 2 : 0) + '°', sx + 3, 12); }
      for (let la = -80; la <= 80; la += step) { const [, sy] = this.screen(la, this.lon); if (sy < 0 || sy > H) continue; x.beginPath(); x.moveTo(0, sy); x.lineTo(W, sy); x.stroke(); x.fillText(la.toFixed(step < 1 ? 2 : 0) + '°', 4, sy - 3); }
      x.fillStyle = 'rgba(255,255,255,.75)'; x.font = '12px Segoe UI'; x.fillText(noTiles ? 'Map tiles are turned off (Preferences). Coordinates grid shown.' : wanted && this.failed ? 'Map tiles could not be loaded (offline?). Coordinates grid shown.' : 'Loading map…', 12, H - 14);
    }
    for (const l of App.cget('locations', [])) { const [sx, sy] = this.screen(l.lat, l.lon), r = l.radius * 1000 / (156543.03 * Math.cos(l.lat * Math.PI / 180) / 2 ** this.z); x.beginPath(); x.arc(sx, sy, Math.max(r, 4), 0, 7); x.fillStyle = 'rgba(255,255,255,.18)'; x.fill(); x.strokeStyle = 'rgba(255,255,255,.9)'; x.lineWidth = 1.5; x.stroke(); x.fillStyle = '#222'; x.font = 'bold 11px Segoe UI'; x.textAlign = 'center'; x.fillText(l.name, sx, sy - Math.max(r, 4) - 4); x.textAlign = 'left'; }
    if (this.track) { x.strokeStyle = '#1b6fe0'; x.lineWidth = 3; x.lineJoin = 'round'; x.beginPath(); this.track.pts.forEach((p, i) => { const [sx, sy] = this.screen(p[0], p[1]); i ? x.lineTo(sx, sy) : x.moveTo(sx, sy); }); x.stroke(); }
    this.mk = this.markers();
    for (const m of this.mk) {
      const sel = m.photos.some(p => App.selection.has(p.id)), n = m.photos.length;
      x.beginPath(); x.moveTo(m.x, m.y + 4); x.arc(m.x, m.y - 12, 12, Math.PI * 0.75, Math.PI * 0.25); x.closePath();
      x.fillStyle = sel ? '#ffc21a' : '#f08a24'; x.fill(); x.strokeStyle = '#3a2a00'; x.lineWidth = 1.2; x.stroke();
      x.fillStyle = '#201400'; x.font = 'bold 11px Segoe UI'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(n > 1 ? n : '•', m.x, m.y - 12); x.textAlign = 'left'; x.textBaseline = 'alphabetic';
    }
    if (drawn) { x.fillStyle = 'rgba(255,255,255,.8)'; x.fillRect(W - 178, H - 18, 178, 18); x.fillStyle = '#333'; x.font = '10px Segoe UI'; x.fillText('© OpenStreetMap contributors', W - 172, H - 5); }
  },
  toolbar() {
    const tagged = App.list.filter(p => p.gps).length, find = h('input', { type: 'search', placeholder: 'Go to  lat, lon', onkeydown: e => { if (e.key === 'Enter') { const m = find.value.match(/(-?\d+(?:\.\d+)?)[,\s]+(-?\d+(?:\.\d+)?)/); if (m) this.go(+m[1], +m[2], Math.max(this.z, 11)); else UI.toast('Type coordinates like 48.8584, 2.2945'); } e.stopPropagation(); } });
    this.tb.replaceChildren(h('span', { class: 'tb-group' }, h('button', { class: 'tbtn', onclick: () => this.zoom(-1) }, '−'), h('input', { type: 'range', class: 'mini', 'aria-label': 'Map zoom', min: 1, max: 19, value: this.z, oninput: e => { this.z = +e.target.value; this.draw(); this.persist(); } }), h('button', { class: 'tbtn', onclick: () => this.zoom(1) }, '+')),
      h('span', { class: 'tb-group' }, find, h('button', { class: 'tbtn', title: 'Centre the map on the selected photo', onclick: () => { const p = App.selected().find(q => q.gps) || App.cur(); if (p && p.gps) this.go(p.gps[0], p.gps[1], Math.max(this.z, 12)); else UI.toast('The selected photo has no GPS position. Drag it onto the map to place it.'); } }, 'Go to Selected'),
        h('button', { class: 'tbtn', title: 'Fit all geotagged photos', onclick: () => this.fitAll() }, 'Fit All')),
      h('span', { class: 'tb-fill' }), h('span', { class: 'dim' }, `${tagged} of ${App.list.length} photos on the map. Drag photos from the filmstrip onto the map to geotag them.`));
  },
  fitAll() { const ps = App.list.filter(p => p.gps); if (!ps.length) return UI.toast('No geotagged photos in this source'); const la = ps.map(p => p.gps[0]), lo = ps.map(p => p.gps[1]); let z = 17; this.lat = (Math.min(...la) + Math.max(...la)) / 2; this.lon = (Math.min(...lo) + Math.max(...lo)) / 2;
    for (; z > 1; z--) { const a = this.world(Math.max(...la), Math.min(...lo), z), b = this.world(Math.min(...la), Math.max(...lo), z); if (Math.abs(b[0] - a[0]) < this.host.clientWidth - 120 && Math.abs(b[1] - a[1]) < this.host.clientHeight - 120) break; } this.go(this.lat, this.lon, z); },
  drawLoc() {
    const ps = App.selected().length ? App.selected() : (App.cur() ? [App.cur()] : []), ids = ps.map(p => p.id);
    if (!ps.length) { this.locB.replaceChildren(h('div', { class: 'empty small' }, 'No photo selected')); return; }
    const rows = ['gps', 'altitude', 'sublocation', 'city', 'state', 'country', 'countrycode'].map(k => { const [label, get, edit] = META[k], vals = new Set(ps.map(p => String(get(p) ?? ''))), mixed = vals.size > 1, val = mixed ? '' : [...vals][0];
      return h('div', { class: 'md-row' }, h('label', {}, label), edit ? h('input', { type: 'text', value: val, placeholder: mixed ? '< mixed >' : k === 'gps' ? 'lat, lon' : '', onchange: e => { const v = e.target.value; if (k === 'gps') { const m = v.match(/(-?\d+(?:\.\d+)?)[,\s]+(-?\d+(?:\.\d+)?)/); App.setMeta(ids, { gps: m ? [+m[1], +m[2]] : null }); } else App.setMeta(ids, { iptc: { [k]: v } }); } }) : h('span', { class: 'md-v' }, val)); });
    this.locB.replaceChildren(h('div', { class: 'fnote' }, ps.length > 1 ? `${ps.length} photos selected` : ps[0].filename), ...rows,
      h('div', { class: 'dlg-inline' }, h('button', { class: 'btn', onclick: () => { App.setMeta(ids, { gps: null }); } }, 'Delete GPS Coordinates'), h('button', { class: 'btn', onclick: () => { const p = ps.find(q => q.gps); if (p) this.go(p.gps[0], p.gps[1], Math.max(this.z, 13)); } }, 'Show on Map')));
  },
  km(a, b) { const R = 6371, r = Math.PI / 180, dla = (b[0] - a[0]) * r, dlo = (b[1] - a[1]) * r, x = Math.sin(dla / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dlo / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); },
  async saveLocation(lat = this.lat, lon = this.lon) {
    const st = { name: '', radius: Math.max(0.1, +(40000 / 2 ** this.z * 0.1).toFixed(2)) };
    const ok = await UI.dialog({ title: 'New Saved Location', width: 400, body: UI.form([{ k: 'name', label: 'Location Name' }, { k: 'radius', label: 'Radius (km)', t: 'number', min: 0.01, step: 0.1 }], st), buttons: [['Cancel', null], ['Create', () => !!st.name.trim(), 'primary']] });
    if (!ok) return; App.cset('locations', [...App.cget('locations', []), { name: st.name.trim(), lat, lon, radius: +st.radius || 1, z: this.z }]); this.drawSaved(); this.draw();
  },
  drawSaved() {
    const locs = App.cget('locations', []);
    this.savedB.replaceChildren(...(locs.length ? locs.map((l, i) => { const inside = [...App.photos.values()].filter(p => p.gps && this.km(p.gps, [l.lat, l.lon]) <= l.radius);
      return h('div', { class: 'trow', title: `${l.lat.toFixed(4)}, ${l.lon.toFixed(4)}  •  radius ${l.radius} km`, onclick: () => this.go(l.lat, l.lon, l.z), ondblclick: () => { App.setSource({ type: 'ids', ids: inside.map(p => p.id), name: 'Location: ' + l.name }); },
        oncontextmenu: e => { e.preventDefault(); UI.menu(e.clientX, e.clientY, [{ label: 'Show Photos Taken Here', run: () => App.setSource({ type: 'ids', ids: inside.map(p => p.id), name: 'Location: ' + l.name }) }, { label: 'Tag Selected Photos with this Location', run: () => App.setMeta(App.selIds(), { gps: [l.lat, l.lon], iptc: { sublocation: l.name } }) },
          { label: 'Delete', run: () => { App.cset('locations', locs.filter((_, k) => k !== i)); this.drawSaved(); this.draw(); } }]); } }, h('span', { class: 'tw none' }), h('span', { class: 'tl' }, l.name), h('span', { class: 'tc' }, inside.length)); })
      : [h('div', { class: 'empty small' }, 'Click + to save the current map view as a named location.')]));
  },
  /* GPX tracklog: draw the route and place photos along it by capture time */
  drawTrack() {
    const t = this.track, st = this.trackSt ||= { offset: 0 };
    this.trackB.replaceChildren(h('div', { class: 'fnote' }, t ? `${t.name}: ${t.pts.length} points, ${fmt.datetime(t.pts[0][2] / 1000)} – ${fmt.datetime(t.pts[t.pts.length - 1][2] / 1000)}` : 'Load a .gpx file recorded by a phone or GPS logger, then tag photos by their capture time.'),
      h('div', { class: 'dlg-inline' }, h('button', { class: 'btn', onclick: async () => { const f = await UI.pickFile('', ['.gpx']); if (!f) return; try { const doc = new DOMParser().parseFromString(await (await fetch('/img/text?path=' + encodeURIComponent(f))).text(), 'text/xml');
        const pts = [...doc.getElementsByTagName('trkpt')].map(e => [+e.getAttribute('lat'), +e.getAttribute('lon'), Date.parse(e.getElementsByTagName('time')[0]?.textContent || '')]).filter(p => !isNaN(p[0]) && !isNaN(p[2])).sort((a, b) => a[2] - b[2]);
        if (!pts.length) return UI.toast('That file has no timed track points'); this.track = { name: f.split(/[\\/]/).pop(), pts }; this.drawTrack(); this.go(pts[0][0], pts[0][1], 13); } catch (e) { UI.error(e); } } }, 'Load Tracklog…'),
        t ? h('button', { class: 'btn', onclick: () => { this.track = null; this.drawTrack(); this.draw(); } }, 'Turn Off') : null),
      t ? UI.form([{ k: 'offset', label: 'Camera clock offset (hours)', t: 'number', step: 0.5 }], st) : null,
      t ? h('button', { class: 'btn', onclick: () => { let n = 0; for (const p of App.selected().length > 1 ? App.selected() : App.list) { const tm = p.capture_time * 1000 - st.offset * 3600e3; if (tm < t.pts[0][2] - 3e5 || tm > t.pts[t.pts.length - 1][2] + 3e5) continue; let i = t.pts.findIndex(q => q[2] >= tm); if (i < 0) i = t.pts.length - 1; const b = t.pts[i], a = t.pts[Math.max(0, i - 1)], k = b[2] === a[2] ? 0 : clamp((tm - a[2]) / (b[2] - a[2]), 0, 1); App.setMeta([p.id], { gps: [+(a[0] + (b[0] - a[0]) * k).toFixed(6), +(a[1] + (b[1] - a[1]) * k).toFixed(6)] }, true); n++; } UI.toast(n + ' photo(s) tagged from the tracklog'); this.draw(); } }, 'Auto-Tag Photos') : null);
  },
};

/* ------------------------------------------------------------------ Book */
const BOOK_SIZES = { 'Standard Landscape 10 × 8 in': [10, 8], 'Standard Portrait 8 × 10 in': [8, 10], 'Small Square 7 × 7 in': [7, 7], 'Large Square 12 × 12 in': [12, 12], 'Large Landscape 13 × 11 in': [13, 11], 'A4 Landscape': [11.69, 8.27], 'A4 Portrait': [8.27, 11.69] };
const BOOK_LAYOUTS = {   // cells in page fractions; t = text cell
  '1 Photo – Full Bleed': [{ x: 0, y: 0, w: 1, h: 1, bleed: 1 }], '1 Photo – Matted': [{ x: 0.08, y: 0.08, w: 0.84, h: 0.84 }], '1 Photo + Caption': [{ x: 0.08, y: 0.07, w: 0.84, h: 0.7 }, { x: 0.1, y: 0.8, w: 0.8, h: 0.13, t: 1 }],
  '2 Photos – Side by Side': [{ x: 0.05, y: 0.12, w: 0.435, h: 0.76 }, { x: 0.515, y: 0.12, w: 0.435, h: 0.76 }], '2 Photos – Stacked': [{ x: 0.1, y: 0.05, w: 0.8, h: 0.435 }, { x: 0.1, y: 0.515, w: 0.8, h: 0.435 }],
  '3 Photos – Feature Left': [{ x: 0.05, y: 0.06, w: 0.56, h: 0.88 }, { x: 0.64, y: 0.06, w: 0.31, h: 0.425 }, { x: 0.64, y: 0.515, w: 0.31, h: 0.425 }], '4 Photos – Grid': [{ x: 0.05, y: 0.05, w: 0.435, h: 0.435 }, { x: 0.515, y: 0.05, w: 0.435, h: 0.435 }, { x: 0.05, y: 0.515, w: 0.435, h: 0.435 }, { x: 0.515, y: 0.515, w: 0.435, h: 0.435 }],
  '6 Photos – Grid': [0, 1, 2, 3, 4, 5].map(i => ({ x: 0.05 + (i % 3) * 0.305, y: 0.12 + Math.floor(i / 3) * 0.39, w: 0.29, h: 0.37 })), 'Text Page': [{ x: 0.12, y: 0.15, w: 0.76, h: 0.7, t: 1 }],
  'Title Page': [{ x: 0.1, y: 0.36, w: 0.8, h: 0.16, t: 1, big: 1 }, { x: 0.2, y: 0.54, w: 0.6, h: 0.1, t: 1 }],
};
const Book = {
  id: 'book', name: 'Book', sel: 0, cell: 0, single: false,
  keys: { ArrowRight: () => Book.pick(Book.sel + 1), ArrowLeft: () => Book.pick(Book.sel - 1), Delete: () => Book.clearCell() },
  init(el) {
    this.st = Mod.store('book', { size: 'Standard Landscape 10 × 8 in', pages: [], bg: '#ffffff', padding: 0, fill: true, font: 'Georgia', textSize: 3.2, textColor: '#222222', align: 'center', numbers: false, auto: '1 Photo – Matted' });
    this.view = h('div', { class: 'book-view' }); this.tb = h('div', { class: 'toolbar' }); el.center.append(this.view, this.tb);
    this.setB = h('div'); this.pageB = h('div'); this.textB = h('div');
    el.left.append(UI.panel('Book', h('div', { class: 'fnote' }, 'Drag photos from the filmstrip into the photo cells. Auto Layout fills the whole book from the filmstrip. Double-click a page to work on it large.'), { key: 'bkinfo' }));
    el.right.append(UI.panel('Book Settings', this.setB, { key: 'bkset' }), UI.panel('Page', this.pageB, { key: 'bkpage' }), UI.panel('Text & Background', this.textB, { key: 'bktext' }),
      h('div', { class: 'side-foot' }, h('button', { class: 'btn', onclick: () => this.export('pdf') }, 'Export Book to PDF…'), h('button', { class: 'btn', onclick: () => this.export('jpeg') }, 'Export to JPEG…')));
    App.on('catalog', () => { this.st = Mod.store('book', this.st); });
    App.on('thumb', () => { if (App.module === 'book') this.draw(); });
    this.panels(); this.toolbar();
  },
  show() { if (!this.st.pages.length) this.st.pages.push(this.newPage('Title Page')); this.draw(); this.panels(); },
  dims() { return BOOK_SIZES[this.st.size] || [10, 8]; },
  newPage(layout) { return { layout, photos: [], texts: [] }; },
  cells(pg) { return BOOK_LAYOUTS[pg.layout] || BOOK_LAYOUTS['1 Photo – Matted']; },
  changed() { this.st._save(); this.draw(); },
  pick(i) { this.sel = clamp(i, 0, this.st.pages.length - 1); this.cell = 0; this.draw(); this.panels(); },
  clearCell() { const pg = this.st.pages[this.sel]; if (!pg) return; const cells = this.cells(pg), slot = cells.slice(0, this.cell + 1).filter(c => !c.t).length - 1; if (!cells[this.cell].t && slot >= 0) { pg.photos[slot] = null; this.changed(); } },
  autoLayout() {
    const ps = Mod.photos(), lay = this.st.auto, per = BOOK_LAYOUTS[lay].filter(c => !c.t).length || 1, title = this.st.pages.find(p => p.layout === 'Title Page');
    this.st.pages = title ? [title] : [];
    for (let i = 0; i < ps.length; i += per) { const pg = this.newPage(lay); pg.photos = ps.slice(i, i + per).map(p => p.id); pg.texts = BOOK_LAYOUTS[lay].filter(c => c.t).map(() => Mod.text(ps[i], '{title}') || ''); this.st.pages.push(pg); }
    this.sel = 0; this.changed(); this.panels(); UI.toast(`${this.st.pages.length} pages laid out from ${ps.length} photos`);
  },
  /* one renderer for screen and export */
  async render(cv, pg, pxW, pageNo, guides) {
    const [iw, ih] = this.dims(), W = Math.round(pxW), H = Math.round(pxW * ih / iw), st = this.st; cv.width = W; cv.height = H;
    const x = cv.getContext('2d'); x.fillStyle = pg.bg || st.bg; x.fillRect(0, 0, W, H);
    let pi = 0, ti = 0; const cells = this.cells(pg);
    for (let ci = 0; ci < cells.length; ci++) {
      const c = cells[ci], pad = c.bleed ? 0 : st.padding / 100 * Math.min(W, H) * 0.5, cx = c.x * W + pad, cy = c.y * H + pad, cw = c.w * W - 2 * pad, ch = c.h * H - 2 * pad;
      if (c.t) {
        const text = pg.texts[ti++] || '', px = (c.big ? st.textSize * 2.2 : st.textSize) / 100 * H;
        x.fillStyle = st.textColor; x.font = `${px}px "${st.font}", serif`; x.textBaseline = 'top';
        if (text) Mod.wrap(x, text, cx, cy, cw, px * 1.3, st.align, Math.floor(ch / (px * 1.3)) || 1);
        else if (guides) { x.fillStyle = '#aaa'; x.font = `${Math.max(10, H * 0.025)}px Segoe UI`; x.textAlign = 'center'; x.fillText('Text — type in the Text panel', cx + cw / 2, cy + ch / 2); x.textAlign = 'left'; }
      } else {
        const p = App.photo(pg.photos[pi++]);
        if (p) { try { const im = await Mod.image(p, Math.min(4096, Math.max(512, Math.ceil(Math.max(cw, ch) * 1.2 / 512) * 512))), f = Mod.fit(im.naturalWidth, im.naturalHeight, cw, ch, c.bleed || st.fill); x.save(); x.beginPath(); x.rect(cx, cy, cw, ch); x.clip(); x.drawImage(im, cx + f.x, cy + f.y, f.w, f.h); x.restore(); } catch (e) { /* offline original */ } }
        else if (guides) { x.fillStyle = '#e4e4e4'; x.fillRect(cx, cy, cw, ch); x.fillStyle = '#999'; x.font = `${Math.max(10, H * 0.03)}px Segoe UI`; x.textAlign = 'center'; x.fillText('Drop photo', cx + cw / 2, cy + ch / 2); x.textAlign = 'left'; }
      }
      if (guides && ci === this.cell && pg === st.pages[this.sel]) { x.strokeStyle = '#f5a623'; x.lineWidth = 2; x.strokeRect(cx + 1, cy + 1, cw - 2, ch - 2); }
    }
    if (st.numbers && pageNo != null && pg.layout !== 'Title Page') { x.fillStyle = st.textColor; x.font = `${H * 0.022}px "${st.font}", serif`; x.textAlign = 'center'; x.textBaseline = 'alphabetic'; x.fillText(String(pageNo), W / 2, H - H * 0.025); x.textAlign = 'left'; }
  },
  draw() {
    if (App.module !== 'book') return;
    const st = this.st, [iw, ih] = this.dims(), view = this.view;
    const avail = view.clientWidth - 60, pw = this.single ? Math.min(avail, (view.clientHeight - 60) * iw / ih) : clamp(Math.floor(avail / Math.max(2, Math.round(avail / 330))) - 24, 180, 420);
    const tok = this.tok = {};
    const pages = (this.single ? [st.pages[this.sel]] : st.pages).map(pg => {
      const i = st.pages.indexOf(pg), cv = h('canvas', { class: 'book-page' + (i === this.sel ? ' sel' : ''), style: { width: pw + 'px' } });
      this.render(cv, pg, pw * devicePixelRatio, i + 1, true).then(() => { if (this.tok !== tok) return; });
      const hit = e => { const b = cv.getBoundingClientRect(), fx = (e.clientX - b.left) / b.width, fy = (e.clientY - b.top) / b.height; return this.cells(pg).findIndex(c => fx >= c.x && fx <= c.x + c.w && fy >= c.y && fy <= c.y + c.h); };
      cv.onclick = e => { this.sel = i; const c = hit(e); this.cell = c < 0 ? 0 : c; this.draw(); this.panels(); };
      cv.ondblclick = () => { this.single = !this.single; this.sel = i; this.draw(); this.toolbar(); };
      cv.ondragover = e => { if (e.dataTransfer.types.includes('text/opia-photos')) e.preventDefault(); };
      cv.ondrop = e => { const d = e.dataTransfer.getData('text/opia-photos'); if (!d) return; e.preventDefault(); const ids = JSON.parse(d), cells = this.cells(pg); let c = hit(e); if (c < 0 || cells[c].t) c = cells.findIndex(k => !k.t); if (c < 0) return UI.toast('This page layout has no photo cell');
        let slot = cells.slice(0, c + 1).filter(k => !k.t).length - 1; const slots = cells.filter(k => !k.t).length; for (const id of ids) { if (slot >= slots) break; pg.photos[slot++] = id; } this.sel = i; this.cell = c; this.changed(); this.panels(); };
      cv.oncontextmenu = e => { e.preventDefault(); this.sel = i; UI.menu(e.clientX, e.clientY, [{ label: 'Add Page After', run: () => this.addPage() }, { label: 'Duplicate Page', run: () => { st.pages.splice(i + 1, 0, clone(pg)); this.changed(); } }, { label: 'Remove Photo from Cell', run: () => { const c = hit(e); if (c >= 0) { this.cell = c; this.clearCell(); } } }, { label: 'Remove Page', run: () => this.removePage() }]); };
      return h('div', { class: 'book-slot' }, cv, h('div', { class: 'dim' }, i === 0 && pg.layout === 'Title Page' ? 'Title' : 'Page ' + (i + 1)));
    });
    view.replaceChildren(...pages);
    view.classList.toggle('single', this.single);
  },
  addPage(layout) { this.st.pages.splice(this.sel + 1, 0, this.newPage(layout || this.st.auto)); this.sel++; this.changed(); this.panels(); },
  removePage() { if (this.st.pages.length < 2) return; this.st.pages.splice(this.sel, 1); this.sel = Math.min(this.sel, this.st.pages.length - 1); this.changed(); this.panels(); },
  toolbar() {
    this.tb.replaceChildren(h('span', { class: 'tb-group' }, h('button', { class: 'tbtn' + (!this.single ? ' on' : ''), onclick: () => { this.single = false; this.draw(); this.toolbar(); } }, 'Multi-Page'), h('button', { class: 'tbtn' + (this.single ? ' on' : ''), onclick: () => { this.single = true; this.draw(); this.toolbar(); } }, 'Single Page'),
      h('button', { class: 'tbtn', onclick: () => this.pick(this.sel - 1) }, '◀'), h('button', { class: 'tbtn', onclick: () => this.pick(this.sel + 1) }, '▶')),
      h('span', { class: 'tb-group' }, h('button', { class: 'tbtn', onclick: () => this.addPage() }, 'Add Page'), h('button', { class: 'tbtn', onclick: () => this.removePage() }, 'Remove Page')), h('span', { class: 'tb-fill' }), Mod.useSelect(() => {}));
  },
  panels() {
    const st = this.st, pg = st.pages[this.sel], ch = () => this.changed(), layouts = Object.keys(BOOK_LAYOUTS);
    this.setB.replaceChildren(UI.form([{ k: 'size', label: 'Size', t: 'select', opts: Object.keys(BOOK_SIZES) }, { t: 'note', label: o => `${o.pages.length} pages • ${this.dims().join(' × ')} in` },
      { t: 'section', label: 'Auto Layout' }, { k: 'auto', label: 'Preset', t: 'select', opts: layouts.filter(l => BOOK_LAYOUTS[l].some(c => !c.t)) }, { t: 'button', label: 'Auto Layout', run: () => this.autoLayout() },
      { t: 'button', label: 'Clear Book', run: async () => { if (await UI.confirm('Clear Book', 'Remove all pages from this book?', 'Clear')) { st.pages = [this.newPage('Title Page')]; this.sel = 0; this.changed(); this.panels(); } } }], st, ch));
    if (!pg) { this.pageB.replaceChildren(); this.textB.replaceChildren(); return; }
    this.pageB.replaceChildren(h('div', { class: 'lay-grid' }, layouts.map(l => { const cv = h('canvas', { width: 54, height: 42, title: l, class: 'lay' + (pg.layout === l ? ' on' : ''), onclick: () => { pg.layout = l; this.cell = 0; this.changed(); this.panels(); } }), x = cv.getContext('2d'); x.fillStyle = '#ddd'; x.fillRect(0, 0, 54, 42);
      for (const c of BOOK_LAYOUTS[l]) { x.fillStyle = c.t ? '#9ab' : '#666'; x.fillRect(c.x * 54, c.y * 42, c.w * 54, c.h * 42); } return cv; })),
      UI.form([{ k: 'padding', label: 'Cell Padding', t: 'range', min: 0, max: 30, def: 0 }, { k: 'fill', label: 'Zoom Photos to Fill Cells', t: 'check' }, { k: 'numbers', label: 'Page Numbers', t: 'check' }], st, ch));
    const texts = this.cells(pg).filter(c => c.t);
    this.textB.replaceChildren(...texts.map((c, i) => h('textarea', { rows: c.big ? 2 : 3, placeholder: c.big ? 'Book title' : 'Page text', value: pg.texts[i] || '', oninput: e => { pg.texts[i] = e.target.value; this.st._save(); this.drawSoon(); } })), texts.length ? null : h('div', { class: 'fnote' }, 'This layout has no text cell. Pick a layout with a caption or text area to add words.'),
      UI.form([{ k: 'font', label: 'Font', t: 'select', opts: ['Georgia', 'Segoe UI', 'Arial', 'Times New Roman', 'Palatino Linotype', 'Trebuchet MS', 'Segoe Script', 'Courier New'] }, { k: 'textSize', label: 'Text Size', t: 'range', min: 1.5, max: 8, step: 0.1, def: 3.2 }, { k: 'align', label: 'Align', t: 'select', opts: ['left', 'center', 'right'] }, { k: 'textColor', label: 'Text Colour', t: 'color' }, { k: 'bg', label: 'Page Background', t: 'color' }], st, ch));
  },
  drawSoon: debounce(() => Book.draw(), 250),
  async export(kind) {
    const st = this.st; if (!st.pages.length) return;
    const folder = await UI.pickFolder(App.boot.pictures); if (!folder) return;
    const { session } = await api('session_begin', { staging: true }), prog = Progress('Rendering book'), names = [], [iw] = this.dims();
    try { for (let i = 0; i < st.pages.length; i++) { prog.set(i, st.pages.length, 'page ' + (i + 1)); const cv = h('canvas'); await this.render(cv, st.pages[i], iw * 200, i + 1, false); const name = `page-${String(i + 1).padStart(3, '0')}.jpg`; await upload('session_put', { session, name }, await Render.blob(cv, 'image/jpeg', 0.93)); names.push(name); } } finally { prog.done(); }
    if (kind === 'pdf') { const r = await api('pdf_build', { session, pages: names, dest: folder + '\\' + App.info.name + ' Book.pdf', dpi: 200 }); UI.toast(`Book saved: ${r.path} (${r.pages} pages)`); }
    else { const r = await runJob(api('session_finish', { session, deliver: { dest: 'folder', folder: folder + '\\' + App.info.name + ' Book', post: 'reveal' } }), 'Saving pages'); UI.toast(`${r.files.length} pages saved to ${r.dir}`); }
  },
};

'use strict';
/* Develop tools drawn over the image: Crop, Spot Removal / Heal / Content-Aware Remove, Red Eye, Masking, WB picker, Guided Upright. */

const rid = () => Math.random().toString(36).slice(2, 9);
const ASPECTS = [['original', 'Original'], ['free', 'Free (unlocked)'], [1, '1 × 1'], [4 / 5, '4 × 5 / 8 × 10'], [5 / 7, '5 × 7'], [2 / 3, '2 × 3 / 4 × 6'], [3 / 4, '3 × 4'], [8.5 / 11, '8.5 × 11'], [9 / 16, '16 × 9'], [10 / 16, '16 × 10'], [1 / 2, '2 × 1 panorama']];
const MASK_SLIDERS = [['exposure', 'Exposure', -4, 4, 0.05], ['contrast', 'Contrast'], ['highlights', 'Highlights'], ['shadows', 'Shadows'], ['whites', 'Whites'], ['blacks', 'Blacks'], ['temp', 'Temp'], ['tint', 'Tint'],
  ['texture', 'Texture'], ['clarity', 'Clarity'], ['dehaze', 'Dehaze'], ['saturation', 'Saturation'], ['sharpness', 'Sharpness'], ['noise', 'Noise', 0, 100], ['hue', 'Color Hue', 0, 360], ['color', 'Color Amount', 0, 100]];

const Tools = {
  sel: -1, maskSel: null, hide: false, showOverlay: true, cropOv: 0, pending: null, picking: false, cursor: null, straighten: false, uprightCache: new Map(),
  brush: { size: 6, feather: 60, flow: 80, erase: false }, spot: { type: 'heal', size: 12, feather: 50, opacity: 100 },
  mask() { return Dev.tool === 'mask' ? (Dev.s.masks || []).find(m => m.id === this.maskSel) || null : null; },
  bind(ov) {
    this.ov = ov;
    ov.addEventListener('mousedown', e => this.down(e));
    ov.addEventListener('mousemove', e => { if (['spot', 'mask', 'redeye'].includes(Dev.tool)) { const b = ov.getBoundingClientRect(); this.cursor = [(e.clientX - b.left) * devicePixelRatio, (e.clientY - b.top) * devicePixelRatio]; this.redraw(); } });
    ov.addEventListener('mouseleave', () => { this.cursor = null; this.redraw(); });
    ov.addEventListener('wheel', e => { e.preventDefault(); const at = Dev.at(e), vp = Dev.after(); if (!vp) return; if (Modes.trackpad) return Dev.gesture(e, at, vp); const cur = vp.rect.scale, z = e.deltaY < 0 ? cur * 1.25 : cur / 1.25; Dev.setZoom(z <= vp.rect.fit * 1.02 ? 'fit' : Math.min(z, 8), at); }, { passive: false });
    ov.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('text/opia-photos')) e.preventDefault(); });
    ov.addEventListener('drop', e => { const d = e.dataTransfer.getData('text/opia-photos'); if (d && Dev.mode === 'reference') { Dev.refPhoto = JSON.parse(d)[0]; Dev.refSrc = null; Dev.render(); } });
  },
  redraw() { if (Dev.vps && this.ov.width) this.drawOverlay(this.ov.getContext('2d'), this.ov.width, this.ov.height); },
  drag(move, up) { const m = e => move(e), u = e => { removeEventListener('mousemove', m); removeEventListener('mouseup', u); up && up(e); }; addEventListener('mousemove', m); addEventListener('mouseup', u); },
  set(tool, quiet) {
    if (Dev.tool === 'crop' && tool !== 'crop' && !quiet) Dev.commit('Crop');
    Dev.tool = tool; this.sel = -1; this.pending = null; this.picking = false; this.straighten = false;
    if (tool !== 'mask') this.maskSel = null;
    if (tool === 'crop') Dev.view = { zoom: 'fit', cx: 0.5, cy: 0.5 };
    document.body.dataset.tool = tool || '';
    if (Dev.strip) $$('button', Dev.strip).forEach(b => b.classList.toggle('on', b.dataset.tool === tool));
    this.panel(); if (!quiet) { Dev.render(); Dev.toolbar(); }
  },
  done() { if (Dev.tool) this.set(null); },
  cycleOverlay() { if (Dev.tool === 'crop') this.cropOv = (this.cropOv + 1) % 6; else this.showOverlay = !this.showOverlay; Dev.render(); this.panel(); },
  brushSize(d) { if (Dev.tool === 'spot') this.spot.size = clamp(this.spot.size + d * 2, 1, 100); else this.brush.size = clamp(this.brush.size + d, 1, 100); this.panel(); this.redraw(); },
  rpx(r) { const vp = Dev.after(); return r * Math.max(vp.src.fullW, vp.src.fullH) * vp.rect.scale; },   // long-edge fraction -> overlay px
  hpx(r) { const vp = Dev.after(); return r * vp.src.fullH * vp.rect.scale; },                               // height units -> overlay px
  toolbarExtra() {
    const t = Dev.tool; if (!t) return null;
    const names = { crop: 'Crop & Straighten', spot: 'Spot Removal', redeye: 'Red Eye', mask: 'Masking', wb: 'White Balance Selector', guided: 'Guided Upright' };
    return h('span', { class: 'tb-group' }, h('b', {}, names[t]), t === 'crop' ? h('button', { class: 'tbtn', title: 'Cycle crop guide overlay (O)', onclick: () => this.cycleOverlay() }, 'Overlay: ' + ['Thirds', 'Grid', 'Diagonal', 'Golden Ratio', 'Center', 'None'][this.cropOv]) : null,
      h('button', { class: 'tbtn on', onclick: () => this.done() }, 'Done'));
  },
  deleteSelected() {
    const s = Dev.s, t = Dev.tool;
    if (t === 'spot' && s.spots[this.sel]) { s.spots.splice(this.sel, 1); this.sel = -1; Dev.reloadSource(); Dev.commit('Remove spot'); }
    else if (t === 'redeye' && s.redeyes[this.sel]) { s.redeyes.splice(this.sel, 1); this.sel = -1; Dev.commit('Remove red eye correction'); }
    else if (t === 'guided' && s.guides[this.sel]) { s.guides.splice(this.sel, 1); this.sel = -1; this.solveGuided(); Dev.commit('Remove guide'); }
    else if (t === 'mask' && this.mask()) { s.masks = s.masks.filter(m => m.id !== this.maskSel); this.maskSel = null; Dev.commit('Delete mask'); }
    else return;
    this.panel(); Dev.render();
  },

  /* ---------------------------------------------------------------- pointer */
  down(e) {
    if (e.button) return;
    const at = Dev.at(e); if (!at) return;
    const dpr = devicePixelRatio, r = at.vp.rect;
    if (Overlay.grab(e, { x: (at.vp.x + r.ox) / dpr, y: (at.vp.y + r.oy) / dpr, w: r.dw / dpr, h: r.dh / dpr }, () => Dev.render())) return;
    const t = Dev.tool;
    if (t === 'crop') return this.cropDown(e, at);
    if (t === 'spot') return this.spotDown(e, at);
    if (t === 'redeye') return this.redeyeDown(e, at);
    if (t === 'mask') return this.maskDown(e, at);
    if (t === 'guided') return this.guideDown(e, at);
    if (t === 'wb') { if (at.inside) { const [T, Ti] = Dev.neutral(Dev.sample(at.sx, at.sy)); Dev.s.temp = Math.round(T * 100); Dev.s.tint = Math.round(Ti * 100); Dev.s.wb = 'custom'; Dev.syncUI(); Dev.render(); Dev.commit('White Balance Selector'); } return; }
    // no tool: drag pans, click toggles zoom
    const v = Dev.view, sx = e.clientX, sy = e.clientY, c0 = [v.cx, v.cy]; let moved = false;
    this.drag(ev => { if (Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) > 3) moved = true; if (v.zoom === 'fit') return; v.cx = clamp(c0[0] - (ev.clientX - sx) * dpr / r.dw, 0, 1); v.cy = clamp(c0[1] - (ev.clientY - sy) * dpr / r.dh, 0, 1); Dev.render(); },
      () => { if (!moved) Dev.setZoom(v.zoom === 'fit' ? 1 : 'fit', at); });
  },

  /* ---------------------------------------------------------------- crop */
  cropFrame(vp) {   // crop rectangle in the rotated view frame (height units) and on screen
    const s = Dev.s, c = s.crop, a = vp.a, r = -c.angle * Math.PI / 180, x = (c.cx - 0.5) * a, y = c.cy - 0.5;
    const p = [x * Math.cos(r) - y * Math.sin(r), x * Math.sin(r) + y * Math.cos(r)], hw = c.w * a / 2, hh = c.h / 2, R = vp.region, k = vp.rect;
    const X = fx => vp.x + k.ox + (fx / R.W + 0.5) * k.dw, Y = fy => vp.y + k.oy + (fy / R.H + 0.5) * k.dh;
    return { p, hw, hh, l: X(p[0] - hw), r: X(p[0] + hw), t: Y(p[1] - hh), b: Y(p[1] + hh), X, Y, ppu: k.dh / R.H };
  },
  cropFromFrame(p, hw, hh, angle, a) { const r = angle * Math.PI / 180, x = p[0] * Math.cos(r) - p[1] * Math.sin(r), y = p[0] * Math.sin(r) + p[1] * Math.cos(r); return { cx: x / a + 0.5, cy: y + 0.5, w: 2 * hw / a, h: 2 * hh, angle }; },
  cropOk(c, a) {
    if (c.w < 0.02 || c.h < 0.02) return false;
    const r = c.angle * Math.PI / 180, hw = c.w * a / 2, hh = c.h / 2, x0 = (c.cx - 0.5) * a, y0 = c.cy - 0.5;
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { const fx = sx * hw, fy = sy * hh, x = x0 + fx * Math.cos(r) - fy * Math.sin(r), y = y0 + fx * Math.sin(r) + fy * Math.cos(r); if (Math.abs(x) > a / 2 + 1e-4 || Math.abs(y) > 0.5 + 1e-4) return false; }
    if (Dev.s.constrainCrop) { const keep = Dev.s.crop; Dev.s.crop = c; const ok = Geo.cropValid(Dev.s, a); Dev.s.crop = keep; return ok; }
    return true;
  },
  cropShrink(c, a) { if (this.cropOk(c, a)) return c; let lo = 0.02, hi = 1; for (let i = 0; i < 20; i++) { const k = (lo + hi) / 2; this.cropOk({ ...c, w: c.w * k, h: c.h * k }, a) ? (lo = k) : (hi = k); } return { ...c, w: c.w * lo, h: c.h * lo }; },
  aspectValue() { const v = Dev.s.cropAspect, src = Dev.src; if (v === 'free') return null; if (v === 'original' || v == null) return src.fullW / src.fullH; const land = Dev.s.crop.w * src.fullW >= Dev.s.crop.h * src.fullH; return land ? 1 / Math.min(v, 1 / v) : Math.min(v, 1 / v); },
  setAspect(v) {
    const s = Dev.s, src = Dev.src, a = src.w / src.h; s.cropAspect = v;
    const r = this.aspectValue();
    if (r) { let hw = s.crop.w * a / 2, hh = s.crop.h / 2; if (hw / hh > r) hw = hh * r; else hh = hw / r; s.crop = this.cropShrink({ ...s.crop, w: 2 * hw / a, h: 2 * hh }, a); }
    Dev.render(); this.panel();
  },
  cropDown(e, at) {
    const s = Dev.s, vp = at.vp, a = vp.a, f = this.cropFrame(vp), dpr = devicePixelRatio, tol = 9 * dpr, { px, py } = at;
    if (this.straighten) {   // draw a line that should be level
      const start = [px, py]; this.line = [px, py, px, py];
      return this.drag(ev => { const q = Dev.at(ev); this.line = [...start, q.px, q.py]; this.redraw(); }, () => {
        const [x1, y1, x2, y2] = this.line; this.line = null; this.straighten = false;
        if (Math.hypot(x2 - x1, y2 - y1) > 12 * dpr) { let d = s.crop.angle + Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI; while (d > 45) d -= 90; while (d < -45) d += 90; s.crop = this.cropShrink({ ...s.crop, angle: +d.toFixed(2) }, a); }
        this.panel(); Dev.render();
      });
    }
    const nl = Math.abs(px - f.l) < tol, nr = Math.abs(px - f.r) < tol, nt = Math.abs(py - f.t) < tol, nb = Math.abs(py - f.b) < tol;
    const inX = px > f.l - tol && px < f.r + tol, inY = py > f.t - tol && py < f.b + tol;
    const hx = inY ? (nl ? -1 : nr ? 1 : 0) : 0, hy = inX ? (nt ? -1 : nb ? 1 : 0) : 0, inside = px > f.l && px < f.r && py > f.t && py < f.b;
    const c0 = { ...s.crop }, p0 = [...f.p], hw0 = f.hw, hh0 = f.hh, ratio = this.aspectValue();
    if (hx || hy) {
      this.drag(ev => {
        const q = Dev.at(ev), dx = (q.px - px) / f.ppu, dy = (q.py - py) / f.ppu;
        let l = p0[0] - hw0, r = p0[0] + hw0, t = p0[1] - hh0, b = p0[1] + hh0;
        if (hx < 0) l += dx; if (hx > 0) r += dx; if (hy < 0) t += dy; if (hy > 0) b += dy;
        if (ratio) {
          let w = r - l, hgt = b - t;
          if (hx && hy) { if (w / hgt > ratio) hgt = w / ratio; else w = hgt * ratio; if (hx < 0) l = r - w; else r = l + w; if (hy < 0) t = b - hgt; else b = t + hgt; }
          else if (hx) { hgt = w / ratio; const cy = p0[1]; t = cy - hgt / 2; b = cy + hgt / 2; } else { w = hgt * ratio; const cx = p0[0]; l = cx - w / 2; r = cx + w / 2; }
        }
        if (r - l < 0.03 || b - t < 0.03) return;
        const c = this.cropFromFrame([(l + r) / 2, (t + b) / 2], (r - l) / 2, (b - t) / 2, c0.angle, a);
        if (this.cropOk(c, a)) { s.crop = c; Dev.render(); }
      }, () => this.panel());
    } else if (inside) {
      this.drag(ev => { const q = Dev.at(ev), c = this.cropFromFrame([p0[0] + (q.px - px) / f.ppu, p0[1] + (q.py - py) / f.ppu], hw0, hh0, c0.angle, a); if (this.cropOk(c, a)) { s.crop = c; Dev.render(); } });
    } else {   // outside: rotate about the crop centre
      const cxp = (f.l + f.r) / 2, cyp = (f.t + f.b) / 2, a0 = Math.atan2(py - cyp, px - cxp);
      this.drag(ev => { const q = Dev.at(ev), d = (Math.atan2(q.py - cyp, q.px - cxp) - a0) * 180 / Math.PI; s.crop = this.cropShrink({ ...c0, angle: +clamp(c0.angle - d, -45, 45).toFixed(2) }, a); Dev.render(); }, () => this.panel());
    }
  },

  /* ---------------------------------------------------------------- spots (clone / heal / content-aware remove) */
  spotDown(e, at) {
    const s = Dev.s, R = this.spot.size * 0.0012, near = (x, y, r) => Math.hypot(...Dev.toPx(x, y).map((v, i) => v - [at.px, at.py][i])) < Math.max(this.rpx(r), 8 * devicePixelRatio);
    const cur = s.spots[this.sel];
    if (cur && cur.sx != null && near(cur.sx, cur.sy, cur.r)) {   // move the source of the selected spot
      const off = [cur.sx - at.sx, cur.sy - at.sy];
      return this.drag(ev => { const q = Dev.at(ev); cur.sx = q.sx + off[0]; cur.sy = q.sy + off[1]; this.redraw(); }, () => { Dev.reloadSource(); Dev.commit('Move spot source'); });
    }
    const hit = s.spots.findIndex(sp => (sp.pts || [[sp.x, sp.y]]).some(p => near(p[0], p[1], sp.r)));
    if (hit >= 0) {
      this.sel = hit; const sp = s.spots[hit], start = [at.sx, at.sy], o = clone(sp); let moved = false; this.panel(); this.redraw();
      return this.drag(ev => { const q = Dev.at(ev), dx = q.sx - start[0], dy = q.sy - start[1]; moved = true; sp.x = o.x + dx; sp.y = o.y + dy; if (o.pts) sp.pts = o.pts.map(p => [p[0] + dx, p[1] + dy]); this.redraw(); }, () => { if (moved) { Dev.reloadSource(); Dev.commit('Move spot'); } });
    }
    if (!at.inside) return;
    const pts = [[at.sx, at.sy]]; this.stroke = { pts, r: R };
    this.drag(ev => { const q = Dev.at(ev), last = pts[pts.length - 1]; if (Math.hypot((q.sx - last[0]) * at.vp.a, q.sy - last[1]) > R * 0.35) { pts.push([clamp(q.sx, 0, 1), clamp(q.sy, 0, 1)]); this.redraw(); } },
      async () => {
        this.stroke = null;
        const sp = { type: this.spot.type, x: pts[0][0], y: pts[0][1], r: R, feather: this.spot.feather, opacity: this.spot.opacity, sx: null, sy: null }; if (pts.length > 1) sp.pts = pts;
        try { const auto = await api('retouch_auto', { id: Dev.photo.id, spot: sp, spots: s.spots }); if (auto) { sp.sx = auto.sx; sp.sy = auto.sy; } } catch (er) { UI.error(er); }
        s.spots.push(sp); this.sel = s.spots.length - 1; this.panel();
        await Dev.reloadSource(); Dev.commit({ heal: 'Heal', clone: 'Clone', remove: 'Content-Aware Remove' }[sp.type] + ' spot');
      });
  },
  /* ---------------------------------------------------------------- red eye */
  redeyeDown(e, at) {
    const s = Dev.s, a = at.vp.a, hit = s.redeyes.findIndex(r => Math.hypot((at.sx - r.x) * a, at.sy - r.y) < Math.max(r.rx, 0.012));
    if (hit >= 0) { this.sel = hit; const r = s.redeyes[hit], off = [r.x - at.sx, r.y - at.sy]; this.panel(); return this.drag(ev => { const q = Dev.at(ev); r.x = q.sx + off[0]; r.y = q.sy + off[1]; Dev.render(); }, () => Dev.commit('Move red eye correction')); }
    if (!at.inside) return;
    if (s.redeyes.length >= 4) return UI.toast('Up to four red-eye corrections per photo');
    const r = { x: at.sx, y: at.sy, rx: 0.02, ry: 0.02, pupil: 50, darken: 50 }; s.redeyes.push(r); this.sel = s.redeyes.length - 1;
    this.drag(ev => { const q = Dev.at(ev); r.rx = r.ry = Math.max(0.008, Math.hypot((q.sx - r.x) * a, q.sy - r.y)); Dev.render(); }, () => { this.panel(); Dev.commit('Red Eye Correction'); });
    Dev.render();
  },
  /* ---------------------------------------------------------------- masks */
  addMask(type) {
    if (!Dev.photo) return;
    if (Dev.tool !== 'mask') this.set('mask', true);
    const s = Dev.s; if (s.masks.length >= 8) return UI.toast('Up to eight masks per photo');
    if (type === 'brush' && s.masks.filter(m => m.type === 'brush').length >= 4) return UI.toast('Up to four brush masks per photo');
    const names = { brush: 'Brush', linear: 'Linear Gradient', radial: 'Radial Gradient' }, n = s.masks.filter(m => m.type === type).length + 1;
    const m = { id: rid(), name: `${names[type]} ${n}`, type, adj: {}, amount: 100, invert: false, range: { type: 'none' } };
    if (type === 'brush') m.strokes = []; else this.pending = m.id;
    s.masks.push(m); this.maskSel = m.id; this.showOverlay = true;
    this.panel(); Dev.render(); Dev.toolbar();
  },
  maskDown(e, at) {
    const s = Dev.s, a = at.vp.a, dpr = devicePixelRatio, hitPx = (x, y) => { const p = Dev.toPx(x, y); return Math.hypot(p[0] - at.px, p[1] - at.py) < 11 * dpr; };
    let m = this.mask();
    if (this.picking && m) { this.picking = false; m.range.color = Dev.sample(at.sx, at.sy); this.panel(); Dev.render(); Dev.commit('Range mask colour'); return; }
    if (m && this.pending === m.id) {
      if (m.type === 'linear') { Object.assign(m, { x1: at.sx, y1: at.sy, x2: at.sx, y2: at.sy + 0.001 }); this.drag(ev => { const q = Dev.at(ev); m.x2 = q.sx; m.y2 = q.sy; Dev.render(); }, () => { this.pending = null; if (Math.hypot(m.x2 - m.x1, m.y2 - m.y1) < 0.01) m.y2 = m.y1 + 0.25; Dev.render(); Dev.commit('Add Linear Gradient'); }); }
      else { Object.assign(m, { cx: at.sx, cy: at.sy, rx: 0.01, ry: 0.01, angle: 0, feather: 50 }); this.drag(ev => { const q = Dev.at(ev); m.rx = Math.max(0.02, Math.abs(q.sx - m.cx) * a); m.ry = ev.shiftKey ? m.rx : Math.max(0.02, Math.abs(q.sy - m.cy)); Dev.render(); }, () => { this.pending = null; if (m.rx < 0.03 && m.ry < 0.03) { m.rx = 0.25; m.ry = 0.25; } Dev.render(); Dev.commit('Add Radial Gradient'); }); }
      return;
    }
    // handles of the selected mask
    if (m && m.type === 'linear' && m.x1 != null) {
      const mid = [(m.x1 + m.x2) / 2, (m.y1 + m.y2) / 2];
      for (const [k, x, y] of [['1', m.x1, m.y1], ['2', m.x2, m.y2], ['m', ...mid]]) if (hitPx(x, y)) { const o = clone(m), st = [at.sx, at.sy];
        return this.drag(ev => { const q = Dev.at(ev), dx = q.sx - st[0], dy = q.sy - st[1]; if (k !== '2') { m.x1 = o.x1 + dx; m.y1 = o.y1 + dy; } if (k !== '1') { m.x2 = o.x2 + dx; m.y2 = o.y2 + dy; } Dev.render(); }, () => Dev.commit('Adjust Linear Gradient')); }
    }
    if (m && m.type === 'radial' && m.cx != null) {
      const an = (m.angle || 0) * Math.PI / 180, hp = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([ux, uy]) => { const ex = ux * m.rx, ey = uy * m.ry; return [m.cx + (ex * Math.cos(an) - ey * Math.sin(an)) / a, m.cy + ex * Math.sin(an) + ey * Math.cos(an), ux]; });
      for (const [x, y, ux] of hp) if (hitPx(x, y)) return this.drag(ev => { const q = Dev.at(ev), dx = (q.sx - m.cx) * a, dy = q.sy - m.cy, d = Math.max(0.01, Math.hypot(dx, dy)); if (ux) m.rx = d; else m.ry = d; if (ev.shiftKey) m.rx = m.ry = d; Dev.render(); }, () => Dev.commit('Adjust Radial Gradient'));
      if (hitPx(m.cx, m.cy)) { const off = [m.cx - at.sx, m.cy - at.sy]; return this.drag(ev => { const q = Dev.at(ev); m.cx = q.sx + off[0]; m.cy = q.sy + off[1]; Dev.render(); }, () => Dev.commit('Move Radial Gradient')); }
    }
    // pins of other masks
    for (const o of s.masks) { const pin = this.pin(o); if (pin && o !== m && hitPx(pin[0], pin[1])) { this.maskSel = o.id; this.panel(); Dev.render(); return; } }
    // paint
    if (m && m.type === 'brush' && at.inside) {
      const b = GLR.brushCanvas(m, a), ctx = b.canvas.getContext('2d'), W = b.canvas.width, H = b.canvas.height;
      const st = { r: this.brush.size * 0.004, feather: this.brush.feather / 100, flow: this.brush.flow / 100, erase: this.brush.erase !== e.altKey, pts: [[at.sx, at.sy]] };
      GLR.stamp(ctx, st, st.pts, W, H); b.dirty = true; Dev.render();
      this.drag(ev => { const q = Dev.at(ev), last = st.pts[st.pts.length - 1]; if (Math.hypot((q.sx - last[0]) * a, q.sy - last[1]) < st.r * 0.2) return; const p = [+q.sx.toFixed(4), +q.sy.toFixed(4)]; GLR.stamp(ctx, st, [last, p], W, H, true); st.pts.push(p); b.dirty = true; Dev.render(); },
        () => { m.strokes.push(st); b.key = JSON.stringify(m.strokes) + a.toFixed(4); Dev.commit(st.erase ? 'Erase brush stroke' : 'Brush stroke'); });
    }
  },
  pin(m) { if (m.type === 'linear' && m.x1 != null) return [(m.x1 + m.x2) / 2, (m.y1 + m.y2) / 2]; if (m.type === 'radial' && m.cx != null) return [m.cx, m.cy]; if (m.type === 'brush' && m.strokes && m.strokes.length) return m.strokes[0].pts[0]; return null; },

  /* ---------------------------------------------------------------- upright */
  async upright(mode) {
    const s = Dev.s, p = Dev.photo; if (!p || !Dev.src) return;
    const a = Dev.src.w / Dev.src.h;
    if (mode === 'guided') { s.upright = 'guided'; this.set('guided'); this.solveGuided(); Dev.syncUI(); return; }
    if (Dev.tool === 'guided') this.set(null, true);
    if (mode === 'off') { s.upright = 'off'; s.uprightH = null; }
    else {
      const key = p.id + '|' + p.orient; let r = this.uprightCache.get(key);
      if (!r) { try { r = await api('upright_analyze', { id: p.id }); this.uprightCache.set(key, r); } catch (e) { return UI.error(e); } }
      const v = r.nv >= 2 ? r.v : null, hz = r.nh >= 2 ? r.h : null;
      if (mode !== 'level' && !v && !hz) { UI.toast('No strong straight lines found; Upright could not correct this photo.'); mode = 'level'; }
      s.upright = mode; s.uprightH = Geo.upright(mode === 'level' ? null : v, mode === 'level' || mode === 'vertical' ? null : hz, mode, r.angle);
    }
    if (s.constrainCrop) Geo.fitCrop(s, a);
    Dev.syncUI(); Dev.render(); Dev.commit('Upright: ' + mode);
  },
  solveGuided() { const s = Dev.s, a = Dev.src.w / Dev.src.h; s.uprightH = s.guides.length ? Geo.guided(s, a) : null; if (s.constrainCrop) Geo.fitCrop(s, a); Dev.render(); },
  guideDown(e, at) {
    const s = Dev.s, dpr = devicePixelRatio;
    for (let i = 0; i < s.guides.length; i++) for (const k of [0, 2]) { const p = Dev.toPx(s.guides[i][k], s.guides[i][k + 1]); if (Math.hypot(p[0] - at.px, p[1] - at.py) < 10 * dpr) { this.sel = i; const g = s.guides[i]; return this.drag(ev => { const q = Dev.at(ev); g[k] = q.sx; g[k + 1] = q.sy; this.redraw(); }, () => { this.solveGuided(); Dev.commit('Adjust guide'); }); } }
    if (s.guides.length >= 4) return UI.toast('Guided Upright uses up to four guides. Select one and press Delete to replace it.');
    const g = [at.sx, at.sy, at.sx, at.sy]; s.guides.push(g); this.sel = s.guides.length - 1;
    this.drag(ev => { const q = Dev.at(ev); g[2] = q.sx; g[3] = q.sy; this.redraw(); }, () => { if (Math.hypot(g[2] - g[0], g[3] - g[1]) < 0.03) { s.guides.pop(); this.sel = -1; } this.solveGuided(); this.panel(); Dev.commit('Guided Upright'); });
  },

  /* ---------------------------------------------------------------- overlay drawing */
  drawOverlay(ctx, W, H) {
    const dpr = devicePixelRatio, s = Dev.s; ctx.clearRect(0, 0, W, H);
    ctx.font = `${11 * dpr}px Segoe UI, sans-serif`;
    for (const vp of Dev.vps || []) {
      if (vp.label) { ctx.fillStyle = 'rgba(0,0,0,.55)'; const w = ctx.measureText(vp.label).width + 14 * dpr; ctx.fillRect(vp.x + 8 * dpr, vp.y + 8 * dpr, w, 20 * dpr); ctx.fillStyle = '#ddd'; ctx.fillText(vp.label, vp.x + 15 * dpr, vp.y + 22 * dpr); }
      if (vp.empty) { ctx.fillStyle = '#888'; ctx.fillText('Drop a photo here from the filmstrip, or click "Set Reference".', vp.x + 20 * dpr, vp.y + vp.h / 2); }
      if (vp.scissor) { ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = dpr; ctx.beginPath(); ctx.moveTo(vp.scissor[2] + 0.5, 0); ctx.lineTo(vp.scissor[2] + 0.5, H); ctx.stroke(); }
    }
    const vp = Dev.after(); if (!vp) return;
    const r = vp.rect, img = { x: vp.x + r.ox, y: vp.y + r.oy, w: r.dw, h: r.dh };
    if (Dev.tool !== 'crop') Overlay.draw(ctx, img);
    if (this.hide) return;
    const P = (x, y) => Dev.toPx(x, y, vp), line = (a, b, col, w = 1.5) => { ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.lineWidth = (w + 2) * dpr; ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.stroke(); ctx.strokeStyle = col; ctx.lineWidth = w * dpr; ctx.stroke(); };
    const ring = (c, rad, col, fill) => { ctx.beginPath(); ctx.arc(c[0], c[1], Math.max(rad, 2), 0, 7); ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.lineWidth = 3 * dpr; ctx.stroke(); ctx.strokeStyle = col; ctx.lineWidth = 1.4 * dpr; ctx.stroke(); if (fill) { ctx.fillStyle = fill; ctx.fill(); } };
    const t = Dev.tool;
    if (t === 'crop') {
      const f = this.cropFrame(vp);
      ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.rect(f.l, f.t, f.r - f.l, f.b - f.t); ctx.fill('evenodd');
      ctx.strokeStyle = '#fff'; ctx.lineWidth = dpr; ctx.strokeRect(f.l + 0.5, f.t + 0.5, f.r - f.l, f.b - f.t);
      const w = f.r - f.l, hh = f.b - f.t; ctx.strokeStyle = 'rgba(255,255,255,.45)'; ctx.beginPath();
      const v = x => { ctx.moveTo(f.l + w * x, f.t); ctx.lineTo(f.l + w * x, f.b); }, hz = y => { ctx.moveTo(f.l, f.t + hh * y); ctx.lineTo(f.r, f.t + hh * y); };
      if (this.cropOv === 0) { v(1 / 3); v(2 / 3); hz(1 / 3); hz(2 / 3); } else if (this.cropOv === 1) { for (let i = 1; i < 8; i++) { v(i / 8); hz(i / 8); } }
      else if (this.cropOv === 2) { ctx.moveTo(f.l, f.t); ctx.lineTo(f.r, f.b); ctx.moveTo(f.r, f.t); ctx.lineTo(f.l, f.b); }
      else if (this.cropOv === 3) { v(0.382); v(0.618); hz(0.382); hz(0.618); } else if (this.cropOv === 4) { v(0.5); hz(0.5); }
      ctx.stroke(); ctx.fillStyle = '#fff';
      for (const [x, y] of [[f.l, f.t], [f.r, f.t], [f.l, f.b], [f.r, f.b], [(f.l + f.r) / 2, f.t], [(f.l + f.r) / 2, f.b], [f.l, (f.t + f.b) / 2], [f.r, (f.t + f.b) / 2]]) ctx.fillRect(x - 4 * dpr, y - 4 * dpr, 8 * dpr, 8 * dpr);
      const c = s.crop; ctx.fillStyle = '#ddd'; ctx.fillText(`${Math.round(c.w * vp.src.fullW)} × ${Math.round(c.h * vp.src.fullH)} px   ${c.angle ? c.angle.toFixed(1) + '°' : ''}`, f.l + 6 * dpr, f.t - 6 * dpr);
      if (this.line) line([this.line[0], this.line[1]], [this.line[2], this.line[3]], '#ffd24a', 1.5);
    }
    if (t === 'spot') {
      s.spots.forEach((sp, i) => {
        const on = i === this.sel, col = on ? '#fff' : 'rgba(255,255,255,.75)', rad = this.rpx(sp.r);
        if (sp.pts) { ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = on ? 'rgba(255,255,255,.35)' : 'rgba(255,255,255,.2)'; ctx.lineWidth = rad * 2; ctx.beginPath(); sp.pts.forEach((q, k) => { const p = P(q[0], q[1]); k ? ctx.lineTo(...p) : ctx.moveTo(...p); }); ctx.stroke(); }
        const d = P(sp.x, sp.y); ring(d, sp.pts ? 5 * dpr : rad, col);
        if (sp.sx != null && on) { const q = P(sp.sx, sp.sy); line(d, q, '#9fe89f', 1); ring(q, sp.pts ? 5 * dpr : rad, '#7fdc7f'); }
      });
      if (this.stroke) { ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = 'rgba(255,255,255,.45)'; ctx.lineWidth = this.rpx(this.stroke.r) * 2; ctx.beginPath(); this.stroke.pts.forEach((q, k) => { const p = P(q[0], q[1]); k ? ctx.lineTo(...p) : ctx.moveTo(...p); }); if (this.stroke.pts.length === 1) ctx.lineTo(...P(...this.stroke.pts[0])); ctx.stroke(); }
      if (this.cursor) ring(this.cursor, this.rpx(this.spot.size * 0.0012), '#fff');
    }
    if (t === 'redeye') { s.redeyes.forEach((e, i) => ring(P(e.x, e.y), this.hpx(e.rx) * (e.pupil ?? 50) / 50, i === this.sel ? '#fff' : 'rgba(255,255,255,.7)')); if (this.cursor) { ctx.strokeStyle = '#fff'; ctx.lineWidth = dpr; ctx.beginPath(); ctx.moveTo(this.cursor[0] - 8 * dpr, this.cursor[1]); ctx.lineTo(this.cursor[0] + 8 * dpr, this.cursor[1]); ctx.moveTo(this.cursor[0], this.cursor[1] - 8 * dpr); ctx.lineTo(this.cursor[0], this.cursor[1] + 8 * dpr); ctx.stroke(); } }
    if (t === 'mask') {
      const m = this.mask();
      for (const o of s.masks) { const pin = this.pin(o); if (pin) ring(P(pin[0], pin[1]), 6 * dpr, '#fff', o === m ? '#1e1e1e' : 'rgba(200,200,200,.9)'); }
      if (m && m.type === 'linear' && m.x1 != null) {
        const a = vp.a, dx = (m.x2 - m.x1) * a, dy = m.y2 - m.y1, len = Math.hypot(dx, dy) || 1, nx = -dy / len / a, ny = dx / len, L = 2;
        for (const [x, y, col] of [[m.x1, m.y1, '#fff'], [(m.x1 + m.x2) / 2, (m.y1 + m.y2) / 2, 'rgba(255,255,255,.5)'], [m.x2, m.y2, '#fff']]) line(P(x - nx * L, y - ny * L), P(x + nx * L, y + ny * L), col, 1);
        ring(P(m.x1, m.y1), 4 * dpr, '#fff', '#fff'); ring(P(m.x2, m.y2), 4 * dpr, '#fff', '#fff');
      }
      if (m && m.type === 'radial' && m.cx != null) {
        const a = vp.a, an = (m.angle || 0) * Math.PI / 180, pt = th => { const ex = Math.cos(th) * m.rx, ey = Math.sin(th) * m.ry; return P(m.cx + (ex * Math.cos(an) - ey * Math.sin(an)) / a, m.cy + ex * Math.sin(an) + ey * Math.cos(an)); };
        ctx.beginPath(); for (let i = 0; i <= 72; i++) { const p = pt(i / 72 * Math.PI * 2); i ? ctx.lineTo(...p) : ctx.moveTo(...p); }
        ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.lineWidth = 3 * dpr; ctx.stroke(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.2 * dpr; ctx.stroke();
        for (const th of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) ring(pt(th), 4 * dpr, '#fff', '#fff');
      }
      if (m && m.type === 'brush' && this.cursor) { const rad = this.rpx(this.brush.size * 0.004); ring(this.cursor, rad, '#fff'); ring(this.cursor, rad * (1 - this.brush.feather / 100), 'rgba(255,255,255,.5)'); }
      if (this.pending) { ctx.fillStyle = '#ddd'; ctx.fillText(m && m.type === 'radial' ? 'Drag from the centre outwards to draw the radial gradient' : 'Drag from where the effect is full to where it ends', img.x + 10 * dpr, img.y + img.h - 10 * dpr); }
      if (this.picking) { ctx.fillStyle = '#ffd24a'; ctx.fillText('Click the colour to target', img.x + 10 * dpr, img.y + img.h - 10 * dpr); }
    }
    if (t === 'guided') { s.guides.forEach((g, i) => { const a = P(g[0], g[1]), b = P(g[2], g[3]), col = i === this.sel ? '#ffd24a' : '#7fd4ff'; line(a, b, col, 1.5); ring(a, 4 * dpr, col, col); ring(b, 4 * dpr, col, col); }); ctx.fillStyle = '#ddd'; ctx.fillText(`${s.guides.length} of 4 guides. Draw along edges that should be vertical or horizontal.`, img.x + 10 * dpr, img.y + img.h - 10 * dpr); }
  },

  /* ---------------------------------------------------------------- tool options panel */
  panel() {
    const el = Dev.toolB; if (!el) return;
    const t = Dev.tool, s = Dev.s, sl = (label, obj, key, min, max, step, def, done, live) => UI.slider({ label, min, max, step: step || 1, value: obj[key] ?? def ?? 0, def: def ?? 0, oninput: v => { obj[key] = v; live ? live(v) : Dev.render(); }, onchange: v => done && done(v) });
    el.className = 'tool-panel' + (t && t !== 'wb' ? ' on' : '');
    if (!t || t === 'wb') { el.replaceChildren(t === 'wb' ? h('div', { class: 'fnote' }, 'Click a neutral grey or white area of the photo.') : ''); return; }
    if (t === 'crop') {
      const asp = h('select', { onchange: e => this.setAspect(ASPECTS[e.target.selectedIndex][0]) }, ASPECTS.map(([v, l]) => h('option', { selected: v === s.cropAspect }, l)));
      const a = Dev.src ? Dev.src.w / Dev.src.h : 1.5;
      el.replaceChildren(h('label', { class: 'frow' }, h('span', {}, 'Aspect'), asp),
        h('div', { class: 'dlg-inline' }, h('button', { class: 'btn', title: 'Swap between landscape and portrait crop (X)', onclick: () => { const c = s.crop, wpx = c.w * Dev.src.fullW, hpx = c.h * Dev.src.fullH; s.crop = this.cropShrink({ ...c, w: hpx / Dev.src.fullW, h: wpx / Dev.src.fullH }, a); Dev.render(); } }, '⇄ Flip'),
          h('button', { class: 'btn' + (this.straighten ? ' on' : ''), title: 'Draw a line along something that should be level', onclick: () => { this.straighten = !this.straighten; this.panel(); } }, '─ Straighten Tool'),
          h('button', { class: 'btn', title: 'Level the photo automatically', onclick: async () => { try { const r = await api('upright_analyze', { id: Dev.photo.id }); let d = s.crop.angle + r.angle; while (d > 45) d -= 90; while (d < -45) d += 90; s.crop = this.cropShrink({ ...s.crop, angle: +d.toFixed(2) }, a); this.panel(); Dev.render(); } catch (e) { UI.error(e); } } }, 'Auto')),
        UI.slider({ label: 'Angle', min: -45, max: 45, step: 0.1, value: s.crop.angle, def: 0, oninput: v => { s.crop = this.cropShrink({ ...s.crop, angle: v }, a); Dev.render(); } }),
        h('div', { class: 'dlg-inline' }, h('button', { class: 'btn', onclick: () => Lib.rotate('ccw') }, '↺ 90°'), h('button', { class: 'btn', onclick: () => Lib.rotate('cw') }, '↻ 90°'), h('button', { class: 'btn', onclick: () => Lib.rotate('fliph') }, 'Flip H'), h('button', { class: 'btn', onclick: () => Lib.rotate('flipv') }, 'Flip V')),
        h('div', { class: 'dlg-inline' }, h('button', { class: 'btn', onclick: () => { s.crop = clone(DEFAULTS.crop); s.cropAspect = 'original'; this.panel(); Dev.render(); } }, 'Reset'), h('button', { class: 'btn primary', onclick: () => this.done() }, 'Done')),
        h('div', { class: 'fnote' }, 'Drag the handles to crop, inside to move, outside the frame to rotate.'));
      return;
    }
    if (t === 'spot') {
      const sp = s.spots[this.sel], target = sp || this.spot, redo = () => { if (sp) { Dev.reloadSource(); Dev.commit('Edit spot'); } };
      const seg = h('div', { class: 'seg' }, [['remove', 'Content-Aware', 'Fills from the best-matching surroundings, chosen automatically'], ['heal', 'Heal', 'Copies texture from the source and blends tone and colour'], ['clone', 'Clone', 'Copies the source pixels exactly']].map(([v, l, tip]) => h('a', { class: target.type === v ? 'on' : '', title: tip, onclick: () => { target.type = v; this.spot.type = v; this.panel(); redo(); } }, l)));
      el.replaceChildren(seg, sp ? sl('Size', { v: sp.r / 0.0012 }, 'v', 1, 100, 1, 12, v => { sp.r = v * 0.0012; redo(); }, v => { sp.r = v * 0.0012; this.redraw(); }) : sl('Size', this.spot, 'size', 1, 100, 1, 12, null, () => this.redraw()),
        sl('Feather', target, 'feather', 0, 100, 1, 50, redo, () => {}), sl('Opacity', target, 'opacity', 0, 100, 1, 100, redo, () => {}),
        h('div', { class: 'dlg-inline' }, sp ? h('button', { class: 'btn', title: 'Pick a different source automatically', onclick: async () => { const others = s.spots.filter(x => x !== sp); const probe = { ...sp, r: sp.r * (1.3 + Math.random()) }; const auto = await api('retouch_auto', { id: Dev.photo.id, spot: probe, spots: others }); if (auto) { sp.sx = auto.sx; sp.sy = auto.sy; redo(); this.redraw(); } } }, 'Refresh Source') : null,
          sp ? h('button', { class: 'btn', onclick: () => this.deleteSelected() }, 'Delete') : null, s.spots.length ? h('button', { class: 'btn', onclick: () => { s.spots = []; this.sel = -1; this.panel(); Dev.reloadSource(); Dev.commit('Reset spots'); } }, 'Reset') : null, h('button', { class: 'btn primary', onclick: () => this.done() }, 'Done')),
        h('div', { class: 'fnote' }, `${s.spots.length} spot${s.spots.length === 1 ? '' : 's'}. Click a blemish, or drag to paint over an object. Drag the green circle to choose the source yourself. H hides the pins.`));
      return;
    }
    if (t === 'redeye') {
      const r = s.redeyes[this.sel];
      el.replaceChildren(r ? sl('Pupil Size', r, 'pupil', 10, 100, 1, 50, () => Dev.commit('Red Eye pupil size')) : null, r ? sl('Darken', r, 'darken', 0, 100, 1, 50, () => Dev.commit('Red Eye darken')) : null,
        h('div', { class: 'dlg-inline' }, r ? h('button', { class: 'btn', onclick: () => this.deleteSelected() }, 'Delete') : null, s.redeyes.length ? h('button', { class: 'btn', onclick: () => { s.redeyes = []; this.sel = -1; this.panel(); Dev.render(); Dev.commit('Reset red eye'); } }, 'Reset') : null, h('button', { class: 'btn primary', onclick: () => this.done() }, 'Done')),
        h('div', { class: 'fnote' }, 'Drag from the centre of each red pupil outwards to cover the eye.'));
      return;
    }
    if (t === 'guided') { el.replaceChildren(h('div', { class: 'fnote' }, 'Draw 2–4 guides along lines that should be perfectly vertical or horizontal. Drag an end to adjust; Delete removes the selected guide.'),
      h('div', { class: 'dlg-inline' }, h('button', { class: 'btn', onclick: () => { s.guides = []; this.sel = -1; this.solveGuided(); this.panel(); Dev.commit('Clear guides'); } }, 'Clear Guides'), h('button', { class: 'btn primary', onclick: () => this.done() }, 'Done'))); return; }
    // ---- masking
    const m = this.mask(), done = label => () => Dev.commit(label);
    const create = h('div', { class: 'dlg-inline' }, [['brush', '✎ Brush (K)'], ['linear', '▥ Linear (M)'], ['radial', '◯ Radial (⇧M)']].map(([k, l]) => h('button', { class: 'btn', onclick: () => this.addMask(k) }, l)));
    const list = s.masks.map(o => h('div', { class: 'trow' + (o === m ? ' on' : ''), onclick: () => { this.maskSel = o.id; this.pending = null; this.panel(); Dev.render(); } },
      h('span', { class: 'ticon' }, { brush: '✎', linear: '▥', radial: '◯' }[o.type]), h('span', { class: 'tl' }, o.name + (o.range && o.range.type !== 'none' ? '  ∩ ' + o.range.type : '')),
      h('a', { class: 'go', title: 'Show / hide this mask’s effect', onclick: e => { e.stopPropagation(); o.hidden = !o.hidden; this.panel(); Dev.render(); Dev.commit('Toggle mask'); } }, o.hidden ? '◌' : '◉')));
    if (!m) { el.replaceChildren(h('div', { class: 'sub' }, 'Create New Mask'), create, ...list, h('div', { class: 'fnote' }, s.masks.length ? 'Select a mask to edit it.' : 'Masks apply adjustments to part of the photo. Add a range mask to limit one by colour, luminance or depth.'), h('div', { class: 'dlg-inline' }, h('button', { class: 'btn primary', onclick: () => this.done() }, 'Done'))); return; }
    const rg = m.range ||= { type: 'none' };
    const rangeUI = [h('label', { class: 'frow' }, h('span', {}, 'Range Mask'), h('select', { onchange: async e => { rg.type = e.target.value; if (rg.type === 'color' && !rg.color) { rg.color = [0.5, 0.5, 0.5]; rg.amount = 50; this.picking = true; } if (rg.type !== 'color' && rg.min == null) { rg.min = 0; rg.max = 100; rg.smooth = 20; } this.panel(); await Dev.refreshNeed(); Dev.commit('Range mask: ' + rg.type); } },
      [['none', 'Off'], ['color', 'Color'], ['lum', 'Luminance'], ['depth', 'Depth (estimated)']].map(([v, l]) => h('option', { value: v, selected: rg.type === v }, l))))];
    if (rg.type === 'color') rangeUI.push(h('div', { class: 'frow' }, h('span', {}, 'Target'), h('span', { class: 'fpick' }, h('i', { class: 'swatch big', style: { background: `rgb(${rg.color.map(c => Math.round(c * 255)).join(',')})` } }), h('button', { class: 'btn' + (this.picking ? ' on' : ''), onclick: () => { this.picking = !this.picking; this.panel(); this.redraw(); } }, '✎ Pick Colour'))), sl('Amount', rg, 'amount', 0, 100, 1, 50, done('Colour range amount')));
    if (rg.type === 'lum' || rg.type === 'depth') rangeUI.push(sl(rg.type === 'lum' ? 'Darkest' : 'Nearest', rg, 'min', 0, 100, 1, 0, done('Range')), sl(rg.type === 'lum' ? 'Brightest' : 'Farthest', rg, 'max', 0, 100, 1, 100, done('Range')), sl('Smoothness', rg, 'smooth', 0, 100, 1, 20, done('Range smoothness')),
      rg.type === 'depth' ? h('div', { class: 'fnote' }, 'Depth is estimated from focus, haze and position because this file has no depth map. Treat it as approximate.') : null);
    m.adj ||= {};
    el.replaceChildren(h('div', { class: 'sub' }, 'Masks'), create, ...list,
      h('div', { class: 'sub row' }, h('input', { type: 'text', class: 'mname', value: m.name, onchange: e => { m.name = e.target.value || m.name; this.panel(); Dev.commit('Rename mask'); } }),
        h('label', { class: 'tb-check' }, h('input', { type: 'checkbox', checked: this.showOverlay, onchange: e => { this.showOverlay = e.target.checked; Dev.render(); } }), 'Overlay (O)')),
      h('label', { class: 'fcheck' }, h('input', { type: 'checkbox', checked: !!m.invert, onchange: e => { m.invert = e.target.checked; Dev.render(); Dev.commit('Invert mask'); } }), 'Invert'),
      sl('Amount', m, 'amount', 0, 100, 1, 100, done('Mask amount')),
      m.type === 'brush' ? [sl('Brush Size', this.brush, 'size', 1, 100, 1, 6, null, () => this.redraw()), sl('Feather', this.brush, 'feather', 0, 100, 1, 60, null, () => this.redraw()), sl('Flow', this.brush, 'flow', 1, 100, 1, 80, null, () => {}),
        h('label', { class: 'fcheck' }, h('input', { type: 'checkbox', checked: this.brush.erase, onchange: e => { this.brush.erase = e.target.checked; } }), 'Erase (or hold Alt)')] : null,
      m.type === 'radial' ? [sl('Feather', m, 'feather', 0, 100, 1, 50, done('Radial feather')), sl('Angle', m, 'angle', -90, 90, 1, 0, done('Radial angle'))] : null,
      ...rangeUI, h('div', { class: 'sub' }, 'Adjustments'),
      ...MASK_SLIDERS.map(([k, label, min = -100, max = 100, step = 1]) => sl(label, m.adj, k, min, max, step, 0, done('Mask ' + label))),
      h('div', { class: 'dlg-inline' }, h('button', { class: 'btn', onclick: () => { m.adj = {}; this.panel(); Dev.render(); Dev.commit('Reset mask adjustments'); } }, 'Reset'),
        h('button', { class: 'btn', onclick: () => { if (s.masks.length >= 8) return; const c = clone(m); c.id = rid(); c.name += ' copy'; s.masks.push(c); this.maskSel = c.id; this.panel(); Dev.render(); Dev.commit('Duplicate mask'); } }, 'Duplicate'),
        h('button', { class: 'btn', onclick: () => this.deleteSelected() }, 'Delete'), h('button', { class: 'btn primary', onclick: () => this.done() }, 'Done')));
  },
};

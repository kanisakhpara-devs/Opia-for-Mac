'use strict';
/* Develop engine: settings model, geometry maths, and the WebGL2 pipeline that renders every edit in one pass. */

const HSL_BANDS = ['Red', 'Orange', 'Yellow', 'Green', 'Aqua', 'Blue', 'Purple', 'Magenta'];
const Z8 = () => [0, 0, 0, 0, 0, 0, 0, 0];
const LINE = () => [[0, 0], [255, 255]];
const DEFAULTS = {
  treatment: 'color', profile: 'standard', wb: 'asshot', temp: 0, tint: 0, exposure: 0, contrast: 0, highlights: 0, shadows: 0,
  whites: 0, blacks: 0, texture: 0, clarity: 0, dehaze: 0, vibrance: 0, saturation: 0,
  pcHighlights: 0, pcLights: 0, pcDarks: 0, pcShadows: 0, pcSplit: [25, 50, 75],
  curve: { rgb: LINE(), r: LINE(), g: LINE(), b: LINE() },
  hsl: { hue: Z8(), sat: Z8(), lum: Z8() }, bwMix: Z8(),
  cg: { shadows: { h: 0, s: 0, l: 0 }, midtones: { h: 0, s: 0, l: 0 }, highlights: { h: 0, s: 0, l: 0 }, global: { h: 0, s: 0, l: 0 }, blending: 50, balance: 0 },
  sharpAmount: 0, sharpRadius: 1, sharpDetail: 25, sharpMasking: 0, nrLum: 0, nrLumDetail: 50, nrLumContrast: 0, nrColor: 0, nrColorDetail: 50, nrColorSmooth: 50,
  lensProfileEnable: false, lensProfile: 'auto', lensDistScale: 100, lensVigScale: 100, caRemove: false, caR: 0, caB: 0,
  defringePurple: 0, defringePurpleHue: [30, 70], defringeGreen: 0, defringeGreenHue: [40, 60], distortion: 0, lensVignette: 0, lensVigMid: 50,
  upright: 'off', uprightH: null, guides: [], tVertical: 0, tHorizontal: 0, tRotate: 0, tAspect: 0, tScale: 100, tX: 0, tY: 0, constrainCrop: false,
  vigAmount: 0, vigMid: 50, vigRound: 0, vigFeather: 50, vigHighlights: 0, grain: 0, grainSize: 25, grainRough: 50,
  calShadowTint: 0, calRedHue: 0, calRedSat: 0, calGreenHue: 0, calGreenSat: 0, calBlueHue: 0, calBlueSat: 0,
  crop: { cx: 0.5, cy: 0.5, w: 1, h: 1, angle: 0 }, cropAspect: 'original', spots: [], redeyes: [], masks: [],
};
const MASK_ADJ = { exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0, temp: 0, tint: 0, texture: 0, clarity: 0, dehaze: 0, saturation: 0, sharpness: 0, noise: 0, hue: 0, color: 0 };
const GEOMETRY_KEYS = ['crop', 'cropAspect', 'upright', 'uprightH', 'guides', 'tVertical', 'tHorizontal', 'tRotate', 'tAspect', 'tScale', 'tX', 'tY', 'constrainCrop', 'distortion', 'lensProfileEnable', 'lensProfile', 'lensDistScale'];
const PROFILES = {   // built-in rendering looks; user camera profiles are stored calibration sets
  standard: { name: 'Standard' }, vivid: { name: 'Vivid', sat: 0.25, con: 0.18 }, landscape: { name: 'Landscape', sat: 0.16, con: 0.1, m: [1.02, -0.02, 0, -0.04, 1.08, -0.04, -0.02, -0.06, 1.08] },
  portrait: { name: 'Portrait', sat: -0.06, con: -0.06, m: [1.03, -0.02, -0.01, 0.01, 0.99, 0, 0, 0.02, 0.98] }, neutral: { name: 'Neutral', sat: -0.1, con: -0.16 },
  flat: { name: 'Flat', sat: -0.15, con: -0.3 }, mono: { name: 'Monochrome', bw: true },
};
const LENS_BUILTIN = {   // generic corrections; real per-lens data comes from saved or imported (.lcp) profiles
  'generic-wide': { name: 'Generic wide-angle (barrel)', k1: -0.08, k2: 0.01, v1: 0.45, v2: 0.1 },
  'generic-zoom': { name: 'Generic kit zoom', k1: -0.035, k2: 0, v1: 0.3, v2: 0.05 },
  'generic-tele': { name: 'Generic telephoto (pincushion)', k1: 0.025, k2: 0, v1: 0.18, v2: 0 },
  'action-cam': { name: 'Action camera / fisheye', k1: -0.22, k2: 0.045, v1: 0.5, v2: 0.2 },
  'phone-wide': { name: 'Smartphone wide', k1: -0.05, k2: 0.008, v1: 0.35, v2: 0.1 },
};

/* Full settings object for a photo: defaults overlaid with what is stored. */
function devFull(s) {
  const out = clone(DEFAULTS);
  for (const [k, v] of Object.entries(s || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' && !Array.isArray(out[k])) out[k] = { ...out[k], ...clone(v) };
    else out[k] = clone(v);
  }
  return out;
}
/* Only what differs from the defaults is stored. */
function devDiff(full) {
  const out = {};
  for (const [k, v] of Object.entries(full)) if (!(k in DEFAULTS) || !same(v, DEFAULTS[k])) out[k] = clone(v);
  return Object.keys(out).length ? out : null;
}

/* ------------------------------------------------------------------ geometry */
const M3 = {
  I: () => [1, 0, 0, 0, 1, 0, 0, 0, 1],
  mul(...ms) { return ms.reduce((a, b) => { const o = new Array(9); for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c]; return o; }); },
  inv(m) {
    const [a, b, c, d, e, f, g, hh, i] = m, A = e * i - f * hh, B = f * g - d * i, C = d * hh - e * g, det = a * A + b * B + c * C;
    if (Math.abs(det) < 1e-12) return M3.I();
    return [A, c * hh - b * i, b * f - c * e, B, a * i - c * g, c * d - a * f, C, b * g - a * hh, a * e - b * d].map(v => v / det);
  },
  ap(m, x, y) { const w = m[6] * x + m[7] * y + m[8]; return [(m[0] * x + m[1] * y + m[2]) / w, (m[3] * x + m[4] * y + m[5]) / w, w]; },
  T: (x, y) => [1, 0, x, 0, 1, y, 0, 0, 1], S: (x, y) => [x, 0, 0, 0, y ?? x, 0, 0, 0, 1],
  R(deg) { const r = deg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r); return [c, -s, 0, s, c, 0, 0, 0, 1]; },
  col: m => [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]],   // row-major -> GL column-major
};
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

const Geo = {
  lens(s) {
    let k1 = -(s.distortion / 100) * 0.22, k2 = 0, v1 = (s.lensVignette / 100) * (0.4 + 1.2 * (1 - s.lensVigMid / 100)), v2 = (s.lensVignette / 100) * 0.5 * (s.lensVigMid / 100);
    if (s.lensProfileEnable) {
      const p = Geo.lensProfile(s.lensProfile, s._lensHint);
      if (p) { k1 += (p.k1 || 0) * s.lensDistScale / 100; k2 += (p.k2 || 0) * s.lensDistScale / 100; v1 += (p.v1 || 0) * s.lensVigScale / 100; v2 += (p.v2 || 0) * s.lensVigScale / 100; }
    }
    return { k1, k2, v1, v2 };
  },
  lensProfiles() { return { ...LENS_BUILTIN, ...App.conf('lens_profiles', {}) }; },
  lensProfile(id, hint) {
    const all = Geo.lensProfiles();
    if (id && id !== 'auto') return all[id] || null;
    if (!hint) return null;
    const hl = hint.toLowerCase();
    return Object.values(all).find(p => p.match && hl.includes(p.match.toLowerCase())) || null;
  },
  /* distortion: source = q * f(r) / norm, with r normalised to 1 at the corner; norm keeps the frame filled */
  dist(s, a) {
    const { k1, k2 } = Geo.lens(s), R2 = (a * a + 1) / 4, rm = Math.min(a, 1) ** 2 / 4 / R2;
    const f = r2 => 1 + k1 * r2 + k2 * r2 * r2;
    return [k1, k2, Math.max(f(rm), f(1), f((rm + 1) / 2)), 1 / R2];
  },
  distort(d, x, y) { const r2 = (x * x + y * y) * d[3], f = (1 + d[0] * r2 + d[1] * r2 * r2) / d[2]; return [x * f, y * f]; },
  undistort(d, x, y) { let qx = x, qy = y; for (let i = 0; i < 12; i++) { const r2 = (qx * qx + qy * qy) * d[3], f = (1 + d[0] * r2 + d[1] * r2 * r2) / d[2]; qx = x / f; qy = y / f; } return [qx, qy]; },
  /* forward transform in centred coordinates (units of image height) */
  forward(s, a) {
    const asp = s.tAspect / 100, sc = s.tScale / 100;
    let m = M3.mul(M3.T(s.tX / 100 * a, s.tY / 100), M3.S(sc * (asp > 0 ? 1 + asp : 1), sc * (asp < 0 ? 1 - asp : 1)),
      [1, 0, 0, 0, 1, 0, s.tHorizontal / 100 * 0.7, s.tVertical / 100 * 0.7, 1], M3.R(s.tRotate));
    if (s.upright !== 'off' && s.uprightH) m = M3.mul(m, s.uprightH);
    return m;
  },
  region(s, a) { const c = s.crop; return { x: (c.cx - 0.5) * a, y: c.cy - 0.5, W: c.w * a, H: c.h, angle: c.angle }; },
  full(a) { return { x: 0, y: 0, W: a, H: 1, angle: 0 }; },
  regionMat(r) { return M3.mul(M3.T(r.x, r.y), M3.R(r.angle), M3.S(r.W, r.H), M3.T(-0.5, -0.5)); },
  /* region uv -> source uv (the exact path the shader takes), and back */
  mapper(s, a, region) {
    const o2t = Geo.regionMat(region || Geo.region(s, a)), fwd = Geo.forward(s, a), inv = M3.inv(fwd), d = Geo.dist(s, a), t2o = M3.inv(o2t);
    return {
      toSrc(u, v) { const c = M3.ap(o2t, u, v), q = M3.ap(inv, c[0], c[1]), qd = Geo.distort(d, q[0], q[1]); return [qd[0] / a + 0.5, qd[1] + 0.5, q[2]]; },
      toOut(x, y) { const q = Geo.undistort(d, (x - 0.5) * a, y - 0.5), c = M3.ap(fwd, q[0], q[1]); return M3.ap(t2o, c[0], c[1]); },
      toT(x, y) { const q = Geo.undistort(d, (x - 0.5) * a, y - 0.5); return M3.ap(fwd, q[0], q[1]); },
      tToSrc(cx, cy) { const q = M3.ap(inv, cx, cy), qd = Geo.distort(d, q[0], q[1]); return [qd[0] / a + 0.5, qd[1] + 0.5, q[2]]; },
    };
  },
  /* is every point on the crop border backed by real pixels? */
  cropValid(s, a) {
    const m = Geo.mapper(s, a);
    for (let i = 0; i <= 12; i++) for (const [u, v] of [[i / 12, 0], [i / 12, 1], [0, i / 12], [1, i / 12]]) {
      const p = m.toSrc(u, v);
      if (p[2] <= 0 || p[0] < -0.001 || p[0] > 1.001 || p[1] < -0.001 || p[1] > 1.001) return false;
    }
    return true;
  },
  /* shrink the crop about its centre until it holds only image */
  fitCrop(s, a) {
    if (Geo.cropValid(s, a)) return s.crop;
    const c0 = s.crop; let lo = 0.02, hi = 1;
    for (let i = 0; i < 22; i++) { const k = (lo + hi) / 2; s.crop = { ...c0, w: c0.w * k, h: c0.h * k }; if (Geo.cropValid(s, a)) lo = k; else hi = k; }
    s.crop = { ...c0, w: c0.w * lo, h: c0.h * lo };
    return s.crop;
  },
  outSize(s, w, h) { return [Math.max(1, Math.round(s.crop.w * w)), Math.max(1, Math.round(s.crop.h * h))]; },
  /* Homography that straightens the scene given vertical / horizontal vanishing points (centred coords). */
  upright(vv, vh, mode, angle) {
    if (mode === 'level' || (!vv && !vh)) return M3.R(-(angle || 0));
    const norm = v => { const n = Math.hypot(v[0], v[1], v[2]) || 1; return v.map(x => x / n); };
    const dirOf = v => { const far = Math.abs(v[2]) < 1e-9; const d = far ? [v[0], v[1]] : [v[0] / v[2], v[1] / v[2]]; const n = Math.hypot(d[0], d[1]) || 1; return [d[0] / n, d[1] / n]; };
    if (mode === 'vertical') vh = null;
    if (vv && !vh) { const d = dirOf(vv); vh = [d[1], -d[0], 0]; }
    if (vh && !vv) { const d = dirOf(vh); vv = [-d[1], d[0], 0]; }
    vv = norm(vv); vh = norm(vh);
    let l = cross(vv, vh);
    let px = 0, py = 0;
    if (Math.abs(l[2]) > 1e-9) { px = l[0] / l[2]; py = l[1] / l[2]; }
    if (mode === 'auto') { const mag = Math.hypot(px, py); if (mag > 0.45) { px *= 0.45 / mag; py *= 0.45 / mag; } }
    const P = [1, 0, 0, 0, 1, 0, px, py, 1];
    const img = v => { const x = P[0] * v[0] + P[1] * v[1] + P[2] * v[2], y = P[3] * v[0] + P[4] * v[1] + P[5] * v[2]; const n = Math.hypot(x, y) || 1; return [x / n, y / n]; };
    let dv = img(vv), dh = img(vh);
    if (dv[1] < 0) dv = [-dv[0], -dv[1]];
    if (dh[0] < 0) dh = [-dh[0], -dh[1]];
    const det = dh[0] * dv[1] - dv[0] * dh[1];
    if (Math.abs(det) < 0.2) return P;
    const k = 1 / Math.sqrt(Math.abs(det));
    const A = [dv[1] / det * k, -dv[0] / det * k, 0, -dh[1] / det * k, dh[0] / det * k, 0, 0, 0, 1];
    return M3.mul(A, P);
  },
  /* Guided Upright: user lines (source uv) -> homography */
  guided(s, a) {
    const d = Geo.dist({ ...s, upright: 'off' }, a), V = [], Hh = [];
    for (const g of s.guides || []) {
      const p1 = Geo.undistort(d, (g[0] - 0.5) * a, g[1] - 0.5), p2 = Geo.undistort(d, (g[2] - 0.5) * a, g[3] - 0.5);
      const line = { l: cross([p1[0], p1[1], 1], [p2[0], p2[1], 1]), dir: [p2[0] - p1[0], p2[1] - p1[1], 0] };
      (Math.abs(p2[1] - p1[1]) >= Math.abs(p2[0] - p1[0]) ? V : Hh).push(line);
    }
    const vp = L => (L.length >= 2 ? cross(L[0].l, L[1].l) : L.length === 1 ? L[0].dir : null);
    const vv = vp(V), vh = vp(Hh);
    if (!vv && !vh) return null;
    return Geo.upright(vv, vh, 'full', 0);
  },
};

/* ------------------------------------------------------------------ tone curves */
function monotoneSpline(pts) {
  const p = [...pts].sort((a, b) => a[0] - b[0]), n = p.length;
  if (n < 2) return x => (n ? p[0][1] : x);
  const dx = [], m = [], t = new Array(n);
  for (let i = 0; i < n - 1; i++) { dx.push(p[i + 1][0] - p[i][0] || 1e-6); m.push((p[i + 1][1] - p[i][1]) / dx[i]); }
  t[0] = m[0]; t[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
    const a = t[i] / m[i], b = t[i + 1] / m[i], q = a * a + b * b;
    if (q > 9) { const k = 3 / Math.sqrt(q); t[i] = k * a * m[i]; t[i + 1] = k * b * m[i]; }
  }
  return x => {
    if (x <= p[0][0]) return p[0][1];
    if (x >= p[n - 1][0]) return p[n - 1][1];
    let i = 0; while (x > p[i + 1][0]) i++;
    const hh = dx[i], u = (x - p[i][0]) / hh, u2 = u * u, u3 = u2 * u;
    return (2 * u3 - 3 * u2 + 1) * p[i][1] + (u3 - 2 * u2 + u) * hh * t[i] + (-2 * u3 + 3 * u2) * p[i + 1][1] + (u3 - u2) * hh * t[i + 1];
  };
}
function parametricCurve(s) {
  const [s1, s2, s3] = s.pcSplit.map(v => v / 100);
  const bump = (x, a, pk, b) => (x <= a || x >= b ? 0 : x < pk ? Math.sin((x - a) / (pk - a) * Math.PI / 2) ** 2 : Math.cos((x - pk) / (b - pk) * Math.PI / 2) ** 2);
  return x => clamp(x + 0.18 * (s.pcShadows / 100 * bump(x, 0, s1 / 2, s2) + s.pcDarks / 100 * bump(x, 0, (s1 + s2) / 2, s3)
    + s.pcLights / 100 * bump(x, s1, (s2 + s3) / 2, 1) + s.pcHighlights / 100 * bump(x, s2, (s3 + 1) / 2, 1)), 0, 1);
}
function curveLUT(s) {
  const par = parametricCurve(s), f = { rgb: monotoneSpline(s.curve.rgb), r: monotoneSpline(s.curve.r), g: monotoneSpline(s.curve.g), b: monotoneSpline(s.curve.b) };
  const out = new Uint8Array(256 * 4);
  let prev = 0;
  for (let i = 0; i < 256; i++) {
    out[i * 4] = clamp(Math.round(f.r(i)), 0, 255); out[i * 4 + 1] = clamp(Math.round(f.g(i)), 0, 255); out[i * 4 + 2] = clamp(Math.round(f.b(i)), 0, 255);
    prev = Math.max(prev, clamp(Math.round(f.rgb(par(i / 255) * 255)), 0, 255));   // keep the master curve monotonic
    out[i * 4 + 3] = prev;
  }
  return out;
}
function hsv2rgb(hh, s, v) { const f = n => { const k = (n + hh / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); }; return [f(5), f(3), f(1)]; }
function rgb2hsv(r, g, b) { const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; let hh = 0; if (d) hh = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return [(hh * 60 + 360) % 360, mx ? d / mx : 0, mx]; }
function calibrationMatrix(s) {
  const prof = PROFILES[s.profile] || {};
  const cols = [[1, 0, 0, s.calRedHue, s.calRedSat], [0, 1, 0, s.calGreenHue, s.calGreenSat], [0, 0, 1, s.calBlueHue, s.calBlueSat]].map(([r, g, b, hu, sa]) => {
    const [hh, , v] = rgb2hsv(r, g, b);
    const c = hsv2rgb((hh + hu * 0.2 + 360) % 360, 1, v), k = 1 + sa / 100 * 0.5, l = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    return c.map(x => l + (x - l) * k);
  });
  let m = [cols[0][0], cols[1][0], cols[2][0], cols[0][1], cols[1][1], cols[2][1], cols[0][2], cols[1][2], cols[2][2]];
  for (let r = 0; r < 3; r++) { const sum = m[r * 3] + m[r * 3 + 1] + m[r * 3 + 2] || 1; for (let c = 0; c < 3; c++) m[r * 3 + c] /= sum; }   // white stays white
  if (prof.m) m = M3.mul(prof.m, m);
  return m;
}

/* ------------------------------------------------------------------ shaders */
const VERT = `#version 300 es
in vec2 a_pos; out vec2 v_p; uniform float u_flip;
void main() { v_p = vec2(a_pos.x * 0.5 + 0.5, u_flip > 0.5 ? a_pos.y * 0.5 + 0.5 : 0.5 - a_pos.y * 0.5); gl_Position = vec4(a_pos, 0.0, 1.0); }`;
const FRAG = `#version 300 es
precision highp float; precision highp sampler3D;
in vec2 v_p; out vec4 o_col;
uniform sampler2D u_src, u_curve, u_depth, u_brush0, u_brush1, u_brush2, u_brush3;
uniform sampler3D u_lut;
uniform mat3 u_p2o, u_o2t, u_geom, u_cal;
uniform vec4 u_dist, u_tone, u_sharp, u_nr, u_vig, u_bg, u_defrP, u_defrG;
uniform vec3 u_tcd, u_lods, u_grain, u_cgS, u_cgM, u_cgH, u_cgG, u_edge, u_ovCol;
uniform vec2 u_srcSize, u_wb, u_tone2, u_color, u_ca, u_lvig, u_cgB, u_outPx, u_prof;
uniform float u_aspect, u_bw, u_fx, u_vigH, u_proof, u_gamut, u_clip, u_ovOn, u_useDepth, u_calShadow, u_hslOn, u_maxLod;
uniform float u_hslH[8], u_hslS[8], u_hslL[8], u_bwMix[8];
uniform int u_mN, u_mSel, u_reN;
uniform vec4 u_mA[8], u_mB[8], u_mC[8], u_mD[8], u_mE[8], u_mF[8], u_mG[8], u_mH[8], u_re[4];
uniform vec2 u_reP[4];
const vec2 DIRS[8] = vec2[8](vec2(1.,0.), vec2(-1.,0.), vec2(0.,1.), vec2(0.,-1.), vec2(.7071,.7071), vec2(-.7071,.7071), vec2(.7071,-.7071), vec2(-.7071,-.7071));
const float HC[9] = float[9](0., 30., 60., 120., 180., 240., 275., 315., 360.);
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 toLin(vec3 c) { c = max(c, 0.0); return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
vec3 toSrgb(vec3 c) { c = max(c, 0.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
vec3 rgb2hsv(vec3 c) { vec4 K = vec4(0., -1./3., 2./3., -1.); vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g)); vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r)); float d = q.x - min(q.w, q.y); return vec3(abs(q.z + (q.w - q.y) / (6. * d + 1e-10)), d / (q.x + 1e-10), q.x); }
vec3 hsv2rgb(vec3 c) { vec3 p = abs(fract(c.xxx + vec3(1., 2./3., 1./3.)) * 6. - 3.); return c.z * mix(vec3(1.), clamp(p - 1., 0., 1.), c.y); }
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f); return mix(mix(hash(i), hash(i + vec2(1., 0.)), f.x), mix(hash(i + vec2(0., 1.)), hash(i + vec2(1., 1.)), f.x), f.y); }
vec3 blurLod(vec2 uv, float lod) {
  lod = min(lod, u_maxLod);
  vec2 t = exp2(lod) / u_srcSize * 0.5;
  return (textureLod(u_src, uv, lod).rgb * 2. + textureLod(u_src, uv + t, lod).rgb + textureLod(u_src, uv - t, lod).rgb + textureLod(u_src, uv + vec2(t.x, -t.y), lod).rgb + textureLod(u_src, uv + vec2(-t.x, t.y), lod).rgb) / 6.;
}
vec3 scurve(vec3 v, float g) { vec3 a = 0.5 * pow(2. * v, vec3(g)); vec3 b = 1. - 0.5 * pow(2. * (1. - v), vec3(g)); return mix(a, b, step(0.5, v)); }
void main() {
  vec2 o = (u_p2o * vec3(v_p, 1.)).xy;
  bool outside = o.x < 0. || o.x > 1. || o.y < 0. || o.y > 1.;
  vec3 c3 = u_o2t * vec3(o, 1.);
  vec3 q3 = u_geom * vec3(c3.xy, 1.);
  vec2 q = q3.xy / q3.z;
  float r2 = dot(q, q) * u_dist.w;
  vec2 qd = q * (1. + u_dist.x * r2 + u_dist.y * r2 * r2) / u_dist.z;
  vec2 uv = vec2(qd.x / u_aspect + 0.5, qd.y + 0.5);
  bool noimg = q3.z <= 0. || uv.x < 0. || uv.x > 1. || uv.y < 0. || uv.y > 1.;
  vec2 px = 1. / u_srcSize, dc = uv - 0.5, asp = vec2(u_aspect, 1.);
  vec3 c0 = vec3(texture(u_src, 0.5 + dc * (1. + u_ca.x)).r, texture(u_src, uv).g, texture(u_src, 0.5 + dc * (1. + u_ca.y)).b);
  float l0 = luma(c0);
  float depth = u_useDepth > 0.5 ? textureLod(u_depth, uv, 0.).r : 0.;

  // ---- local adjustments: each mask adds weighted deltas to the global parameters
  vec4 aE = vec4(0.), aF = vec4(0.), aG = vec4(0.), aH = vec4(0.); vec3 tintC = vec3(0.); float ov = 0.;
  for (int i = 0; i < 8; i++) {
    if (i >= u_mN) break;
    vec4 A = u_mA[i], B = u_mB[i], C = u_mC[i], D = u_mD[i];
    int t = int(A.x + 0.5); float m = 0.;
    if (t == 1) { vec2 d = (B.zw - B.xy) * asp; m = 1. - smoothstep(0., 1., dot((uv - B.xy) * asp, d) / max(dot(d, d), 1e-8)); }
    else if (t == 2) { vec2 pp = (uv - B.xy) * asp; float ca = cos(C.x), sa = sin(C.x); pp = vec2(ca * pp.x + sa * pp.y, -sa * pp.x + ca * pp.y); float fe = clamp(C.y, 0.002, 1.); m = 1. - smoothstep(1. - fe, 1., length(pp / max(B.zw, vec2(1e-5)))); }
    else if (t == 3) { int b = int(A.z + 0.5); m = b == 0 ? textureLod(u_brush0, uv, 0.).a : b == 1 ? textureLod(u_brush1, uv, 0.).a : b == 2 ? textureLod(u_brush2, uv, 0.).a : textureLod(u_brush3, uv, 0.).a; }
    if (A.y > 0.5) m = 1. - m;
    int rt = int(A.w + 0.5); float sm = max(C.w, 0.002);
    if (rt == 1) m *= 1. - smoothstep(D.a * 0.5, D.a, distance(c0, D.rgb));
    else if (rt == 2) m *= smoothstep(D.x - sm, D.x, l0) * (1. - smoothstep(D.y, D.y + sm, l0));
    else if (rt == 3) m *= smoothstep(D.x - sm, D.x, depth) * (1. - smoothstep(D.y, D.y + sm, depth));
    m *= C.z;
    aE += m * u_mE[i]; aF += m * u_mF[i]; aG += m * u_mG[i]; aH.xy += m * u_mH[i].xy;
    tintC += m * u_mH[i].w * (hsv2rgb(vec3(u_mH[i].z / 360., 1., 1.)) - 0.5);
    if (i == u_mSel) ov = m;
  }

  // ---- detail: noise reduction then capture sharpening, on source neighbourhoods
  vec3 c = c0;
  float shA = max(0., u_sharp.x * (1. + aH.x)) + max(0., aH.x) * 0.4, nrL = clamp(u_nr.x + aH.y, 0., 1.), nrC = u_nr.y;
  vec3 bT = blurLod(uv, u_lods.x), bC = blurLod(uv, u_lods.y), bW = blurLod(uv, u_lods.z);
  if (shA > 0. || nrL > 0. || nrC > 0.) {
    float rs = u_sharp.y, rn = 1. + 2.2 * nrL, sig = 0.015 + 0.11 * nrL * (1.3 - u_nr.z), wN = 1., gmax = 0.;
    vec3 sumS = vec3(0.), sumN = c0;
    for (int k = 0; k < 8; k++) {
      vec3 a = texture(u_src, uv + DIRS[k] * px * rs).rgb; sumS += a; gmax = max(gmax, abs(luma(a) - l0));
      vec3 b = texture(u_src, uv + DIRS[k] * px * rn).rgb; float dl = luma(b) - l0; float w = exp(-dl * dl / (2. * sig * sig)); sumN += b * w; wN += w;
    }
    if (nrL > 0.) c += vec3(luma(sumN / wN) - l0) * min(1., nrL * 1.6);
    if (nrC > 0.) { vec3 mc = textureLod(u_src, uv, min(u_maxLod, 1.5 + 2.5 * nrC * (0.5 + u_nr.w))).rgb; float ml = luma(mc); float we = exp(-(ml - l0) * (ml - l0) / 0.03); float lc = luma(c); c = lc + mix(c - lc, mc - ml, nrC * we); }
    float det = l0 - luma(sumS / 8.);
    det *= smoothstep(0., u_sharp.z, abs(det));
    c += vec3(det * shA * 2.2 * mix(1., smoothstep(0.02, 0.14, gmax), u_sharp.w));
  }
  // ---- presence (texture / clarity) from blurred copies
  float tex = u_tcd.x + aG.x, cla = u_tcd.y + aG.y, deh = u_tcd.z + aG.z;
  float midw = 1. - pow(abs(2. * l0 - 1.), 2.2);
  c += vec3((l0 - luma(bT)) * tex * 1.1 + (l0 - luma(bC)) * cla * 0.9 * midw);
  // ---- red eye
  for (int i = 0; i < 4; i++) {
    if (i >= u_reN) break;
    float d = length((uv - u_re[i].xy) * asp / max(u_re[i].zw * u_reP[i].x, vec2(1e-5)));
    float red = c.r - max(c.g, c.b);
    float w = smoothstep(0.04, 0.18, red) * (1. - smoothstep(0.7, 1., d));
    c = mix(c, vec3((c.g + c.b) * 0.5 * (1. - u_reP[i].y * 0.6)), w);
  }
  // ---- defringe: desaturate purple / green fringes near strong edges
  if (u_defrP.x > 0. || u_defrG.x > 0.) {
    vec3 hsv = rgb2hsv(clamp(c, 0., 1.)); float hue = hsv.x * 360.;
    float e = smoothstep(0.02, 0.16, max(abs(l0 - luma(bT)), abs(luma(bT) - luma(bC))));
    float wp = smoothstep(u_defrP.y - 12., u_defrP.y + 4., hue) * (1. - smoothstep(u_defrP.z - 4., u_defrP.z + 12., hue));
    float wg = smoothstep(u_defrG.y - 12., u_defrG.y + 4., hue) * (1. - smoothstep(u_defrG.z - 4., u_defrG.z + 12., hue));
    float w = clamp((wp * u_defrP.x + wg * u_defrG.x) * e * smoothstep(0.08, 0.3, hsv.y), 0., 1.);
    c = mix(c, vec3(luma(c)), w);
  }

  // ---- linear light: lens falloff, camera calibration, dehaze, white balance, exposure
  vec3 lin = toLin(c);
  float rv = dot(qd, qd) * u_dist.w;
  lin *= max(0., 1. + u_lvig.x * rv + u_lvig.y * rv * rv);
  lin = u_cal * lin;
  if (deh != 0.) {
    vec3 wl = toLin(bW); float dark = min(wl.r, min(wl.g, wl.b));
    vec3 air = mix(toLin(textureLod(u_src, vec2(0.5), u_maxLod).rgb), vec3(1.), 0.65);
    if (deh > 0.) { float tr = max(1. - deh * 0.85 * dark / max(luma(air), 0.2), 0.2); lin = (lin - air) / tr + air; }
    else lin = mix(lin, air, -deh * 0.6);
  }
  float T = u_wb.x + aF.z, Ti = u_wb.y + aF.w;
  vec3 wb = vec3(exp2(0.42 * T + 0.12 * Ti), exp2(-0.25 * Ti), exp2(-0.42 * T + 0.12 * Ti));
  lin *= wb / luma(wb);
  float ev = u_tone.x + aE.x;
  lin = max(lin, 0.) * exp2(ev);
  // ---- highlights / shadows with a locally-adapted mask
  float Lg = pow(clamp(mix(luma(lin), luma(toLin(bW)) * exp2(ev), 0.6), 0., 4.), 1. / 2.2);
  float hi = u_tone.z + aE.z, sh = u_tone.w + aE.w;
  lin *= exp2(sh * (1. - smoothstep(0., 0.55, Lg)) * 1.5 + hi * smoothstep(0.4, 1.05, Lg) * 0.85);
  vec3 v = toSrgb(lin);
  float wht = u_tone2.x + aF.x, blk = u_tone2.y + aF.y, lv = luma(v);
  v = mix(v, v / max(1. - wht * 0.3, 0.2), smoothstep(0.15, 0.85, lv));
  float bp = -blk * 0.15;
  v = mix((v - bp) / (1. - bp), v, smoothstep(0.1, 0.7, lv));
  v = clamp(v, 0., 1.);
  float con = u_tone.y + aE.y + u_prof.y;
  if (con != 0.) v = scurve(v, exp2(con * 0.8));
  // ---- tone curve
  float k0 = 255. / 256., k1 = 0.5 / 256.;
  v = vec3(texture(u_curve, vec2(v.r * k0 + k1, 0.5)).a, texture(u_curve, vec2(v.g * k0 + k1, 0.5)).a, texture(u_curve, vec2(v.b * k0 + k1, 0.5)).a);
  v = vec3(texture(u_curve, vec2(v.r * k0 + k1, 0.5)).r, texture(u_curve, vec2(v.g * k0 + k1, 0.5)).g, texture(u_curve, vec2(v.b * k0 + k1, 0.5)).b);
  // ---- colour: vibrance / saturation, HSL mixer, black & white, grading
  float l = luma(v), cs = max(v.r, max(v.g, v.b)) - min(v.r, min(v.g, v.b));
  float sat = max(0., 1. + u_color.y + aG.w + u_prof.x) * (1. + u_color.x * pow(1. - cs, 1.5) * (u_color.x > 0. ? 1.1 : 0.8));
  v = mix(vec3(l), v, sat) + tintC * 0.5;
  if (u_hslOn > 0.5 || u_bw > 0.5) {
    vec3 hsv = rgb2hsv(clamp(v, 0., 1.)); float hue = hsv.x * 360., dh = 0., ds = 0., dl = 0., db = 0.;
    for (int i = 0; i < 8; i++) {
      if (hue >= HC[i] && hue < HC[i + 1]) { float t = (hue - HC[i]) / (HC[i + 1] - HC[i]); int j = i == 7 ? 0 : i + 1;
        dh = mix(u_hslH[i], u_hslH[j], t); ds = mix(u_hslS[i], u_hslS[j], t); dl = mix(u_hslL[i], u_hslL[j], t); db = mix(u_bwMix[i], u_bwMix[j], t); }
    }
    float sw = smoothstep(0.02, 0.3, hsv.y);
    if (u_bw > 0.5) v = vec3(clamp(luma(v) * (1. + db * sw * 0.7), 0., 1.));
    else {
      hsv.x = fract(hsv.x + dh * 30. / 360.); hsv.y = clamp(hsv.y * (1. + ds), 0., 1.);
      v = hsv2rgb(hsv); v *= 1. + dl * sw * 0.6;
    }
  }
  l = luma(v);
  float piv = 0.5 - u_cgB.y * 0.3, bw = mix(0.12, 0.6, u_cgB.x);
  float wS = 1. - smoothstep(0., piv + bw * 0.5, l), wH = smoothstep(piv - bw * 0.5, 1., l), wM = clamp(1. - wS - wH, 0., 1.) + 0.25 * (1. - abs(2. * l - 1.));
  vec3 gS = hsv2rgb(vec3(u_cgS.x / 360., 1., 1.)), gM = hsv2rgb(vec3(u_cgM.x / 360., 1., 1.)), gH = hsv2rgb(vec3(u_cgH.x / 360., 1., 1.)), gG = hsv2rgb(vec3(u_cgG.x / 360., 1., 1.));
  v += (gS - luma(gS)) * u_cgS.y * wS * 0.4 + (gM - luma(gM)) * u_cgM.y * wM * 0.4 + (gH - luma(gH)) * u_cgH.y * wH * 0.4 + (gG - luma(gG)) * u_cgG.y * 0.4;
  v += u_cgS.z * wS * 0.25 + u_cgM.z * wM * 0.25 + u_cgH.z * wH * 0.25 + u_cgG.z * 0.25;
  v.g -= u_calShadow * 0.06 * (1. - smoothstep(0., 0.5, l));
  // ---- effects (in crop space): vignette and grain
  if (u_fx > 0.5) {
    vec2 vc = abs(o - 0.5) * 2.;
    float n = mix(10., 2., clamp(u_vig.z * 0.5 + 0.5, 0., 1.));
    float d = pow(pow(vc.x, n) + pow(vc.y, n), 1. / n);
    float e0 = u_vig.y * 1.25 * (1. - u_vig.w * 0.9), vg = smoothstep(e0, u_vig.y * 1.25 + u_vig.w * 0.7 + 0.001, d);
    if (u_vig.x < 0.) v *= mix(1. + u_vig.x * vg, 1., u_vigH * smoothstep(0.6, 1., luma(v)));
    else v = mix(v, vec3(1.), u_vig.x * vg);
    if (u_grain.x > 0.) {
      vec2 gp = o * u_outPx / (0.7 + u_grain.y * 3.5);
      float gn = mix(vnoise(gp), hash(floor(gp * 2.3)), u_grain.z * 0.7) - 0.5;
      v += gn * u_grain.x * 0.28 * (0.35 + 0.65 * (1. - abs(2. * luma(v) - 1.)));
    }
  }
  v = clamp(v, 0., 1.);
  // ---- soft proof, warnings, overlays
  if (u_proof > 0.5) { vec4 pl = texture(u_lut, v * (32. / 33.) + 0.5 / 33.); v = (u_gamut > 0.5 && pl.a > 0.5) ? vec3(1., 0.1, 0.1) : pl.rgb; }
  if (u_clip > 0.5) { if (max(v.r, max(v.g, v.b)) >= 0.998) v = vec3(1., 0., 0.); else if (max(v.r, max(v.g, v.b)) <= 0.006) v = vec3(0., 0.2, 1.); }
  if (u_ovOn > 0.5) v = mix(v, u_ovCol, ov * 0.55);
  o_col = outside ? u_bg : vec4(noimg ? u_edge : v, 1.);
}`;

/* ------------------------------------------------------------------ renderer */
const GLR = {
  gl: null, loc: {}, sources: new Map(), brushes: new Map(), luts: new Map(), depths: new Map(), curveKey: '', maxTex: 4096,
  init(canvas) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, preserveDrawingBuffer: true, premultipliedAlpha: false });
    if (!gl) throw new Error('This app needs WebGL 2, which this browser or graphics driver does not provide.');
    this.gl = gl; this.canvas = canvas;
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('Shader: ' + gl.getShaderInfoLog(s)); return s; };
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VERT)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FRAG)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Link: ' + gl.getProgramInfoLog(p));
    gl.useProgram(p); this.prog = p;
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const a = gl.getAttribLocation(p, 'a_pos'); gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const u = gl.getActiveUniform(p, i); this.loc[u.name.replace('[0]', '')] = gl.getUniformLocation(p, u.name); }
    ['u_src', 'u_curve', 'u_depth', 'u_brush0', 'u_brush1', 'u_brush2', 'u_brush3', 'u_lut'].forEach((nm, i) => gl.uniform1i(this.loc[nm], i));
    this.maxTex = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE), 16384);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    this.curveTex = this.tex2d(1); this.blank = this.tex2d(2);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
    this.lutBlank = gl.createTexture(); gl.activeTexture(gl.TEXTURE7); gl.bindTexture(gl.TEXTURE_3D, this.lutBlank);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA, 1, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); UI.toast('Graphics context was lost. Reload the window to continue editing.', 'error'); });
  },
  tex2d(unit, mip) {
    const gl = this.gl, t = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  },
  /* Source pixels for a photo (spot edits baked in by the server), as a mip-mapped texture. LRU-cached. */
  async source(p, size, spots) {
    const long = Math.max(p.w, p.h) || 1;
    size = Math.min(size || long, long, this.maxTex);
    if (size >= long) size = 0;
    const sp = spots && spots.length ? spots : null;
    const key = [p.id, p.path, p.orient, p.filesize, size, sp ? JSON.stringify(sp) : ''].join('|');
    let s = this.sources.get(key);
    if (s) { this.sources.delete(key); this.sources.set(key, s); return s.ready; }
    s = { key };
    s.ready = (async () => {
      let blob;
      if (sp) blob = await api('src_render', { id: p.id, size, spots: sp });
      else { const r = await fetch(`/img/src/${p.id}?size=${size}&v=${p.orient}_${p.filesize}`); if (!r.ok) throw new Error((await r.json()).error || 'Could not load ' + p.filename); blob = await r.blob(); }
      const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
      const gl = this.gl;
      s.tex = this.tex2d(0, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bmp);
      gl.generateMipmap(gl.TEXTURE_2D);
      Object.assign(s, { w: bmp.width, h: bmp.height, fullW: p.w || bmp.width, fullH: p.h || bmp.height, id: p.id, lens: (p.exif || {}).lens || '' });
      bmp.close();
      return s;
    })();
    this.sources.set(key, s);
    s.ready.catch(() => this.sources.delete(key));
    while (this.sources.size > 7) { const [k, old] = this.sources.entries().next().value; this.sources.delete(k); old.ready.then(o => this.gl.deleteTexture(o.tex)).catch(() => {}); }
    return s.ready;
  },
  /* Rasterise a brush mask's strokes. Coordinates are source-normalised; radius is a fraction of the long edge. */
  brushCanvas(mask, aspect) {
    let b = this.brushes.get(mask.id);
    const key = JSON.stringify(mask.strokes || []) + aspect.toFixed(4);
    if (b && b.key === key) return b;
    const W = aspect >= 1 ? 1024 : Math.round(1024 * aspect), H = aspect >= 1 ? Math.round(1024 / aspect) : 1024;
    if (!b) { b = { canvas: h('canvas'), tex: this.tex2d(3) }; this.brushes.set(mask.id, b); }
    b.canvas.width = W; b.canvas.height = H; b.key = key; b.dirty = true;
    const ctx = b.canvas.getContext('2d');
    for (const st of mask.strokes || []) GLR.stamp(ctx, st, st.pts, W, H);
    if (this.brushes.size > 24) { const [k, old] = this.brushes.entries().next().value; if (k !== mask.id) { this.brushes.delete(k); this.gl.deleteTexture(old.tex); } }
    return b;
  },
  stamp(ctx, st, pts, W, H, cont) {   // cont: pts[0] was already stamped (live painting, segment by segment)
    const r = Math.max(1, st.r * Math.max(W, H)), hard = 1 - clamp(st.feather ?? 0.5, 0, 0.99);
    ctx.globalCompositeOperation = st.erase ? 'destination-out' : 'source-over';
    const dab = (x, y) => { const g = ctx.createRadialGradient(x, y, 0, x, y, r); const a = (st.flow ?? 1) * 0.5; g.addColorStop(0, `rgba(255,255,255,${a})`); g.addColorStop(hard, `rgba(255,255,255,${a})`); g.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2); };
    let prev = null;
    for (const [nx, ny] of pts) {
      const x = nx * W, y = ny * H;
      if (!prev) { if (!cont) dab(x, y); }
      else { const d = Math.hypot(x - prev[0], y - prev[1]), n = Math.max(1, Math.ceil(d / (r * 0.25))); for (let i = 1; i <= n; i++) dab(prev[0] + (x - prev[0]) * i / n, prev[1] + (y - prev[1]) * i / n); }
      prev = [x, y];
    }
    ctx.globalCompositeOperation = 'source-over';
  },
  async lut(proof) {
    const key = [proof.profile, proof.intent, proof.paper ? 1 : 0].join('|');
    if (this.luts.has(key)) return this.luts.get(key);
    const buf = new Uint8Array(await (await fetch(`/img/lut?profile=${encodeURIComponent(proof.profile)}&intent=${proof.intent}&paper=${proof.paper ? 1 : 0}`)).arrayBuffer());
    const gl = this.gl, t = gl.createTexture();
    gl.activeTexture(gl.TEXTURE7); gl.bindTexture(gl.TEXTURE_3D, t);
    for (const pn of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_3D, pn, gl.LINEAR);
    for (const pn of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, pn, gl.CLAMP_TO_EDGE);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA, 33, 33, 33, 0, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    this.luts.set(key, t);
    return t;
  },
  async depth(id) {
    if (this.depths.has(id)) return this.depths.get(id);
    const bmp = await createImageBitmap(await (await fetch('/img/depth/' + id)).blob());
    const t = this.tex2d(2); this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, this.gl.RGBA, this.gl.UNSIGNED_BYTE, bmp);
    this.depths.set(id, t);
    if (this.depths.size > 6) { const [k, old] = this.depths.entries().next().value; this.depths.delete(k); this.gl.deleteTexture(old); }
    return t;
  },
  /* Async resources a settings object needs before it can be drawn. */
  async prepare(src, s, opts = {}) {
    const need = {};
    if ((s.masks || []).some(m => m.range && m.range.type === 'depth')) need.depth = await this.depth(src.id);
    if (opts.proof) need.lut = await this.lut(opts.proof);
    return need;
  },
  /* Draw. o: {w,h target px, x,y viewport origin, rect:{ox,oy,dw,dh}, region, flip, fx, sel, overlay, clip, proof, gamut, bg, edge, need} */
  draw(src, s, o = {}) {
    const gl = this.gl, L = this.loc, a = src.w / src.h;
    const U = (n, ...v) => { const l = L[n]; if (l == null) return; v.length === 1 ? gl.uniform1f(l, v[0]) : v.length === 2 ? gl.uniform2f(l, ...v) : v.length === 3 ? gl.uniform3f(l, ...v) : gl.uniform4f(l, ...v); };
    const UM = (n, m) => L[n] != null && gl.uniformMatrix3fv(L[n], false, M3.col(m));
    const vw = o.w, vh = o.h, rect = o.rect || { ox: 0, oy: 0, dw: vw, dh: vh };
    gl.viewport(o.x || 0, o.y || 0, vw, vh);
    s._lensHint = src.lens;
    UM('u_p2o', [vw / rect.dw, 0, -rect.ox / rect.dw, 0, vh / rect.dh, -rect.oy / rect.dh, 0, 0, 1]);
    UM('u_o2t', Geo.regionMat(o.region || Geo.region(s, a)));
    UM('u_geom', M3.inv(Geo.forward(s, a)));
    UM('u_cal', calibrationMatrix(s));
    const lens = Geo.lens(s), prof = PROFILES[s.profile] || {}, scale = src.w / src.fullW, long = Math.max(src.w, src.h);
    U('u_dist', ...Geo.dist(s, a)); U('u_aspect', a); U('u_srcSize', src.w, src.h); U('u_flip', o.flip ? 1 : 0);
    U('u_maxLod', Math.floor(Math.log2(long)));
    U('u_lods', Math.max(0, Math.log2(long * 0.004)), Math.max(0, Math.log2(long * 0.022)), Math.max(0, Math.log2(long * 0.09)));
    U('u_ca', s.caRemove ? s.caR : 0, s.caRemove ? s.caB : 0); U('u_lvig', lens.v1, lens.v2);
    U('u_wb', s.temp / 100, s.tint / 100); U('u_tone', s.exposure, s.contrast / 100, s.highlights / 100, s.shadows / 100);
    U('u_tone2', s.whites / 100, s.blacks / 100); U('u_tcd', s.texture / 100, s.clarity / 100, s.dehaze / 100);
    U('u_color', s.vibrance / 100, s.saturation / 100); U('u_prof', prof.sat || 0, prof.con || 0);
    const bw = s.treatment === 'bw' || prof.bw;
    U('u_bw', bw ? 1 : 0);
    U('u_hslOn', [...s.hsl.hue, ...s.hsl.sat, ...s.hsl.lum].some(Boolean) ? 1 : 0);
    gl.uniform1fv(L.u_hslH, s.hsl.hue.map(v => v / 100)); gl.uniform1fv(L.u_hslS, s.hsl.sat.map(v => v / 100));
    gl.uniform1fv(L.u_hslL, s.hsl.lum.map(v => v / 100)); gl.uniform1fv(L.u_bwMix, s.bwMix.map(v => v / 100));
    const cg = s.cg, z = k => [cg[k].h, cg[k].s / 100, cg[k].l / 100];
    U('u_cgS', ...z('shadows')); U('u_cgM', ...z('midtones')); U('u_cgH', ...z('highlights')); U('u_cgG', ...z('global')); U('u_cgB', cg.blending / 100, cg.balance / 100);
    U('u_sharp', s.sharpAmount / 100 * clamp(scale * 1.6, 0.4, 1), Math.max(0.6, s.sharpRadius * scale), (1 - s.sharpDetail / 100) * 0.035, s.sharpMasking / 100);
    U('u_nr', s.nrLum / 100, s.nrColor / 100, s.nrLumDetail / 100, s.nrColorSmooth / 100);
    U('u_defrP', s.defringePurple / 20, 220 + s.defringePurpleHue[0] * 1.3, 220 + s.defringePurpleHue[1] * 1.3, 0);
    U('u_defrG', s.defringeGreen / 20, 55 + s.defringeGreenHue[0] * 1.2, 55 + s.defringeGreenHue[1] * 1.2, 0);
    U('u_vig', s.vigAmount / 100, s.vigMid / 100, s.vigRound / 100, s.vigFeather / 100); U('u_vigH', s.vigHighlights / 100);
    U('u_grain', s.grain / 100, s.grainSize / 100, s.grainRough / 100);
    U('u_outPx', s.crop.w * src.fullW, s.crop.h * src.fullH); U('u_fx', o.fx === false ? 0 : 1); U('u_calShadow', s.calShadowTint / 100);
    U('u_bg', ...(o.bg || [0.102, 0.102, 0.106, 1])); U('u_edge', ...(o.edge || [0.2, 0.2, 0.21]));
    // tone curve LUT
    const ck = JSON.stringify([s.curve, s.pcHighlights, s.pcLights, s.pcDarks, s.pcShadows, s.pcSplit]);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.curveTex);
    if (ck !== this.curveKey) { this.curveKey = ck; gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, curveLUT(s)); }
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src.tex);
    // masks
    const A = [], B = [], C = [], D = [], E = [], F = [], G = [], Hh = [];
    let nb = 0, sel = -1, useDepth = 0;
    const masks = (s.masks || []).filter(m => !m.hidden).slice(0, 8);
    masks.forEach((m, i) => {
      const r = m.range || { type: 'none' }, ad = { ...MASK_ADJ, ...m.adj };
      let type = 0, bi = 0, geo = [0, 0, 0, 0], ang = 0, fe = 0;
      if (m.type === 'linear') { type = 1; geo = [m.x1, m.y1, m.x2, m.y2]; }
      else if (m.type === 'radial') { type = 2; geo = [m.cx, m.cy, m.rx, m.ry]; ang = (m.angle || 0) * Math.PI / 180; fe = (m.feather ?? 50) / 100; }
      else if (m.type === 'brush' && nb < 4) {
        type = 3; bi = nb++;
        const b = this.brushCanvas(m, a);
        gl.activeTexture(gl.TEXTURE3 + bi); gl.bindTexture(gl.TEXTURE_2D, b.tex);
        if (b.dirty) { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, b.canvas); b.dirty = false; }
      }
      const rt = { none: 0, color: 1, lum: 2, depth: 3 }[r.type] || 0;
      if (rt === 3) useDepth = 1;
      A.push(type, m.invert ? 1 : 0, bi, rt); B.push(...geo);
      C.push(ang, fe, (m.amount ?? 100) / 100, (r.smooth ?? 20) / 100);
      D.push(...(rt === 1 ? [...(r.color || [0.5, 0.5, 0.5]), 0.05 + (r.amount ?? 50) / 100 * 0.6] : [(r.min ?? 0) / 100, (r.max ?? 100) / 100, 0, 0]));
      E.push(ad.exposure, ad.contrast / 100, ad.highlights / 100, ad.shadows / 100); F.push(ad.whites / 100, ad.blacks / 100, ad.temp / 100, ad.tint / 100);
      G.push(ad.texture / 100, ad.clarity / 100, ad.dehaze / 100, ad.saturation / 100); Hh.push(ad.sharpness / 100, ad.noise / 100, ad.hue, ad.color / 100);
      if (o.sel && m.id === o.sel) sel = i;
    });
    for (let i = nb; i < 4; i++) { gl.activeTexture(gl.TEXTURE3 + i); gl.bindTexture(gl.TEXTURE_2D, this.blank); }
    gl.uniform1i(L.u_mN, masks.length); gl.uniform1i(L.u_mSel, sel);
    if (masks.length) for (const [n, arr] of [['u_mA', A], ['u_mB', B], ['u_mC', C], ['u_mD', D], ['u_mE', E], ['u_mF', F], ['u_mG', G], ['u_mH', Hh]]) gl.uniform4fv(L[n], new Float32Array(arr));
    U('u_ovOn', o.overlay && sel >= 0 ? 1 : 0); U('u_ovCol', ...(o.ovCol || [1, 0.15, 0.1]));
    const need = o.need || {};
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, useDepth && need.depth ? need.depth : this.blank);
    U('u_useDepth', useDepth && need.depth ? 1 : 0);
    // red eye
    const re = (s.redeyes || []).slice(0, 4);
    gl.uniform1i(L.u_reN, re.length);
    if (re.length) { gl.uniform4fv(L.u_re, new Float32Array(re.flatMap(e => [e.x, e.y, e.rx, e.ry]))); gl.uniform2fv(L.u_reP, new Float32Array(re.flatMap(e => [(e.pupil ?? 50) / 50, (e.darken ?? 50) / 100]))); }
    gl.activeTexture(gl.TEXTURE7); gl.bindTexture(gl.TEXTURE_3D, o.proof && need.lut ? need.lut : this.lutBlank);
    U('u_proof', o.proof && need.lut ? 1 : 0); U('u_gamut', o.proof && o.proof.gamut ? 1 : 0); U('u_clip', o.clip ? 1 : 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  },
  /* Render to an off-screen target and hand back a 2D canvas. */
  toCanvas(src, s, w, h_, o = {}) {
    const gl = this.gl;
    w = Math.min(w, this.maxTex); h_ = Math.min(h_, this.maxTex);
    const tex = this.tex2d(2); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h_, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    this.draw(src, s, { ...o, w, h: h_, x: 0, y: 0, flip: true });
    const px = new Uint8ClampedArray(w * h_ * 4);
    gl.readPixels(0, 0, w, h_, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.deleteFramebuffer(fb); gl.deleteTexture(tex);
    if (o.raw) return { data: px, w, h: h_ };
    const cv = h('canvas', { width: w, height: h_ });
    cv.getContext('2d').putImageData(new ImageData(px, w, h_), 0, 0);
    return cv;
  },
  histogram(src, s, o = {}) {
    const [ow, oh] = Geo.outSize(s, src.w, src.h), k = 256 / Math.max(ow, oh);
    const { data } = this.toCanvas(src, s, Math.max(8, Math.round(ow * k)), Math.max(8, Math.round(oh * k)), { ...o, raw: true });
    const H = { r: new Uint32Array(256), g: new Uint32Array(256), b: new Uint32Array(256), l: new Uint32Array(256), n: data.length / 4, mean: [0, 0, 0] };
    for (let i = 0; i < data.length; i += 4) {
      H.r[data[i]]++; H.g[data[i + 1]]++; H.b[data[i + 2]]++; H.l[Math.round(0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2])]++;
      H.mean[0] += data[i]; H.mean[1] += data[i + 1]; H.mean[2] += data[i + 2];
    }
    H.mean = H.mean.map(v => v / H.n / 255);
    return H;
  },
};

/* ------------------------------------------------------------------ high-level rendering used by every module */
const Render = {
  urls: new Map(), queue: Promise.resolve(), thumbJobs: new Set(),
  serial(fn) { const p = this.queue.then(fn, fn); this.queue = p.catch(() => {}); return p; },
  /* Canvas of a photo with its edits, long edge <= size. opts: {settings, proof, noFx} */
  canvas(p, size, opts = {}) {
    return this.serial(async () => {
      const s = devFull(opts.settings !== undefined ? opts.settings : p.develop);
      const [fw, fh] = Geo.outSize(s, p.w, p.h), k = Math.min(1, size / Math.max(fw, fh));
      const w = Math.max(1, Math.round(fw * k)), hh = Math.max(1, Math.round(fh * k));
      const need = Math.max(p.w, p.h) * k * 1.15;                 // source pixels needed for this output size
      const src = await GLR.source(p, need >= Math.max(p.w, p.h) * 0.9 ? 0 : Math.max(512, Math.ceil(need / 256) * 256), s.spots);
      const extra = await GLR.prepare(src, s, opts);
      return GLR.toCanvas(src, s, w, hh, { need: extra, proof: opts.proof, bg: [0, 0, 0, 1], edge: opts.edge || [1, 1, 1] });
    });
  },
  /* URL usable in <img>. Unedited photos are served straight from the engine; edited ones are rendered and cached. */
  async url(p, size) {
    if (!App.isEdited(p)) return `/img/src/${p.id}?size=${Math.min(size, Math.max(p.w, p.h))}&v=${p.orient}_${p.filesize}`;
    const key = [p.id, p.ver, size].join('|');
    if (this.urls.has(key)) return this.urls.get(key);
    const pr = this.canvas(p, size).then(cv => new Promise(res => cv.toBlob(b => res(URL.createObjectURL(b)), 'image/jpeg', 0.92)));
    this.urls.set(key, pr);
    if (this.urls.size > 160) { const [k, old] = this.urls.entries().next().value; this.urls.delete(k); Promise.resolve(old).then(u => URL.revokeObjectURL(u)).catch(() => {}); }
    return pr;
  },
  blob(cv, type = 'image/png', q) { return new Promise(res => cv.toBlob(res, type, q)); },
  /* Refresh the stored grid thumbnail so the Library shows the edit. */
  async thumb(p) {
    if (this.thumbJobs.has(p.id)) return;
    this.thumbJobs.add(p.id);
    try {
      if (!App.isEdited(p)) await api('thumb_clear', { ids: [p.id] });
      else { const cv = await this.canvas(p, 480); await upload('thumb_put', { id: p.id }, await this.blob(cv, 'image/jpeg', 0.85)); }
      p.ver++;
      App.emit('thumb', p.id);
    } catch (e) { console.warn('thumb', e); } finally { this.thumbJobs.delete(p.id); }
  },
  async thumbs(ids) { for (const id of ids) { const p = App.photo(id); if (p) await this.thumb(p); } },
};

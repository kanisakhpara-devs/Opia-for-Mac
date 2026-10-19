'use strict';
/* Core: DOM helpers, server API, app state, UI toolkit, command/menu system. */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const clone = o => (o == null ? o : JSON.parse(JSON.stringify(o)));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'data') Object.assign(el.dataset, v);
    else if (k in el && k !== 'list') el[k] = v;
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(kid));
  if (attrs && attrs.onclick && CLICKABLE.has(tag) && !attrs.role && attrs.tabindex == null && !(tag === 'a' && attrs.href) && !el.querySelector('button,a,input,select,textarea,[tabindex]')) keyable(el);
  return el;
}
/* Something clicked with the mouse can also be reached with Tab and pressed with Enter or Space. */
const CLICKABLE = new Set(['a', 'span', 'div', 'i', 'b', 'li', 'figure', 'img']);
function keyable(el, role = 'button') {
  el.tabIndex = 0; el.setAttribute('role', role);
  el.addEventListener('keydown', e => { if (e.target === el && (e.key === 'Enter' || e.key === ' ') && !e.ctrlKey && !e.altKey) { e.preventDefault(); e.stopPropagation(); el.click(); } });
  return el;
}
/* Let append / replaceChildren take nested arrays and skip null / false, the way h() does. */
for (const m of ['replaceChildren', 'append']) { const orig = Element.prototype[m]; Element.prototype[m] = function (...kids) { return orig.apply(this, kids.flat(Infinity).filter(k => k != null && k !== false)); }; }
const getPath = (o, p) => p.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
function setPath(o, p, v) { const ks = p.split('.'); const last = ks.pop(); let a = o; for (const k of ks) a = a[k] ??= {}; a[last] = v; }

const fmt = {
  bytes: n => (n > 1e9 ? (n / 1e9).toFixed(2) + ' GB' : n > 1e6 ? (n / 1e6).toFixed(1) + ' MB' : n > 1e3 ? (n / 1e3).toFixed(0) + ' KB' : n + ' B'),
  date: t => (t ? new Date(t * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : ''),
  datetime: t => (t ? new Date(t * 1000).toLocaleString() : ''),
  shutter: e => (!e ? '' : e >= 1 ? e + ' sec' : '1/' + Math.round(1 / e) + ' sec'),
  exif(p) { const e = p.exif || {}; return [e.exposure ? fmt.shutter(e.exposure) : '', e.aperture ? 'f/' + e.aperture : '', e.iso ? 'ISO ' + e.iso : '', e.focal ? Math.round(e.focal) + ' mm' : ''].filter(Boolean).join('   '); },
};

async function api(name, args) {
  const r = await fetch('/api/' + name, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(args || {}) });
  if (!(r.headers.get('Content-Type') || '').includes('json')) { if (!r.ok) throw new Error(name + ' failed'); return r.blob(); }
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j.result;
}
async function upload(name, query, body) {
  const r = await fetch('/api/upload/' + name + '?' + new URLSearchParams(query), { method: 'POST', body });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j.result;
}
/* Start a server job and follow it in the activity area; resolves with the job's result. */
async function runJob(start, title) {
  const { job } = await start;
  const bar = h('div', { class: 'bar' }, h('i'));
  const msg = h('span', {}, title || 'Working');
  const row = h('div', { class: 'job' }, msg, bar, h('b', { title: 'Cancel', onclick: () => api('job_cancel', { id: job }) }, '×'));
  $('#activity').append(row);
  try {
    for (;;) {
      await new Promise(r => setTimeout(r, 220));
      const s = await api('job_status', { id: job });
      msg.textContent = (title || s.title) + (s.message ? ' — ' + s.message : '');
      bar.firstChild.style.width = (s.total ? Math.min(100, 100 * s.progress / s.total) : 30) + '%';
      if (s.done) { if (s.error) throw new Error(s.error); return s.result; }
    }
  } finally { row.remove(); }
}

/* ------------------------------------------------------------------ UI toolkit */
const UI = {
  toast(text, kind) {
    const t = h('div', { class: 'toast ' + (kind || ''), role: kind === 'error' ? 'alert' : null }, text);
    $('#toasts').append(t);
    setTimeout(() => t.remove(), kind === 'error' ? 7000 : 3200);
  },
  error(e) { console.error(e); UI.toast(e.message || String(e), 'error'); },
  /* Modal dialog. buttons: [[label, value, 'primary'?]]. A button value that is a function may return false to stay open. */
  dialog({ title, body, buttons = [['Close', null]], width = 520, onClose }) {
    return new Promise(resolve => {
      const back = document.activeElement;
      const close = v => { ov.remove(); document.removeEventListener('keydown', key, true); if (back && back.isConnected && back.focus) back.focus(); onClose && onClose(v); resolve(v); };
      const key = e => {
        if (ov !== $('#overlays').lastChild) return;
        if (e.key === 'Escape') { e.stopPropagation(); close(null); }
        else if (e.key === 'Tab') {      // keep the keyboard inside the dialog
          const f = $$('button,input,select,textarea,a[href],[tabindex]:not([tabindex="-1"])', box).filter(x => !x.disabled && x.offsetParent); if (!f.length) return;
          const i = f.indexOf(document.activeElement); if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && (i === f.length - 1 || i < 0)) { e.preventDefault(); f[0].focus(); }
        }
      };
      const foot = h('div', { class: 'dlg-foot' }, buttons.map(([label, val, cls]) => h('button', {
        class: 'btn ' + (cls || ''), onclick: async () => {
          if (typeof val === 'function') { try { const r = await val(); if (r !== false) close(r === undefined ? true : r); } catch (e) { UI.error(e); } } else close(val);
        } }, label)));
      const tid = 'dlg' + Math.random().toString(36).slice(2, 8);
      const box = h('div', { class: 'dlg', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': tid, style: { width: width + 'px' } }, h('div', { class: 'dlg-title' }, h('span', { id: tid }, title), h('b', { onclick: () => close(null), title: 'Close', 'aria-label': 'Close' }, '×')), h('div', { class: 'dlg-body' }, body), foot);
      const ov = h('div', { class: 'overlay', onmousedown: e => { if (e.target === ov) close(null); } }, box);
      ov.close = close;
      $('#overlays').append(ov);
      document.addEventListener('keydown', key, true);
      const first = box.querySelector('input:not([type=checkbox]),textarea,select') || foot.querySelector('.btn.primary') || foot.querySelector('button');
      if (first) setTimeout(() => { if (!box.contains(document.activeElement)) { first.focus(); first.select && first.select(); } }, 30);
    });
  },
  confirm(title, text, ok = 'OK') { return UI.dialog({ title, body: h('p', { class: 'msg' }, text), buttons: [['Cancel', false], [ok, true, 'primary']], width: 420 }); },
  alert(title, text) { return UI.dialog({ title, body: h('p', { class: 'msg' }, text), width: 440 }); },
  prompt(title, label, value = '') {
    const inp = h('input', { type: 'text', value, onkeydown: e => { if (e.key === 'Enter') e.target.closest('.overlay').querySelector('.btn.primary').click(); } });
    return UI.dialog({ title, body: h('label', { class: 'frow' }, h('span', {}, label), inp), buttons: [['Cancel', null], ['OK', () => inp.value.trim() || false, 'primary']], width: 420 });
  },
  menu(x, y, items, opener) {
    $$('.menu').forEach(m => m.remove());
    const back = opener || document.activeElement;
    const m = h('div', { class: 'menu', role: 'menu' });
    for (const it of items) {
      if (!it) continue;
      if (it === '-') { m.append(h('hr')); continue; }
      m.append(h('div', { class: 'mi' + (it.disabled ? ' off' : ''), role: it.checked != null ? 'menuitemcheckbox' : 'menuitem', tabindex: -1, 'aria-checked': it.checked != null ? String(!!it.checked) : null, 'aria-disabled': it.disabled ? 'true' : null, 'aria-haspopup': it.sub ? 'menu' : null, onclick: e => {
        if (it.disabled) return;
        if (it.sub) { const r = e.currentTarget.getBoundingClientRect(); const s = UI.menu(r.right - 6, r.top, typeof it.sub === 'function' ? it.sub() : it.sub, back); s.parent = m; return; }
        m.remove(); if (back && back.isConnected && back.focus) back.focus(); it.run && it.run(e);
      } }, h('i', { 'aria-hidden': 'true' }, it.checked ? '✓' : ''), h('span', {}, it.label), it.sub ? h('kbd', { 'aria-hidden': 'true' }, '▸') : it.key ? h('kbd', {}, it.key) : null));
    }
    /* arrow keys move through the items, Enter picks one, Escape closes */
    m.addEventListener('keydown', e => {
      const its = $$('.mi', m).filter(x => !x.classList.contains('off')), i = its.indexOf(document.activeElement);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); its[(i + (e.key === 'ArrowDown' ? 1 : its.length - 1)) % its.length].focus(); }
      else if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); e.stopPropagation(); its[e.key === 'Home' ? 0 : its.length - 1].focus(); }
      else if (e.key === 'Enter' || e.key === ' ' || (e.key === 'ArrowRight' && document.activeElement.getAttribute('aria-haspopup'))) { e.preventDefault(); e.stopPropagation(); if (document.activeElement.closest('.menu') === m) document.activeElement.click(); }
      else if (e.key === 'Escape' || e.key === 'ArrowLeft' || e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); m.remove(); if (m.parent && m.parent.isConnected) $('.mi', m.parent).focus(); else if (back && back.isConnected && back.focus) back.focus(); }
    });
    document.body.append(m);
    setTimeout(() => { const f = $$('.mi', m).find(x => !x.classList.contains('off')); if (f && (m.parent || (back && back.matches && back.matches('.mb, button, [role=button]')) || document.activeElement === document.body)) f.focus({ preventScroll: true }); }, 0);
    const r = m.getBoundingClientRect();
    m.style.left = Math.max(0, Math.min(x, innerWidth - r.width - 4)) + 'px';
    m.style.top = Math.max(0, Math.min(y, innerHeight - r.height - 4)) + 'px';
    setTimeout(() => document.addEventListener('mousedown', function off(e) { if (!m.contains(e.target)) { m.remove(); document.removeEventListener('mousedown', off); } }), 0);
    return m;
  },
  /* Collapsible side panel; open state remembered per key. */
  panel(title, body, opts = {}) {
    const key = 'panel_' + (opts.key || title);
    let open = localStorage[key] ? localStorage[key] === '1' : !opts.closed;
    const tools = h('span', { class: 'ph-tools', role: 'none', onclick: e => e.stopPropagation() }, opts.tools || []);
    const head = h('div', { class: 'panel-h', onclick: () => { open = !open; localStorage[key] = open ? '1' : '0'; el.classList.toggle('closed', !open); } }, h('span', { class: 'tw' }), h('span', { class: 'pt', data: TIPS.panel[opts.key || title] ? { tip: TIPS.panel[opts.key || title] } : null }, title), tools);
    const el = h('div', { class: 'panel' + (open ? '' : ' closed') + (opts.cls ? ' ' + opts.cls : ''), data: { p: opts.key || title } }, head, h('div', { class: 'panel-b' }, body));
    el.body = el.lastChild;
    return el;
  },
  /* Labelled slider with numeric box. Double-click the label to reset. */
  slider({ label, min = -100, max = 100, step = 1, value = 0, def = 0, oninput, onchange, cls, tip }) {
    tip = tip || TIPS.label[label];
    const digits = step >= 1 ? 0 : Math.min(4, Math.ceil(-Math.log10(step) - 1e-9));
    const rng = h('input', { type: 'range', min, max, step, value, 'aria-label': label });
    const num = h('input', { type: 'text', class: 'num', value: (+value).toFixed(digits), 'aria-label': label + ' value' });
    const set = (v, fire) => { v = clamp(+v || 0, min, max); rng.value = v; num.value = (+v).toFixed(digits); if (fire === 'input') oninput && oninput(v); if (fire === 'change') { oninput && oninput(v); onchange && onchange(v); } };
    rng.oninput = () => set(rng.value, 'input');
    rng.onchange = () => onchange && onchange(+rng.value);
    num.onchange = () => set(num.value, 'change');
    num.onkeydown = e => { if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); set(+rng.value + (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1), 'change'); } e.stopPropagation(); };
    const el = h('div', { class: 'srow ' + (cls || '') }, h('label', { title: tip ? null : 'Double-click to reset', data: tip ? { tip, tipReset: 1 } : null, ondblclick: () => set(def, 'change') }, label), rng, num);
    el.set = v => set(v);
    el.get = () => +rng.value;
    return el;
  },
  /* Declarative form bound to an object.
     spec item: {k, label, t, opts, min, max, step, show(obj), ph}  t = text number range select check color textarea folder file note section button */
  form(spec, obj, onChange) {
    const root = h('div', { class: 'form' });
    const fire = (k, rebuild) => { onChange && onChange(k, obj); if (rebuild) render(); };
    function render() {
      root.replaceChildren();
      for (const f of spec) {
        if (f.show && !f.show(obj)) continue;
        if (f.t === 'section') { root.append(h('div', { class: 'fsec' }, f.label)); continue; }
        if (f.t === 'note') { root.append(h('div', { class: 'fnote' }, typeof f.label === 'function' ? f.label(obj) : f.label)); continue; }
        if (f.t === 'button') { root.append(h('div', { class: 'frow' }, h('span'), h('button', { class: 'btn', onclick: () => f.run(obj, render) }, f.label))); continue; }
        if (f.t === 'custom') { root.append(f.el(obj, render)); continue; }
        const val = getPath(obj, f.k) ?? f.def ?? (f.t === 'check' ? false : '');
        const set = (v, rebuild) => { setPath(obj, f.k, v); fire(f.k, rebuild); };
        let c;
        if (f.t === 'select') {
          const opts = typeof f.opts === 'function' ? f.opts(obj) : f.opts;
          c = h('select', { onchange: e => { const o = opts[e.target.selectedIndex]; set(Array.isArray(o) ? o[0] : o, true); } },
            opts.map(o => { const [v, l] = Array.isArray(o) ? o : [o, o]; return h('option', { selected: v === val }, l); }));
        } else if (f.t === 'check') {
          root.append(h('label', { class: 'fcheck' }, h('input', { type: 'checkbox', checked: !!val, onchange: e => set(e.target.checked, true) }), f.label));
          continue;
        } else if (f.t === 'range') {
          root.append(UI.slider({ label: f.label, min: f.min ?? 0, max: f.max ?? 100, step: f.step ?? 1, value: val === '' ? (f.def ?? 0) : val, def: f.def ?? 0, oninput: v => set(v) }));
          continue;
        } else if (f.t === 'textarea') c = h('textarea', { rows: f.rows || 3, value: val, placeholder: f.ph || '', oninput: e => set(e.target.value) });
        else if (f.t === 'color') c = h('input', { type: 'color', value: val || '#000000', oninput: e => set(e.target.value) });
        else if (f.t === 'folder' || f.t === 'file') {
          const inp = h('input', { type: 'text', value: val, placeholder: f.ph || '', onchange: e => set(e.target.value) });
          c = h('span', { class: 'fpick' }, inp, h('button', { class: 'btn', onclick: async () => {
            const p = f.t === 'folder' ? await UI.pickFolder(inp.value) : await UI.pickFile(inp.value, f.exts);
            if (p) { inp.value = p; set(p, true); }
          } }, '…'));
        } else c = h('input', { type: f.t === 'number' ? 'number' : f.t === 'password' ? 'password' : 'text', value: val, min: f.min, max: f.max, step: f.step, placeholder: f.ph || '',
          oninput: e => set(f.t === 'number' ? (e.target.value === '' ? '' : +e.target.value) : e.target.value) });
        root.append(h('label', { class: 'frow' }, h('span', {}, f.label), c));
      }
    }
    render();
    root.render = render;
    return root;
  },
  /* In-app folder / file browser over the local disk. */
  async browse({ title, start, files, exts }) {
    let cur = start || '', picked = null, settle, settled = false;
    const result = new Promise(res => { settle = v => { if (!settled) { settled = true; res(v); } }; });
    const ok = () => { const v = picked || (files ? null : cur); if (!v) return false; settle(v); return true; };
    const list = h('div', { class: 'fb-list' }), crumb = h('input', { type: 'text', class: 'fb-path', onkeydown: e => { if (e.key === 'Enter') { e.stopPropagation(); go(crumb.value); } } });
    async function go(p, quiet) {
      let d;
      try { d = await api('fs_list', { path: p || null, images: false }); } catch (e) {
        const up = p && p.replace(/[\\/]+$/, '').replace(/[\\/][^\\/]*$/, '');      // a folder that does not exist yet: start from the nearest one that does
        if (quiet !== false && p) return go(up && up !== p ? up : null, true);
        UI.error(e); return;
      }
      cur = d.path; crumb.value = cur; picked = null;
      list.replaceChildren();
      if (cur) list.append(h('div', { class: 'fb-i dir', ondblclick: () => go(d.parent) }, '↑  ..'));
      for (const pl of d.places || []) list.append(h('div', { class: 'fb-i dir', ondblclick: () => go(pl.path), onclick: e => mark(e, pl.path) }, '★  ' + pl.name));
      for (const dir of d.dirs) list.append(h('div', { class: 'fb-i dir', ondblclick: () => go(dir.path), onclick: e => mark(e, files ? null : dir.path) }, '📁  ' + dir.name));
      if (files) for (const f of d.files) { if (exts && !exts.some(x => f.name.toLowerCase().endsWith(x))) continue; list.append(h('div', { class: 'fb-i', onclick: e => mark(e, f.path), ondblclick: () => { picked = f.path; if (ok()) ov.close(true); } }, f.name)); }
    }
    function mark(e, p) { $$('.sel', list).forEach(x => x.classList.remove('sel')); e.currentTarget.classList.add('sel'); picked = p; }
    await go(cur);
    const dlg = UI.dialog({ title, width: 560, body: h('div', {}, crumb, list), buttons: [
      ['New Folder', async () => { const n = await UI.prompt('New Folder', 'Name'); if (n && cur) { await api('fs_mkdir', { path: cur.replace(/[\\/]$/, '') + '\\' + n }); go(cur); } return false; }],
      ['Cancel', null], [files ? 'Open' : 'Choose', ok, 'primary']] });
    const ov = $('#overlays').lastChild;
    dlg.then(() => settle(null));
    return result;
  },
  pickFolder(start) { return UI.browse({ title: 'Choose Folder', start: start || App.boot.pictures }); },
  pickFile(start, exts) { return UI.browse({ title: 'Choose File', start: start ? start.replace(/[\\/][^\\/]*$/, '') : App.boot.pictures, files: true, exts }); },
  /* A named-preset bar: dropdown + save/delete, storing an object map in app config under `key`. */
  presetBar(key, getCurrent, apply, builtin = {}) {
    const sel = h('select', { onchange: () => { const all = { ...builtin, ...App.conf(key, {}) }; if (all[sel.value]) apply(clone(all[sel.value]), sel.value); } });
    const fill = cur => { const all = { ...builtin, ...App.conf(key, {}) }; sel.replaceChildren(h('option', { value: '' }, 'Preset…'), ...Object.keys(all).map(n => h('option', { value: n, selected: n === cur }, n))); };
    fill();
    return h('div', { class: 'preset-bar' }, sel,
      h('button', { class: 'btn', title: 'Save current settings as a preset', onclick: async () => { const n = await UI.prompt('Save Preset', 'Preset name', sel.value); if (!n) return; App.setConf(key, { ...App.conf(key, {}), [n]: clone(getCurrent()) }); fill(n); UI.toast('Preset "' + n + '" saved'); } }, 'Save'),
      h('button', { class: 'btn', title: 'Delete the selected preset', onclick: () => { const all = { ...App.conf(key, {}) }; if (!all[sel.value]) return UI.toast(builtin[sel.value] ? 'Built-in presets cannot be deleted' : 'Choose a preset first'); delete all[sel.value]; App.setConf(key, all); fill(); } }, 'Delete'));
  },
  shell(id) {   // standard three-column module frame
    const left = h('div', { class: 'side left' }), right = h('div', { class: 'side right' }), center = h('div', { class: 'center' });
    const root = h('div', { class: 'module', id: 'mod-' + id }, left, center, right);
    $('#modules').append(root);
    return { root, left, center, right };
  },
  stars(n) { return '★'.repeat(n) + '·'.repeat(5 - n); },
};

/* ------------------------------------------------------------------ app state */
const LABELS = { red: '#d6453d', yellow: '#d9c12e', green: '#4aa655', blue: '#3f7fd9', purple: '#9b59c4' };
const App = {
  photos: new Map(), keywords: new Map(), collections: new Map(), colPhotos: new Map(), people: [], faces: [],
  cfg: {}, cat: {}, info: {}, boot: {}, lastBatch: 0,
  source: { type: 'all' }, list: [], selection: new Set(), active: null, anchor: null, module: null, modules: {},
  filter: { on: true, text: '', field: 'any', flags: new Set(), rating: 0, ratingOp: '>=', labels: new Set(), kind: new Set(), edited: null, meta: [] },
  sort: { key: 'capture_time', dir: 1 }, expanded: new Set(),
  _ev: {}, commands: {},
  on(ev, fn) { (this._ev[ev] ??= []).push(fn); },
  emit(ev, ...a) { for (const fn of this._ev[ev] || []) { try { fn(...a); } catch (e) { console.error(e); } } },

  conf(key, def) { return this.cfg[key] ?? def; },
  setConf(key, value) { this.cfg[key] = value; api('kv_set', { scope: 'app', key, value }).catch(UI.error); },
  pref(key, def) { return (this.cfg.prefs || {})[key] ?? def; },
  setPref(key, value) { this.setConf('prefs', { ...(this.cfg.prefs || {}), [key]: value }); this.emit('prefs', key); },
  cget(key, def) { return this.cat[key] ?? def; },
  cset(key, value) { this.cat[key] = value; api('kv_set', { scope: 'catalog', key, value }).catch(UI.error); },

  photo(id) { return this.photos.get(id); },
  cur() { return this.photos.get(this.active); },
  selected() { return this.list.filter(p => this.selection.has(p.id)); },
  selIds() { const s = this.selected().map(p => p.id); return s.length ? s : (this.active ? [this.active] : []); },
  thumb(p) { return `/img/thumb/${p.id}?v=${p.ver}_${p.orient}`; },
  isEdited(p) { return !!p.develop && Object.keys(p.develop).length > 0; },
  dims(p) { return [p.w, p.h]; },

  /* ---- keywords */
  kwPath(id) { const out = []; let k = this.keywords.get(id), n = 0; while (k && n++ < 20) { out.unshift(k.name); k = this.keywords.get(k.parent_id); } return out; },
  kwKids(id) { return [...this.keywords.values()].filter(k => (k.parent_id ?? null) === (id ?? null)).sort((a, b) => a.name.localeCompare(b.name)); },
  kwTree(id) { const out = [id]; for (const k of this.kwKids(id)) out.push(...this.kwTree(k.id)); return out; },
  kwNames(p, withParents) { const s = new Set(); for (const id of p.keywords) (withParents ? this.kwPath(id) : [this.keywords.get(id)?.name]).forEach(n => n && s.add(n)); return [...s]; },
  setKeywords(rows) { this.keywords = new Map(rows.map(k => [k.id, k])); this.emit('keywords'); },
  async assignKeywords(ids, keywords, remove) {
    if (!ids.length || !keywords.length) return;
    const r = await api('keywords_assign', { photo_ids: ids, keywords, remove: !!remove });
    this.keywords = new Map(r.keywords.map(k => [k.id, k]));
    for (const id of ids) { const p = this.photo(id); if (!p) continue; const s = new Set(p.keywords); r.ids.forEach(k => (remove ? s.delete(k) : s.add(k))); p.keywords = [...s]; }
    this.emit('keywords'); this.emit('meta', ids);
  },

  /* ---- photo edits */
  async setMeta(ids, fields, quiet) {
    if (!ids.length) return;
    for (const id of ids) { const p = this.photo(id); if (!p) continue; for (const [k, v] of Object.entries(fields)) { if (k === 'iptc') p.iptc = { ...p.iptc, ...v }; else p[k] = v; } if ('develop' in fields) p.ver++; }
    this.emit('meta', ids, fields);
    try { await api('photos_update', { ids, fields }); } catch (e) { UI.error(e); }
    if (!quiet && this.filter.on && ('rating' in fields || 'flag' in fields || 'label' in fields)) this.refreshList(true);
  },
  /* Rating / flag / label from keyboard or toolbar, with auto-advance. */
  rate(fields, toggle) {
    const ids = this.selIds();
    if (!ids.length) return;
    if (toggle) { const p = this.photo(ids[0]); const [k, v] = Object.entries(fields)[0]; if (p[k] === v) fields = { [k]: k === 'label' ? '' : 0 }; }
    const single = ids.length === 1, idx = this.list.findIndex(p => p.id === this.active);
    const next = single && this.pref('autoAdvance', false) ? this.list[idx + 1] : null;
    this.setMeta(ids, fields);
    const [k, v] = Object.entries(fields)[0];
    UI.toast(k === 'rating' ? (v ? 'Set rating to ' + v : 'Rating removed') : k === 'flag' ? ['Flagged as Rejected', 'Flag removed', 'Flagged as Pick'][v + 1] : v ? 'Label: ' + v : 'Label removed');
    if (next) this.select(next.id);
  },

  /* ---- source, filtering, sorting */
  sourceIds() {
    const s = this.source, all = [...this.photos.values()];
    switch (s.type) {
      case 'all': return all;
      case 'quick': return this.cget('quick', []).map(i => this.photo(i)).filter(Boolean);
      case 'prev': return all.filter(p => p.import_batch === this.lastBatch);
      case 'missing': return all.filter(p => p.missing);
      case 'folder': { const f = s.path.toLowerCase(); return all.filter(p => { const d = p.folder.toLowerCase(); return d === f || d.startsWith(f.replace(/[\\/]$/, '') + '\\'); }); }
      case 'collection': return this.collectionPhotos(s.id);
      case 'keyword': { const ks = new Set(this.kwTree(s.id)); return all.filter(p => p.keywords.some(k => ks.has(k))); }
      case 'person': { const ph = new Set(this.faces.filter(f => f.person_id === s.id).map(f => f.photo_id)); return all.filter(p => ph.has(p.master_id || p.id)); }
      case 'ids': return s.ids.map(i => this.photo(i)).filter(Boolean);
    }
    return all;
  },
  collectionPhotos(id, seen = new Set()) {
    const c = this.collections.get(id);
    if (!c || seen.has(id)) return [];
    seen.add(id);
    if (c.type === 'smart') return [...this.photos.values()].filter(p => this.matchRules(p, c.rules));
    if (c.type === 'set') { const s = new Set(); for (const k of this.collections.values()) if (k.parent_id === id) this.collectionPhotos(k.id, seen).forEach(p => s.add(p)); return [...s]; }
    return (this.colPhotos.get(id) || []).map(i => this.photo(i)).filter(Boolean);
  },
  sourceName() {
    const s = this.source;
    return { all: 'All Photographs', quick: 'Quick Collection', prev: 'Previous Import', missing: 'Missing Photographs', ids: s.name || 'Selection',
      folder: s.path && s.path.split(/[\\/]/).slice(-2).join(' › '), collection: this.collections.get(s.id)?.name, keyword: 'Keyword: ' + this.kwPath(s.id).join(' > '),
      person: 'Person: ' + (this.people.find(p => p.id === s.id)?.name || '') }[s.type] || '';
  },
  field(p, f) {
    const e = p.exif || {};
    switch (f) {
      case 'camera': return e.model || '';
      case 'lens': return e.lens || '';
      case 'iso': return e.iso || 0;
      case 'aperture': return e.aperture || 0;
      case 'focal': return e.focal || 0;
      case 'shutter': return e.exposure || 0;
      case 'date': return p.capture_time ? new Date(p.capture_time * 1000).toISOString().slice(0, 10) : '';
      case 'month': return p.capture_time ? new Date(p.capture_time * 1000).toISOString().slice(0, 7) : 'Unknown';
      case 'year': return p.capture_time ? String(new Date(p.capture_time * 1000).getFullYear()) : 'Unknown';
      case 'keywords': return this.kwNames(p, true).join(', ');
      case 'megapixels': return p.w * p.h / 1e6;
      case 'aspect': return p.w > p.h ? 'Landscape' : p.w < p.h ? 'Portrait' : 'Square';
      case 'edited': return this.isEdited(p);
      case 'virtual': return !!p.master_id;
      case 'gps': return !!p.gps;
      case 'smart': return !!p.smart;
      case 'creator': case 'copyright': case 'city': case 'state': case 'country': case 'headline': return p.iptc[f] || '';
      case 'people': { const m = p.master_id || p.id; return this.faces.filter(x => x.photo_id === m && x.person_id).map(x => this.people.find(q => q.id === x.person_id)?.name).filter(Boolean).join(', '); }
      case 'any': return [p.filename, p.title, p.caption, this.kwNames(p, true).join(' '), Object.values(p.iptc).join(' '), e.model, e.lens, p.folder, p.copy_name, p.label].join(' ');
      case 'flagname': return ['Rejected', 'Unflagged', 'Flagged'][p.flag + 1];
      case 'stars': return p.rating ? '★'.repeat(p.rating) : 'Unrated';
      case 'labelname': return p.label || 'No Label';
      default: return p[f];
    }
  },
  matchRule(p, r) {
    let v = this.field(p, r.field), t = r.value;
    switch (r.op) {
      case 'contains': return String(v).toLowerCase().includes(String(t).toLowerCase());
      case 'contains all': return String(t).toLowerCase().split(/\s+/).filter(Boolean).every(w => String(v).toLowerCase().includes(w));
      case 'not contains': return !String(v).toLowerCase().includes(String(t).toLowerCase());
      case 'starts': return String(v).toLowerCase().startsWith(String(t).toLowerCase());
      case 'ends': return String(v).toLowerCase().endsWith(String(t).toLowerCase());
      case 'is': return String(v).toLowerCase() === String(t).toLowerCase();
      case 'is not': return String(v).toLowerCase() !== String(t).toLowerCase();
      case 'empty': return !v || (Array.isArray(v) && !v.length);
      case 'not empty': return !!v && !(Array.isArray(v) && !v.length);
      case '=': return +v === +t;
      case '!=': return +v !== +t;
      case '>': return +v > +t;
      case '<': return +v < +t;
      case '>=': return +v >= +t;
      case '<=': return +v <= +t;
      case 'true': return !!v;
      case 'false': return !v;
      case 'after': return (r.field === 'import_time' ? p.import_time : p.capture_time) * 1000 > Date.parse(t);
      case 'before': return (r.field === 'import_time' ? p.import_time : p.capture_time) * 1000 < Date.parse(t);
      case 'last days': return p[r.field === 'import_time' ? 'import_time' : 'capture_time'] * 1000 > Date.now() - t * 864e5;
    }
    return true;
  },
  matchRules(p, rules) {
    if (!rules || !rules.rules || !rules.rules.length) return false;
    return rules.match === 'any' ? rules.rules.some(r => this.matchRule(p, r)) : rules.rules.every(r => this.matchRule(p, r));
  },
  passes(p, skipMetaFrom = 99) {
    const f = this.filter;
    if (!f.on) return true;
    if (f.text) {
      const hay = String(this.field(p, f.field)).toLowerCase();
      for (const w of f.text.toLowerCase().split(/\s+/).filter(Boolean)) { if (w[0] === '!' ? (w.length > 1 && hay.includes(w.slice(1))) : !hay.includes(w)) return false; }
    }
    if (f.flags.size && !f.flags.has(p.flag)) return false;
    if (f.rating || f.ratingOp === '=') { const r = p.rating; if (f.ratingOp === '>=' ? r < f.rating : f.ratingOp === '<=' ? r > f.rating : r !== f.rating) return false; }
    if (f.labels.size && !f.labels.has(p.label || 'none')) return false;
    if (f.kind.size && !f.kind.has(p.master_id ? 'virtual' : 'master')) return false;
    if (f.edited != null && this.isEdited(p) !== f.edited) return false;
    for (let i = 0; i < f.meta.length && i < skipMetaFrom; i++) { const m = f.meta[i]; if (m.values.size && !m.values.has(String(this.field(p, m.field)))) return false; }
    return true;
  },
  filterActive() { const f = this.filter; return f.on && !!(f.text || f.flags.size || f.rating || f.ratingOp === '=' || f.labels.size || f.kind.size || f.edited != null || f.meta.some(m => m.values.size)); },
  refreshList(keep) {
    let rows = this.sourceIds().filter(p => this.passes(p));
    const { key, dir } = this.sort;
    const val = p => (key === 'filename' ? p.filename.toLowerCase() : key === 'pixels' ? p.w * p.h : key === 'label' ? (p.label || 'zz') : p[key] ?? 0);
    if (key === 'custom' && this.source.type === 'collection') { const order = this.colPhotos.get(this.source.id) || []; const pos = new Map(order.map((id, i) => [id, i])); rows.sort((a, b) => (pos.get(a.id) ?? 1e9) - (pos.get(b.id) ?? 1e9)); }
    else rows.sort((a, b) => { const x = val(a), y = val(b); return (x < y ? -1 : x > y ? 1 : a.id - b.id) * dir; });
    // stacks: members follow their top; collapsed stacks show only the top
    const stacks = new Map();
    for (const p of rows) if (p.stack_id) (stacks.get(p.stack_id) || stacks.set(p.stack_id, []).get(p.stack_id)).push(p);
    const out = [], done = new Set();
    for (const p of rows) {
      if (!p.stack_id) { out.push(p); continue; }
      if (done.has(p.stack_id)) continue;
      done.add(p.stack_id);
      const members = stacks.get(p.stack_id).sort((a, b) => a.stack_pos - b.stack_pos);
      members.forEach((m, i) => { m._stackN = members.length; m._stackI = i; });
      if (members.length < 2) { out.push(members[0]); continue; }
      out.push(...(this.expanded.has(p.stack_id) ? members : [members[0]]));
    }
    for (const p of out) if (!p.stack_id) { p._stackN = 0; p._stackI = 0; }
    this.list = out;
    const ids = new Set(out.map(p => p.id));
    for (const id of [...this.selection]) if (!ids.has(id)) this.selection.delete(id);
    if (!ids.has(this.active)) { this.active = keep && this.selection.size ? [...this.selection][0] : (out[0]?.id ?? null); if (this.active && !this.selection.size) this.selection.add(this.active); }
    this.emit('list');
    this.emit('selection');
  },
  setSource(src) { this.source = src; this.selection.clear(); this.active = null; this.refreshList(); this.emit('source'); },
  select(id, e) {
    const idx = this.list.findIndex(p => p.id === id);
    if (idx < 0) return;
    if (e && e.shiftKey && this.anchor != null) {
      const a = this.list.findIndex(p => p.id === this.anchor);
      if (!(e.ctrlKey || e.metaKey)) this.selection.clear();
      for (let i = Math.min(a, idx); i <= Math.max(a, idx); i++) this.selection.add(this.list[i].id);
    } else if (e && (e.ctrlKey || e.metaKey)) {
      if (this.selection.has(id) && this.selection.size > 1) { this.selection.delete(id); if (this.active === id) id = [...this.selection][0]; } else this.selection.add(id);
      this.anchor = id;
    } else if (e && e.keepMulti && this.selection.has(id)) { this.anchor = id; }
    else { this.selection.clear(); this.selection.add(id); this.anchor = id; }
    this.active = id;
    this.emit('selection');
  },
  step(d, e) {
    if (!this.list.length) return;
    const i = clamp(this.list.findIndex(p => p.id === this.active) + d, 0, this.list.length - 1);
    this.select(this.list[i].id, e && e.shiftKey ? { shiftKey: true } : null);
  },
  selectAll() { this.selection = new Set(this.list.map(p => p.id)); if (!this.active && this.list[0]) this.active = this.list[0].id; this.emit('selection'); },
  selectNone() { this.selection = new Set(this.active ? [this.active] : []); this.emit('selection'); },

  /* ---- catalog data */
  addPhotos(rows) { for (const p of rows) this.photos.set(p.id, p); },
  async loadCatalog() {
    const d = await api('catalog_load');
    this.info = d.info; this.cat = d.settings; this.lastBatch = d.last_batch;
    this.photos = new Map(d.photos.map(p => [p.id, p]));
    this.keywords = new Map(d.keywords.map(k => [k.id, k]));
    this.collections = new Map(d.collections.map(c => [c.id, c]));
    this.colPhotos = new Map(Object.entries(d.collection_photos).map(([k, v]) => [+k, v]));
    this.people = d.people; this.faces = d.faces;
    this.source = { type: 'all' }; this.selection.clear(); this.active = null; this.expanded.clear();
    document.title = this.info.name + ' — Opia';
    this.emit('catalog');
    this.refreshList();
  },
  async reloadPhotos(ids) { const rows = await api('photos_get', { ids }); this.addPhotos(rows); this.emit('meta', ids); },
  quickToggle(ids) {
    const target = this.cget('target', null);
    if (target && this.collections.get(target)) return this.collectionToggle(target, ids);
    const q = new Set(this.cget('quick', []));
    const add = !ids.every(i => q.has(i));
    ids.forEach(i => (add ? q.add(i) : q.delete(i)));
    this.cset('quick', [...q]);
    UI.toast((add ? 'Added to' : 'Removed from') + ' Quick Collection');
    this.emit('collections'); this.emit('meta', ids);
    if (this.source.type === 'quick') this.refreshList(true);
  },
  async collectionToggle(cid, ids, forceAdd) {
    const cur = new Set(this.colPhotos.get(cid) || []);
    const add = forceAdd || !ids.every(i => cur.has(i));
    await api(add ? 'collection_add' : 'collection_remove', { id: cid, photo_ids: ids });
    ids.forEach(i => (add ? cur.add(i) : cur.delete(i)));
    this.colPhotos.set(cid, [...cur]);
    UI.toast((add ? 'Added to ' : 'Removed from ') + this.collections.get(cid).name);
    this.emit('collections'); this.emit('meta', ids);
    if (this.source.type === 'collection') this.refreshList(true);
  },
  inTarget(p) { const t = this.cget('target', null); return t && this.collections.get(t) ? (this.colPhotos.get(t) || []).includes(p.id) : this.cget('quick', []).includes(p.id); },

  /* ---- modules, commands, keys */
  addModule(m) { this.modules[m.id] = m; },
  show(id) {
    if (this.module === id) return;
    const prev = this.modules[this.module];
    if (prev) { prev.hide && prev.hide(); prev.el.root.classList.remove('on'); }
    this.module = id;
    const m = this.modules[id];
    if (!m.el) { m.el = UI.shell(id); m.init(m.el); }
    m.el.root.classList.add('on');
    $$('#modpick a').forEach(a => a.classList.toggle('on', a.dataset.m === id));
    document.body.dataset.module = id;
    m.show && m.show();
    this.emit('module', id);
  },
  cmd(id, label, key, run, opts) { this.commands[id] = { id, label, key, run, ...(opts || {}) }; },
  run(id, ...a) { const c = this.commands[id]; if (c) { try { const r = c.run(...a); if (r && r.catch) r.catch(UI.error); } catch (e) { UI.error(e); } } },
  keyName(e) {
    let k = e.key.length === 1 ? e.key.toUpperCase() : e.key;
    if (k === ' ') k = 'Space';
    return (e.ctrlKey || e.metaKey ? 'Ctrl+' : '') + (e.altKey ? 'Alt+' : '') + (e.shiftKey && (k.length > 1 || /[A-Z0-9]/.test(k)) ? 'Shift+' : '') + k;
  },
  onKey(e) {
    const t = e.target;
    if (t.matches && t.matches('input:not([type=range]):not([type=checkbox]),textarea,select,[contenteditable]')) { if (e.key === 'Escape') t.blur(); return; }
    if ($('#overlays').children.length) return;
    if (t.matches && t.matches('input[type=range]') && /^(Arrow|Home$|End$|Page)/.test(e.key) && !e.ctrlKey) return;     // a focused slider moves with the arrow keys
    if (t.matches && t.matches('button, [role=button], [role=menuitem], a[href], input[type=checkbox]') && (e.key === 'Enter' || e.key === ' ') && !e.ctrlKey && !e.altKey) return;   // and a focused button presses
    if (e.key === 'F10' && !e.ctrlKey && !e.altKey) { e.preventDefault(); const mb = $('#menubar .mb'); if (mb) mb.focus(); return; }   // F10 reaches the menus
    const name = this.keyName(e), m = this.modules[this.module];
    if (m && m.keys && m.keys[name]) { e.preventDefault(); const k = m.keys[name]; typeof k === 'string' ? this.run(k) : k(e); return; }
    if (m && m.exclusive && !/^(F11|Ctrl\+[,/]|Ctrl\+Alt\+.+)$/.test(name)) return;   // a workspace of its own: the photo shortcuts stay out of it
    for (const c of Object.values(this.commands)) {
      if (c.key === name && (!c.modules || c.modules.includes(this.module))) { e.preventDefault(); this.run(c.id); return; }
    }
  },
  buildMenus(def) {
    const bar = $('#menubar');
    bar.replaceChildren();
    for (const [title, items] of def) {
      const open = e => {
        e.preventDefault();
        const r = el.getBoundingClientRect();
        const list = (typeof items === 'function' ? items() : items).map(it => {
          if (it === '-' || typeof it === 'object') return it;
          const c = this.commands[it];
          return c ? { label: c.label, key: c.key, checked: c.checked && c.checked(), run: () => this.run(it) } : null;
        });
        UI.menu(r.left, r.bottom, list, el);
      };
      const el = h('span', { class: 'mb', tabindex: 0, role: 'button', 'aria-haspopup': 'menu', onmousedown: open, onkeydown: e => {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') open(e);
        else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); const all = $$('.mb', bar), i = all.indexOf(el); all[(i + (e.key === 'ArrowRight' ? 1 : all.length - 1)) % all.length].focus(); }
      } }, title);
      bar.append(el);
    }
  },
};
addEventListener('keydown', e => App.onKey(e));
addEventListener('unhandledrejection', e => UI.error(e.reason || new Error('Unexpected error')));
addEventListener('contextmenu', e => { if (!e.target.closest('input,textarea')) e.preventDefault(); });

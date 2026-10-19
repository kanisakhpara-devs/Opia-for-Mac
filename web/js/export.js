'use strict';
/* Export (presets, naming templates, watermarks, FTP, disc), batch rename, external editors, DNG, Photo Merge, lens & camera profiles. */

const NAME_TEMPLATES = { Filename: '{name}', 'Custom Name - Sequence': '{custom}-{seq:000}', 'Date - Filename': '{date:%Y%m%d}-{name}', 'Filename - Sequence': '{name}-{seq:00}',
  'Custom Name (x of y)': '{custom} ({seq} of {total})', 'Date - Custom - Sequence': '{date:%Y-%m-%d}_{custom}_{seq:0000}', 'Camera - Date - Sequence': '{camera}_{date:%Y%m%d}_{seq:000}' };
const NAME_TOKENS = [['{name}', 'Filename'], ['{custom}', 'Custom Text'], ['{seq:000}', 'Sequence 001'], ['{seq}', 'Sequence 1'], ['{total}', 'Total'], ['{date:%Y%m%d}', 'Date YYYYMMDD'], ['{date:%Y-%m-%d}', 'Date YYYY-MM-DD'], ['{year}', 'Year'], ['{month}', 'Month'],
  ['{day}', 'Day'], ['{time}', 'Time HHMMSS'], ['{camera}', 'Camera'], ['{lens}', 'Lens'], ['{iso}', 'ISO'], ['{focal}', 'Focal Length'], ['{rating}', 'Rating'], ['{label}', 'Label'], ['{title}', 'Title'], ['{folder}', 'Folder'], ['{copy}', 'Copy Name'], ['{width}', 'Width'], ['{height}', 'Height']];
const WM_DEFAULT = { type: 'text', text: '\u00a9 {creator}', font: 'Segoe UI', bold: false, italic: false, color: '#ffffff', opacity: 70, size: 4, anchor: 'br', insetH: 3, insetV: 3, rotate: 0, shadow: true, image: '' };
const ANCHORS = [['tl', 'Top Left'], ['tc', 'Top Centre'], ['tr', 'Top Right'], ['ml', 'Middle Left'], ['mc', 'Centre'], ['mr', 'Middle Right'], ['bl', 'Bottom Left'], ['bc', 'Bottom Centre'], ['br', 'Bottom Right']];

const Naming = {
  all() { return { ...NAME_TEMPLATES, ...App.conf('rename_templates', {}) }; },
  select(obj, key, onchange) {
    const sel = h('select', { onchange: async () => { if (sel.value === '__edit') { await Naming.edit(); const n = Naming.pick(obj[key]); fill(n); } else obj[key] = Naming.all()[sel.value]; onchange && onchange(); } });
    const fill = () => sel.replaceChildren(...Object.entries(Naming.all()).map(([n, t]) => h('option', { value: n, selected: t === obj[key] }, n)), h('option', { value: '__edit' }, 'Edit Templates\u2026'));
    fill();
    return sel;
  },
  pick(tpl) { return Object.entries(this.all()).find(([, t]) => t === tpl)?.[0]; },
  /* Filename template editor: tokens + free text, saved as named presets. */
  edit() {
    const st = { tpl: '{custom}-{seq:000}', custom: 'Trip', start: 1 }, out = h('div', { class: 'fnote mono' });
    const inp = h('input', { type: 'text', class: 'mono', value: st.tpl, oninput: () => { st.tpl = inp.value; prev(); } });
    const prev = debounce(async () => { const ids = App.selIds().slice(0, 3); if (!ids.length) { out.textContent = 'Select photos to see an example.'; return; } try { const r = await api('rename_preview', { ids, template: st.tpl, custom: st.custom, start: st.start }); out.textContent = 'Example: ' + r.map(x => x.to).join('    '); } catch (e) { out.textContent = e.message; } }, 200);
    const ins = t => { const a = inp.selectionStart ?? inp.value.length; inp.value = inp.value.slice(0, a) + t + inp.value.slice(inp.selectionEnd ?? a); st.tpl = inp.value; inp.focus(); prev(); };
    prev();
    return UI.dialog({ title: 'Filename Template Editor', width: 620, body: h('div', {}, UI.presetBar('rename_templates', () => st.tpl, t => { st.tpl = t; inp.value = t; prev(); }, NAME_TEMPLATES),
      h('label', { class: 'frow' }, h('span', {}, 'Template'), inp), out, h('div', { class: 'sub' }, 'Insert token'), h('div', { class: 'tokens' }, NAME_TOKENS.map(([t, l]) => h('button', { class: 'btn', title: t, onclick: () => ins(t) }, l))),
      h('div', { class: 'fnote' }, 'Tokens in braces are replaced per photo; anything else is kept as typed. {seq:000} pads the number; {date:%Y-%m-%d} takes any strftime pattern. The extension is added automatically.')), buttons: [['Done', null, 'primary']] });
  },
  /* Batch rename on disk */
  async rename() {
    const ids = App.selIds(); if (!ids.length) return;
    const st = { template: '{custom}-{seq:000}', custom: '', start: 1 }, out = h('div', { class: 'scroll small mono' });
    const prev = debounce(async () => { try { const r = await api('rename_preview', { ids, ...st }); out.replaceChildren(...r.slice(0, 40).map(x => h('div', {}, x.from + '  \u2192  ' + x.to)), r.length > 40 ? h('div', { class: 'dim' }, '\u2026') : null); } catch (e) { out.textContent = e.message; } }, 200);
    const form = UI.form([{ t: 'custom', el: () => h('label', { class: 'frow' }, h('span', {}, 'File Naming'), Naming.select(st, 'template', prev)) }, { k: 'custom', label: 'Custom Text' }, { k: 'start', label: 'Start Number', t: 'number', min: 0 }], st, prev);
    prev();
    const ok = await UI.dialog({ title: `Rename ${ids.length} Photo${ids.length > 1 ? 's' : ''}`, width: 560, body: h('div', {}, form, h('div', { class: 'sub' }, 'Preview'), out, h('div', { class: 'fnote' }, 'Files are renamed on disk; XMP sidecars follow. Virtual copies share their master\u2019s file name.')), buttons: [['Cancel', null], ['Rename', true, 'primary']] });
    if (!ok) return;
    const r = await api('photos_rename', { ids, ...st });
    App.addPhotos(r.photos); App.emit('meta', ids); App.refreshList(true);
    UI.toast(`${r.renamed} file(s) renamed` + (r.errors.length ? `, ${r.errors.length} failed: ${r.errors[0]}` : ''), r.errors.length ? 'error' : '');
  },
};

const Watermark = {
  all() { return { 'Simple Copyright': clone(WM_DEFAULT), ...App.conf('watermarks', {}) }; },
  cache: new Map(),
  async image(path) { if (!this.cache.has(path)) { const im = new Image(); im.src = '/img/file?path=' + encodeURIComponent(path); await im.decode(); this.cache.set(path, im); } return this.cache.get(path); },
  expand(text, p) { const i = (p && p.iptc) || {}; return String(text || '').replace(/\{(\w+)\}/g, (_, k) => ({ creator: i.creator || '', copyright: i.copyright || '', title: p?.title || '', filename: p?.filename || '', year: p && p.capture_time ? new Date(p.capture_time * 1000).getFullYear() : new Date().getFullYear(), date: p ? fmt.date(p.capture_time) : '' }[k] ?? '')).replace(/\s+$/, '').replace(/^\u00a9\s*$/, '\u00a9'); },
  /* Draw onto a 2D canvas of the final output size. */
  async draw(cv, wm, p) {
    if (!wm) return;
    const ctx = cv.getContext('2d'), W = cv.width, H = cv.height, ix = wm.insetH / 100 * W, iy = wm.insetV / 100 * H;
    let w, hgt, paint;
    if (wm.type === 'image' && wm.image) {
      let im; try { im = await this.image(wm.image); } catch (e) { return; }
      w = W * wm.size * 3 / 100; hgt = w * im.naturalHeight / im.naturalWidth; paint = () => ctx.drawImage(im, -w / 2, -hgt / 2, w, hgt);
    } else {
      const text = this.expand(wm.text, p); if (!text) return;
      const px = Math.max(8, Math.max(W, H) * wm.size / 100);
      ctx.font = `${wm.italic ? 'italic ' : ''}${wm.bold ? 'bold ' : ''}${px}px "${wm.font}", sans-serif`;
      w = ctx.measureText(text).width; hgt = px * 1.15;
      paint = () => { ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; if (wm.shadow) { ctx.shadowColor = 'rgba(0,0,0,.65)'; ctx.shadowBlur = px * 0.18; ctx.shadowOffsetX = ctx.shadowOffsetY = px * 0.05; } ctx.fillStyle = wm.color; ctx.fillText(text, 0, 0); };
    }
    const rot = (wm.rotate || 0) * Math.PI / 180, bw = Math.abs(w * Math.cos(rot)) + Math.abs(hgt * Math.sin(rot)), bh = Math.abs(w * Math.sin(rot)) + Math.abs(hgt * Math.cos(rot));
    const ax = wm.anchor[1], ay = wm.anchor[0];
    const x = ax === 'l' ? ix + bw / 2 : ax === 'r' ? W - ix - bw / 2 : W / 2, y = ay === 't' ? iy + bh / 2 : ay === 'b' ? H - iy - bh / 2 : H / 2;
    ctx.save(); ctx.globalAlpha = wm.opacity / 100; ctx.translate(x, y); ctx.rotate(rot); paint(); ctx.restore();
  },
  /* Watermark editor with live preview on the active photo. */
  async edit() {
    let wm = clone(WM_DEFAULT); const p = App.cur();
    const pv = h('canvas', { class: 'wm-prev' }), host = h('div');
    let base = null;
    const paint = debounce(async () => { if (!base && p) base = await Render.canvas(p, 720); const W = base ? base.width : 720, H = base ? base.height : 480; pv.width = W; pv.height = H; const x = pv.getContext('2d'); if (base) x.drawImage(base, 0, 0); else { x.fillStyle = '#555'; x.fillRect(0, 0, W, H); } await this.draw(pv, wm, p); }, 60);
    const spec = [{ k: 'type', label: 'Watermark Style', t: 'select', opts: [['text', 'Text'], ['image', 'Graphic (PNG / JPG)']] },
      { k: 'text', label: 'Text', show: o => o.type === 'text', ph: '\u00a9 {creator}   tokens: {creator} {copyright} {title} {filename} {year}' },
      { k: 'font', label: 'Font', t: 'select', opts: ['Segoe UI', 'Arial', 'Georgia', 'Times New Roman', 'Verdana', 'Trebuchet MS', 'Courier New', 'Impact', 'Segoe Script', 'Palatino Linotype'], show: o => o.type === 'text' },
      { k: 'bold', label: 'Bold', t: 'check', show: o => o.type === 'text' }, { k: 'italic', label: 'Italic', t: 'check', show: o => o.type === 'text' }, { k: 'color', label: 'Colour', t: 'color', show: o => o.type === 'text' }, { k: 'shadow', label: 'Shadow', t: 'check', show: o => o.type === 'text' },
      { k: 'image', label: 'Graphic file', t: 'file', exts: ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'], show: o => o.type === 'image' },
      { t: 'section', label: 'Watermark Effects' }, { k: 'opacity', label: 'Opacity', t: 'range', min: 0, max: 100, def: 70 }, { k: 'size', label: 'Size', t: 'range', min: 1, max: 30, step: 0.5, def: 4 },
      { k: 'anchor', label: 'Anchor', t: 'select', opts: ANCHORS }, { k: 'insetH', label: 'Inset Horizontal', t: 'range', min: 0, max: 20, step: 0.5, def: 3 }, { k: 'insetV', label: 'Inset Vertical', t: 'range', min: 0, max: 20, step: 0.5, def: 3 },
      { k: 'rotate', label: 'Rotate', t: 'select', opts: [[0, 'None'], [-90, '90\u00b0 Left'], [90, '90\u00b0 Right'], [180, '180\u00b0'], [-30, 'Diagonal']] }];
    const draw = () => { host.replaceChildren(UI.form(spec, wm, paint)); paint(); };
    draw();
    await UI.dialog({ title: 'Watermark Editor', width: 860, body: h('div', { class: 'split' }, h('div', { class: 'wm-left' }, pv), h('div', { class: 'wm-right' }, UI.presetBar('watermarks', () => wm, w => { wm = { ...clone(WM_DEFAULT), ...w }; draw(); }, { 'Simple Copyright': WM_DEFAULT }), host)), buttons: [['Done', null, 'primary']] });
  },
};

/* A progress row in the activity area for work done in the page itself. */
function Progress(title) {
  const bar = h('div', { class: 'bar' }, h('i')), msg = h('span', {}, title), st = { cancel: false };
  const row = h('div', { class: 'job' }, msg, bar, h('b', { title: 'Cancel', onclick: () => { st.cancel = true; } }, '\u00d7'));
  $('#activity').append(row);
  st.set = (i, n, text) => { msg.textContent = title + (text ? ' \u2014 ' + text : ''); bar.firstChild.style.width = (n ? 100 * i / n : 30) + '%'; };
  st.done = () => row.remove();
  return st;
}

const Exporter = {
  defaults: { dest: 'disk', folder: '', subfolder: '', addToCatalog: false, stack: false, existing: 'rename', naming: { enabled: false, template: '{name}', custom: '', start: 1 }, format: 'jpeg', quality: 90, colorSpace: 'sRGB', intent: 'relative',
    tiffCompression: 'lzw', resize: { enabled: false, mode: 'long', value: 2048, w: 1920, h: 1080, dontEnlarge: true, dpi: 240 }, sharpen: { enabled: false, target: 'screen', amount: 'standard' }, border: { enabled: false, size: 4, color: '#ffffff' }, metadata: 'all', removeLocation: false,
    watermark: { enabled: false, preset: 'Simple Copyright' }, post: 'reveal', app: '', ftp: { host: '', port: 21, user: '', pass: '', path: '', tls: false, passive: true }, disc: { label: 'Photos', recorder: 0, iso: false, isoFolder: '' } },
  builtin: {
    'Full-Sized JPEGs': {}, 'For Web \u2013 2048 px sRGB': { quality: 82, resize: { enabled: true, mode: 'long', value: 2048, dontEnlarge: true, dpi: 72 }, sharpen: { enabled: true, target: 'screen', amount: 'standard' } },
    'For Email \u2013 1200 px': { quality: 70, resize: { enabled: true, mode: 'long', value: 1200, dontEnlarge: true, dpi: 72 }, metadata: 'copyright' },
    'Print \u2013 TIFF Adobe RGB': { format: 'tiff', colorSpace: 'AdobeRGB', sharpen: { enabled: true, target: 'glossy', amount: 'standard' }, resize: { enabled: false, dpi: 300 } },
    'Originals + XMP': { format: 'original' }, 'Burn Full-Sized JPEGs to Disc': { dest: 'disc' }, 'Upload to FTP \u2013 Web Size': { dest: 'ftp', quality: 82, resize: { enabled: true, mode: 'long', value: 2048, dontEnlarge: true } },
  },
  merge(base, over) { const out = clone(base); for (const [k, v] of Object.entries(over || {})) out[k] = v && typeof v === 'object' && !Array.isArray(v) ? { ...out[k], ...v } : v; return out; },
  targetLong(st, fw, fh) {
    const r = st.resize || {}, long = Math.max(fw, fh), short = Math.min(fw, fh); if (!r.enabled) return long;
    let k = 1;
    if (r.mode === 'long') k = r.value / long; else if (r.mode === 'short') k = r.value / short; else if (r.mode === 'wh') k = Math.min(r.w / fw, r.h / fh); else if (r.mode === 'mp') k = Math.sqrt(r.value * 1e6 / (fw * fh)); else if (r.mode === 'pct') k = r.value / 100;
    if (r.dontEnlarge) k = Math.min(1, k);
    return Math.max(16, Math.round(long * k));
  },
  /* Final pixels for one photo: develop pipeline, resize, watermark. */
  async render(p, st) {
    const s = devFull(p.develop), [fw, fh] = Geo.outSize(s, p.w, p.h), long = this.targetLong(st, fw, fh);
    let cv = await Render.canvas(p, Math.min(long, Math.max(fw, fh)));
    if (long > Math.max(cv.width, cv.height) * 1.01) { const k = long / Math.max(cv.width, cv.height), up = h('canvas', { width: Math.round(cv.width * k), height: Math.round(cv.height * k) }), x = up.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(cv, 0, 0, up.width, up.height); cv = up; }
    if (st.watermark && st.watermark.enabled) await Watermark.draw(cv, Watermark.all()[st.watermark.preset] || WM_DEFAULT, p);
    return cv;
  },
  async run(ids, st, quiet) {
    const photos = ids.map(i => App.photo(i)).filter(Boolean); if (!photos.length) return null;
    const settings = { ...st, count: photos.length };
    if (settings.dest === 'disk' && !settings.folder) settings.folder = App.boot.pictures + '\\Opia Exports';
    const { session } = await api('session_begin', { settings, staging: settings.dest !== 'disk' });
    const prog = Progress('Exporting'); let n = 0, errors = [];
    try {
      for (const p of photos) {
        if (prog.cancel) { await api('session_cancel', { session }); UI.toast('Export cancelled'); return null; }
        prog.set(n, photos.length, `${n + 1} of ${photos.length}: ${p.filename}`);
        try {
          const body = st.format === 'original' ? new Blob([]) : await Render.blob(await this.render(p, settings), 'image/png');
          await upload('export_put', { session, id: p.id, index: n }, body);
        } catch (e) { errors.push(p.filename + ': ' + e.message); }
        n++;
      }
    } finally { prog.done(); }
    const res = await runJob(api('session_finish', { session }), settings.dest === 'ftp' ? 'Uploading to FTP' : settings.dest === 'disc' ? 'Writing disc' : 'Finishing export');
    if (res.added && res.added.length) { App.addPhotos(res.added); App.refreshList(true); Panels.refreshAll(); }
    if (!quiet) UI.toast(`Exported ${res.count} photo${res.count === 1 ? '' : 's'}` + (settings.dest === 'disk' ? ' to ' + res.dir : '') + (res.messages.length ? ' \u2014 ' + res.messages.join('; ') : '') + (errors.length ? ` \u2014 ${errors.length} failed: ${errors[0]}` : ''), errors.length ? 'error' : '');
    return res;
  },
  spec() {
    const profs = (App.boot.profiles || []).map(p => [p.id, `${p.name}${p.space !== 'RGB' ? ' (' + p.space + ')' : ''}`]), lossy = o => ['jpeg', 'webp', 'avif'].includes(o.format), raster = o => o.format !== 'original';
    return [
      { t: 'section', label: 'Export To' }, { k: 'dest', label: 'Destination', t: 'select', opts: [['disk', 'Hard Drive'], ['ftp', 'FTP Server'], ['disc', 'CD / DVD']] },
      { t: 'section', label: 'Export Location', show: o => o.dest === 'disk' }, { k: 'folder', label: 'Folder', t: 'folder', ph: App.boot.pictures + '\\Opia Exports', show: o => o.dest === 'disk' }, { k: 'subfolder', label: 'Put in Subfolder', ph: '(none)', show: o => o.dest === 'disk' },
      { k: 'existing', label: 'Existing Files', t: 'select', opts: [['rename', 'Choose a new name for the exported file'], ['overwrite', 'Overwrite WITHOUT WARNING'], ['skip', 'Skip']], show: o => o.dest === 'disk' },
      { k: 'addToCatalog', label: 'Add to This Catalog', t: 'check', show: o => o.dest === 'disk' }, { k: 'stack', label: 'Add to Stack with the original', t: 'check', show: o => o.dest === 'disk' && o.addToCatalog },
      { t: 'section', label: 'FTP Server', show: o => o.dest === 'ftp' }, { k: 'ftp.host', label: 'Server', ph: 'ftp.example.com', show: o => o.dest === 'ftp' }, { k: 'ftp.port', label: 'Port', t: 'number', show: o => o.dest === 'ftp' }, { k: 'ftp.user', label: 'User Name', ph: 'anonymous', show: o => o.dest === 'ftp' },
      { k: 'ftp.pass', label: 'Password', t: 'password', show: o => o.dest === 'ftp' }, { k: 'ftp.path', label: 'Server Path', ph: '/public_html/photos', show: o => o.dest === 'ftp' }, { k: 'ftp.tls', label: 'Use FTPS (explicit TLS)', t: 'check', show: o => o.dest === 'ftp' }, { k: 'ftp.passive', label: 'Passive mode', t: 'check', show: o => o.dest === 'ftp' },
      { t: 'button', label: 'Test Connection', show: o => o.dest === 'ftp', run: async o => { try { const r = await api('ftp_test', { conn: o.ftp }); UI.alert('FTP connection OK', `Connected. Remote folder: ${r.cwd}\n${r.list.length} item(s) there.\n${r.welcome}`); } catch (e) { UI.error(e); } } },
      { t: 'note', label: 'The password is kept only for this session unless you save it inside a preset (presets are stored unencrypted on this computer).', show: o => o.dest === 'ftp' },
      { t: 'section', label: 'CD / DVD', show: o => o.dest === 'disc' }, { k: 'disc.label', label: 'Disc Name', show: o => o.dest === 'disc' },
      { t: 'custom', show: o => o.dest === 'disc', el: (o, redraw) => { const box = h('div', { class: 'fnote' }, 'Looking for disc recorders\u2026'); api('disc_info').then(list => { Exporter.discs = list; box.replaceChildren(list.length ? h('label', { class: 'frow' }, h('span', {}, 'Recorder'), h('select', { onchange: e => { o.disc.recorder = list[e.target.selectedIndex].index; } }, list.map(d => h('option', { selected: d.index === o.disc.recorder }, `${d.name} ${d.drive} \u2014 ${d.media === 'writable' ? 'ready, ' + fmt.bytes(d.free) + ' free' : 'no writable disc inserted'}`)))) : 'No disc recorder is connected. Tick "Write a disc image" to produce an .iso file you can burn later or on another computer.'); if (!list.length && !o.disc.iso) { o.disc.iso = true; redraw(); } }); return box; } },
      { k: 'disc.iso', label: 'Write a disc image (.iso) instead of burning', t: 'check', show: o => o.dest === 'disc' }, { k: 'disc.isoFolder', label: 'Save .iso in', t: 'folder', ph: App.boot.pictures, show: o => o.dest === 'disc' && o.disc.iso },
      { t: 'section', label: 'File Naming' }, { k: 'naming.enabled', label: 'Rename To', t: 'check' }, { t: 'custom', show: o => o.naming.enabled, el: o => h('label', { class: 'frow' }, h('span', {}, 'Template'), Naming.select(o.naming, 'template')) },
      { k: 'naming.custom', label: 'Custom Text', show: o => o.naming.enabled }, { k: 'naming.start', label: 'Start Number', t: 'number', min: 0, show: o => o.naming.enabled },
      { t: 'section', label: 'File Settings' }, { k: 'format', label: 'Image Format', t: 'select', opts: [['jpeg', 'JPEG'], ['tiff', 'TIFF'], ['png', 'PNG'], ['webp', 'WebP'], ['avif', 'AVIF'], ['original', 'Original (unmodified file + XMP sidecar)']] },
      { k: 'quality', label: 'Quality', t: 'range', min: 10, max: 100, def: 90, show: lossy }, { k: 'tiffCompression', label: 'Compression', t: 'select', opts: [['none', 'None'], ['lzw', 'LZW'], ['zip', 'ZIP']], show: o => o.format === 'tiff' },
      { k: 'colorSpace', label: 'Color Space', t: 'select', opts: profs, show: raster }, { k: 'intent', label: 'Rendering Intent', t: 'select', opts: [['relative', 'Relative Colorimetric'], ['perceptual', 'Perceptual']], show: o => raster(o) && o.colorSpace !== 'sRGB' },
      { t: 'section', label: 'Image Sizing', show: raster }, { k: 'resize.enabled', label: 'Resize to Fit', t: 'check', show: raster },
      { k: 'resize.mode', label: 'Fit', t: 'select', opts: [['long', 'Long Edge'], ['short', 'Short Edge'], ['wh', 'Width & Height'], ['mp', 'Megapixels'], ['pct', 'Percentage']], show: o => raster(o) && o.resize.enabled },
      { k: 'resize.value', label: 'Value', t: 'number', min: 1, show: o => raster(o) && o.resize.enabled && o.resize.mode !== 'wh' }, { k: 'resize.w', label: 'Width (px)', t: 'number', show: o => raster(o) && o.resize.enabled && o.resize.mode === 'wh' }, { k: 'resize.h', label: 'Height (px)', t: 'number', show: o => raster(o) && o.resize.enabled && o.resize.mode === 'wh' },
      { k: 'resize.dontEnlarge', label: "Don't Enlarge", t: 'check', show: o => raster(o) && o.resize.enabled }, { k: 'resize.dpi', label: 'Resolution (ppi)', t: 'number', min: 1, show: raster },
      { t: 'section', label: 'Output Sharpening', show: raster }, { k: 'sharpen.enabled', label: 'Sharpen For', t: 'check', show: raster }, { k: 'sharpen.target', label: 'Medium', t: 'select', opts: [['screen', 'Screen'], ['matte', 'Matte Paper'], ['glossy', 'Glossy Paper']], show: o => raster(o) && o.sharpen.enabled },
      { k: 'sharpen.amount', label: 'Amount', t: 'select', opts: [['low', 'Low'], ['standard', 'Standard'], ['high', 'High']], show: o => raster(o) && o.sharpen.enabled },
      { t: 'section', label: 'Border', show: raster }, { k: 'border.enabled', label: 'Add a Border', t: 'check', show: raster }, { k: 'border.size', label: 'Width (% of long edge)', t: 'range', min: 1, max: 20, def: 4, show: o => raster(o) && o.border.enabled }, { k: 'border.color', label: 'Colour', t: 'select', opts: [['#ffffff', 'White'], ['#000000', 'Black'], ['#f4f1ea', 'Cream'], ['#808080', 'Grey']], show: o => raster(o) && o.border.enabled },
      { t: 'section', label: 'Metadata', show: raster }, { k: 'metadata', label: 'Include', t: 'select', opts: [['all', 'All Metadata'], ['all_except_camera', 'All Except Camera & Camera Raw Info'], ['copyright_contact', 'Copyright & Contact Info Only'], ['copyright', 'Copyright Only'], ['none', 'None']], show: raster },
      { k: 'removeLocation', label: 'Remove Location Info', t: 'check', show: o => raster(o) && o.metadata.startsWith('all') },
      { t: 'section', label: 'Watermarking', show: raster }, { k: 'watermark.enabled', label: 'Watermark', t: 'check', show: raster },
      { t: 'custom', show: o => raster(o) && o.watermark.enabled, el: (o, redraw) => h('div', { class: 'frow' }, h('span', {}, 'Preset'), h('span', { class: 'fpick' }, h('select', { onchange: e => { o.watermark.preset = e.target.value; } }, Object.keys(Watermark.all()).map(n => h('option', { selected: n === o.watermark.preset }, n))), h('button', { class: 'btn', onclick: async () => { await Watermark.edit(); redraw(); } }, 'Edit\u2026'))) },
      { t: 'section', label: 'Post-Processing', show: o => o.dest === 'disk' }, { k: 'post', label: 'After Export', t: 'select', opts: [['nothing', 'Do nothing'], ['reveal', 'Show in Finder'], ['open', 'Open in default application'], ['app', 'Open in Other Application\u2026']], show: o => o.dest === 'disk' },
      { k: 'app', label: 'Application', t: 'file', exts: ['.app', '.command', '.sh'], show: o => o.dest === 'disk' && o.post === 'app' },
      { t: 'note', label: () => { const pl = (App.boot.plugins || []).filter(p => p.enabled && p.hooks.includes('on_export')); return pl.length ? 'Plug-in export actions that will run: ' + pl.map(p => p.name).join(', ') : 'No plug-in export actions are enabled (File > Plug-in Manager).'; } },
    ];
  },
  async dialog() {
    const ids = App.selIds(); if (!ids.length) return UI.toast('Select photos to export');
    let st = this.merge(this.defaults, App.conf('export_last', {}));
    const host = h('div', { class: 'ex-form' }), list = h('div', { class: 'ex-presets' });
    const draw = () => host.replaceChildren(UI.form(this.spec(), st));
    const drawList = () => {
      const user = App.conf('export_presets', {});
      const row = (n, set, isUser) => h('div', { class: 'trow', onclick: event => { st = this.merge(this.defaults, set); if (!st.ftp.pass && set.ftp && set.ftp.pass) st.ftp.pass = set.ftp.pass; draw(); $$('.trow', list).forEach(r => r.classList.remove('on')); event.currentTarget.classList.add('on'); },
        oncontextmenu: e => { e.preventDefault(); if (isUser) UI.menu(e.clientX, e.clientY, [{ label: 'Update with Current Settings', run: () => { App.setConf('export_presets', { ...user, [n]: clone(st) }); UI.toast('Preset updated'); } }, { label: 'Delete', run: () => { const u = { ...user }; delete u[n]; App.setConf('export_presets', u); drawList(); } }]); } }, h('span', { class: 'tw none' }), h('span', { class: 'tl' }, n));
      list.replaceChildren(h('div', { class: 'sub' }, 'Opia Presets'), ...Object.entries(this.builtin).map(([n, s]) => row(n, s, false)), h('div', { class: 'sub' }, 'User Presets'),
        ...(Object.keys(user).length ? Object.entries(user).map(([n, s]) => row(n, s, true)) : [h('div', { class: 'empty small' }, 'None yet')]),
        h('button', { class: 'btn', onclick: async () => { const n = await UI.prompt('New Export Preset', 'Preset name'); if (n) { App.setConf('export_presets', { ...App.conf('export_presets', {}), [n]: clone(st) }); drawList(); } } }, 'Add\u2026'));
    };
    draw(); drawList();
    const ok = await UI.dialog({ title: `Export ${ids.length} File${ids.length > 1 ? 's' : ''}`, width: 860, body: h('div', { class: 'split' }, list, host), buttons: [['Cancel', null], ['Export', true, 'primary']] });
    if (!ok) return;
    const keep = clone(st); keep.ftp.pass = ''; App.setConf('export_last', keep);
    await this.run(ids, st);
  },
  again() { const st = App.conf('export_last', null); if (!st) return this.dialog(); return this.run(App.selIds(), this.merge(this.defaults, st)); },
};

const Ext = {
  /* Edit In: hand a rendered copy (or the original) to another program; the copy is catalogued and stacked. */
  async editIn(ed) {
    const p = App.cur(); if (!p) return;
    const st = { what: App.isEdited(p) || !['JPG', 'JPEG', 'TIF', 'TIFF', 'PNG'].includes(p.format) ? 'copy' : 'original' };
    const ok = await UI.dialog({ title: 'Edit Photo with ' + ed.name, width: 460, body: UI.form([{ k: 'what', label: 'What to Edit', t: 'select', opts: [['copy', 'Edit a Copy with Opia Adjustments'], ['original', 'Edit Original']] },
      { t: 'note', label: o => (o.what === 'copy' ? `A ${String(ed.format || 'tiff').toUpperCase()} copy with your adjustments is saved next to the original, added to the catalog, stacked with it, and opened in ${ed.name}.` : 'The original file is opened directly. Opia adjustments are not visible to the other program.') }], st), buttons: [['Cancel', null], ['Edit', true, 'primary']] });
    if (!ok) return;
    if (st.what === 'original') return api('fs_open', { path: p.path, app: ed.path });
    await Exporter.run(App.selIds(), Exporter.merge(Exporter.defaults, { dest: 'disk', folder: p.folder, suffix: '-Edit', format: ed.format || 'tiff', colorSpace: ed.colorSpace || 'sRGB', addToCatalog: true, stack: true, post: 'app', app: ed.path, existing: 'rename' }), true);
    UI.toast('Opened in ' + ed.name);
  },
  async dng() {
    const ids = App.selIds(), raws = ids.filter(i => /^(CR2|CR3|NEF|NRW|ARW|SRF|SR2|RAF|ORF|RW2|PEF|SRW|3FR|ERF|KDC|MRW|X3F|IIQ|RAW|RWL|DCR)$/.test(App.photo(i).format));
    const { path } = await api('dng_status');
    const st = { compressed: true, preview: 1, embed: false, lossy: false, delete_original: false };
    const ok = await UI.dialog({ title: 'Convert Photos to DNG', width: 500, body: h('div', {}, h('div', { class: 'fnote' }, path ? `Using Adobe DNG Converter at ${path}` : 'Adobe DNG Converter was not found. Install the free converter from Adobe, or set its location in Preferences > External Editing.'),
      h('div', { class: 'fnote' }, `${raws.length} of ${ids.length} selected photo(s) are proprietary raw files that can be converted.`),
      UI.form([{ k: 'compressed', label: 'Use lossless compression', t: 'check' }, { k: 'lossy', label: 'Use lossy compression (smaller files)', t: 'check' }, { k: 'preview', label: 'JPEG Preview', t: 'select', opts: [[0, 'None'], [1, 'Medium Size'], [2, 'Full Size']] }, { k: 'embed', label: 'Embed original raw file', t: 'check' }, { k: 'delete_original', label: 'Move originals to the Trash after successful conversion', t: 'check' }], st)),
      buttons: [['Cancel', null], path && raws.length ? ['Convert', true, 'primary'] : null].filter(Boolean) });
    if (!ok) return;
    const r = await runJob(api('dng_convert', { ids: raws, opts: st }), 'Converting to DNG');
    App.addPhotos(r.photos); App.emit('meta', raws); UI.toast(`${r.converted} converted` + (r.errors.length ? `, ${r.errors.length} failed: ${r.errors[0]}` : ''), r.errors.length ? 'error' : '');
  },
  async locate() { const p = App.cur(); if (!p) return; const f = await UI.pickFile(p.path); if (!f) return; const n = await api('photos_locate', { id: p.id, path: f }); await App.loadCatalog(); UI.toast(n + ' photo(s) relinked'); },
  async relinkFolder(old) { const d = await UI.pickFolder(old); if (!d) return; const first = [...App.photos.values()].find(p => p.folder.toLowerCase() === old.toLowerCase()); if (!first) return; try { const n = await api('photos_locate', { id: first.id, path: d.replace(/[\\/]$/, '') + '\\' + first.filename }); await App.loadCatalog(); UI.toast(n + ' photo(s) relinked'); } catch (e) { UI.error(e); } },
  /* Lens profiles: saved from manual settings, or imported from Adobe .lcp files */
  async saveLensProfile() {
    const s = Dev.s, lensName = (Dev.photo?.exif || {}).lens || '', L = Geo.lens({ ...s, lensProfileEnable: false });
    const st = { name: lensName || 'My lens', match: lensName };
    const ok = await UI.dialog({ title: 'Save Lens Profile', width: 460, body: h('div', {}, UI.form([{ k: 'name', label: 'Profile Name' }, { k: 'match', label: 'Auto-match lens name', ph: 'text found in the EXIF lens name' }], st),
      h('div', { class: 'fnote' }, `Stores the current manual Distortion (${s.distortion}) and Vignetting (${s.lensVignette}) as a profile. Photos whose EXIF lens name contains the match text use it automatically when Profile Corrections are on.`)), buttons: [['Cancel', null], ['Save', () => !!st.name.trim(), 'primary']] });
    if (!ok) return;
    App.setConf('lens_profiles', { ...App.conf('lens_profiles', {}), ['user:' + st.name.trim()]: { name: st.name.trim(), match: st.match.trim(), k1: L.k1, k2: L.k2, v1: L.v1, v2: L.v2 } });
    Object.assign(s, { lensProfileEnable: true, lensProfile: 'user:' + st.name.trim(), distortion: 0, lensVignette: 0 }); Dev.syncUI(); Dev.render(); Dev.commit('Lens profile: ' + st.name);
  },
  async importLcp() {
    const f = await UI.pickFile('C:\\ProgramData\\Adobe\\CameraRaw\\LensProfiles\\1.0', ['.lcp']); if (!f) return;
    const xml = await (await fetch('/img/text?path=' + encodeURIComponent(f))).text();
    const doc = new DOMParser().parseFromString(xml, 'text/xml'), at = (el, n) => { for (const a of el.attributes) if (a.localName === n) return a.value; const c = [...el.children].find(x => x.localName === n); return c ? c.textContent : null; };
    const descs = [...doc.getElementsByTagName('*')].filter(e => e.localName === 'Description' && at(e, 'FocalLength'));
    const target = (Dev.photo?.exif || {}).focal || 0; let best = null;
    for (const d of descs) { const pm = [...d.getElementsByTagName('*')].find(e => e.localName === 'PerspectiveModel'); if (!pm) continue; const inner = [...pm.getElementsByTagName('*')].find(e => e.localName === 'Description') || pm; const k1 = +at(inner, 'RadialDistortParam1'); if (isNaN(k1)) continue;
      const fl = +at(d, 'FocalLength'), fx = +at(inner, 'FocalLengthX') || 1, vm = [...inner.getElementsByTagName('*')].find(e => e.localName === 'VignetteModel'), vi = vm ? ([...vm.getElementsByTagName('*')].find(e => e.localName === 'Description') || vm) : null;
      const cand = { fl, fx, k1, k2: +at(inner, 'RadialDistortParam2') || 0, v1: vi ? +at(vi, 'VignetteModelParam1') || 0 : 0, v2: vi ? +at(vi, 'VignetteModelParam2') || 0 : 0 };
      if (!best || Math.abs(fl - target) < Math.abs(best.fl - target)) best = cand; }
    if (!best) return UI.alert('Import LCP', 'No rectilinear distortion model was found in that profile.');
    const name = at(descs[0], 'ProfileName') || at(descs[0], 'Lens') || f.split(/[\\/]/).pop(), lensN = at(descs[0], 'Lens') || '';
    // Adobe's model is in focal-length units; ours is normalised to the image corner (assumes a 3:2 frame).
    const rc2 = (1.5 * 1.5 + 1) / 4 / (best.fx * best.fx * 2.25);
    App.setConf('lens_profiles', { ...App.conf('lens_profiles', {}), ['lcp:' + name]: { name: name + ` (${best.fl} mm)`, match: lensN, k1: best.k1 * rc2, k2: best.k2 * rc2 * rc2, v1: -best.v1 * rc2, v2: -best.v2 * rc2 * rc2 } });
    if (Dev.photo) { Object.assign(Dev.s, { lensProfileEnable: true, lensProfile: 'lcp:' + name }); Dev.syncUI(); Dev.render(); Dev.commit('Lens profile: ' + name); }
    UI.toast('Imported lens profile ' + name);
  },
  manageMap(title, key, note) {
    const list = h('div'); const draw = () => { const all = App.conf(key, {}); list.replaceChildren(...(Object.keys(all).length ? Object.entries(all).map(([k, v]) => h('div', { class: 'trow' }, h('span', { class: 'tl' }, (v.name || k) + (v.match ? '   \u2014 matches \u201c' + v.match + '\u201d' : '')), h('a', { class: 'go', title: 'Delete', onclick: () => { const c = { ...all }; delete c[k]; App.setConf(key, c); draw(); } }, '\u00d7'))) : [h('div', { class: 'empty small' }, 'None saved yet.')])); };
    draw();
    return UI.dialog({ title, width: 520, body: h('div', {}, h('div', { class: 'fnote' }, note), list) }).then(() => Dev.syncUI());
  },
  manageLensProfiles() { return this.manageMap('Lens Profiles', 'lens_profiles', 'Custom and imported lens correction profiles. Built-in generic profiles are always available.'); },
  /* Camera calibration profiles: profile look + primaries, optionally the default for a camera model */
  async saveCameraProfile() {
    const s = Dev.s, model = (Dev.photo?.exif || {}).model || '', st = { name: model ? model + ' custom' : 'My camera', def: false };
    const ok = await UI.dialog({ title: 'Save Camera Calibration Profile', width: 460, body: UI.form([{ k: 'name', label: 'Profile Name' }, { k: 'def', label: model ? `Use as default for ${model} on import` : 'Use as default on import (no camera model in EXIF)', t: 'check' }], st), buttons: [['Cancel', null], ['Save', () => !!st.name.trim(), 'primary']] });
    if (!ok) return;
    const prof = { name: st.name.trim(), match: st.def ? model : '' }; for (const k of ['profile', ...GROUPS.Calibration]) prof[k] = s[k];
    App.setConf('camera_profiles', { ...App.conf('camera_profiles', {}), [st.name.trim()]: prof }); Dev.syncUI(); UI.toast('Camera profile saved');
  },
  manageCameraProfiles() { return this.manageMap('Camera Calibration Profiles', 'camera_profiles', 'Saved calibration sets appear in the Profile menu of the Basic panel. A profile with a camera match is applied to new imports from that camera.'); },
  cameraDefault(p) { const cams = Object.values(App.conf('camera_profiles', {})), m = (p.exif || {}).model || ''; const c = cams.find(x => x.match && m && m.toLowerCase().includes(x.match.toLowerCase())); if (!c) return null; const { name, match, ...set } = c; return set; },
};

/* Photo Merge: panorama (boundary warp, fill edges, auto crop) and HDR */
const Merge = {
  async dialog(kind) {
    const ids = App.selIds(); if (ids.length < 2) return UI.toast('Select two or more photos to merge');
    const st = kind === 'pano' ? { projection: 'panorama', boundaryWarp: 0, fillEdges: false, autoCrop: true, stack: true, size: 3000 } : kind === 'focus' ? { align: true, smooth: 9, stack: true, size: 0 } : { align: true, fillEdges: false, saturation: 1, stack: true, size: 0 };
    const img = h('img', { class: 'merge-prev' }), note = h('div', { class: 'fnote' }, 'Building preview\u2026');
    const prev = debounce(async () => { note.textContent = 'Building preview\u2026'; try { const r = await runJob(api('merge_preview', { ids, kind, opts: st }), 'Merge preview'); img.src = '/img/mergeprev/' + r.key + '?t=' + Date.now(); note.textContent = `Preview ${r.width} \u00d7 ${r.height}. The merged file is rendered at the chosen size.`; } catch (e) { note.textContent = e.message; img.removeAttribute('src'); } }, 350);
    const spec = kind === 'pano' ? [{ k: 'projection', label: 'Projection', t: 'select', opts: [['panorama', 'Spherical (hand-held / tripod sweeps)'], ['scans', 'Flat (scans, documents)']] },
      { k: 'boundaryWarp', label: 'Boundary Warp', t: 'range', min: 0, max: 100, def: 0 }, { k: 'fillEdges', label: 'Fill Edges (content-aware fill of the empty corners)', t: 'check' }, { k: 'autoCrop', label: 'Auto Crop', t: 'check', show: o => !o.fillEdges },
      { k: 'size', label: 'Source size (long edge)', t: 'select', opts: [[2000, '2000 px (fast)'], [3000, '3000 px'], [4500, '4500 px'], [0, 'Full resolution (slow)']] }, { k: 'stack', label: 'Create Stack', t: 'check' }]
      : kind === 'focus' ? [{ k: 'align', label: 'Auto Align', t: 'check' }, { k: 'smooth', label: 'Blend smoothness', t: 'range', min: 3, max: 41, step: 2, def: 9 }, { k: 'size', label: 'Size', t: 'select', opts: [[0, 'Full resolution'], [3000, '3000 px'], [2000, '2000 px']] }, { k: 'stack', label: 'Create Stack', t: 'check' }]
      : [{ k: 'align', label: 'Auto Align', t: 'check' }, { k: 'fillEdges', label: 'Fill Edges (instead of cropping the alignment border)', t: 'check' }, { k: 'saturation', label: 'Saturation weight', t: 'range', min: 0, max: 2, step: 0.1, def: 1 },
        { k: 'size', label: 'Size', t: 'select', opts: [[0, 'Full resolution'], [3000, '3000 px'], [2000, '2000 px']] }, { k: 'stack', label: 'Create Stack', t: 'check' }];
    prev();
    const ok = await UI.dialog({ title: kind === 'pano' ? `Panorama Merge \u2014 ${ids.length} photos` : kind === 'focus' ? `Focus Stack \u2014 ${ids.length} photos` : `HDR Merge \u2014 ${ids.length} exposures`, width: 880, body: h('div', { class: 'split' }, h('div', { class: 'wm-left' }, img, note), h('div', { class: 'wm-right' }, UI.form(spec, st, prev))), buttons: [['Cancel', null], ['Merge', true, 'primary']] });
    if (!ok) return;
    const r = await runJob(api('merge_run', { ids, kind, opts: st }), kind === 'pano' ? 'Merging panorama' : kind === 'focus' ? 'Stacking focus' : 'Merging HDR');
    App.addPhotos(r.photos);
    if (st.stack) await App.reloadPhotos(ids);
    App.refreshList(true); Panels.refreshAll();
    if (r.photos[0]) App.select(r.photos[0].id);
    UI.toast(`Merged to ${r.path.split(/[\\/]/).pop()} (${r.width} \u00d7 ${r.height})`);
  },
};

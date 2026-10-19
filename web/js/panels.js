'use strict';
/* Library side panels: Navigator, Catalog, Folders, Local Disk, Collections | Histogram, Quick Develop, Keywording, Keyword List, Metadata. Plus People view. */

const IPTC_FIELDS = [['creator', 'Creator'], ['jobtitle', 'Job Title'], ['address', 'Address'], ['city', 'City'], ['state', 'State / Province'], ['country', 'Country'], ['countrycode', 'ISO Country Code'],
  ['sublocation', 'Sublocation'], ['phone', 'Phone'], ['email', 'E-Mail'], ['website', 'Website'], ['headline', 'Headline'], ['genre', 'Intellectual Genre'], ['scene', 'IPTC Scene Code'],
  ['category', 'Category'], ['event', 'Event'], ['credit', 'Credit Line'], ['source', 'Source'], ['copyright', 'Copyright'], ['usage', 'Rights Usage Terms'], ['weburl', 'Copyright Info URL'],
  ['instructions', 'Instructions'], ['transref', 'Job Identifier']];
const ex = (k, f) => p => { const v = (p.exif || {})[k]; return v == null || v === '' ? '' : f ? f(v, p) : String(v); };
const META = {   // key: [label, getter, editable field ('title' | 'caption' | 'copy_name' | 'gps' | 'iptc')]
  filename: ['File Name', p => p.filename], copy_name: ['Copy Name', p => p.copy_name, 'copy_name'], folder: ['Folder', p => p.folder], filesize: ['File Size', p => fmt.bytes(p.filesize)],
  format: ['File Type', p => p.format], title: ['Title', p => p.title, 'title'], caption: ['Caption', p => p.caption, 'caption'], rating: ['Rating', p => (p.rating ? '★'.repeat(p.rating) : '')],
  label: ['Label', p => p.label], capture: ['Capture Time', p => fmt.datetime(p.capture_time)], imported: ['Date Added', p => fmt.datetime(p.import_time)],
  dims: ['Dimensions', p => `${p.w} × ${p.h}`], cropped: ['Cropped', p => { const c = devFull(p.develop).crop; return `${Math.round(p.w * c.w)} × ${Math.round(p.h * c.h)}`; }],
  megapixels: ['Megapixels', p => (p.w * p.h / 1e6).toFixed(1) + ' MP'], exposure: ['Exposure', p => [fmt.shutter((p.exif || {}).exposure), p.exif.aperture ? 'f/' + p.exif.aperture : ''].filter(Boolean).join(' at ')],
  focal: ['Focal Length', ex('focal', v => v + ' mm')], focal35: ['Focal Length 35mm', ex('focal35', v => v + ' mm')], iso: ['ISO Speed Rating', ex('iso', v => 'ISO ' + v)], flash: ['Flash', ex('flash')],
  program: ['Exposure Program', ex('program')], metering: ['Metering Mode', ex('metering')], bias: ['Exposure Bias', ex('bias', v => (v > 0 ? '+' : '') + v + ' EV')], wb: ['White Balance', ex('wb')],
  make: ['Make', ex('make')], model: ['Model', ex('model')], lens: ['Lens', ex('lens')], software: ['Software', ex('software')], colorspace: ['Color Space', ex('colorspace')],
  gps: ['GPS', p => (p.gps ? p.gps[0].toFixed(6) + ', ' + p.gps[1].toFixed(6) : ''), 'gps'], altitude: ['Altitude', ex('altitude', v => v + ' m')],
  keywords: ['Keywords', p => App.kwNames(p).join(', ')], people: ['People', p => App.field(p, 'people')], smart: ['Smart Preview', p => (p.smart ? 'Yes' : 'No')],
  status: ['Metadata Status', p => (p.missing ? (p.smart ? 'Original offline (Smart Preview)' : 'Photo is missing') : 'Up to date')],
};
for (const [k, l] of IPTC_FIELDS) META[k] = [l, p => p.iptc[k] || '', 'iptc'];
const META_VIEWS = {
  Default: ['filename', 'copy_name', 'folder', 'status', 'title', 'caption', 'copyright', 'creator', 'sublocation', 'rating', 'label', 'capture', 'dims', 'cropped', 'exposure', 'focal', 'iso', 'flash', 'make', 'model', 'lens', 'gps'],
  EXIF: ['filename', 'folder', 'filesize', 'format', 'dims', 'cropped', 'megapixels', 'capture', 'exposure', 'focal', 'focal35', 'bias', 'iso', 'flash', 'program', 'metering', 'wb', 'make', 'model', 'lens', 'software', 'colorspace', 'gps', 'altitude'],
  IPTC: ['title', 'caption', 'headline', ...IPTC_FIELDS.map(f => f[0]).filter(k => k !== 'headline'), 'keywords'],
  'EXIF and IPTC': ['filename', 'title', 'caption', 'creator', 'copyright', 'headline', 'city', 'state', 'country', 'capture', 'dims', 'exposure', 'focal', 'iso', 'make', 'model', 'lens', 'gps'],
  'Quick Describe': ['filename', 'copy_name', 'rating', 'dims', 'capture', 'model', 'title', 'caption', 'copyright', 'creator', 'sublocation', 'city', 'state', 'country'],
  Location: ['filename', 'title', 'sublocation', 'city', 'state', 'country', 'countrycode', 'gps', 'altitude', 'capture'],
  Minimal: ['filename', 'rating', 'caption', 'copyright'], 'Large Caption': ['caption', 'title'],
};
const RULE_FIELDS = [['rating', 'Rating', 'num'], ['flag', 'Pick Flag', 'flag'], ['label', 'Label Color', 'label'], ['keywords', 'Keywords', 'text'], ['any', 'Any Searchable Text', 'text'],
  ['title', 'Title', 'text'], ['caption', 'Caption', 'text'], ['filename', 'File Name', 'text'], ['folder', 'Folder', 'text'], ['format', 'File Type', 'text'], ['camera', 'Camera', 'text'], ['lens', 'Lens', 'text'],
  ['iso', 'ISO Speed', 'num'], ['aperture', 'Aperture', 'num'], ['focal', 'Focal Length', 'num'], ['megapixels', 'Megapixels', 'num'], ['capture_time', 'Capture Date', 'date'], ['import_time', 'Date Added', 'date'],
  ['edited', 'Has Adjustments', 'bool'], ['virtual', 'Is Virtual Copy', 'bool'], ['gps', 'Has GPS Data', 'bool'], ['smart', 'Has Smart Preview', 'bool'], ['people', 'People', 'text'], ['creator', 'Creator', 'text'],
  ['city', 'City', 'text'], ['country', 'Country', 'text'], ['aspect', 'Aspect Ratio', 'text']];
const RULE_OPS = { num: ['=', '!=', '>', '<', '>=', '<='], text: ['contains', 'contains all', 'not contains', 'starts', 'ends', 'is', 'is not', 'empty', 'not empty'], date: ['after', 'before', 'last days'], bool: ['true', 'false'], flag: ['=', '!='], label: ['is', 'is not', 'empty'] };
const OP_NAMES = { '=': 'is', '!=': 'is not', '>': 'is greater than', '<': 'is less than', '>=': 'is at least', '<=': 'is at most', contains: 'contains', 'contains all': 'contains all', 'not contains': "doesn't contain",
  starts: 'starts with', ends: 'ends with', is: 'is', 'is not': 'is not', empty: 'is empty', 'not empty': 'is not empty', true: 'is true', false: 'is false', after: 'is after', before: 'is before', 'last days': 'is in the last (days)' };
const KEYWORD_SETS = { 'Outdoor Photography': ['Landscape', 'Macro', 'Flowers & Plants', 'Spring', 'Summer', 'Wildlife', 'Fall', 'Winter', 'People'],
  'Portrait Photography': ['Portrait', 'Candid', 'Family', 'Children', 'Group', 'Studio', 'Outdoor', 'Black & White', 'Headshot'],
  'Wedding Photography': ['Bride', 'Groom', 'Wedding Party', 'Family & Friends', 'Reception', 'Ceremony', 'Candid', 'Pre-wedding', 'Details'] };

const dropPhotos = (el, fn) => { el.ondragover = e => { if (e.dataTransfer.types.includes('text/opia-photos')) { e.preventDefault(); el.classList.add('drop'); } }; el.ondragleave = () => el.classList.remove('drop'); el.ondrop = e => { el.classList.remove('drop'); const d = e.dataTransfer.getData('text/opia-photos'); if (d) { e.preventDefault(); fn(JSON.parse(d)); } }; return el; };
const srcIs = s => same(App.source, s);

const Panels = {
  open: new Set(JSON.parse(localStorage.treeOpen || '[]')), diskSel: null, diskKids: new Map(), kwFilter: '',
  tog(key) { this.open.has(key) ? this.open.delete(key) : this.open.add(key); localStorage.treeOpen = JSON.stringify([...this.open].slice(-400)); },
  row(depth, { label, count, on, tw, onclick, oncontext, icon, title, extra, cls }) {
    return h('div', { class: 'trow' + (on ? ' on' : '') + (cls ? ' ' + cls : ''), style: { paddingLeft: 6 + depth * 12 + 'px' }, title, onclick, oncontextmenu: oncontext && (e => { e.preventDefault(); oncontext(e); }) },
      h('span', { class: 'tw ' + (tw === undefined ? 'none' : tw ? 'open' : '') }),
      icon ? h('span', { class: 'ticon' }, icon) : null, h('span', { class: 'tl' }, label), extra, count != null ? h('span', { class: 'tc' }, count) : null);
  },
  build(el) {
    this.nav = h('div', { class: 'nav' }, this.navImg = h('img', { draggable: false }));
    this.catB = h('div'); this.foldB = h('div'); this.diskB = h('div'); this.colB = h('div'); this.dateB = h('div');
    el.left.append(UI.panel('Navigator', this.nav), UI.panel('Catalog', this.catB), UI.panel('Folders', this.foldB, { tools: h('a', { title: 'Add folder to catalog', onclick: () => App.run('file.import') }, '+') }),
      UI.panel('Dates', this.dateB, { closed: true, key: 'dates' }), UI.panel('Local Disk', this.diskB, { closed: true, key: 'disk' }),
      UI.panel('Collections', this.colB, { tools: h('a', { title: 'New collection', onclick: e => { const r = e.target.getBoundingClientRect(); UI.menu(r.left, r.bottom, Collections.newMenu(null)); } }, '+') }),
      h('div', { class: 'side-foot' }, h('button', { class: 'btn', onclick: () => App.run('file.import') }, 'Import…'), h('button', { class: 'btn', onclick: () => App.run('file.export') }, 'Export…')));
    this.histC = h('canvas', { width: 256, height: 96, class: 'histo' }); this.histInfo = h('div', { class: 'hist-info' });
    this.qdB = h('div'); this.kwB = h('div'); this.klB = h('div'); this.mdB = h('div');
    el.right.append(UI.panel('Histogram', h('div', {}, this.histC, this.histInfo)), UI.panel('Quick Develop', this.qdB, { closed: true }), UI.panel('Keywording', this.kwB),
      UI.panel('Keyword List', this.klB, { tools: h('a', { title: 'Create keyword tag', onclick: () => Keywords.create(null) }, '+') }), UI.panel('Metadata', this.mdB),
      h('div', { class: 'side-foot adv' }, h('button', { class: 'btn', title: 'Copy develop settings to the other selected photos', onclick: () => App.run('dev.sync') }, 'Sync Settings'), h('button', { class: 'btn', onclick: () => App.run('meta.sync') }, 'Sync Metadata')));
    const left = debounce(() => { this.drawCatalog(); this.drawFolders(); this.drawDates(); this.drawCollections(); }, 60);
    const right = debounce(() => { this.drawHist(); this.drawQuick(); Keywords.drawTags(); Keywords.drawList(); this.drawMeta(); Lib.toolbar(); }, 40);
    App.on('list', left); App.on('source', left); App.on('collections', left); App.on('meta', () => { left(); right(); });
    App.on('selection', right); App.on('keywords', right); App.on('thumb', right);
    this.drawDisk(); left(); right();
  },
  refreshAll() { if (!this.catB) return; this.drawCatalog(); this.drawFolders(); this.drawCollections(); this.drawHist(); this.drawQuick(); Keywords.drawTags(); Keywords.drawList(); this.drawMeta(); },

  drawCatalog() {
    const all = [...App.photos.values()], miss = all.filter(p => p.missing).length;
    const r = (src, label, n, extra) => this.row(0, { label, count: n, on: srcIs(src), onclick: () => App.setSource(src), extra });
    const qrow = dropPhotos(r({ type: 'quick' }, 'Quick Collection' + (App.collections.get(App.cget('target', null)) ? '' : ' +'), App.cget('quick', []).filter(i => App.photos.has(i)).length), ids => App.quickToggle(ids));
    qrow.oncontextmenu = e => { e.preventDefault(); UI.menu(e.clientX, e.clientY, [{ label: 'Save Quick Collection…', run: () => Collections.saveQuick() }, { label: 'Clear Quick Collection', run: () => { App.cset('quick', []); App.emit('collections'); App.refreshList(); } }, { label: 'Set as Target Collection', run: () => { App.cset('target', null); App.emit('collections'); } }]); };
    this.catB.replaceChildren(r({ type: 'all' }, 'All Photographs', all.length), qrow, r({ type: 'prev' }, 'Previous Import', all.filter(p => p.import_batch === App.lastBatch).length), miss ? r({ type: 'missing' }, 'Missing Photographs', miss) : null);
    this.navImg.src = App.cur() ? App.thumb(App.cur()) : '';
  },
  drawFolders() {
    const root = { kids: new Map(), n: 0, total: 0, path: '' };
    for (const p of App.photos.values()) {
      if (p.master_id) continue;
      const unc = p.folder.startsWith('\\\\'), parts = p.folder.split(/[\\/]+/).filter(Boolean); let node = root, path = unc ? '\\' : '';
      parts.forEach((part, i) => { path = i || unc ? path + '\\' + part : part; let k = node.kids.get(part.toLowerCase()); if (!k) { k = { name: part, kids: new Map(), n: 0, total: 0, path }; node.kids.set(part.toLowerCase(), k); } k.total++; node = k; });
      node.n++;
    }
    const out = [];
    const walk = (node, depth, top) => {
      if (top) { while (node.kids.size === 1 && node.n === 0) node = [...node.kids.values()][0]; }
      const key = 'f:' + node.path, hasKids = node.kids.size > 0, open = this.open.has(key), src = { type: 'folder', path: node.path };
      const el = this.row(depth, { label: top ? node.path : node.name, count: node.total, on: srcIs(src), title: node.path, tw: hasKids ? open : undefined, onclick: () => App.setSource(src),
        oncontext: e => UI.menu(e.clientX, e.clientY, [{ label: 'Show in Finder', run: () => api('fs_reveal', { path: node.path }) }, { label: 'Import into this Folder…', run: () => Import.open(node.path) }, { label: 'Synchronize Folder…', run: () => Import.sync(node.path) }, { label: 'Find Missing Folder…', run: () => Ext.relinkFolder(node.path) }]) });
      if (hasKids) el.querySelector('.tw').onclick = e => { e.stopPropagation(); this.tog(key); this.drawFolders(); };
      dropPhotos(el, () => UI.toast('Photos stay where they are on disk. Use Import with "Move" to relocate files.'));
      out.push(el);
      if (hasKids && open) for (const k of [...node.kids.values()].sort((a, b) => a.name.localeCompare(b.name))) walk(k, depth + 1, false);
    };
    for (const k of root.kids.values()) walk(k, 0, true);
    this.foldB.replaceChildren(...(out.length ? out : [h('div', { class: 'empty small' }, 'No folders yet. Import photos or add a folder from Local Disk below.')]));
  },
  /* Local hard-drive browsing: any folder on any drive, without importing first. */
  async drawDisk() {
    if (!this.diskKids.has('')) { try { this.diskKids.set('', await api('fs_list', {})); } catch (e) { return; } }
    const top = this.diskKids.get(''), out = [];
    const add = (d, depth) => {
      const key = 'd:' + d.path, open = this.open.has(key), kids = this.diskKids.get(d.path);
      const toggle = async () => { this.tog(key); if (this.open.has(key) && !this.diskKids.has(d.path)) { try { this.diskKids.set(d.path, await api('fs_list', { path: d.path })); } catch (e) { UI.error(e); this.open.delete(key); } } this.drawDisk(); };
      const el = this.row(depth, { label: d.name, icon: depth ? '' : (d.kind === 'CD/DVD' ? '◎' : d.kind ? '⛁' : '★'), on: this.diskSel === d.path, tw: open, title: d.path,
        count: kids ? kids.files.length || null : null,
        onclick: async () => { this.diskSel = d.path; if (!this.diskKids.has(d.path)) { try { this.diskKids.set(d.path, await api('fs_list', { path: d.path })); } catch (e) { UI.error(e); } } this.drawDisk(); },
        oncontext: e => UI.menu(e.clientX, e.clientY, [{ label: 'Add Folder to Catalog', run: () => Import.addFolder(d.path) }, { label: 'Import…', run: () => Import.open(d.path) }, { label: 'Show in Finder', run: () => api('fs_reveal', { path: d.path }) }, { label: 'Refresh', run: () => { this.diskKids.delete(d.path); toggle().then(toggle); } }]) });
      el.querySelector('.tw').onclick = e => { e.stopPropagation(); toggle(); };
      el.ondblclick = () => Import.addFolder(d.path);
      out.push(el);
      if (open && kids) for (const k of kids.dirs) add(k, depth + 1);
    };
    for (const d of [...(top.places || []), ...top.dirs]) add(d, 0);
    const sel = this.diskSel && this.diskKids.get(this.diskSel);
    this.diskB.replaceChildren(...out, h('div', { class: 'disk-foot' },
      h('div', { class: 'dim' }, this.diskSel ? `${sel ? sel.files.length : 0} photo file(s) in ${this.diskSel}` : 'Pick a folder, then add it in place or import it.'),
      h('button', { class: 'btn', disabled: !this.diskSel, title: 'Catalog the photos where they are (no files are moved or copied)', onclick: () => Import.addFolder(this.diskSel) }, 'Add Folder'),
      h('button', { class: 'btn', disabled: !this.diskSel, onclick: () => Import.open(this.diskSel) }, 'Import…')));
  },
  /* browse by when the photos were taken: years, opening into months */
  drawDates() {
    const tree = new Map(), names = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'], rows = [], src = (ids, name) => ({ type: 'ids', ids, name });
    for (const p of App.photos.values()) { if (!p.capture_time) continue; const d = new Date(p.capture_time * 1000), y = d.getFullYear(), m = d.getMonth(); if (!tree.has(y)) tree.set(y, new Map()); if (!tree.get(y).has(m)) tree.get(y).set(m, []); tree.get(y).get(m).push(p.id); }
    for (const [y, months] of [...tree].sort((a, b) => b[0] - a[0])) {
      const all = [...months.values()].flat(), key = 'date:' + y, open = this.open.has(key);
      rows.push(this.row(0, { label: String(y), count: all.length, tw: open, on: srcIs(src(all, String(y))), onclick: e => { if (e.target.classList.contains('tw')) { this.tog(key); this.drawDates(); } else App.setSource(src(all, String(y))); } }));
      if (open) for (const [m, ids] of [...months].sort((a, b) => b[0] - a[0])) rows.push(this.row(1, { label: names[m], count: ids.length, on: srcIs(src(ids, names[m] + ' ' + y)), onclick: () => App.setSource(src(ids, names[m] + ' ' + y)) }));
    }
    this.dateB.replaceChildren(...(rows.length ? rows : [h('div', { class: 'fnote' }, 'Photos with a capture date are listed here by year and month.')]));
  },
  drawCollections() {
    const out = [], target = App.cget('target', null);
    const kids = pid => [...App.collections.values()].filter(c => (c.parent_id ?? null) === pid).sort((a, b) => (a.type === 'set' ? 0 : 1) - (b.type === 'set' ? 0 : 1) || a.name.localeCompare(b.name));
    const walk = (c, depth) => {
      const key = 'c:' + c.id, isSet = c.type === 'set', open = this.open.has(key), src = { type: 'collection', id: c.id };
      const toggle = () => { this.tog(key); this.drawCollections(); };
      const el = this.row(depth, { label: c.name + (c.id === target ? ' +' : ''), icon: isSet ? '▤' : c.type === 'smart' ? '⚙' : '▢', count: App.collectionPhotos(c.id).length, on: srcIs(src), tw: isSet ? open : undefined, cls: c.id === target ? 'target' : '',
        title: c.type === 'smart' ? 'Smart Collection (rules)' : isSet ? 'Collection Set' : c.id === target ? 'Target Collection (press B to add photos)' : 'Collection', onclick: () => App.setSource(src), oncontext: e => UI.menu(e.clientX, e.clientY, Collections.menu(c)) });
      if (isSet) el.querySelector('.tw').onclick = e => { e.stopPropagation(); toggle(); };
      if (c.type === 'collection') dropPhotos(el, ids => App.collectionToggle(c.id, ids, true));
      el.draggable = true; el.ondragstart = e => e.dataTransfer.setData('text/opia-col', String(c.id));
      if (isSet) { el.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('text/opia-col')) { e.preventDefault(); el.classList.add('drop'); } }); el.addEventListener('drop', e => { const id = +e.dataTransfer.getData('text/opia-col'); if (id && id !== c.id) Collections.move(id, c.id); }); }
      if (c.type === 'smart') el.ondblclick = () => Collections.editSmart(c);
      out.push(el);
      if (isSet && open) kids(c.id).forEach(k => walk(k, depth + 1));
    };
    kids(null).forEach(c => walk(c, 0));
    this.colB.replaceChildren(...(out.length ? out : [h('div', { class: 'empty small' }, 'Click + to create a collection, smart collection or collection set.')]));
  },

  drawHist() {
    const p = App.cur();
    if (!p) { drawHistogram(this.histC, null); this.histInfo.replaceChildren(); return; }
    const img = new Image(); img.onload = () => { if (App.active === p.id) drawHistogram(this.histC, histogramOf(img)); }; img.src = App.thumb(p);
    const e = p.exif || {};
    this.histInfo.replaceChildren(h('div', { class: 'hi-row' }, h('span', {}, e.iso ? 'ISO ' + e.iso : ''), h('span', {}, e.focal ? Math.round(e.focal) + ' mm' : ''), h('span', {}, e.aperture ? 'f / ' + e.aperture : ''), h('span', {}, fmt.shutter(e.exposure))),
      h('div', { class: 'hi-row' }, h('a', { title: 'Click to build or discard the Smart Preview', onclick: () => App.run(p.smart ? 'photo.smartdiscard' : 'photo.smart') }, (p.missing ? '⚠ Original offline' : '▣ Original') + (p.smart ? ' + Smart Preview' : ''))));
  },
  drawQuick() {
    const ids = () => App.selIds();
    if (this.qdDrag) return;   // don't rebuild the sliders while one is being dragged
    const cur = App.cur(), now = devFull(cur && cur.develop);
    const step = (label, key) => {
      const lim = key === 'exposure' ? 5 : 100; let base = null;
      const live = debounce(v => {   // preview on the active photo while dragging
        const p = App.cur(); if (!p || !this.qdDrag) return;
        const t = devFull(base); t[key] = v; p.develop = devDiff(t); p.ver++;
        if (Lib.view === 'grid') Render.thumb(p); else Lib.refreshView(true);
      }, 60);
      return UI.slider({ label, min: -lim, max: lim, step: key === 'exposure' ? 0.01 : 1, value: now[key], def: 0, tip: TIPS.key[key],
        oninput: v => { const p = App.cur(); if (!p) return; if (!this.qdDrag) { this.qdDrag = true; base = clone(p.develop); } live(v); },
        onchange: async v => {   // commit: the same change is applied to every selected photo
          const p = App.cur(); if (!p) return;
          const start = devFull(base !== null || this.qdDrag ? base : p.develop)[key], d = v - start;
          if (this.qdDrag) p.develop = base;
          this.qdDrag = false; base = null;
          if (d) await Dev.adjustMany(ids(), t => { t[key] = clamp(+(t[key] + d).toFixed(2), -lim, lim); }, 'Quick Develop: ' + label);
          this.drawQuick();
        } });
    };
    const pre = Dev.presets();
    this.qdB.replaceChildren(
      h('label', { class: 'frow' }, h('span', {}, 'Saved Preset'), h('select', { onchange: e => { const n = e.target.value; if (pre[n]) Dev.adjustMany(ids(), s => Object.assign(s, clone(pre[n])), 'Preset: ' + n); e.target.value = ''; } }, h('option', { value: '' }, 'Choose…'), Object.keys(pre).map(n => h('option', {}, n)))),
      h('label', { class: 'frow' }, h('span', {}, 'Treatment'), h('select', { onchange: e => Dev.adjustMany(ids(), s => { s.treatment = e.target.value; }, 'Treatment') }, h('option', { value: 'color' }, 'Color'), h('option', { value: 'bw' }, 'Black & White'))),
      h('label', { class: 'frow' }, h('span', {}, 'White Balance'), h('select', { onchange: e => { const v = e.target.value; Dev.adjustMany(ids(), s => Dev.applyWB(s, v), 'White Balance: ' + v); } }, Object.keys(Dev.WB).map(k => h('option', { value: k }, Dev.WB[k].name)))),
      ...[['Exposure', 'exposure'], ['Contrast', 'contrast'], ['Highlights', 'highlights'], ['Shadows', 'shadows'], ['Whites', 'whites'], ['Blacks', 'blacks'], ['Clarity', 'clarity'], ['Vibrance', 'vibrance'], ['Saturation', 'saturation']].map(([l, k]) => step(l, k)),
      h('div', { class: 'qd-row' }, h('span'), h('button', { class: 'btn', onclick: () => Dev.autoTone(ids()) }, 'Auto Tone'), h('button', { class: 'btn', onclick: () => App.run('dev.reset') }, 'Reset All')));
  },
  drawMeta() {
    const ps = App.selected().length ? App.selected() : (App.cur() ? [App.cur()] : []), custom = App.conf('meta_views', {}), views = { ...META_VIEWS, ...custom };
    let view = App.pref('metaView', 'Default'); if (!views[view]) view = 'Default';
    const presets = App.conf('metadata_presets', {});
    const head = h('div', { class: 'md-head' },
      h('select', { title: 'Metadata view', onchange: e => { const v = e.target.value; if (v === '__custom') { MetaUI.customize(); e.target.value = view; } else { App.setPref('metaView', v); this.drawMeta(); } } }, Object.keys(views).map(n => h('option', { selected: n === view }, n)), h('option', { value: '__custom' }, 'Customize…')),
      h('select', { title: 'Apply a metadata preset to the selected photos', onchange: e => { const v = e.target.value; e.target.value = ''; if (v === '__edit') MetaUI.editPresets(); else if (presets[v]) MetaUI.applyPreset(presets[v], App.selIds()); } }, h('option', { value: '' }, 'Preset: None'), Object.keys(presets).map(n => h('option', {}, n)), h('option', { value: '__edit' }, 'Edit Presets…')));
    if (!ps.length) { this.mdB.replaceChildren(head, h('div', { class: 'empty small' }, 'No photo selected')); return; }
    const ids = ps.map(p => p.id);
    const rows = views[view].filter(k => META[k]).map(k => {
      const [label, get, edit] = META[k], vals = new Set(ps.map(p => String(get(p) ?? ''))), mixed = vals.size > 1, val = mixed ? '' : [...vals][0];
      let c;
      if (edit) {
        const save = v => { if (mixed && v === '') return; if (edit === 'iptc') App.setMeta(ids, { iptc: { [k]: v } }); else if (edit === 'gps') { const m = v.match(/(-?\d+(?:\.\d+)?)[,\s]+(-?\d+(?:\.\d+)?)/); App.setMeta(ids, { gps: m ? [+m[1], +m[2]] : null }); } else App.setMeta(ids, { [edit]: v }); };
        c = k === 'caption' || k === 'instructions' ? h('textarea', { rows: view === 'Large Caption' ? 8 : 2, value: val, placeholder: mixed ? '< mixed >' : '', onchange: e => save(e.target.value) })
          : h('input', { type: 'text', value: val, placeholder: mixed ? '< mixed >' : '', onchange: e => save(e.target.value), onkeydown: e => { if (e.key === 'Enter') e.target.blur(); } });
      } else c = h('span', { class: 'md-v', title: val }, mixed ? '< mixed >' : val);
      return h('div', { class: 'md-row' }, h('label', {}, label), c);
    });
    this.mdB.replaceChildren(head, ps.length > 1 ? h('div', { class: 'fnote' }, `Editing ${ps.length} photos — changes apply to all of them.`) : null, ...rows,
      h('div', { class: 'md-foot' }, h('button', { class: 'btn', onclick: () => App.run('meta.exif') }, 'All EXIF…'), h('button', { class: 'btn', onclick: () => App.run('meta.xmpwrite') }, 'Save to XMP')));
  },
};

const MetaUI = {
  applyPreset(pre, ids) { const { title, caption, ...iptc } = pre; App.setMeta(ids, { ...(title ? { title } : {}), ...(caption ? { caption } : {}), iptc }); UI.toast('Metadata preset applied to ' + ids.length + ' photo(s)'); },
  spec: [{ t: 'section', label: 'Basic' }, { k: 'title', label: 'Title' }, { k: 'caption', label: 'Caption', t: 'textarea' }, { t: 'section', label: 'IPTC' }, ...IPTC_FIELDS.map(([k, label]) => ({ k, label }))],
  /* Metadata presets (also offered in the Import dialog). */
  editPresets() {
    let cur = {};
    const host = h('div'), draw = () => host.replaceChildren(UI.form(this.spec, cur));
    draw();
    return UI.dialog({ title: 'Edit Metadata Presets', width: 560, body: h('div', {}, UI.presetBar('metadata_presets', () => Object.fromEntries(Object.entries(cur).filter(([, v]) => v)), p => { cur = p; draw(); }), h('div', { class: 'fnote' }, 'Only filled-in fields are written. Presets can be applied here, with the Painter, or automatically on import.'), host),
      buttons: [['Apply to Selected', () => { this.applyPreset(Object.fromEntries(Object.entries(cur).filter(([, v]) => v)), App.selIds()); }], ['Done', null, 'primary']] }).then(() => Panels.drawMeta());
  },
  /* Custom metadata views: choose and order the fields the Metadata panel shows. */
  customize() {
    const custom = App.conf('meta_views', {}); let name = App.pref('metaView', 'Default'), keys = [...({ ...META_VIEWS, ...custom }[name] || META_VIEWS.Default)];
    const list = h('div', { class: 'mv-list' });
    const draw = () => list.replaceChildren(...[...keys, ...Object.keys(META).filter(k => !keys.includes(k))].map(k => h('label', { class: 'fcheck', draggable: true, ondragstart: e => e.dataTransfer.setData('text/plain', k), ondragover: e => e.preventDefault(),
      ondrop: e => { const from = e.dataTransfer.getData('text/plain'); if (!keys.includes(from) || !keys.includes(k)) return; keys.splice(keys.indexOf(from), 1); keys.splice(keys.indexOf(k), 0, from); draw(); } },
      h('input', { type: 'checkbox', checked: keys.includes(k), onchange: e => { e.target.checked ? keys.push(k) : keys.splice(keys.indexOf(k), 1); draw(); } }), META[k][0], META[k][2] ? h('span', { class: 'dim' }, '  editable') : null)));
    draw();
    return UI.dialog({ title: 'Customize Metadata View', width: 460, body: h('div', {}, h('div', { class: 'fnote' }, 'Tick the fields to show; drag ticked fields to reorder. Save under a new name to create a custom view.'), list), buttons: [
      ['Delete View', () => { if (META_VIEWS[name]) { UI.toast('Built-in views cannot be deleted'); return false; } const c = { ...custom }; delete c[name]; App.setConf('meta_views', c); App.setPref('metaView', 'Default'); }],
      ['Cancel', null], ['Save View…', async () => { const n = await UI.prompt('Save Metadata View', 'View name', META_VIEWS[name] ? name + ' (custom)' : name); if (!n) return false; if (META_VIEWS[n]) { UI.toast('That name belongs to a built-in view'); return false; } App.setConf('meta_views', { ...App.conf('meta_views', {}), [n]: keys }); App.setPref('metaView', n); }, 'primary']] }).then(() => Panels.drawMeta());
  },
  async showExif() {
    const p = App.cur(); if (!p) return;
    const rows = await api('exif_full', { id: p.id });
    const tb = h('table', { class: 'tbl' }, h('tr', {}, h('th', {}, 'Group'), h('th', {}, 'Tag'), h('th', {}, 'Value')), rows.map(([g, t, v]) => h('tr', {}, h('td', { class: 'dim' }, g), h('td', {}, t), h('td', {}, v))));
    UI.dialog({ title: 'EXIF — ' + p.filename, width: 640, body: rows.length ? h('div', { class: 'scroll' }, tb) : h('p', { class: 'msg' }, 'This file carries no EXIF metadata.') });
  },
  async syncMeta() {
    const src = App.cur(), ids = App.selIds().filter(i => i !== src.id); if (!ids.length) return UI.toast('Select more photos; the active photo is the source');
    const flags = { title: true, caption: true, iptc: true, rating: false, label: false, gps: false, keywords: false };
    const ok = await UI.dialog({ title: 'Synchronize Metadata', width: 400, body: UI.form([['title', 'Title'], ['caption', 'Caption'], ['iptc', 'IPTC (creator, copyright, location…)'], ['rating', 'Rating'], ['label', 'Color label'], ['gps', 'GPS position'], ['keywords', 'Keywords']].map(([k, label]) => ({ k, label, t: 'check' })), flags), buttons: [['Cancel', null], ['Synchronize', true, 'primary']] });
    if (!ok) return;
    const f = {}; for (const k of ['title', 'caption', 'rating', 'label', 'gps']) if (flags[k]) f[k] = src[k];
    if (flags.iptc) f.iptc = src.iptc;
    await App.setMeta(ids, f);
    if (flags.keywords) await App.assignKeywords(ids, src.keywords);
    UI.toast('Metadata synchronized to ' + ids.length + ' photo(s)');
  },
};

const Collections = {
  newMenu(parent) { return [{ label: 'Create Collection…', run: () => this.create('collection', parent) }, { label: 'Create Smart Collection…', run: () => this.editSmart(null, parent) }, { label: 'Create Collection Set…', run: () => this.create('set', parent) }]; },
  menu(c) {
    return [...(c.type === 'set' ? this.newMenu(c.id) : []), c.type === 'set' ? '-' : null,
      c.type === 'collection' ? { label: 'Set as Target Collection', checked: App.cget('target', null) === c.id, run: () => { App.cset('target', App.cget('target', null) === c.id ? null : c.id); App.emit('collections'); App.emit('meta', App.list.map(p => p.id)); } } : null,
      c.type === 'collection' ? { label: 'Add Selected Photos', run: () => App.collectionToggle(c.id, App.selIds(), true) } : null,
      c.type === 'smart' ? { label: 'Edit Smart Collection…', run: () => this.editSmart(c) } : null,
      { label: 'Rename…', run: async () => { const n = await UI.prompt('Rename', 'Name', c.name); if (n) { await api('collection_update', { id: c.id, fields: { name: n } }); c.name = n; App.emit('collections'); } } },
      c.parent_id ? { label: 'Move to Top Level', run: () => this.move(c.id, null) } : null,
      { label: 'Move into Set', sub: () => [...App.collections.values()].filter(s => s.type === 'set' && s.id !== c.id).map(s => ({ label: s.name, run: () => this.move(c.id, s.id) })).concat([{ label: 'New Set…', run: async () => { const id = await this.create('set', null); if (id) this.move(c.id, id); } }]) },
      c.type !== 'set' ? { label: 'Export this Collection…', run: () => { App.setSource({ type: 'collection', id: c.id }); App.selectAll(); App.run('file.export'); } } : null,
      { label: 'Delete…', run: async () => { if (!(await UI.confirm('Delete ' + c.name, c.type === 'set' ? 'Delete this set and everything inside it? Photos stay in the catalog.' : 'Delete this collection? Photos stay in the catalog.', 'Delete'))) return; const gone = await api('collection_delete', { id: c.id }); gone.forEach(i => { App.collections.delete(i); App.colPhotos.delete(i); }); if (gone.includes(App.cget('target', null))) App.cset('target', null); if (App.source.type === 'collection' && gone.includes(App.source.id)) App.setSource({ type: 'all' }); App.emit('collections'); } }];
  },
  async create(type, parent, opts = {}) {
    const state = { name: opts.name || '', include: App.selection.size > 1, target: false, parent: parent ?? '' };
    const sets = [['', 'None (top level)'], ...[...App.collections.values()].filter(c => c.type === 'set').map(c => [c.id, c.name])];
    const ok = await UI.dialog({ title: type === 'set' ? 'Create Collection Set' : 'Create Collection', width: 420, body: UI.form([{ k: 'name', label: 'Name' }, { k: 'parent', label: 'Inside Set', t: 'select', opts: sets },
      ...(type === 'collection' ? [{ k: 'include', label: `Include selected photos (${App.selIds().length})`, t: 'check' }, { k: 'target', label: 'Set as target collection', t: 'check' }] : [])], state), buttons: [['Cancel', null], ['Create', () => !!state.name.trim(), 'primary']] });
    if (!ok) return null;
    const photo_ids = opts.ids || (state.include ? App.selIds() : []);
    const id = await api('collection_create', { name: state.name.trim(), type, parent_id: state.parent || null, photo_ids });
    App.collections.set(id, { id, name: state.name.trim(), type, parent_id: state.parent || null, rules: null });
    if (type === 'collection') App.colPhotos.set(id, [...photo_ids]);
    if (state.target) App.cset('target', id);
    if (state.parent) Panels.open.add('c:' + state.parent);
    App.emit('collections');
    return id;
  },
  async saveQuick() { const ids = App.cget('quick', []).filter(i => App.photos.has(i)); if (!ids.length) return UI.toast('The Quick Collection is empty'); await this.create('collection', null, { name: 'Quick Collection ' + new Date().toLocaleDateString(), ids }); },
  async move(id, parent) {
    let p = parent; while (p != null) { if (p === id) return UI.toast('A set cannot be moved inside itself'); p = App.collections.get(p)?.parent_id ?? null; }
    await api('collection_update', { id, fields: { parent_id: parent } }); App.collections.get(id).parent_id = parent; if (parent) Panels.open.add('c:' + parent); App.emit('collections');
  },
  /* Smart collections: rule editor. Rules are evaluated live against the local catalog. */
  async editSmart(c, parent) {
    const st = { name: c ? c.name : '', match: c?.rules?.match || 'all', rules: clone(c?.rules?.rules) || [{ field: 'rating', op: '>=', value: 3 }] };
    const list = h('div', { class: 'rules' }), count = h('span', { class: 'dim' });
    const typeOf = f => (RULE_FIELDS.find(r => r[0] === f) || [])[2] || 'text';
    const draw = () => {
      list.replaceChildren(...st.rules.map((r, i) => {
        const t = typeOf(r.field), ops = RULE_OPS[t]; if (!ops.includes(r.op)) r.op = ops[0];
        let val;
        if (t === 'bool' || r.op === 'empty' || r.op === 'not empty') val = h('span');
        else if (t === 'flag') { if (![1, 0, -1].includes(+r.value)) r.value = 1; val = h('select', { onchange: e => { r.value = [1, 0, -1][e.target.selectedIndex]; upd(); } }, ['flagged', 'unflagged', 'rejected'].map((l, k) => h('option', { selected: [1, 0, -1][k] === +r.value }, l))); }
        else if (t === 'label') { if (!LABELS[r.value]) r.value = 'red'; val = h('select', { onchange: e => { r.value = e.target.value; upd(); } }, Object.keys(LABELS).map(l => h('option', { selected: l === r.value }, l))); }
        else val = h('input', { type: t === 'num' || r.op === 'last days' ? 'number' : t === 'date' ? 'date' : 'text', step: 'any', value: r.value ?? '', oninput: e => { r.value = e.target.value; upd(); } });
        return h('div', { class: 'rule' },
          h('select', { onchange: e => { r.field = RULE_FIELDS[e.target.selectedIndex][0]; r.value = ''; draw(); } }, RULE_FIELDS.map(([k, l]) => h('option', { selected: k === r.field }, l))),
          h('select', { onchange: e => { r.op = ops[e.target.selectedIndex]; draw(); } }, ops.map(o => h('option', { selected: o === r.op }, OP_NAMES[o]))), val,
          h('button', { class: 'btn', title: 'Remove rule', onclick: () => { st.rules.splice(i, 1); draw(); } }, '−'), h('button', { class: 'btn', title: 'Add rule', onclick: () => { st.rules.splice(i + 1, 0, { field: 'keywords', op: 'contains', value: '' }); draw(); } }, '+'));
      }), st.rules.length ? null : h('button', { class: 'btn', onclick: () => { st.rules.push({ field: 'rating', op: '>=', value: 1 }); draw(); } }, 'Add a rule'));
      upd();
    };
    const upd = () => { count.textContent = [...App.photos.values()].filter(p => App.matchRules(p, st)).length + ' photos match right now'; };
    const nameI = h('input', { type: 'text', value: st.name, placeholder: 'Smart Collection', oninput: e => { st.name = e.target.value; } });
    draw();
    const ok = await UI.dialog({ title: c ? 'Edit Smart Collection' : 'Create Smart Collection', width: 640, body: h('div', {}, h('label', { class: 'frow' }, h('span', {}, 'Name'), nameI),
      h('div', { class: 'frow' }, h('span', {}, 'Match'), h('select', { onchange: e => { st.match = e.target.value; upd(); } }, h('option', { value: 'all', selected: st.match === 'all' }, 'all of the following rules'), h('option', { value: 'any', selected: st.match === 'any' }, 'any of the following rules'))), list, count),
      buttons: [['Cancel', null], [c ? 'Save' : 'Create', () => !!st.name.trim(), 'primary']] });
    if (!ok) return;
    const rules = { match: st.match, rules: st.rules };
    if (c) { await api('collection_update', { id: c.id, fields: { name: st.name.trim(), rules } }); c.name = st.name.trim(); c.rules = rules; }
    else { const id = await api('collection_create', { name: st.name.trim(), type: 'smart', parent_id: parent ?? null, rules }); App.collections.set(id, { id, name: st.name.trim(), type: 'smart', parent_id: parent ?? null, rules }); }
    App.emit('collections'); if (App.source.type === 'collection') App.refreshList(true);
  },
};

const Keywords = {
  setName() { return App.pref('keywordSet', 'Recent Keywords'); },
  sets() { return { ...KEYWORD_SETS, ...App.conf('keyword_sets', {}) }; },
  current() { const n = this.setName(); if (n === 'Recent Keywords') return (App.cget('recent_keywords', []).map(i => App.keywords.get(i)?.name).filter(Boolean)).slice(0, 9); return this.sets()[n] || []; },
  async toggle(name, ids) {
    ids = ids || App.selIds(); if (!ids.length || !name) return;
    const kw = [...App.keywords.values()].find(k => k.name.toLowerCase() === name.split('>').pop().trim().toLowerCase());
    const has = kw && ids.every(i => App.photo(i).keywords.includes(kw.id));
    await App.assignKeywords(ids, has ? [kw.id] : [name], has);
    const id = kw?.id || [...App.keywords.values()].find(k => k.name.toLowerCase() === name.split('>').pop().trim().toLowerCase())?.id;
    if (id && !has) App.cset('recent_keywords', [id, ...App.cget('recent_keywords', []).filter(x => x !== id)].slice(0, 9));
  },
  drawTags() {
    const ps = App.selected().length ? App.selected() : (App.cur() ? [App.cur()] : []), ids = ps.map(p => p.id), el = Panels.kwB;
    if (!ps.length) { el.replaceChildren(h('div', { class: 'empty small' }, 'No photo selected')); return; }
    const count = new Map(); ps.forEach(p => p.keywords.forEach(k => count.set(k, (count.get(k) || 0) + 1)));
    const names = [...count.keys()].map(k => ({ id: k, name: App.keywords.get(k)?.name, all: count.get(k) === ps.length })).filter(k => k.name).sort((a, b) => a.name.localeCompare(b.name));
    const ta = h('textarea', { rows: 3, value: names.map(k => k.name + (k.all ? '' : '*')).join(', '), title: 'Keyword tags. Edit and press Enter. * = only on some selected photos.',
      onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); ta.blur(); } },
      onchange: async () => {
        const want = ta.value.split(',').map(s => s.trim()).filter(Boolean), keepPartial = new Set(want.filter(w => w.endsWith('*')).map(w => w.slice(0, -1).toLowerCase())), full = want.filter(w => !w.endsWith('*'));
        const fullL = new Set(full.map(w => w.split('>').pop().trim().toLowerCase()));
        const remove = names.filter(k => !fullL.has(k.name.toLowerCase()) && !keepPartial.has(k.name.toLowerCase())).map(k => k.id);
        if (remove.length) await App.assignKeywords(ids, remove, true);
        const add = full.filter(w => !names.some(k => k.all && k.name.toLowerCase() === w.split('>').pop().trim().toLowerCase()));
        if (add.length) await App.assignKeywords(ids, add);
      } });
    const dl = h('datalist', { id: 'kw-dl' }, [...App.keywords.values()].map(k => h('option', { value: k.name })));
    const add = h('input', { type: 'text', list: 'kw-dl', placeholder: 'Click here to add keywords  (Parent > Child)', onkeydown: async e => { if (e.key === 'Enter' && add.value.trim()) { e.preventDefault(); const v = add.value.split(',').map(s => s.trim()).filter(Boolean); add.value = ''; await App.assignKeywords(ids, v); } } });
    // suggestions: keywords on photos shot close in time, most frequent first
    const t0 = ps[0].capture_time, sug = new Map();
    for (const q of App.photos.values()) if (Math.abs(q.capture_time - t0) < 3 * 3600 && !ids.includes(q.id)) q.keywords.forEach(k => { if (!count.has(k)) sug.set(k, (sug.get(k) || 0) + 1); });
    const sugs = [...sug.entries()].sort((a, b) => b[1] - a[1]).slice(0, 9).map(([k]) => App.keywords.get(k)?.name).filter(Boolean);
    const setNames = ['Recent Keywords', ...Object.keys(this.sets())], cur = this.current();
    const grid = (list, alt) => h('div', { class: 'kw-grid' }, Array.from({ length: 9 }, (_, i) => { const n = list[i]; const on = n && names.some(k => k.all && k.name.toLowerCase() === n.toLowerCase()); return h('button', { class: 'btn kw' + (on ? ' on' : ''), disabled: !n, title: n ? (alt ? `Alt+${i + 1}` : n) : '', onclick: () => this.toggle(n, ids) }, n || ''); }));
    el.replaceChildren(h('div', { class: 'sub' }, 'Keyword Tags'), ta, add, dl, sugs.length ? h('div', { class: 'sub' }, 'Keyword Suggestions') : null, sugs.length ? grid(sugs) : null,
      h('div', { class: 'sub row' }, 'Keyword Set', h('select', { onchange: e => { const v = e.target.value; if (v === '__edit') { this.editSets(); } else { App.setPref('keywordSet', v); this.drawTags(); } } }, setNames.map(n => h('option', { selected: n === this.setName() }, n)), h('option', { value: '__edit' }, 'Edit Set…'))), grid(cur, true));
  },
  /* Keyword sets: nine keywords each, on Alt+1..9. */
  editSets() {
    const cur = this.setName(), vals = [...(this.sets()[cur] || this.current())]; while (vals.length < 9) vals.push('');
    const obj = Object.fromEntries(vals.map((v, i) => ['k' + i, v]));
    const host = h('div');
    const draw = () => host.replaceChildren(h('div', { class: 'kw-edit' }, Array.from({ length: 9 }, (_, i) => h('label', {}, h('span', { class: 'dim' }, 'Alt+' + (i + 1)), h('input', { type: 'text', list: 'kw-dl', value: obj['k' + i], oninput: e => { obj['k' + i] = e.target.value; } })))));
    draw();
    return UI.dialog({ title: 'Edit Keyword Set', width: 520, body: h('div', {}, UI.presetBar('keyword_sets', () => Array.from({ length: 9 }, (_, i) => obj['k' + i].trim()), (p, n) => { p.forEach((v, i) => { obj['k' + i] = v || ''; }); App.setPref('keywordSet', n); draw(); }, KEYWORD_SETS), host,
      h('div', { class: 'fnote' }, 'Save under a name to create or update a set. The active set appears in the Keywording panel.')) }).then(() => { if (!this.sets()[this.setName()] && this.setName() !== 'Recent Keywords') App.setPref('keywordSet', 'Recent Keywords'); this.drawTags(); });
  },
  drawList() {
    const el = Panels.klB, ps = App.selected().length ? App.selected() : (App.cur() ? [App.cur()] : []), filt = Panels.kwFilter.toLowerCase();
    const counts = new Map(); for (const p of App.photos.values()) p.keywords.forEach(k => counts.set(k, (counts.get(k) || 0) + 1));
    const matches = id => !filt || App.kwTree(id).some(k => App.keywords.get(k).name.toLowerCase().includes(filt) || (App.keywords.get(k).synonyms || '').toLowerCase().includes(filt));
    const out = [];
    const walk = (k, depth) => {
      if (!matches(k.id)) return;
      const kids = App.kwKids(k.id), key = 'k:' + k.id, open = !!filt || Panels.open.has(key), n = ps.filter(p => p.keywords.includes(k.id)).length, state = !ps.length || !n ? '' : n === ps.length ? 'all' : 'some';
      const toggle = () => { Panels.tog(key); this.drawList(); };
      const box = h('b', { class: 'kcheck ' + state, title: 'Assign / remove for the selected photos', onclick: e => { e.stopPropagation(); if (ps.length) App.assignKeywords(ps.map(p => p.id), [k.id], state === 'all'); } }, state === 'all' ? '✓' : state === 'some' ? '–' : '');
      const el2 = Panels.row(depth, { label: k.name + (k.export ? '' : ' ⊘'), count: counts.get(k.id) || 0, tw: kids.length ? open : undefined, on: srcIs({ type: 'keyword', id: k.id }), title: App.kwPath(k.id).join(' > ') + (k.synonyms ? '\nSynonyms: ' + k.synonyms : ''),
        extra: h('a', { class: 'go', title: 'Show photos with this keyword', onclick: e => { e.stopPropagation(); App.setSource({ type: 'keyword', id: k.id }); } }, '→'), onclick: () => { if (ps.length) App.assignKeywords(ps.map(p => p.id), [k.id], state === 'all'); },
        oncontext: e => UI.menu(e.clientX, e.clientY, [{ label: `Create Keyword Tag inside "${k.name}"…`, run: () => this.create(k.id) }, { label: 'Edit Keyword Tag…', run: () => this.edit(k) }, { label: 'Assign to Selected Photos', run: () => App.assignKeywords(App.selIds(), [k.id]) },
          { label: 'Remove from Selected Photos', run: () => App.assignKeywords(App.selIds(), [k.id], true) }, { label: 'Use with Painter', run: () => { Painter.mode = 'keywords'; Painter.value.keywords = App.kwPath(k.id).join(' > '); Lib.setView('grid'); Painter.toggle(true); } },
          k.parent_id ? { label: 'Move to Top Level', run: () => this.move(k.id, null) } : null, '-', { label: 'Delete…', run: () => this.remove(k) }]) });
      el2.firstChild.after(box);
      if (kids.length) el2.querySelector('.tw').onclick = e => { e.stopPropagation(); toggle(); };
      el2.draggable = true; el2.ondragstart = e => e.dataTransfer.setData('text/opia-kw', String(k.id));
      dropPhotos(el2, ids => App.assignKeywords(ids, [k.id]));
      el2.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('text/opia-kw')) { e.preventDefault(); el2.classList.add('drop'); } });
      el2.addEventListener('drop', e => { const id = +e.dataTransfer.getData('text/opia-kw'); if (id && id !== k.id) this.move(id, k.id); });
      out.push(el2);
      if (open) kids.forEach(c => walk(c, depth + 1));
    };
    App.kwKids(null).forEach(k => walk(k, 0));
    const fi = h('input', { type: 'search', placeholder: 'Filter keywords', value: Panels.kwFilter, oninput: () => { Panels.kwFilter = fi.value; this.drawList(); const n = Panels.klB.querySelector('input'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); } });
    el.replaceChildren(fi, ...(out.length ? out : [h('div', { class: 'empty small' }, App.keywords.size ? 'No keyword matches' : 'No keywords yet. Add some in Keywording, or click + here.')]));
  },
  async create(parent) {
    const st = { name: '', synonyms: '', export: true, assign: false, parent: parent ?? '' };
    const opts = [['', 'None (top level)'], ...[...App.keywords.values()].map(k => [k.id, App.kwPath(k.id).join(' > ')]).sort((a, b) => a[1].localeCompare(b[1]))];
    const ok = await UI.dialog({ title: 'Create Keyword Tag', width: 440, body: UI.form([{ k: 'name', label: 'Keyword Name', ph: 'e.g. Birds   or   Nature > Birds > Owl' }, { k: 'synonyms', label: 'Synonyms', ph: 'comma separated' }, { k: 'parent', label: 'Put inside', t: 'select', opts },
      { k: 'export', label: 'Include on export', t: 'check' }, { k: 'assign', label: 'Add to selected photos', t: 'check' }], st), buttons: [['Cancel', null], ['Create', () => !!st.name.trim(), 'primary']] });
    if (!ok) return;
    const before = new Set(App.keywords.keys());
    const rows = await api('keyword_create', { name: st.name.trim(), parent_id: st.parent || null, synonyms: st.synonyms, export: st.export ? 1 : 0 });
    App.setKeywords(rows);
    if (st.parent) Panels.open.add('k:' + st.parent);
    if (st.assign) { const added = rows.filter(k => !before.has(k.id)).map(k => k.id); if (added.length) await App.assignKeywords(App.selIds(), [added[added.length - 1]]); }
  },
  async edit(k) {
    const st = { name: k.name, synonyms: k.synonyms || '', export: !!k.export };
    const ok = await UI.dialog({ title: 'Edit Keyword Tag', width: 420, body: UI.form([{ k: 'name', label: 'Keyword Name' }, { k: 'synonyms', label: 'Synonyms' }, { k: 'export', label: 'Include on export', t: 'check' }], st), buttons: [['Cancel', null], ['Save', () => !!st.name.trim(), 'primary']] });
    if (ok) App.setKeywords(await api('keyword_update', { id: k.id, fields: { name: st.name.trim(), synonyms: st.synonyms, export: st.export ? 1 : 0 } }));
  },
  async move(id, parent) { App.setKeywords(await api('keyword_update', { id, fields: { parent_id: parent } })); if (parent) Panels.open.add('k:' + parent); this.drawList(); },
  async remove(k) {
    const n = App.kwTree(k.id).length - 1;
    if (!(await UI.confirm('Delete Keyword', `Delete "${k.name}"${n ? ' and its ' + n + ' child keyword(s)' : ''}? It is removed from every photo.`, 'Delete'))) return;
    const gone = new Set(await api('keyword_delete', { id: k.id }));
    for (const p of App.photos.values()) p.keywords = p.keywords.filter(x => !gone.has(x));
    gone.forEach(i => App.keywords.delete(i));
    if (App.source.type === 'keyword' && gone.has(App.source.id)) App.setSource({ type: 'all' });
    App.emit('keywords');
  },
};

/* People view: faces found and recognised locally, grouped into named and unnamed people. */
const People = {
  set(d) { App.people = d.people; App.faces = d.faces; },
  async scan(selectedOnly) {
    if (!App.boot.faces) return UI.alert('Face models missing', 'The face detection models were not found in the app\'s models folder.');
    const ids = (selectedOnly ? App.selected() : App.sourceIds()).map(p => p.master_id || p.id);
    if (!ids.length) return;
    const r = await runJob(api('faces_scan', { ids: [...new Set(ids)], rescan: !!selectedOnly }), 'Finding faces');
    this.set(r); UI.toast(`${r.found} new face(s) found in ${r.scanned} photo(s)`); Lib.refreshView();
  },
  async name(faceIds, name) { this.set(await api('face_name', { face_ids: faceIds, name })); Lib.refreshView(); },
  card(faces, title, opts = {}) {
    const f = faces[0], inp = h('input', { type: 'text', list: 'ppl-dl', placeholder: opts.suggest ? opts.suggest + '?' : 'Add name', value: opts.name || '', onkeydown: e => { if (e.key === 'Enter') inp.blur(); e.stopPropagation(); },
      onchange: async () => { const v = inp.value.trim(); if (!v) return; if (opts.person) this.set(await api('person_update', { id: opts.person, name: v })); else await this.name(faces.map(x => x.id), v); Lib.refreshView(); } });
    return h('div', { class: 'pcard', ondblclick: () => { if (opts.person) { App.setSource({ type: 'person', id: opts.person }); Lib.setView('grid'); } else { App.setSource({ type: 'ids', ids: [...new Set(faces.map(x => x.photo_id))], name: 'Unnamed person' }); Lib.setView('grid'); } },
      oncontextmenu: e => { e.preventDefault(); UI.menu(e.clientX, e.clientY, [{ label: 'Show Photos', run: () => { App.setSource({ type: 'ids', ids: [...new Set(faces.map(x => x.photo_id))], name: opts.name || 'Unnamed person' }); Lib.setView('grid'); } },
        opts.suggest ? { label: `Confirm as ${opts.suggest}`, run: () => this.name(faces.map(x => x.id), opts.suggest) } : null,
        opts.person ? { label: 'Remove Name (keep faces)', run: async () => { this.set(await api('person_update', { id: opts.person, delete: true })); Lib.refreshView(); } } : null,
        { label: 'Not a Face / Remove', run: async () => { this.set(await api('face_delete', { face_ids: faces.map(x => x.id) })); Lib.refreshView(); } }]); } },
      h('div', { class: 'pfaces' }, faces.slice(0, 4).map(x => h('img', { src: '/img/face/' + x.id + '?v=1', draggable: false }))), h('div', { class: 'pmeta' }, inp, h('span', { class: 'dim' }, faces.length + (faces.length === 1 ? ' face' : ' faces'))),
      opts.suggest ? h('div', { class: 'psug' }, h('button', { class: 'btn', onclick: () => this.name(faces.map(x => x.id), opts.suggest) }, '✓ ' + opts.suggest), h('button', { class: 'btn', title: 'Not this person', onclick: () => { inp.focus(); } }, '✕')) : null, void f);
  },
  draw(el) {
    const inSrc = new Set(App.sourceIds().map(p => p.master_id || p.id)), faces = App.faces.filter(f => inSrc.has(f.photo_id));
    const named = new Map(), unnamed = new Map();
    for (const f of faces) { if (f.person_id) (named.get(f.person_id) || named.set(f.person_id, []).get(f.person_id)).push(f); else (unnamed.get(f.cluster ?? 'x' + f.id) || unnamed.set(f.cluster ?? 'x' + f.id, []).get(f.cluster ?? 'x' + f.id)).push(f); }
    const pn = id => App.people.find(p => p.id === id)?.name || '';
    const nCards = [...named.entries()].sort((a, b) => pn(a[0]).localeCompare(pn(b[0]))).map(([pid, fs]) => this.card(fs, pn(pid), { person: pid, name: pn(pid) }));
    const uCards = [...unnamed.entries()].sort((a, b) => b[1].length - a[1].length).map(([cl, fs]) => this.card(fs, '', { suggest: typeof cl === 'number' && cl < 0 ? pn(-cl) : '' }));
    el.replaceChildren(h('datalist', { id: 'ppl-dl' }, App.people.map(p => h('option', { value: p.name }))),
      h('div', { class: 'psec' }, `Named People (${nCards.length})`), h('div', { class: 'pgrid' }, nCards.length ? nCards : h('div', { class: 'empty small' }, 'Name a face below and it appears here. Double-click a person to see their photos.')),
      h('div', { class: 'psec' }, `Unnamed People (${uCards.length})`), h('div', { class: 'pgrid' }, uCards.length ? uCards : h('div', { class: 'empty' }, faces.length ? 'Everyone is named.' : 'No faces indexed for these photos yet. Click "Find Faces" in the toolbar to scan them on this computer.')));
  },
};

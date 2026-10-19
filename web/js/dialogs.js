'use strict';
/* Import, catalog management (multiple catalogs, backup, optimise), preferences, plug-in manager, tethered capture. */

const Import = {
  async finish(r, quiet) {
    App.addPhotos(r.photos); if (r.batch) App.lastBatch = r.batch;
    // camera calibration defaults for matching cameras
    const items = []; for (const p of r.photos) { if (p.develop) continue; const d = Ext.cameraDefault(p); if (d) { p.develop = d; items.push({ id: p.id, develop: d }); } }
    if (items.length) await api('photos_develop', { items });
    App.setKeywords(await api('keywords_list'));
    if (r.photos.length) App.setSource({ type: 'prev' }); else App.refreshList();
    Panels.refreshAll();
    Render.thumbs(r.photos.filter(p => App.isEdited(p)).map(p => p.id));
    if (!quiet) UI.toast(`${r.ids.length} photo(s) imported` + (r.skipped ? `, ${r.skipped} already in the catalog` : '') + (r.errors.length ? `, ${r.errors.length} failed: ${r.errors[0]}` : ''), r.errors.length ? 'error' : '');
  },
  /* catalog a folder where it is; no files are copied or moved */
  async addFolder(path) {
    if (!path) return;
    const files = (await api('import_scan', { path, recursive: true })).filter(f => !f.known);
    if (!files.length) { UI.toast('No new photos found in ' + path); if ([...App.photos.values()].some(p => p.folder.toLowerCase().startsWith(path.toLowerCase()))) App.setSource({ type: 'folder', path }); return; }
    const pre = App.conf('import_preset', ''), develop = Dev.presets()[pre] || null;
    const r = await runJob(api('import_run', { files: files.map(f => f.path), mode: 'add', develop }), 'Adding folder');
    await this.finish(r); App.setSource({ type: 'folder', path: path.replace(/[\\/]$/, '') });
  },
  async sync(path) { const files = (await api('import_scan', { path, recursive: true })).filter(f => !f.known); if (!files.length) return UI.toast('The folder is already in sync with the catalog'); if (await UI.confirm('Synchronize Folder', `${files.length} new photo(s) found in this folder. Import them?`, 'Import')) await this.finish(await runJob(api('import_run', { files: files.map(f => f.path), mode: 'add' }), 'Synchronizing')); },
  async open(start) {
    const st = { path: start || App.conf('import_last', App.boot.pictures), recursive: true, mode: 'add', dest: App.conf('import_dest', App.boot.pictures), subfolder: '%Y/%Y-%m-%d', rename: false, template: '{name}', custom: '', start: 1, preset: '', develop: App.conf('import_preset', ''), keywords: '', smart: false, newOnly: true };
    let files = [], picked = new Set();
    const grid = h('div', { class: 'imp-grid' }), count = h('span', { class: 'dim' }), pathI = h('input', { type: 'text', value: st.path, onchange: () => { st.path = pathI.value; scan(); }, onkeydown: e => { if (e.key === 'Enter') { e.stopPropagation(); st.path = pathI.value; scan(); } } });
    const upd = () => { count.textContent = `${picked.size} of ${files.length} photos selected` + (files.some(f => f.known) ? `  \u2022  ${files.filter(f => f.known).length} already in catalog` : ''); };
    const paint = () => { const show = files.filter(f => !st.newOnly || !f.known).slice(0, 800);
      grid.replaceChildren(...(show.length ? show.map(f => { const cb = h('input', { type: 'checkbox', checked: picked.has(f.path), disabled: f.known && st.mode === 'add', onchange: () => { cb.checked ? picked.add(f.path) : picked.delete(f.path); upd(); } });
        return h('label', { class: 'imp-cell' + (f.known ? ' known' : ''), title: f.path }, h('img', { loading: 'lazy', src: '/img/disk?size=220&v=1&path=' + encodeURIComponent(f.path) }), h('span', {}, cb, f.name)); }) : [h('div', { class: 'empty' }, files.length ? 'Every photo here is already in the catalog.' : 'No photos found in this folder.')])); upd(); };
    const scan = async () => { grid.replaceChildren(h('div', { class: 'empty' }, 'Reading folder\u2026')); try { files = await api('import_scan', { path: st.path, recursive: st.recursive }); } catch (e) { files = []; UI.error(e); } picked = new Set(files.filter(f => !f.known).map(f => f.path)); paint(); };
    const modes = h('div', { class: 'seg big' }, [['add', 'Add', 'Add photos to the catalog without moving them'], ['copy', 'Copy', 'Copy photos to a new location and add them'], ['move', 'Move', 'Move photos to a new location and add them']].map(([m, l, t]) => h('a', { title: t, data: { m }, onclick: () => { st.mode = m; drawSide(); paint(); } }, l)));
    const side = h('div', { class: 'imp-side' });
    const drawSide = () => { $$('a', modes).forEach(a => a.classList.toggle('on', a.dataset.m === st.mode)); const moving = o => o.mode !== 'add';
      side.replaceChildren(UI.form([{ t: 'section', label: 'File Handling' }, { k: 'smart', label: 'Build Smart Previews', t: 'check' }, { k: 'newOnly', label: "Don't show photos already in the catalog", t: 'check' },
        { t: 'section', label: 'File Renaming', show: moving }, { k: 'rename', label: 'Rename Files', t: 'check', show: moving }, { t: 'custom', show: o => moving(o) && o.rename, el: o => h('label', { class: 'frow' }, h('span', {}, 'Template'), Naming.select(o, 'template')) }, { k: 'custom', label: 'Custom Text', show: o => moving(o) && o.rename }, { k: 'start', label: 'Start Number', t: 'number', show: o => moving(o) && o.rename },
        { t: 'section', label: 'Apply During Import' }, { k: 'develop', label: 'Develop Settings', t: 'select', opts: [['', 'None'], ...Object.keys(Dev.presets()).map(n => [n, n])] },
        { k: 'preset', label: 'Metadata', t: 'select', opts: [['', 'None'], ...Object.keys(App.conf('metadata_presets', {})).map(n => [n, n])] }, { t: 'button', label: 'Edit Metadata Presets\u2026', run: async (o, re) => { await MetaUI.editPresets(); re(); } }, { k: 'keywords', label: 'Keywords', t: 'textarea', ph: 'comma separated;  Parent > Child for hierarchy' },
        { t: 'section', label: 'Destination', show: moving }, { k: 'dest', label: 'Folder', t: 'folder', show: moving }, { k: 'subfolder', label: 'Organize', t: 'select', show: moving, opts: [['', 'Into one folder'], ['%Y/%Y-%m-%d', 'By date: 2026/2026-10-10'], ['%Y/%m', 'By date: 2026/10'], ['%Y-%m-%d', 'By date: 2026-10-10'], ['%Y/%B %d', 'By date: 2026/October 10']] }], st, k => { if (k === 'newOnly') paint(); })); };
    drawSide(); scan();
    const ok = await UI.dialog({ title: 'Import Photos', width: 1080, body: h('div', { class: 'imp' }, h('div', { class: 'imp-main' }, h('div', { class: 'imp-top' }, h('span', { class: 'dim' }, 'From'), pathI, h('button', { class: 'btn', onclick: async () => { const p = await UI.pickFolder(st.path); if (p) { st.path = p; pathI.value = p; scan(); } } }, 'Browse\u2026'),
      h('label', { class: 'tb-check' }, h('input', { type: 'checkbox', checked: st.recursive, onchange: e => { st.recursive = e.target.checked; scan(); } }), 'Include Subfolders'), modes), grid,
      h('div', { class: 'imp-top' }, h('button', { class: 'btn', onclick: () => { picked = new Set(files.filter(f => !(f.known && st.mode === 'add')).map(f => f.path)); paint(); } }, 'Check All'), h('button', { class: 'btn', onclick: () => { picked.clear(); paint(); } }, 'Uncheck All'), count)), side),
      buttons: [['Cancel', null], ['Import', () => picked.size > 0 || (UI.toast('Tick at least one photo'), false), 'primary']] });
    if (!ok) return;
    App.setConf('import_last', st.path); if (st.mode !== 'add') App.setConf('import_dest', st.dest);
    const r = await runJob(api('import_run', { files: [...picked], mode: st.mode, dest: st.dest, subfolder: st.subfolder, template: st.rename ? st.template : null, custom: st.custom, start: st.start, preset: App.conf('metadata_presets', {})[st.preset] || null,
      develop: Dev.presets()[st.develop] || null, keywords: st.keywords.split(',').map(s => s.trim()).filter(Boolean), smart: st.smart }), 'Importing');
    await this.finish(r);
  },
};

const Catalogs = {
  async switchTo(path) { Dev.flushThumb(); await api('catalog_open', { path }); GLR.sources.clear(); Render.urls.clear(); await App.loadCatalog(); UI.toast('Opened catalog ' + App.info.name); },
  async create() {
    const st = { name: '', dir: App.boot.home };
    const ok = await UI.dialog({ title: 'New Catalog', width: 480, body: h('div', {}, UI.form([{ k: 'name', label: 'Catalog Name', ph: 'e.g. Weddings 2026' }, { k: 'dir', label: 'Location', t: 'folder' }], st), h('div', { class: 'fnote' }, 'Creates <Name>\\<Name>.opiacat with its own previews, Smart Previews and backups folders beside it.')), buttons: [['Cancel', null], ['Create', () => !!st.name.trim(), 'primary']] });
    if (!ok) return; Dev.flushThumb(); await api('catalog_create', { name: st.name.trim(), dir: st.dir }); GLR.sources.clear(); Render.urls.clear(); await App.loadCatalog(); UI.toast('Created catalog ' + App.info.name);
  },
  async backup() { const r = await api('catalog_backup', {}); App.info.last_backup = Date.now() / 1000; UI.toast(`Catalog backed up (${fmt.bytes(r.size)}): ${r.path}`); return r; },
  async optimize() { const r = await api('catalog_optimize'); UI.alert('Catalog Optimized', `Integrity check: ${r.integrity}\nSize: ${fmt.bytes(r.before)} \u2192 ${fmt.bytes(r.after)}\nOrphaned preview files removed: ${r.purged}`); },
  /* Catalog Settings: switch / create catalogs, backups, optimisation */
  async manage(tab = 'catalogs') {
    const body = h('div', { class: 'tabs-body' }), tabs = h('div', { class: 'seg big' });
    const draw = async () => {
      $$('a', tabs).forEach(a => a.classList.toggle('on', a.dataset.t === tab));
      const info = await api('catalog_info');
      if (tab === 'catalogs') { const list = await api('catalog_list');
        body.replaceChildren(h('div', { class: 'fnote' }, 'Each catalog is an independent .opiacat database with its own photos, keywords, collections and edits. Only one is open at a time.'),
          h('table', { class: 'tbl' }, h('tr', {}, h('th', {}, 'Catalog'), h('th', {}, 'Location'), h('th', {}, 'Size'), h('th', {}, 'Modified'), h('th')), list.map(c => h('tr', { class: c.current ? 'cur' : '' }, h('td', {}, h('b', {}, c.name)), h('td', { class: 'dim small', title: c.path }, c.path), h('td', {}, fmt.bytes(c.size)), h('td', {}, fmt.date(c.mtime)),
            h('td', {}, c.current ? h('span', { class: 'dim' }, 'Open') : h('button', { class: 'btn', onclick: async () => { await this.switchTo(c.path); draw(); } }, 'Open'))))),
          h('div', { class: 'dlg-inline' }, h('button', { class: 'btn', onclick: async () => { await this.create(); draw(); } }, 'New Catalog\u2026'), h('button', { class: 'btn', onclick: async () => { const f = await UI.pickFile(App.boot.home, ['.opiacat', '.lrcat']); if (f) { await this.switchTo(f); draw(); } } }, 'Open Other Catalog\u2026'), h('button', { class: 'btn', onclick: () => api('fs_reveal', { path: info.path }) }, 'Show in Finder')));
      } else if (tab === 'backup') { const list = await api('catalog_backups'), prefs = { backupEvery: App.pref('backupEvery', 'week'), backup_dir: App.conf('backup_dir', '') };
        body.replaceChildren(UI.form([{ k: 'backupEvery', label: 'Back Up Catalog', t: 'select', opts: [['never', 'Never'], ['month', 'Once a month, when exiting'], ['week', 'Once a week, when exiting'], ['day', 'Once a day, when exiting'], ['exit', 'Every time Opia exits']] }, { k: 'backup_dir', label: 'Backup Folder', t: 'folder', ph: info.dir + '\\Backups' }], prefs, k => { if (k === 'backupEvery') App.setPref('backupEvery', prefs.backupEvery); else App.setConf('backup_dir', prefs.backup_dir); }),
          h('div', { class: 'fnote' }, `Last backup: ${info.last_backup ? fmt.datetime(info.last_backup) : 'never'}. Backups hold the catalog database (zipped, integrity-tested), not your photo files.`),
          h('div', { class: 'dlg-inline' }, h('button', { class: 'btn primary', onclick: async () => { await this.backup(); draw(); } }, 'Back Up Now')),
          h('div', { class: 'sub' }, 'Existing Backups'), list.length ? h('table', { class: 'tbl' }, list.map(b => h('tr', {}, h('td', {}, b.name), h('td', {}, fmt.bytes(b.size)), h('td', { class: 'dim small', title: b.path }, b.path),
            h('td', {}, h('button', { class: 'btn', title: 'Unpacks the backup as a new catalog beside this one and opens it; the current catalog is left untouched', onclick: async () => { if (await UI.confirm('Restore Backup', `Restore the backup from ${b.name} as a separate catalog and open it?`, 'Restore')) { await api('catalog_restore', { path: b.path }); await App.loadCatalog(); draw(); } } }, 'Restore'))))) : h('div', { class: 'empty small' }, 'No backups yet'));
      } else { body.replaceChildren(h('table', { class: 'tbl' }, [['Name', info.name], ['Location', info.path], ['Size', fmt.bytes(info.size)], ['Photos', info.count], ['Last Backup', info.last_backup ? fmt.datetime(info.last_backup) : 'never'], ['Last Optimized', info.last_optimize ? fmt.datetime(info.last_optimize) : 'never']].map(([k, v]) => h('tr', {}, h('td', { class: 'dim' }, k), h('td', {}, String(v))))),
        h('div', { class: 'fnote' }, 'Optimizing checks the database for corruption, removes orphaned records and preview files, and compacts and re-indexes the catalog. Run it when the catalog feels slow or after removing many photos.'),
        h('div', { class: 'dlg-inline' }, h('button', { class: 'btn primary', onclick: async () => { await this.optimize(); draw(); } }, 'Optimize Catalog'), h('button', { class: 'btn', onclick: async () => { const ids = [...App.photos.values()].filter(p => !p.master_id && !p.smart && !p.missing).map(p => p.id); if (ids.length) { await runJob(api('smart_previews_build', { ids }), 'Building Smart Previews'); await App.loadCatalog(); } draw(); } }, 'Build All Smart Previews'))); }
    };
    tabs.append(...[['catalogs', 'Catalogs'], ['backup', 'Backup'], ['general', 'Optimize & Info']].map(([t, l]) => h('a', { data: { t }, onclick: () => { tab = t; draw(); } }, l)));
    await draw();
    return UI.dialog({ title: 'Catalog Settings', width: 780, body: h('div', {}, tabs, body) });
  },
};

const Prefs = {
  async open(tab = 'general') {
    const body = h('div', { class: 'tabs-body' }), tabs = h('div', { class: 'seg big' }), P = new Proxy({}, { get: (_, k) => App.pref(k, { autoAdvance: false, autoXmp: false, loupeInfo: true, mapTiles: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', dngConverter: '' }[k]), set: (_, k, v) => { App.setPref(k, v); return true; } });
    const draw = async () => {
      $$('a', tabs).forEach(a => a.classList.toggle('on', a.dataset.t === tab));
      if (tab === 'general') body.replaceChildren(UI.form([{ t: 'section', label: 'Library' }, { k: 'autoAdvance', label: 'Auto-advance to the next photo after rating, flagging or labelling', t: 'check' }, { k: 'loupeInfo', label: 'Show info overlay in Loupe view', t: 'check' },
        { t: 'section', label: 'Metadata' }, { k: 'autoXmp', label: 'Automatically write changes into XMP sidecar files', t: 'check' }, { t: 'note', label: 'Sidecars (.xmp beside each original) carry ratings, labels, keywords, IPTC and develop settings so other programs and other catalogs can read them.' },
        { t: 'section', label: 'Map' }, { k: 'mapTiles', label: 'Map Tiles', t: 'select', opts: [['https://tile.openstreetmap.org/{z}/{x}/{y}.png', 'OpenStreetMap (needs internet)'], ['none', 'Off \u2014 coordinate grid only']] }], P));
      else if (tab === 'editors') { const eds = App.conf('editors', []), dng = await api('dng_status'), save = l => { App.setConf('editors', l); draw(); };
        body.replaceChildren(h('div', { class: 'fnote' }, 'Programs listed here appear under Photo > Edit In. Opia renders a copy with your adjustments, stacks it with the original and opens it in the editor.'),
          eds.length ? h('table', { class: 'tbl' }, eds.map((e, i) => h('tr', {}, h('td', {}, h('b', {}, e.name)), h('td', { class: 'dim small' }, e.path), h('td', {}, h('select', { onchange: ev => { e.format = ev.target.value; save(eds); } }, ['tiff', 'jpeg', 'png'].map(f => h('option', { value: f, selected: (e.format || 'tiff') === f }, f.toUpperCase())))), h('td', {}, h('button', { class: 'btn', onclick: () => save(eds.filter((_, k) => k !== i)) }, 'Remove'))))) : h('div', { class: 'empty small' }, 'No external editors configured yet.'),
          h('div', { class: 'dlg-inline' }, h('button', { class: 'btn', onclick: async () => { const found = await api('editors_detect'), add = found.filter(f => !eds.some(e => e.path === f.path)); if (!add.length) return UI.toast(found.length ? 'Detected editors are already listed' : 'No known editors were found on this computer'); save([...eds, ...add.map(f => ({ ...f, format: 'tiff' }))]); } }, 'Detect Installed Editors'),
            h('button', { class: 'btn', onclick: async () => { const f = await UI.pickFile('/Applications', ['.app']); if (!f) return; const n = await UI.prompt('External Editor', 'Name shown in the menu', f.split(/[\\/]/).pop().replace(/\.exe$/i, '')); if (n) save([...eds, { name: n, path: f, format: 'tiff' }]); } }, 'Add Application\u2026')),
          h('div', { class: 'sub' }, 'DNG Converter'), h('div', { class: 'fnote' }, dng.path ? 'Adobe DNG Converter found: ' + dng.path : 'Adobe DNG Converter not found. Install it from Adobe (free) or point to it below; it is used by Photo > Convert to DNG.'),
          UI.form([{ k: 'dngConverter', label: 'Converter Location', t: 'file', exts: ['.app'] }], P));
      }
    };
    tabs.append(...[['general', 'General'], ['editors', 'External Editing']].map(([t, l]) => h('a', { data: { t }, onclick: () => { tab = t; draw(); } }, l)));
    await draw();
    return UI.dialog({ title: 'Preferences', width: 720, body: h('div', {}, tabs, body) }).then(() => { Lib.toolbar(); Lib.refreshView(true); });
  },
};

/* Plug-in manager for local extensions (folders with a plugin.json + plugin.py) */
const Plugins = {
  async refresh(list) { App.boot.plugins = list || await api('plugins_list'); return App.boot.plugins; },
  async run(pl, cmd) { try { const r = await api('plugin_run', { id: pl.id, command: cmd.id, photo_ids: App.selIds() }); if (r.photos) { App.addPhotos(r.photos); App.refreshList(true); } UI.toast((r.messages || []).join(' \u2022 ') || cmd.title + ' finished'); } catch (e) { UI.error(e); } },
  menu() { const out = []; for (const pl of App.boot.plugins || []) if (pl.enabled) for (const c of pl.commands || []) out.push({ label: `${c.title}  (${pl.name})`, run: () => this.run(pl, c) }); return out.length ? out : [{ label: 'No plug-in commands available', disabled: true }]; },
  async manage() {
    const body = h('div');
    const draw = list => body.replaceChildren(...(list.length ? list.map(pl => h('div', { class: 'plug' + (pl.enabled ? '' : ' off') }, h('div', { class: 'plug-h' }, h('b', {}, pl.name), h('span', { class: 'dim' }, ' ' + pl.version + (pl.author ? '  by ' + pl.author : '')), h('span', { class: 'tb-fill' }),
      h('label', { class: 'tb-check' }, h('input', { type: 'checkbox', checked: pl.enabled, onchange: async e => draw(await this.refresh(await api('plugin_toggle', { id: pl.id, enabled: e.target.checked }))) }), 'Enabled'),
      pl.builtin ? null : h('button', { class: 'btn', onclick: async () => draw(await this.refresh(await api('plugin_remove', { id: pl.id }))) }, 'Remove')),
      h('div', {}, pl.description), h('div', { class: 'dim small' }, pl.dir), pl.error ? h('div', { class: 'err' }, 'Failed to load: ' + pl.error) : h('div', { class: 'dim small' }, 'Status: ' + (pl.enabled ? 'installed and running' : 'disabled') + (pl.hooks.length ? '  \u2022  hooks: ' + pl.hooks.join(', ') : '')),
      pl.enabled && pl.commands.length ? h('div', { class: 'dlg-inline' }, pl.commands.map(c => h('button', { class: 'btn', onclick: () => this.run(pl, c) }, c.title))) : null)) : [h('div', { class: 'empty' }, 'No plug-ins installed.')]));
    draw(await this.refresh());
    return UI.dialog({ title: 'Plug-in Manager', width: 680, body: h('div', {}, h('div', { class: 'fnote' }, 'Plug-ins are local folders containing plugin.json and a Python file. They can add commands for the selected photos and hook into import and export. Only add plug-ins you trust: they run with your user account\u2019s permissions.'), body),
      buttons: [['Add\u2026', async () => { const d = await UI.pickFolder(App.boot.home); if (d) { try { draw(await this.refresh(await api('plugin_add', { path: d }))); } catch (e) { UI.error(e); } } return false; }], ['Reload All', async () => { draw(await this.refresh(await api('plugins_reload'))); return false; }], ['Done', null, 'primary']] });
  },
};

/* Tethered shooting: watched folder (camera utility saves here) + direct capture from a connected camera/webcam */
const Tether = {
  active: false, timer: null, stream: null,
  async start() {
    if (this.active) return this.bar();
    const st = { session: 'Studio Session', folder: App.conf('tether_folder', App.boot.pictures + '\\Tethered'), preset: '', develop: '', keywords: '', advance: true };
    const ok = await UI.dialog({ title: 'Tethered Capture Settings', width: 540, body: h('div', {}, UI.form([{ k: 'session', label: 'Session Name' }, { k: 'folder', label: 'Watched Folder', t: 'folder' }, { k: 'develop', label: 'Develop Settings', t: 'select', opts: [['', 'None'], ...Object.keys(Dev.presets()).map(n => [n, n])] },
      { k: 'preset', label: 'Metadata', t: 'select', opts: [['', 'None'], ...Object.keys(App.conf('metadata_presets', {})).map(n => [n, n])] }, { k: 'keywords', label: 'Keywords' }, { k: 'advance', label: 'Auto-select each new capture', t: 'check' }], st),
      h('div', { class: 'fnote' }, 'Point your camera maker\u2019s tether utility (Canon EOS Utility, Nikon Camera Control, Sony Imaging Edge, Capture One\u2019s hot folder, etc.) at the watched folder: every new file appears here seconds after the shutter fires, with the settings above applied. Cameras that work as a webcam or capture device can also be triggered directly from the tether bar.')), buttons: [['Cancel', null], ['Start', true, 'primary']] });
    if (!ok) return;
    App.setConf('tether_folder', st.folder);
    await api('tether_start', { folder: st.folder + '\\' + st.session.replace(/[\\/:*?"<>|]/g, '_'), session: st.session, opts: { preset: App.conf('metadata_presets', {})[st.preset] || null, develop: Dev.presets()[st.develop] || null, keywords: st.keywords.split(',').map(s => s.trim()).filter(Boolean) } });
    this.active = true; this.st = st; this.count = 0; this.ids = [];
    this.timer = setInterval(() => this.poll(), 1000); this.bar();
  },
  async poll() {
    let r; try { r = await api('tether_poll'); } catch (e) { return; }
    if (!r.photos.length) return;
    App.addPhotos(r.photos); this.count = r.count; this.ids.push(...r.photos.map(p => p.id));
    App.setKeywords(await api('keywords_list'));
    App.source = { type: 'ids', ids: this.ids, name: 'Tethered: ' + this.st.session }; App.refreshList(true); App.emit('source'); Panels.refreshAll();
    if (this.st.advance) App.select(r.photos[r.photos.length - 1].id);
    Render.thumbs(r.photos.filter(p => App.isEdited(p)).map(p => p.id)); this.bar();
  },
  bar() {
    const el = $('#tetherbar'); el.classList.toggle('on', this.active); if (!this.active) { el.replaceChildren(); return; }
    this.video ||= h('video', { autoplay: true, muted: true, playsInline: true });
    el.replaceChildren(h('b', {}, '\u25cf Tethered: ' + this.st.session), h('span', { class: 'dim' }, `${this.count} capture${this.count === 1 ? '' : 's'}  \u2022  watching ${this.st.folder}`), h('span', { class: 'tb-fill' }),
      this.stream ? [this.video, h('button', { class: 'btn shutter', title: 'Capture (F12)', onclick: () => this.capture() }, '\u25c9 Capture'), h('button', { class: 'btn', onclick: () => this.camera(false) }, 'Disconnect Camera')] : h('button', { class: 'btn', onclick: () => this.camera(true) }, 'Connect Camera / Webcam\u2026'),
      h('button', { class: 'btn', onclick: () => api('fs_reveal', { path: this.st.folder }) }, 'Open Folder'), h('button', { class: 'btn', onclick: () => this.stop() }, 'Stop Tethering'));
  },
  async camera(on) {
    if (!on) { this.stream?.getTracks().forEach(t => t.stop()); this.stream = null; return this.bar(); }
    try { this.stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 4096 }, height: { ideal: 2160 } } }); this.video ||= h('video', { autoplay: true, muted: true, playsInline: true }); this.video.srcObject = this.stream; this.bar(); }
    catch (e) { UI.alert('No Camera', 'No camera could be opened: ' + e.message + '. You can still shoot into the watched folder with your camera maker\u2019s software.'); }
  },
  async capture() {
    if (!this.stream) return; const v = this.video, cv = h('canvas', { width: v.videoWidth, height: v.videoHeight }); if (!cv.width) return;
    cv.getContext('2d').drawImage(v, 0, 0); await upload('tether_capture', {}, await Render.blob(cv, 'image/jpeg', 0.95)); this.poll();
  },
  async stop() { clearInterval(this.timer); await api('tether_stop'); this.camera(false); this.active = false; this.bar(); UI.toast(`Tethered session ended with ${this.count} capture(s)`); },
};

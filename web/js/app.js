'use strict';
/* App shell: commands, menus, module picker, startup. */

const MODULES = [Lib, Dev, MapMod, Book, Slideshow, Print, WebMod];

/* Your own keyboard shortcuts, kept in the app settings and laid over the built-in ones. */
const Keymap = {
  defaults: null,
  apply() {
    this.defaults = this.defaults || Object.fromEntries(Object.values(App.commands).map(c => [c.id, c.key]));
    const map = App.conf('keymap', {}); for (const c of Object.values(App.commands)) c.key = map[c.id] ?? this.defaults[c.id];
  },
  async edit() {
    const map = { ...App.conf('keymap', {}) }, cmds = Object.values(App.commands).filter(c => !/^(kwset|rate|music|pdf|image|video)\./.test(c.id)).sort((a, b) => a.label.localeCompare(b.label));
    const rows = cmds.map(c => { const inp = h('input', { type: 'text', class: 'km-key', readOnly: true, value: map[c.id] ?? this.defaults[c.id], placeholder: 'none', onkeydown: e => { e.preventDefault(); e.stopPropagation(); if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return; inp.value = e.key === 'Backspace' || e.key === 'Delete' ? '' : App.keyName(e); map[c.id] = inp.value; } }); return h('tr', {}, h('td', {}, c.label.replace(/\u2026$/, '')), h('td', {}, inp)); });
    const ok = await UI.dialog({ title: 'Customize Shortcuts', width: 560, body: h('div', {}, h('div', { class: 'fnote' }, 'Click a box and press the keys you want. Backspace clears it.'), h('div', { class: 'scroll' }, h('table', { class: 'tbl' }, rows))), buttons: [['Reset All', 'reset'], ['Cancel', null], ['Save', true, 'primary']] });
    if (!ok) return;
    const keep = ok === 'reset' ? {} : Object.fromEntries(Object.entries(map).filter(([id, k]) => k !== this.defaults[id]));
    App.setConf('keymap', keep); this.apply(); buildMenus();
    const used = Object.values(App.commands).map(c => c.key).filter(Boolean), clash = new Set(used.filter((k, i) => used.indexOf(k) !== i));
    UI.toast(ok === 'reset' ? 'Shortcuts reset' : clash.size ? `Saved. ${clash.size} shortcut(s) are used twice: ${[...clash].slice(0, 4).join(', ')}` : 'Shortcuts saved');
  },
};
async function findDuplicates() {
  const r = await runJob(api('duplicates_find'), 'Finding duplicates');
  if (!r.groups.length) return UI.toast(`No look-alike photos among the ${r.checked} checked`);
  App.show('library'); App.setSource({ type: 'ids', ids: r.groups.flat(), name: 'Duplicates' }); Lib.setView('grid');
  UI.toast(`${r.groups.length} set(s) of look-alike photos found. Reject (X) the ones you do not want.`);
}
async function pickSharpest() {
  const ids = App.selIds(); if (ids.length < 2) return UI.toast('Select a few shots of the same thing first');
  const score = await api('sharpness', { ids }), best = ids.reduce((a, b) => (score[b] > score[a] ? b : a));
  App.select(best); App.rate({ flag: 1 }); UI.toast('Flagged the sharpest of the ' + ids.length);
}

function registerCommands() {
  const C = (...a) => App.cmd(...a), lib = { modules: ['library'] }, libdev = { modules: ['library', 'develop'] }, ld = v => () => { App.show('library'); Lib.setView(v); };
  C('file.import', 'Import Photos…', 'Ctrl+Shift+I', () => Import.open()); C('file.export', 'Export…', 'Ctrl+Shift+E', () => Exporter.dialog()); C('file.exportagain', 'Export with Previous', 'Ctrl+Alt+Shift+E', () => Exporter.again());
  C('file.catalogs', 'Open / Manage Catalogs…', '', () => Catalogs.manage('catalogs')); C('file.newcatalog', 'New Catalog…', '', () => Catalogs.create()); C('file.backup', 'Back Up Catalog…', '', () => Catalogs.manage('backup')); C('file.optimize', 'Optimize Catalog…', '', () => Catalogs.manage('general'));
  C('file.plugins', 'Plug-in Manager…', 'Ctrl+Alt+Shift+,', () => Plugins.manage()); C('file.tether', 'Tethered Capture…', '', () => Tether.start()); C('file.prefs', 'Preferences…', 'Ctrl+,', () => Prefs.open()); C('prefs.editors', 'External Editors…', '', () => Prefs.open('editors'));
  C('edit.identity', 'Identity Plate Setup…', '', () => Identity.edit()); C('edit.watermarks', 'Edit Watermarks…', '', () => Watermark.edit()); C('edit.templates', 'Filename Template Editor…', '', () => Naming.edit()); C('edit.metapresets', 'Edit Metadata Presets…', '', () => MetaUI.editPresets()); C('edit.keywordsets', 'Edit Keyword Sets…', '', () => Keywords.editSets());
  C('edit.selectall', 'Select All', 'Ctrl+A', () => App.selectAll()); C('edit.selectnone', 'Select None', 'Ctrl+D', () => App.selectNone());
  C('view.grid', 'Grid', 'G', ld('grid'), lib); C('view.loupe', 'Loupe', 'E', ld('loupe'), lib); C('view.compare', 'Compare', 'C', ld('compare'), lib); C('view.survey', 'Survey', 'N', ld('survey'), lib); C('view.people', 'People', 'O', ld('people'), lib);
  C('view.info', 'Loupe Info Overlay', 'Ctrl+I', () => { App.setPref('loupeInfo', !App.pref('loupeInfo', true)); Lib.refreshView(true); }, { checked: () => App.pref('loupeInfo', true) });
  C('view.panels', 'Show / Hide Side Panels', 'Tab', () => document.body.classList.toggle('nopanels')); C('view.film', 'Show / Hide Filmstrip', 'F6', () => { document.body.classList.toggle('nofilm'); dispatchEvent(new Event('resize')); });
  C('view.full', 'Full Screen', 'F11', () => (window.pywebview && pywebview.api && pywebview.api.fullscreen ? pywebview.api.fullscreen() : document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()));
  C('go.grid', 'Library Grid', '', ld('grid')); C('go.loupe', 'Library Loupe', '', ld('loupe')); C('go.develop', 'Develop', 'D', () => App.show('develop'), lib);
  MODULES.forEach((m, i) => C('mod.' + m.id, m.name, 'Ctrl+Alt+' + (i + 1), () => App.show(m.id)));
  C('flag.pick', 'Flag as Pick', 'P', () => App.rate({ flag: 1 }), libdev); C('flag.none', 'Unflag', 'U', () => App.rate({ flag: 0 }), libdev); C('flag.reject', 'Set as Rejected', 'X', () => App.rate({ flag: -1 }), libdev);
  for (let r = 0; r <= 5; r++) C('rate.' + r, r ? 'Rating ' + '★'.repeat(r) : 'No Rating', String(r), () => App.rate({ rating: r }), libdev);
  Object.keys(LABELS).slice(0, 4).forEach((l, i) => C('label.' + l, 'Label ' + l[0].toUpperCase() + l.slice(1), String(6 + i), () => App.rate({ label: l }, true), libdev));
  C('label.purple', 'Label Purple', '', () => App.rate({ label: 'purple' }, true)); C('label.none', 'No Label', '', () => App.rate({ label: '' }));
  C('rate.auto', 'Auto Advance', '', () => { App.setPref('autoAdvance', !App.pref('autoAdvance', false)); Lib.toolbar(); }, { checked: () => App.pref('autoAdvance', false) });
  C('col.quick', 'Add to / Remove from Target Collection', 'B', () => App.quickToggle(App.selIds())); C('col.new', 'New Collection…', 'Ctrl+Shift+N', () => Collections.create('collection', null)); C('col.smart', 'New Smart Collection…', '', () => Collections.editSmart(null)); C('col.set', 'New Collection Set…', '', () => Collections.create('set', null));
  C('col.savequick', 'Save Quick Collection…', 'Ctrl+Alt+B', () => Collections.saveQuick()); C('col.showquick', 'Show Quick Collection', 'Ctrl+B', () => App.setSource({ type: 'quick' }));
  C('photo.vcopy', 'Create Virtual Copy', "Ctrl+'", () => Lib.virtualCopy()); C('stack.group', 'Group into Stack', 'Ctrl+G', () => Lib.stack()); C('stack.ungroup', 'Unstack', 'Ctrl+Shift+G', () => Lib.unstack()); C('stack.toggle', 'Expand / Collapse Stack', 'S', () => { const p = App.cur(); if (p && p.stack_id) Lib.toggleStack(p); }, lib); C('stack.auto', 'Auto-Stack by Capture Time…', '', () => Lib.autoStack());
  C('photo.rotl', 'Rotate Left (CCW)', 'Ctrl+[', () => Lib.rotate('ccw')); C('photo.rotr', 'Rotate Right (CW)', 'Ctrl+]', () => Lib.rotate('cw')); C('photo.fliph', 'Flip Horizontal', '', () => Lib.rotate('fliph')); C('photo.flipv', 'Flip Vertical', '', () => Lib.rotate('flipv'));
  C('photo.remove', 'Remove Photos…', 'Delete', () => Lib.remove(), lib); C('photo.rename', 'Rename Photos…', 'F2', () => Naming.rename()); C('photo.dng', 'Convert Photos to DNG…', '', () => Ext.dng()); C('photo.locate', 'Find Missing Photo…', '', () => Ext.locate());
  C('photo.smart', 'Build Smart Previews', '', async () => { const ids = App.selIds(); const r = await runJob(api('smart_previews_build', { ids }), 'Building Smart Previews'); await App.reloadPhotos(ids); UI.toast(r.built + ' Smart Preview(s) built'); });
  C('photo.smartdiscard', 'Discard Smart Previews', '', async () => { const ids = App.selIds(); await api('smart_previews_discard', { ids }); await App.reloadPhotos(ids); UI.toast('Smart Previews discarded'); });
  C('photo.explorer', 'Show in Finder', 'Ctrl+R', () => App.cur() && api('fs_reveal', { path: App.cur().path }));
  C('dev.copy', 'Copy Settings…', 'Ctrl+Shift+C', () => Dev.copy()); C('dev.paste', 'Paste Settings', 'Ctrl+Shift+V', () => Dev.paste()); C('dev.sync', 'Sync Settings…', 'Ctrl+Shift+S', () => Dev.sync());
  C('dev.reset', 'Reset All Settings', 'Ctrl+Shift+R', () => (App.module === 'develop' ? Dev.reset() : Dev.resetMany())); C('dev.undo', 'Undo', 'Ctrl+Z', () => Dev.undo(), { modules: ['develop'] }); C('dev.redo', 'Redo', 'Ctrl+Y', () => Dev.redo(), { modules: ['develop'] });
  C('dev.snapshot', 'New Snapshot…', 'Ctrl+Shift+U', () => { App.show('develop'); Dev.createSnap(); }); C('dev.preset', 'New Preset…', '', () => { App.show('develop'); Dev.createPreset(); }); C('dev.auto', 'Auto Tone', 'Ctrl+U', () => Dev.autoTone(App.selIds()));
  C('dev.proof', 'Soft Proofing', '', () => { App.show('develop'); Dev.toggleProof(); }, { checked: () => Dev.proof.on }); C('dev.before', 'Before / After', '', () => { App.show('develop'); Dev.setMode(Dev.mode === 'before-lr' ? 'loupe' : 'before-lr'); }); C('dev.reference', 'Reference View', '', () => { App.show('develop'); Dev.setMode(Dev.mode === 'reference' ? 'loupe' : 'reference'); });
  for (const [id, label, fn] of [['crop', 'Crop & Straighten', () => Tools.set('crop')], ['spot', 'Spot Removal / Healing', () => Tools.set('spot')], ['redeye', 'Red Eye Correction', () => Tools.set('redeye')], ['brush', 'Masking: Brush', () => Tools.addMask('brush')], ['linear', 'Masking: Linear Gradient', () => Tools.addMask('linear')], ['radial', 'Masking: Radial Gradient', () => Tools.addMask('radial')], ['guided', 'Guided Upright', () => Tools.upright('guided')]]) C('tool.' + id, label, '', () => { App.show('develop'); setTimeout(fn, 80); });
  C('meta.xmpwrite', 'Save Metadata to XMP Sidecar', 'Ctrl+S', async () => { const r = await api('xmp_write', { ids: App.selIds() }); UI.toast(r.written.length + ' XMP sidecar file(s) written'); });
  C('meta.xmpread', 'Read Metadata from XMP Sidecar', '', async () => { const ids = App.selIds(), r = await api('xmp_read', { ids }); App.addPhotos(r.photos); App.setKeywords(r.keywords); App.emit('meta', ids); Render.thumbs(ids); if (App.module === 'develop') Dev.load(App.cur(), true); UI.toast(r.read + ' sidecar(s) read'); });
  C('meta.exif', 'Show All EXIF…', '', () => MetaUI.showExif()); C('meta.sync', 'Sync Metadata…', '', () => MetaUI.syncMeta()); C('meta.kwnew', 'New Keyword Tag…', '', () => Keywords.create(null));
  C('merge.pano', 'Panorama…', 'Ctrl+M', () => Merge.dialog('pano')); C('merge.hdr', 'HDR…', 'Ctrl+Shift+H', () => Merge.dialog('hdr')); C('merge.focus', 'Focus Stack…', '', () => Merge.dialog('focus'));
  C('photo.duplicates', 'Find Duplicates…', '', () => findDuplicates()); C('photo.sharpest', 'Pick the Sharpest', '', () => pickSharpest()); C('help.keymap', 'Customize Shortcuts…', '', () => Keymap.edit());
  C('people.find', 'Find Faces in These Photos', '', () => { App.show('library'); Lib.setView('people'); People.scan(); });
  C('filter.toggle', 'Enable Filters', 'Ctrl+L', () => { App.filter.on = !App.filter.on; App.refreshList(true); App.emit('filter'); }, { checked: () => App.filter.on }); C('filter.bar', 'Show Filter Bar', '', () => Lib.toggleFilterBar(), { checked: () => App.pref('filterBar', true) });
  C('paint.toggle', 'Painter (Spray Can)', 'Ctrl+Alt+K', () => { App.show('library'); Lib.setView('grid'); Painter.toggle(); });
  for (let i = 1; i <= 9; i++) C('kwset.' + i, 'Keyword Set ' + i, 'Alt+' + i, () => Keywords.toggle(Keywords.current()[i - 1]), libdev);
  C('help.keys', 'Keyboard Shortcuts…', 'Ctrl+/', () => { const rows = Object.values(App.commands).filter(c => c.key && !c.id.startsWith('kwset') && !c.id.startsWith('rate.')).map(c => h('tr', {}, h('td', {}, c.label.replace(/…$/, '')), h('td', {}, h('kbd', {}, c.key))));
    const extra = [['Rating 0–5 / Labels 6–9', '0 – 9'], ['Keyword Set shortcuts', 'Alt+1 – 9'], ['Develop: Crop / Heal / Brush / Linear / Radial', 'R / Q / K / M / Shift+M'], ['Develop: Before / Side-by-side / Split / Reference', '\\ / Y / Shift+Y / Shift+R'], ['Develop: WB picker / Clipping / Soft proof / Mask overlay', 'W / J / S / O'], ['Zoom', 'Z, Space, mouse wheel'], ['Move loupe guides', 'Ctrl+drag']].map(([a, b]) => h('tr', {}, h('td', {}, a), h('td', {}, h('kbd', {}, b))));
    UI.dialog({ title: 'Keyboard Shortcuts', width: 560, body: h('div', { class: 'scroll' }, h('table', { class: 'tbl' }, ...extra, ...rows)) }); });
  C('mode.beginner', 'Beginner Mode', '', () => Modes.set('beginner', !Modes.beginner), { checked: () => Modes.beginner }); C('mode.trackpad', 'Trackpad-Friendly Controls', '', () => Modes.set('trackpad', !Modes.trackpad), { checked: () => Modes.trackpad });
  const M = (id, label, key, fn) => C('music.' + id, label, key, () => { if (App.module === 'music') fn(); }, { modules: ['music'] });
  M('new', 'New Song', '', () => Music.save().then(() => Music.create())); M('clear', 'Clear Song', '', () => Music.clearSong()); M('selall', 'Select All Parts', 'Ctrl+A', () => Music.selectAll()); M('dup', 'Duplicate Selected Parts', 'Ctrl+D', () => Music.duplicatePicked()); M('delparts', 'Delete Selected Parts', '', () => Music.removePicked()); M('rename', 'Rename Song…', '', () => Music.rename()); M('import', 'Import Audio…', '', () => Music.importAudio()); M('importmidi', 'Import MIDI…', '', () => Music.importMidi()); M('stems', 'Export Each Track (Stems)…', '', () => Music.exportStems()); M('midi', 'Export MIDI…', '', () => Music.exportMidi()); M('mp3', 'Export as MP3…', '', () => Music.exportAudio('.mp3')); M('record', 'Record', '', () => Music.toggleRec()); M('export', 'Export as WAV…', '', () => Music.exportWav());
  M('undo', 'Undo', '', () => Music.step(Music.undo, Music.redo)); M('redo', 'Redo', '', () => Music.step(Music.redo, Music.undo)); M('cut', 'Cut', '', () => Music.cut()); M('copy', 'Copy', '', () => Music.copy()); M('paste', 'Paste', '', () => Music.paste());
  M('delete', 'Delete', '', () => Music.remove(true)); M('silence', 'Silence', '', () => Music.remove(false)); M('split', 'Split', '', () => Music.splitHere()); M('trim', 'Trim to Selection', '', () => Music.trim());
    for (const r of ['drums', 'bass', 'chords', 'melody']) M('add.' + r, 'Add ' + ROLES[r].name, '', () => Music.addTrack(r));
  const P = (id, label, key, fn, needDoc = true) => C('pdf.' + id, label, key, () => { if (App.module !== 'pdf') return; if (needDoc && !Pdf.doc) return UI.toast('Open a PDF first.'); return fn(); }, { modules: ['pdf'] });
  P('open', 'Open…', 'Ctrl+O', () => Pdf.open(), false); P('add', 'Add Files…', '', () => Pdf.add(), false); P('save', 'Save', 'Ctrl+S', () => Pdf.save()); P('saveas', 'Save As…', 'Ctrl+Shift+S', () => Pdf.saveAs()); P('close', 'Close Document', '', () => Pdf.close());
  P('images', 'Save Pages as Pictures…', '', () => Pdf.exportImages()); P('text', 'Save All Text…', '', () => Pdf.exportText()); P('split', 'Split into Several Files…', '', () => Pdf.split());
  P('undo', 'Undo', 'Ctrl+Z', () => Pdf.step(Pdf.undo, Pdf.redo)); P('redo', 'Redo', 'Ctrl+Y', () => Pdf.step(Pdf.redo, Pdf.undo)); P('delete', 'Delete', 'Delete', () => Pdf.del()); P('selall', 'Select All Pages', 'Ctrl+A', () => Pdf.selectAll()); P('find', 'Find…', 'Ctrl+F', () => Pdf.keys['Ctrl+F']());
  P('rotl', 'Rotate Left', '', () => Pdf.rotate(-90)); P('rotr', 'Rotate Right', '', () => Pdf.rotate(90)); P('dup', 'Duplicate Page', 'Ctrl+D', () => Pdf.duplicate()); P('delpage', 'Delete Page', '', () => Pdf.removePages()); P('blank', 'Insert Blank Page', '', () => Pdf.blank());
  P('extract', 'Extract Pages…', '', () => Pdf.saveAs(Pdf.targets())); P('numbers', 'Page Numbers…', '', () => Pdf.numbers()); P('watermark', 'Watermark…', '', () => Pdf.watermark()); P('password', 'Password…', '', () => Pdf.protect()); P('props', 'Properties…', '', () => Pdf.props());
  P('edit', 'Edit View', '', () => Pdf.setView('edit')); P('pages', 'Pages View', '', () => Pdf.setView('pages')); P('zin', 'Zoom In', 'Ctrl+=', () => Pdf.zoomBy(1.2)); P('zout', 'Zoom Out', 'Ctrl+-', () => Pdf.zoomBy(1 / 1.2)); P('zfit', 'Fit Page to Window', 'Ctrl+0', () => Pdf.setZoom('fit'));
  const I = (id, label, key, fn, needDoc = true) => C('image.' + id, label, key, () => { if (App.module !== 'image') return; if (needDoc && !ImgEd.doc) return UI.toast('Open or create a picture first.'); return fn(); }, { modules: ['image'] });
  I('new', 'New Picture…', 'Ctrl+N', () => ImgEd.newDoc(), false); I('open', 'Open…', 'Ctrl+O', () => ImgEd.open(), false); I('fromphoto', 'Edit the Selected Photo', '', () => ImgEd.fromPhoto(App.cur()), false); I('place', 'Place Picture as Layer…', '', () => ImgEd.pickFiles().then(f => f.length && ImgEd.place(f)));
  I('save', 'Save Project', 'Ctrl+S', () => ImgEd.save()); I('saveas', 'Save Project As…', 'Ctrl+Shift+S', () => ImgEd.saveAs()); I('export', 'Export Picture…', 'Ctrl+Shift+E', () => ImgEd.exportPic()); I('close', 'Close Picture', '', () => ImgEd.close());
  I('undo', 'Undo', 'Ctrl+Z', () => ImgEd.step(ImgEd.undo, ImgEd.redo)); I('redo', 'Redo', 'Ctrl+Y', () => ImgEd.step(ImgEd.redo, ImgEd.undo)); I('cut', 'Cut', 'Ctrl+X', () => ImgEd.copy(true)); I('copy', 'Copy', 'Ctrl+C', () => ImgEd.copy()); I('copymerged', 'Copy Merged', '', () => ImgEd.copy(false, true)); I('paste', 'Paste', 'Ctrl+V', () => ImgEd.paste(), false);
  I('fill', 'Fill with Colour', 'Alt+Backspace', () => ImgEd.fillSel()); I('clear', 'Delete', 'Delete', () => ImgEd.del()); I('transform', 'Free Transform', 'Ctrl+T', () => ImgEd.startTransform()); I('fliplh', 'Flip Layer Horizontal', '', () => ImgEd.flipLayer(true)); I('fliplv', 'Flip Layer Vertical', '', () => ImgEd.flipLayer(false));
  I('selall', 'Select All', 'Ctrl+A', () => ImgEd.selectAll()); I('deselect', 'Deselect', 'Ctrl+D', () => ImgEd.deselect()); I('invert', 'Invert Selection', 'Ctrl+Shift+I', () => ImgEd.invertSel()); I('feather', 'Feather…', '', () => ImgEd.feather()); I('sellayer', 'Select Layer Pixels', '', () => ImgEd.layerToSel());
  I('newlayer', 'New Layer', 'Ctrl+Shift+N', () => ImgEd.newLayer()); I('duplayer', 'Duplicate Layer', '', () => ImgEd.dupLayer()); I('dellayer', 'Delete Layer', '', () => ImgEd.delLayer()); I('layercopy', 'Layer via Copy', 'Ctrl+J', () => ImgEd.layerViaCopy()); I('layercut', 'Layer via Cut', 'Ctrl+Shift+J', () => ImgEd.layerViaCopy(true));
  I('mergedown', 'Merge Down', 'Ctrl+E', () => ImgEd.mergeDown()); I('mergevis', 'Merge Visible', '', () => ImgEd.flatten(true)); I('flatten', 'Flatten Image', '', () => ImgEd.flatten()); I('rasterize', 'Turn Layer Into Pixels', '', () => ImgEd.pixels(ImgEd.L, 'paint on'));
  I('imgsize', 'Image Size…', '', () => ImgEd.imageSize()); I('canvas', 'Canvas Size…', '', () => ImgEd.canvasSize()); I('rotr', 'Rotate 90° Right', '', () => ImgEd.rotateDoc(90)); I('rotl', 'Rotate 90° Left', '', () => ImgEd.rotateDoc(-90)); I('rot180', 'Rotate 180°', '', () => ImgEd.rotateDoc(180));
  I('fliph', 'Flip Horizontal', '', () => ImgEd.flipDoc(true)); I('flipv', 'Flip Vertical', '', () => ImgEd.flipDoc(false)); I('cropsel', 'Crop to Selection', '', () => ImgEd.cropToSel()); I('trim', 'Trim Empty Edges', '', () => ImgEd.trimTransparent());
  I('bc', 'Brightness / Contrast…', '', () => ImgEd.brightness()); I('levels', 'Levels…', 'Ctrl+L', () => ImgEd.levels()); I('curves', 'Curves…', 'Ctrl+M', () => ImgEd.curves()); I('hsl', 'Hue / Saturation…', 'Ctrl+U', () => ImgEd.hsl()); I('balance', 'Colour Balance…', '', () => ImgEd.colorBalance());
  I('auto', 'Auto Tone', '', () => ImgEd.autoTone()); I('bw', 'Black & White', '', () => ImgEd.desaturate()); I('invertc', 'Invert Colours', 'Ctrl+I', () => ImgEd.invertColours()); I('posterize', 'Posterize…', '', () => ImgEd.posterize()); I('threshold', 'Threshold…', '', () => ImgEd.threshold());
  I('blur', 'Blur…', '', () => ImgEd.blur()); I('sharpen', 'Sharpen…', '', () => ImgEd.sharpen()); I('noise', 'Add Noise…', '', () => ImgEd.noise()); I('pixelate', 'Pixelate…', '', () => ImgEd.pixelate());
  I('zin', 'Zoom In', 'Ctrl+=', () => ImgEd.zoomBy(1.25)); I('zout', 'Zoom Out', 'Ctrl+-', () => ImgEd.zoomBy(.8)); I('zfit', 'Fit on Screen', 'Ctrl+0', () => ImgEd.setZoom('fit')); I('z100', 'Actual Pixels', 'Ctrl+1', () => ImgEd.setZoom(1));
  C('photo.imageedit', 'Edit in Imagine', '', () => ImgEd.fromPhoto(App.cur()));
  const V = (id, label, key, fn, needP = true) => C('video.' + id, label, key, () => { if (App.module !== 'video') return; if (needP && !Vid.p) return UI.toast('Start or open a video project first.'); return fn(); }, { modules: ['video'] });
  V('new', 'New Project…', 'Ctrl+N', () => Vid.create(), false); V('rename', 'Rename Project…', '', () => Vid.rename()); V('delete', 'Delete Project…', '', () => Vid.del()); V('import', 'Import Media…', 'Ctrl+I', () => Vid.importMedia(), false); V('importdisk', 'Import from Disk…', '', () => Vid.importFromDisk(), false);
  V('photos', 'Add Selected Photos', '', () => Vid.addPhotos(), false); V('export', 'Export Video…', 'Ctrl+Shift+E', () => Vid.exportDialog()); V('frame', 'Save Frame as Picture…', '', () => Vid.saveFrame()); V('frameimg', 'Edit Frame in Imagine', '', () => Vid.frameToImage()); V('settings', 'Project Settings…', '', () => Vid.settings());
  V('undo', 'Undo', 'Ctrl+Z', () => Vid.step(Vid.undo, Vid.redo)); V('redo', 'Redo', 'Ctrl+Y', () => Vid.step(Vid.redo, Vid.undo)); V('split', 'Split at Playhead', 'S', () => Vid.split()); V('del', 'Delete', 'Delete', () => Vid.remove()); V('ripple', 'Delete and Close Gap', 'Shift+Delete', () => Vid.remove(true));
  V('dup', 'Duplicate', 'Ctrl+D', () => Vid.duplicate()); V('selall', 'Select All Clips', 'Ctrl+A', () => Vid.selectAll()); V('xfade', 'Crossfade with Clip Before', '', () => Vid.crossfade()); V('detach', 'Detach Sound', '', () => Vid.detachAudio()); V('title', 'Add Title', 'T', () => Vid.addTitle());
  V('vtrack', 'Add Video Track', '', () => Vid.addTrack('video')); V('atrack', 'Add Audio Track', '', () => Vid.addTrack('audio')); V('play', 'Play / Pause', 'Space', () => Vid.toggle()); V('start', 'Go to Start', 'Home', () => Vid.seek(0)); V('end', 'Go to End', 'End', () => Vid.seek(Vid.total()));
  V('zin', 'Zoom In', 'Ctrl+=', () => Vid.zoom(1.4)); V('zout', 'Zoom Out', 'Ctrl+-', () => Vid.zoom(1 / 1.4)); V('zfit', 'Show Whole Timeline', 'Ctrl+0', () => Vid.zoomFit());
  C('photo.videoshow', 'Make a Video in Motion', '', () => { App.show('video'); Vid.addPhotos(); });
  C('help.tour', 'Take the Tour', '', () => Tour.start());
  C('help.updates', 'Check for Updates…', '', () => Updates.open());
  C('help.contact', 'Get Help on WhatsApp…', '', async () => {
    const num = '+91 8450973767';
    const go = await UI.dialog({ title: 'Get help', width: 440, body: h('div', { class: 'upd' },
      h('p', { class: 'msg' }, 'Message Opia\'s help number on WhatsApp:'), h('p', { class: 'msg' }, h('b', { data: { notr: 1 } }, num)),
      h('p', { class: 'msg dim' }, 'Messages are preferred; calls may not be answered.')),
      buttons: [['Copy Number', 'copy'], ['Close', null], ['Open WhatsApp', true, 'primary']] });
    if (go === 'copy') navigator.clipboard.writeText(num).then(() => UI.toast('Number copied.'), () => UI.toast(num));
    if (go === true) api('help_whatsapp').catch(UI.error);
  });
  C('help.about', 'About Opia', '', async () => { const ff = await api('video_ffmpeg').catch(() => ({ ok: false })); UI.alert('About Opia', `Opia ${App.boot.version}\nA local-first creative suite: Lens for photos, Imagine for pictures, Motion for video, Groove for music and Folio for PDFs.\n\nCatalog: ${App.info.path}\nRAW support: ${App.boot.raw ? 'yes (LibRaw)' : 'not installed'}   Face models: ${App.boot.faces ? 'installed' : 'missing'}\nVideo (FFmpeg): ${ff.ok ? ff.version.replace(/ Copyright.*$/, '') : 'not found'}\nEverything runs on this computer. The only things fetched from the internet are map tiles, and update checks once you have allowed them.`); });
}

function buildMenus() {
  const recent = () => (App.cfg.recent_catalogs || []).slice(0, 6).map(p => ({ label: p.split(/[\\/]/).pop().replace(/\.(opiacat|lrcat)$/i, ''), checked: p === App.info.path, run: () => Catalogs.switchTo(p) }));
  const rating = { label: 'Set Rating', sub: [0, 1, 2, 3, 4, 5].map(r => ({ label: r ? '★'.repeat(r) : 'None', key: String(r), run: () => App.rate({ rating: r }) })) };
  const looks = [{ label: 'Theme', sub: looksMenu('theme') }, { label: 'Language', sub: looksMenu('lang') }, '-', 'mode.beginner', 'mode.trackpad', '-'];
  if (App.module === 'music') return App.buildMenus([
    ['File', ['music.new', 'music.rename', 'music.clear', '-', 'music.import', 'music.importmidi', 'music.record', '-', 'music.export', 'music.mp3', 'music.stems', 'music.midi', '-', 'file.prefs']],
    ['Edit', Modes.beginner ? ['music.undo', 'music.redo', '-', 'music.selall', 'music.dup', 'music.delparts'] : ['music.undo', 'music.redo', '-', 'music.selall', 'music.dup', 'music.delparts', '-', 'music.cut', 'music.copy', 'music.paste', 'music.delete', 'music.silence', '-', 'music.split', 'music.trim']],
    ['Track', ['music.add.drums', 'music.add.bass', 'music.add.chords', 'music.add.melody', 'music.import']],
    ...(Modes.beginner ? [] : [['Effects', () => Music.fxItems()], ['Generate', () => Music.genItems()]]),
    ['View', () => [...looks, 'view.full']],
    ['Help', ['help.tour', 'help.keys', 'help.keymap', '-', 'help.updates', 'help.contact', 'help.about']],
  ]);
  if (App.module === 'pdf') return App.buildMenus([
    ['File', Modes.beginner ? ['pdf.open', 'pdf.add', '-', 'pdf.save', 'pdf.images', '-', 'pdf.close', 'file.prefs'] : ['pdf.open', 'pdf.add', '-', 'pdf.save', 'pdf.saveas', '-', 'pdf.images', 'pdf.text', 'pdf.split', '-', 'pdf.props', 'pdf.close', '-', 'file.prefs']],
    ['Edit', ['pdf.undo', 'pdf.redo', '-', 'pdf.delete', 'pdf.selall', 'pdf.find']],
    ['Page', ['pdf.rotl', 'pdf.rotr', 'pdf.dup', 'pdf.delpage', 'pdf.blank', '-', 'pdf.extract', 'pdf.numbers', ...(Modes.beginner ? [] : ['pdf.watermark']), 'pdf.password']],
    ['View', () => [...looks, 'pdf.edit', 'pdf.pages', '-', 'pdf.zin', 'pdf.zout', 'pdf.zfit', '-', 'view.full']],
    ['Help', ['help.tour', 'help.keys', 'help.keymap', '-', 'help.updates', 'help.contact', 'help.about']],
  ]);
  if (App.module === 'image') return App.buildMenus(Modes.beginner ? [
    ['File', ['image.new', 'image.open', 'image.fromphoto', '-', 'image.save', 'image.export', '-', 'image.close', 'file.prefs']],
    ['Edit', ['image.undo', 'image.redo', '-', 'image.cut', 'image.copy', 'image.paste', 'image.clear', 'image.fill', '-', 'image.transform']],
    ['Image', ['image.imgsize', 'image.rotr', 'image.rotl', 'image.cropsel', '-', 'image.bc', 'image.hsl', 'image.auto', 'image.bw', '-', 'image.blur', 'image.sharpen']],
    ['Layer', ['image.newlayer', 'image.duplayer', 'image.dellayer', '-', 'image.layercopy', 'image.mergedown']],
    ['Select', ['image.selall', 'image.deselect', 'image.invert']],
    ['View', () => [...looks, 'image.zin', 'image.zout', 'image.zfit', '-', 'view.full']],
    ['Help', ['help.tour', 'help.keys', 'help.keymap', '-', 'help.updates', 'help.contact', 'help.about']],
  ] : [
    ['File', ['image.new', 'image.open', 'image.fromphoto', 'image.place', '-', 'image.save', 'image.saveas', 'image.export', '-', 'image.close', 'file.prefs']],
    ['Edit', ['image.undo', 'image.redo', '-', 'image.cut', 'image.copy', 'image.copymerged', 'image.paste', 'image.clear', 'image.fill', '-', 'image.transform', 'image.fliplh', 'image.fliplv']],
    ['Image', [{ label: 'Adjustments', sub: () => ['image.bc', 'image.levels', 'image.curves', 'image.hsl', 'image.balance', '-', 'image.auto', 'image.bw', 'image.invertc', 'image.posterize', 'image.threshold'].map(menuItem) }, '-', 'image.imgsize', 'image.canvas', { label: 'Rotate', sub: () => ['image.rotr', 'image.rotl', 'image.rot180', '-', 'image.fliph', 'image.flipv'].map(menuItem) }, 'image.cropsel', 'image.trim']],
    ['Layer', ['image.newlayer', 'image.duplayer', 'image.dellayer', '-', 'image.layercopy', 'image.layercut', '-', 'image.rasterize', 'image.mergedown', 'image.mergevis', 'image.flatten']],
    ['Select', ['image.selall', 'image.deselect', 'image.invert', '-', 'image.feather', 'image.sellayer']],
    ['Filter', ['image.blur', 'image.sharpen', 'image.noise', 'image.pixelate']],
    ['View', () => [...looks, 'image.zin', 'image.zout', 'image.zfit', 'image.z100', '-', 'view.full']],
    ['Help', ['help.tour', 'help.keys', 'help.keymap', '-', 'help.updates', 'help.contact', 'help.about']],
  ]);
  if (App.module === 'video') return App.buildMenus([
    ['File', Modes.beginner ? ['video.new', 'video.import', 'video.photos', '-', 'video.export', 'video.frame', '-', 'video.settings', 'file.prefs'] : ['video.new', 'video.rename', 'video.delete', '-', 'video.import', 'video.importdisk', 'video.photos', '-', 'video.export', 'video.frame', 'video.frameimg', '-', 'video.settings', 'file.prefs']],
    ['Edit', Modes.beginner ? ['video.undo', 'video.redo', '-', 'video.split', 'video.del', 'video.dup', 'video.selall'] : ['video.undo', 'video.redo', '-', 'video.split', 'video.del', 'video.ripple', 'video.dup', 'video.selall', '-', 'video.xfade', 'video.detach']],
    ['Clip', ['video.title', 'video.xfade', ...(Modes.beginner ? [] : ['video.detach', '-', 'video.vtrack', 'video.atrack'])]],
    ['Playback', ['video.play', 'video.start', 'video.end']],
    ['View', () => [...looks, 'video.zin', 'video.zout', 'video.zfit', '-', 'view.full']],
    ['Help', ['help.tour', 'help.keys', 'help.keymap', '-', 'help.updates', 'help.contact', 'help.about']],
  ]);
  if (Modes.beginner) return App.buildMenus([   // the short menus; Advanced has everything
    ['File', ['file.import', 'file.export', '-', 'file.prefs']],
    ['Edit', ['dev.undo', 'dev.redo', '-', 'edit.selectall', 'edit.selectnone']],
    ['Photo', ['flag.pick', 'flag.none', 'flag.reject', rating, '-', 'photo.rotl', 'photo.rotr', '-', 'dev.auto', 'dev.reset', 'photo.imageedit', 'photo.videoshow', '-', 'photo.sharpest', 'photo.duplicates', '-', 'col.new', 'photo.remove']],
    ['View', () => [...looks, 'view.grid', 'view.loupe', 'go.develop', '-', 'view.full']],
    ['Help', ['help.tour', 'help.keys', 'help.keymap', '-', 'help.updates', 'help.contact', 'help.about']],
  ]);
  App.buildMenus([
    ['File', () => ['file.newcatalog', 'file.catalogs', { label: 'Open Recent', sub: recent }, '-', 'file.import', 'file.tether', '-', 'file.export', 'file.exportagain', { label: 'Plug-in Extras', sub: () => Plugins.menu() }, '-', 'file.backup', 'file.optimize', 'file.plugins', '-', 'file.prefs']],
    ['Edit', ['dev.undo', 'dev.redo', '-', 'edit.selectall', 'edit.selectnone', '-', 'edit.identity', 'edit.watermarks', 'edit.templates', 'edit.metapresets', 'edit.keywordsets', 'prefs.editors']],
    ['Library', ['col.new', 'col.smart', 'col.set', '-', 'col.quick', 'col.showquick', 'col.savequick', '-', 'filter.toggle', 'filter.bar', 'paint.toggle', '-', 'people.find', 'photo.duplicates', 'photo.sharpest', 'photo.smart', 'photo.smartdiscard', 'photo.locate', '-', 'photo.rename', 'photo.dng']],
    ['Photo', () => ['photo.vcopy', '-', 'flag.pick', 'flag.none', 'flag.reject', rating,
      { label: 'Set Color Label', sub: [...Object.keys(LABELS).map(l => ({ label: l[0].toUpperCase() + l.slice(1), run: () => App.rate({ label: l }) })), { label: 'None', run: () => App.rate({ label: '' }) }] }, 'rate.auto', '-',
      'stack.group', 'stack.ungroup', 'stack.toggle', 'stack.auto', '-', 'photo.rotl', 'photo.rotr', 'photo.fliph', 'photo.flipv', '-',
      'photo.imageedit', 'photo.videoshow', { label: 'Edit In', sub: () => [...App.conf('editors', []).map(ed => ({ label: ed.name, run: () => Ext.editIn(ed) })), { label: 'Configure External Editors…', run: () => App.run('prefs.editors') }] }, { label: 'Photo Merge', sub: [{ label: 'Panorama…', key: 'Ctrl+M', run: () => App.run('merge.pano') }, { label: 'HDR…', key: 'Ctrl+Shift+H', run: () => App.run('merge.hdr') }, { label: 'Focus Stack…', run: () => App.run('merge.focus') }] }, '-', 'photo.explorer', 'photo.remove']],
    ['Develop', ['dev.copy', 'dev.paste', 'dev.sync', 'dev.auto', 'dev.reset', '-', 'dev.snapshot', 'dev.preset', '-', 'dev.before', 'dev.reference', 'dev.proof', '-', 'tool.crop', 'tool.spot', 'tool.redeye', 'tool.brush', 'tool.linear', 'tool.radial', 'tool.guided']],
    ['Metadata', ['meta.kwnew', 'edit.keywordsets', '-', 'meta.sync', 'edit.metapresets', '-', 'meta.xmpwrite', 'meta.xmpread', 'meta.exif']],
    ['View', () => [...looks, 'view.grid', 'view.loupe', 'view.compare', 'view.survey', 'view.people', '-', 'view.info', 'view.panels', 'view.film', 'view.full']],
    ['Window', MODULES.map(m => 'mod.' + m.id)],
    ['Help', ['help.tour', 'help.keys', 'help.keymap', '-', 'help.updates', 'help.contact', 'help.about']],
  ]);
}

/* a command as a menu entry, for submenus built on the fly */
function menuItem(id) { if (id === '-') return id; const c = App.commands[id]; return c && { label: c.label, key: c.key, run: () => App.run(id) }; }

function looksMenu(kind) {
  const themes = Object.entries(THEMES).map(([k, n]) => ({ label: n, checked: Theme.cur === k, run: () => Theme.set(k) }));
  const langs = [['en', 'English'], ['es', 'Espa\u00f1ol']].map(([k, n]) => ({ label: n, checked: Lang.cur === k, run: () => Lang.set(k) }));
  return kind === 'theme' ? themes : kind === 'lang' ? langs : [...themes, '-', ...langs];
}

/* the message and where it happened; Safari's stack leaves the message out, Chromium's starts with it */
function errorText(e) { const msg = String(e), st = (e && e.stack) || ''; return st.includes(msg) ? st : msg + (st ? '\n\n' + st : ''); }

async function start() {
  const t0 = performance.now();
  try {
    App.boot = await api('boot'); App.cfg = App.boot.config || {};
    registerCommands(); Keymap.apply(); Modes.init(); buildMenus();
    $('#looks').onclick = e => { const r = e.currentTarget.getBoundingClientRect(); UI.menu(r.right - 220, r.bottom + 6, looksMenu()); };
    $('#brand').onclick = () => App.run('help.about'); $('#brand').onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); App.run('help.about'); } };
    new MutationObserver(() => $('#brand').classList.toggle('busy', $('#activity').children.length > 0)).observe($('#activity'), { childList: true });
    $('#identity').replaceChildren(Identity.el()); $('#identity').ondblclick = () => Identity.edit(); $('#identity').title = 'Double-click to customise the identity plate';
    const pick = $('#modpick'); for (const m of MODULES) { App.addModule(m); pick.append(h('a', { data: { m: m.id }, onclick: () => App.show(m.id) }, m.name)); }
    App.addModule(Music); App.addModule(Pdf); App.addModule(ImgEd); App.addModule(Vid);
    const WORKSPACES = [['image', 'Imagine', 'Imagine: paint, combine pictures in layers, add text, fix colours'], ['video', 'Motion', 'Motion: edit video on a timeline and export an MP4'], ['music', 'Groove', 'Groove: make and edit music'], ['pdf', 'Folio', 'Folio: read, sign, mark up and rearrange PDFs']];
    const own = id => WORKSPACES.some(w => w[0] === id);
    const apps = () => $('#apps').replaceChildren(h('span', { class: 'seg', data: { notr: 1 } }, h('a', { class: !own(App.module) ? 'on' : '', title: 'Lens: organise and edit photos', onclick: () => App.show(App.lastPhoto || 'library') }, 'Lens'),
      WORKSPACES.map(([id, label, tip]) => h('a', { class: App.module === id ? 'on' : '', title: tip, onclick: () => App.show(id) }, label))));
    App.on('module', id => { if (!own(id)) App.lastPhoto = id; apps(); buildMenus(); dispatchEvent(new Event('resize')); });
    Dev.el = UI.shell('develop'); Dev.init(Dev.el); GLR.init(Dev.cv);
    Film.init();
    await App.loadCatalog();
    App.show('library');
    const wait = Math.max(0, 1900 - (performance.now() - t0)), tour = !App.pref('tourDone', false);
    setTimeout(() => $('#splash').classList.add('gone'), wait);   // let the logo finish drawing itself
    if (tour) setTimeout(() => Tour.start(), wait + 650);
    else setTimeout(() => Updates.boot(), wait + 2500);     // asks once about update checks; not during the first-run tour
    App.on('catalog', () => { Lib.cells.clear(); });
    if (!App.photos.size && !tour) UI.toast('Welcome. Use File > Import Photos, or open Local Disk in the left panel to add a folder.');
  } catch (e) { console.error(e); $('#splash').classList.add('gone'); document.body.append(h('div', { class: 'fatal' }, h('h2', {}, 'Opia could not start'), h('pre', {}, errorText(e)))); }
}
start();

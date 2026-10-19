'use strict';
/* Video workspace: a timeline editor. A project has tracks (video tracks draw over the ones below them; audio tracks add sound)
   and clips placed on them: video, pictures, titles and sound. Each clip points into a media file between an in point and a length.
   The preview is played here in the browser, one media element per clip on screen, drawn into a canvas; the finished film is
   made by FFmpeg on the server (server/video.py), from the same project, so the two follow the same rules:
   a fade changes the clip's opacity (over black, or over the tracks below) and its volume, and a crossfade lets a clip start
   over the end of the one before it on the same track while that one's sound fades out. */

const VD_SIZES = [['1080p, wide (1920 × 1080)', 1920, 1080], ['720p, wide (1280 × 720)', 1280, 720], ['4K, wide (3840 × 2160)', 3840, 2160], ['Square (1080 × 1080)', 1080, 1080], ['Vertical, for phones (1080 × 1920)', 1080, 1920], ['Portrait 4:5 (1080 × 1350)', 1080, 1350]];
const VD_POS = [['bottom', 'Bottom'], ['lower', 'Lower third'], ['center', 'Centre'], ['top', 'Top']];
const VD_EXTS = ['.mp4', '.m4v', '.mov', '.webm', '.mkv', '.avi', '.wmv', '.mpg', '.mpeg', '.mts', '.m2ts', '.3gp', '.mp3', '.wav', '.m4a', '.aac', '.ogg', '.opus', '.flac', '.wma', '.aif', '.aiff', '.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tif', '.tiff', '.heic'];

const Vid = {
  id: 'video', name: 'Motion', exclusive: true, p: null, sel: new Set(), t: 0, playing: false, z: 60, undo: [], redo: [], snap: true,
  els: new Map(), peaks: new Map(), titleCache: new Map(), media: new Map(),

  /* ---- set-up */
  init(el) {
    el.left.remove(); el.right.remove(); el.center.classList.add('vd');
    this.bar = h('div', { class: 'mu-bar vd-bar' }); this.tools = h('div', { class: 'mu-tools vd-tools' });
    this.bin = h('div', { class: 'vd-bin' }); this.insp = h('div', { class: 'vd-insp' });
    this.cv = h('canvas', { class: 'vd-cv', role: 'img', 'aria-label': 'Video preview' }); this.g = this.cv.getContext('2d'); this.screen = h('div', { class: 'vd-screen' }, this.cv);
    this.transport = h('div', { class: 'vd-transport' });
    this.view = h('div', { class: 'vd-view' }, this.screen, this.transport);
    this.tl = h('div', { class: 'vd-tl' });
    this.top = h('div', { class: 'vd-top' }, this.bin, this.view, this.insp);
    this.welcomeEl = h('div', { class: 'vd-welcome' });
    this.picker = h('input', { type: 'file', multiple: true, accept: 'video/*,audio/*,image/*,' + VD_EXTS.join(','), style: { display: 'none' } });
    el.center.append(this.bar, this.tools, this.top, h('div', { class: 'vd-split', onpointerdown: e => this.resizeTl(e) }), this.tl, this.welcomeEl, this.picker);
    for (const b of [this.bar, this.tools, this.transport]) b.addEventListener('mousedown', e => { if (!e.target.closest('input,select,textarea')) e.preventDefault(); });
    for (const z of [this.bin, this.tl]) { z.addEventListener('dragover', e => { if ([...e.dataTransfer.types].some(t => t === 'Files' || t === 'text/opia-media')) e.preventDefault(); }); }
    this.bin.addEventListener('drop', e => { if (!e.dataTransfer.files.length) return; e.preventDefault(); this.importFiles([...e.dataTransfer.files]).catch(UI.error); });
    this.tl.addEventListener('drop', e => this.dropOnTimeline(e));
    new ResizeObserver(() => { if (App.module === 'video' && this.p) { this.fitScreen(); this.paint(); } }).observe(this.screen);
    App.on('prefs', k => { if (k === 'beginner' && this.bar) this.draw(); });
    this.keys = {
      'Space': () => this.toggle(), 'S': () => this.split(), 'Delete': () => this.remove(), 'Backspace': () => this.remove(), 'Shift+Delete': () => this.remove(true), 'Ctrl+D': () => this.duplicate(),
      'Ctrl+Z': 'video.undo', 'Ctrl+Y': 'video.redo', 'Ctrl+Shift+Z': 'video.redo', 'Ctrl+I': 'video.import', 'Ctrl+Shift+E': 'video.export', 'Ctrl+N': 'video.new', 'T': 'video.title', 'Ctrl+A': () => this.selectAll(),
      'Home': () => this.seek(0), 'End': () => this.seek(this.total()), 'ArrowLeft': () => this.seek(this.t - 1 / this.p.fps), 'ArrowRight': () => this.seek(this.t + 1 / this.p.fps),
      'Shift+ArrowLeft': () => this.seek(this.t - 1), 'Shift+ArrowRight': () => this.seek(this.t + 1), 'ArrowUp': () => this.jump(-1), 'ArrowDown': () => this.jump(1),
      'Alt+ArrowLeft': () => this.nudge(-1 / this.p.fps), 'Alt+ArrowRight': () => this.nudge(1 / this.p.fps), 'Alt+Shift+ArrowLeft': () => this.nudge(-1), 'Alt+Shift+ArrowRight': () => this.nudge(1),
      'Ctrl+=': () => this.zoom(1.4), 'Ctrl++': () => this.zoom(1.4), 'Ctrl+-': () => this.zoom(1 / 1.4), 'Ctrl+0': () => this.zoomFit(), 'Escape': () => { this.sel.clear(); this.draw(); },
    };
    this.draw();
  },
  show() { this.draw(); if (!this.p && !this.listed) { this.listed = true; this.openLast().catch(UI.error); } },
  hide() { this.pause(); },
  uid() { return Math.random().toString(36).slice(2, 10); },

  /* ---- projects: kept in Pictures\Opia\Video\<name>, saved a moment after every change */
  blank(name) { return { name, w: 1920, h: 1080, fps: 30, bg: '#000000', tracks: [{ id: this.uid(), kind: 'video', name: 'Video 2' }, { id: this.uid(), kind: 'video', name: 'Video 1' }, { id: this.uid(), kind: 'audio', name: 'Audio 1', vol: 1 }], clips: [], media: [], z: 60 }; },
  async openLast() { const last = App.conf('video_last', null); if (last && (await api('video_list')).some(p => p.name === last)) return this.load(last); this.draw(); },
  async load(name) {
    const p = await api('video_load', { name }); if (!p) return UI.toast('That project could not be found.');
    this.pause(); this.dropEls(); this.p = { ...this.blank(name), ...p, name }; this.media = new Map((this.p.media || []).map(m => [m.path, m])); this.z = this.p.z || 60;
    this.sel.clear(); this.undo = []; this.redo = []; this.t = 0; App.setConf('video_last', name); this.draw();
    const gone = this.p.media.filter(m => m.missing); if (gone.length) UI.toast(gone.length + ' media file(s) are missing. Their clips show as red.', 'error');
    this.checkMissing();
  },
  async checkMissing() { const ms = [...this.media.values()]; if (!ms.length) return; const ex = await api('fs_exists', { paths: ms.map(m => m.path) }); let n = 0; ms.forEach((m, k) => { m.missing = !ex[k]; if (m.missing) n++; }); if (n) { this.drawTimeline(); this.drawBin(); UI.toast(n + ' media file(s) could not be found where they were. Their clips are shown in red.', 'error'); } },
  async create() {
    const names = (await api('video_list')).map(p => p.name); let n = 1; while (names.includes('My Video ' + n)) n++;
    const name = await UI.prompt('New Video', 'Name', 'My Video ' + n); if (!name) return;
    if (names.includes(name)) return UI.toast('There is already a project called ' + name + '.', 'error');
    this.pause(); this.dropEls(); this.p = this.blank(name); this.media = new Map(); this.sel.clear(); this.undo = []; this.redo = []; this.t = 0;
    await this.saveNow(); App.setConf('video_last', name); this.draw();
  },
  async rename() { const n = await UI.prompt('Rename Project', 'Name', this.p.name); if (!n || n === this.p.name) return; await this.saveNow(); const r = await api('video_rename', { old: this.p.name, new: n }); this.p.name = r.name; App.setConf('video_last', r.name); this.drawBar(); },
  async projects(e) {
    const list = await api('video_list'), r = e.currentTarget.getBoundingClientRect();
    UI.menu(r.left, r.bottom + 4, [{ label: 'New Project…', run: () => this.create().catch(UI.error) }, this.p ? { label: 'Rename…', run: () => this.rename().catch(UI.error) } : null, this.p ? { label: 'Delete This Project…', run: () => this.del().catch(UI.error) } : null, list.length ? '-' : null,
      ...list.slice(0, 14).map(pr => ({ label: pr.name, checked: this.p && pr.name === this.p.name, run: () => this.saveNow().then(() => this.load(pr.name)).catch(UI.error) }))].filter(Boolean));
  },
  async del() { if (!await UI.confirm('Delete Project?', 'Delete "' + this.p.name + '"? Your media files are not touched; only the project (and anything Opia copied into its Media folder) is removed.', 'Delete')) return; clearTimeout(this.saveT); await api('video_delete', { name: this.p.name }); this.pause(); this.dropEls(); this.p = null; App.setConf('video_last', null); this.draw(); },
  data() { const p = this.p; return { name: p.name, w: p.w, h: p.h, fps: p.fps, bg: p.bg, tracks: p.tracks, clips: p.clips, media: [...this.media.values()].map(m => ({ ...m, missing: undefined })), z: this.z }; },
  saveSoon() { clearTimeout(this.saveT); this.saveT = setTimeout(() => this.saveNow().catch(UI.error), 900); },
  async saveNow() { clearTimeout(this.saveT); if (this.p) await api('video_save', { name: this.p.name, project: this.data() }); },

  /* ---- undo */
  state() { const p = this.p; return JSON.stringify({ w: p.w, h: p.h, fps: p.fps, bg: p.bg, tracks: p.tracks, clips: p.clips }); },
  mark() { this.undo.push(this.state()); if (this.undo.length > 120) this.undo.shift(); this.redo = []; },
  after(full = true) { this.saveSoon(); this.titleCache.clear(); if (full) this.draw(); else { this.drawTimeline(); this.drawInsp(); this.drawBar(); } this.paint(); },
  step(from, to) { if (!this.p || !from.length) return; to.push(this.state()); Object.assign(this.p, JSON.parse(from.pop())); const ids = new Set(this.p.clips.map(c => c.id)); this.sel = new Set([...this.sel].filter(i => ids.has(i))); this.after(); this.sync(true); },

  /* ---- media */
  pickFiles() { return new Promise(res => { this.picker.value = ''; this.picker.onchange = () => res([...this.picker.files]); this.picker.click(); }); },
  async importMedia() { if (!this.p) await this.create(); if (!this.p) return; const f = await this.pickFiles(); if (f.length) await this.importFiles(f); },
  async importFromDisk() { if (!this.p) await this.create(); if (!this.p) return; const path = await UI.pickFile(App.conf('video_dir', App.boot.pictures.replace(/Pictures$/, 'Videos')), VD_EXTS); if (path) { App.setConf('video_dir', path.replace(/[\\/][^\\/]*$/, '')); await this.addMedia(path); } },
  async importFiles(files) {
    if (!this.p) await this.create(); if (!this.p) return [];
    await this.saveNow(); const out = [];
    for (const f of files) {
      try {
        let path = f.path;
        if (!path) {
          const r = await fetch('/api/stream/video_media_put?' + new URLSearchParams({ project: this.p.name, name: f.name }), { method: 'POST', body: f }), j = await r.json();
          if (j.error) throw new Error(j.error); path = j.result.path;
        }
        const m = await this.addMedia(path); if (m) out.push(m);
      } catch (e) { UI.error(e); }
    }
    return out;
  },
  async addMedia(path) {
    let m = this.media.get(path); if (m && !m.missing) return m;
    m = await api('video_probe', { path });
    if (!m.play) { UI.toast(m.name + ' cannot be played here directly; making a preview copy. The original is used for the export.'); const r = await runJob(api('video_proxy', { path }), 'Preparing ' + m.name); m.play = r.play; }
    this.media.set(path, m); this.saveSoon(); this.drawBin(); return m;
  },
  mediaUrl(path) { return '/img/media?path=' + encodeURIComponent(path); },
  playPath(c) { const m = this.media.get(c.src); return (m && m.play) || c.src; },
  async addPhotos() {
    const ids = App.selIds(); if (!ids.length) return UI.toast('Select some photos in Lens first.'); if (!this.p) await this.create(); if (!this.p) return;
    await this.saveNow(); const made = [];
    for (const id of ids) {
      const ph = App.photo(id); if (!ph) continue;
      const cv = await Exporter.render(ph, { resize: { enabled: true, mode: 'wh', w: this.p.w * 1.5, h: this.p.h * 1.5, dontEnlarge: true } });
      const r = await api('video_still_put', { project: this.p.name, name: ph.filename.replace(/\.[^.]+$/, '') + '-' + id + '.jpg', data: cv.toDataURL('image/jpeg', .93) });
      made.push(await this.addMedia(r.path));
    }
    if (!made.length) return;
    const tr = this.tracksOf('video').slice(-1)[0], end = this.trackEnd(tr.id); this.mark();
    made.forEach((m, k) => this.p.clips.push(this.clipFor(m, tr.id, end + k * 4 - (k ? .5 * k : 0), { dur: 4, xfade: k ? .5 : 0 })));
    this.after(); UI.toast(made.length + ' photo(s) added to the timeline, 4 seconds each with a crossfade.');
  },
  clipFor(m, track, start, extra) {
    const c = { id: this.uid(), track, kind: m.kind, src: m.path, name: m.name, in: 0, dur: m.kind === 'image' ? 4 : Math.max(.1, m.dur), max: m.kind === 'image' ? 0 : m.dur, start: Math.max(0, start), vol: 1, fadeIn: 0, fadeOut: 0, xfade: 0, fit: 'fit', scale: 1, x: 0, y: 0, opacity: 1 };
    if (m.kind === 'video') c.audio = !!m.audio;
    return Object.assign(c, extra || {});
  },
  /* put a media file on the timeline: at a time on a track, or at the end of the first track that suits it */
  place(m, track, start) {
    const kind = m.kind === 'audio' ? 'audio' : 'video';
    let tr = track && this.track(track); if (!tr || tr.kind !== kind) tr = kind === 'audio' ? this.tracksOf('audio')[0] : this.tracksOf('video').slice(-1)[0];
    if (!tr) { tr = { id: this.uid(), kind, name: kind === 'audio' ? 'Audio 1' : 'Video 1', vol: 1 }; this.p.tracks.push(tr); }
    this.mark();
    if (!this.p.clips.length && m.kind === 'video' && m.w && m.h) { this.p.w = m.w + (m.w % 2); this.p.h = m.h + (m.h % 2); this.p.fps = Math.round(m.fps) || 30; UI.toast('The project now matches this video: ' + this.p.w + ' × ' + this.p.h + ', ' + this.p.fps + ' frames a second. Change it in Project Settings.'); }
    const c = this.clipFor(m, tr.id, start ?? this.trackEnd(tr.id)); this.p.clips.push(c); this.sel = new Set([c.id]); this.after(); this.fitScreen();
    return c;
  },
  dropOnTimeline(e) {
    e.preventDefault(); if (!this.p) return;
    const lane = e.target.closest('.vd-lane'), at = lane ? this.timeAt(e) : null, tid = lane && lane.dataset.track, idx = e.dataTransfer.getData('text/opia-media');
    if (idx) { const m = this.media.get(idx); if (m) this.place(m, tid, at); return; }
    if (e.dataTransfer.files.length) this.importFiles([...e.dataTransfer.files]).then(ms => { let t = at; for (const m of ms) { const c = this.place(m, tid, t); t = c.start + c.dur; } }).catch(UI.error);
  },

  /* ---- tracks and clips */
  track(id) { return this.p.tracks.find(t => t.id === id); },
  tracksOf(kind) { return this.p.tracks.filter(t => t.kind === kind); },
  clip(id) { return this.p.clips.find(c => c.id === id); },
  picked() { return this.p ? this.p.clips.filter(c => this.sel.has(c.id)) : []; },
  total() { return this.p ? Math.max(0, ...this.p.clips.map(c => c.start + c.dur)) : 0; },
  trackEnd(tid) { return Math.max(0, ...this.p.clips.filter(c => c.track === tid).map(c => c.start + c.dur)); },
  addTrack(kind) { this.mark(); const n = this.tracksOf(kind).length + 1, t = { id: this.uid(), kind, name: (kind === 'video' ? 'Video ' : 'Audio ') + n, vol: 1 }; if (kind === 'video') this.p.tracks.unshift(t); else this.p.tracks.push(t); this.after(); },
  delTrack(t) { if (this.tracksOf(t.kind).length < 2) return UI.toast('Keep at least one ' + t.kind + ' track.'); this.mark(); this.p.clips = this.p.clips.filter(c => c.track !== t.id); this.p.tracks = this.p.tracks.filter(x => x !== t); this.after(); },
  setTrack(t, k, v) { this.mark(); t[k] = v; this.after(false); this.sync(true); },
  split() {
    if (!this.p) return; const t = this.t, eps = 1 / this.p.fps;
    let cs = this.picked().filter(c => c.start + eps < t && t < c.start + c.dur - eps); if (!this.sel.size) cs = this.p.clips.filter(c => c.start + eps < t && t < c.start + c.dur - eps);
    if (!cs.length) return UI.toast(this.sel.size ? 'Move the playhead over the picked clip to split it there.' : 'Move the playhead over a clip to split it there.');
    this.mark(); const made = [];
    for (const c of cs) { const cut = t - c.start, b = { ...clone(c), id: this.uid(), start: t, in: c.in + cut, dur: c.dur - cut, fadeIn: 0, xfade: 0 }; c.dur = cut; c.fadeOut = 0; this.p.clips.push(b); made.push(b.id); }
    this.sel = new Set(made); this.after();
  },
  remove(ripple) {
    const cs = this.picked(); if (!cs.length) return; this.mark();
    for (const c of cs) { this.p.clips = this.p.clips.filter(x => x !== c); if (ripple) for (const o of this.p.clips) if (o.track === c.track && o.start >= c.start + c.dur - 1e-3) o.start -= c.dur; }
    this.sel.clear(); this.after(); this.sync(true);
  },
  duplicate() { const cs = this.picked(); if (!cs.length) return; this.mark(); const made = []; for (const c of cs) { const d = { ...clone(c), id: this.uid(), start: this.trackEnd(c.track), xfade: 0 }; this.p.clips.push(d); made.push(d.id); } this.sel = new Set(made); this.after(); },
  /* move the picked clips along their tracks from the keyboard */
  nudge(d) {
    const cs = this.picked(); if (!cs.length) return; d = Math.max(d, -Math.min(...cs.map(c => c.start))); if (!d) return;
    const last = this.undo[this.undo.length - 1]; if (!(this.nudging && performance.now() - this.nudging < 800 && last)) this.mark(); this.nudging = performance.now();
    for (const c of cs) c.start += d; const f = document.activeElement && document.activeElement.dataset && document.activeElement.dataset.id; this.after(false);
    if (f) { const el = $(`.vd-clip[data-id="${f}"]`, this.tl); if (el) el.focus(); }
  },
  selectAll() { if (this.p) { this.sel = new Set(this.p.clips.map(c => c.id)); this.drawTimeline(); this.drawInsp(); } },
  detachAudio() {
    const cs = this.picked().filter(c => c.kind === 'video' && c.audio && !c.mute); if (!cs.length) return UI.toast('Pick a video clip that has sound.');
    this.mark(); let at = this.tracksOf('audio')[0]; if (!at) { at = { id: this.uid(), kind: 'audio', name: 'Audio 1', vol: 1 }; this.p.tracks.push(at); }
    for (const c of cs) { this.p.clips.push({ ...clone(c), id: this.uid(), track: at.id, kind: 'audio', name: c.name + ' (sound)', audio: undefined, fit: undefined, scale: undefined, x: undefined, y: undefined, opacity: undefined }); c.mute = true; }
    this.after(); UI.toast('The sound is now a clip of its own on ' + at.name + ', so it can be trimmed and moved separately.');
  },
  /* the clip just before c on its track */
  before(c) { return this.p.clips.filter(o => o !== c && o.track === c.track && o.start < c.start).sort((a, b) => b.start + b.dur - (a.start + a.dur))[0]; },
  crossfade(c, on) {
    c = c || this.picked()[0]; if (!c) return; const prev = this.before(c), later = this.p.clips.filter(o => o.track === c.track && o.start >= c.start && o !== c);
    if (on === false || (on == null && c.xfade)) { if (!c.xfade) return; this.mark(); const d = c.xfade; c.xfade = 0; c.start += d; later.forEach(o => { o.start += d; }); return this.after(); }
    if (!prev) return UI.toast('A crossfade needs a clip just before this one on the same track.');
    const gap = c.start - (prev.start + prev.dur), d = Math.min(1, prev.dur / 2, c.dur / 2), shift = gap + d;
    this.mark(); c.start -= shift; later.forEach(o => { o.start -= shift; }); c.xfade = d; this.after();
  },
  /* times a clip edge could snap to */
  snaps(skip) { const out = [0, this.t]; for (const c of this.p.clips) if (!skip.has(c.id)) out.push(c.start, c.start + c.dur); return out; },
  snapTo(v, skip, e) { if (!this.snap || (e && e.altKey)) return v; const lim = 8 / this.z; let best = v, d = lim; for (const s of this.snaps(skip)) { const k = Math.abs(s - v); if (k < d) { d = k; best = s; } } return best; },
  jump(dir) { if (!this.p) return; const ts = [...new Set([0, ...this.p.clips.flatMap(c => [c.start, c.start + c.dur])])].sort((a, b) => a - b), eps = 1e-3; const n = dir > 0 ? ts.find(v => v > this.t + eps) : [...ts].reverse().find(v => v < this.t - eps); if (n != null) this.seek(n); },

  /* ---- the preview */
  fitScreen() {
    if (!this.p) return; const r = this.screen.getBoundingClientRect(); if (!r.width) return;
    const k = Math.min((r.width - 16) / this.p.w, (r.height - 16) / this.p.h), w = Math.max(16, Math.floor(this.p.w * k)), hh = Math.max(9, Math.floor(this.p.h * k)), dpr = devicePixelRatio || 1;
    this.cv.style.width = w + 'px'; this.cv.style.height = hh + 'px'; const pw = Math.min(this.p.w, Math.round(w * dpr)), ph = Math.round(pw * this.p.h / this.p.w);
    if (this.cv.width !== pw || this.cv.height !== ph) { this.cv.width = pw; this.cv.height = ph; }
  },
  active(t) { const hid = new Set(this.p.tracks.filter(x => x.hide).map(x => x.id)); return this.p.clips.filter(c => t >= c.start && t < c.start + c.dur && !hid.has(c.track)); },
  /* how far a clip has faded in or out at time t (0..1) */
  env(c, t, sound) {
    const lt = t - c.start, fin = Math.max(c.fadeIn || 0, c.xfade || 0); let out = c.fadeOut || 0, k = 1;
    if (sound) for (const o of this.p.clips) if (o !== c && o.track === c.track && o.xfade && c.start < o.start && o.start < c.start + c.dur && c.start + c.dur <= o.start + o.dur + 1e-6) out = Math.max(out, c.start + c.dur - o.start);
    if (fin > 0 && lt < fin) k = Math.min(k, lt / fin); if (out > 0 && c.dur - lt < out) k = Math.min(k, (c.dur - lt) / out);
    return clamp(k, 0, 1);
  },
  elFor(c) {
    let e = this.els.get(c.id); const src = this.playPath(c);
    if (e && e.src === src && e.kind === c.kind) return e;
    if (e) this.dropEl(c.id);
    if (c.kind === 'title') return null;
    if (c.kind === 'image') { const im = new Image(); im.src = this.mediaUrl(src); im.onload = () => this.paint(); e = { kind: 'image', src, node: im }; this.els.set(c.id, e); return e; }
    const node = document.createElement(c.kind === 'audio' ? 'audio' : 'video'); node.preload = 'auto'; node.playsInline = true; node.src = this.mediaUrl(src);
    node.addEventListener('seeked', () => { if (!this.playing) this.paint(); }); node.addEventListener('error', () => this.playFailed(c)); node.addEventListener('loadeddata', () => { if (!this.playing) { this.syncOne(c, this.t, true); this.paint(); } });
    e = { kind: c.kind, src, node }; this.els.set(c.id, e);
    if (this.ac) this.route(e);
    return e;
  },
  /* the browser could not decode a file it was expected to play: make a preview copy, once */
  async playFailed(c) {
    const m = this.media.get(c.src); if (!m || this.failing === m.path) return;
    if (m.play !== m.path) return UI.toast(m.name + ' cannot be shown in the preview. It will still be used for the export.', 'error');
    this.failing = m.path;
    try { UI.toast(m.name + ' does not play here; making a preview copy. The original is used for the export.'); const r = await runJob(api('video_proxy', { path: m.path }), 'Preparing ' + m.name); m.play = r.play; this.saveSoon(); for (const x of this.p.clips) if (x.src === m.path) this.dropEl(x.id); this.sync(true); this.paint(); }
    catch (e) { UI.error(e); } finally { this.failing = null; }
  },
  route(e) { if (e.gain || !this.ac || e.kind === 'image') return; try { e.gain = this.ac.createGain(); this.ac.createMediaElementSource(e.node).connect(e.gain); e.gain.connect(this.ac.destination); } catch (err) { e.gain = null; } },
  dropEl(id) { const e = this.els.get(id); if (!e) return; if (e.node.pause) { e.node.pause(); e.node.removeAttribute('src'); e.node.load(); } if (e.gain) e.gain.disconnect(); this.els.delete(id); },
  dropEls() { for (const id of [...this.els.keys()]) this.dropEl(id); },
  /* keep one clip's media element at the right moment */
  syncOne(c, t, force) {
    const e = this.elFor(c); if (!e || e.kind === 'image') return;
    const n = e.node, want = c.in + (t - c.start), on = t >= c.start && t < c.start + c.dur, soon = !on && c.start > t && c.start - t < 1.2;
    if (on) {
      if (this.playing) { if (force || Math.abs(n.currentTime - want) > .3) n.currentTime = want; if (n.paused) n.play().catch(() => {}); }
      else { if (!n.paused) n.pause(); if (force || Math.abs(n.currentTime - want) > .5 / this.p.fps) n.currentTime = want; }
      const tr = this.track(c.track), sound = c.kind === 'audio' || (c.audio && !c.mute);
      const g = sound && !tr.mute ? (c.vol ?? 1) * (tr.vol ?? 1) * this.env(c, t, true) : 0;
      if (e.gain) e.gain.gain.value = g; else n.volume = clamp(g, 0, 1);
    } else { if (!n.paused) n.pause(); if (soon && Math.abs(n.currentTime - c.in) > .05) n.currentTime = c.in; if (e.gain) e.gain.gain.value = 0; }
  },
  sync(force) {
    if (!this.p) return; const t = this.t, keep = new Set();
    for (const c of this.p.clips) { const near = (t >= c.start - 1.2 && t < c.start + c.dur) || c.kind === 'image'; if (!near && !this.els.has(c.id)) continue; keep.add(c.id); this.syncOne(c, t, force); }
    for (const id of [...this.els.keys()]) if (!keep.has(id)) this.dropEl(id);
  },
  titleCanvas(c) {
    const p = this.p, key = c.id + JSON.stringify(c.title) + p.w + 'x' + p.h; if (this.titleCache.has(key)) return this.titleCache.get(key);
    const T = c.title || {}, cv = h('canvas', { width: p.w, height: p.h }), g = cv.getContext('2d'), size = Math.max(6, (T.size || 7) / 100 * p.h), lines = String(T.text || '').split('\n');
    g.font = (T.bold ? 'bold ' : '') + size + 'px ' + (T.font || 'Nunito, Arial, sans-serif'); g.textBaseline = 'middle';
    const lh = size * 1.2, bh = lines.length * lh, bw = Math.max(...lines.map(s => g.measureText(s).width)), left = T.pos === 'lower', cx = left ? p.w * .06 : p.w / 2;
    const cy = { top: p.h * .1 + bh / 2, center: p.h / 2, bottom: p.h * .88 - bh / 2, lower: p.h * .76 - bh / 2 }[T.pos || 'bottom'];
    if (T.box) { const pad = size * .45; g.fillStyle = T.boxColor || 'rgba(0,0,0,.55)'; g.beginPath(); (g.roundRect ? g.roundRect.bind(g) : g.rect.bind(g))((left ? cx : cx - bw / 2) - pad, cy - bh / 2 - pad * .6, bw + pad * 2, bh + pad * 1.2, size * .25); g.fill(); }
    g.textAlign = left ? 'left' : 'center'; g.fillStyle = T.color || '#ffffff'; if (!T.box) { g.shadowColor = 'rgba(0,0,0,.6)'; g.shadowBlur = size * .12; g.shadowOffsetY = size * .04; }
    lines.forEach((s, k) => g.fillText(s, cx, cy - bh / 2 + lh * (k + .5)));
    this.titleCache.set(key, cv); return cv;
  },
  /* draw the frame at time t (default: the playhead) into a canvas the size of the project, or into the preview */
  frame(g, W, H, t = this.t) {
    const p = this.p, order = p.tracks.map(x => x.id); g.save(); g.fillStyle = p.bg || '#000'; g.fillRect(0, 0, W, H);
    const cs = this.active(t).filter(c => c.kind !== 'audio').sort((a, b) => order.indexOf(b.track) - order.indexOf(a.track) || a.start - b.start);
    for (const c of cs) {
      const a = (c.opacity ?? 1) * this.env(c, t); if (a <= 0) continue; g.globalAlpha = a;
      if (c.kind === 'title') { g.drawImage(this.titleCanvas(c), 0, 0, W, H); continue; }
      const e = this.elFor(c); if (!e) continue; const n = e.node, sw = n.videoWidth || n.naturalWidth, sh = n.videoHeight || n.naturalHeight; if (!sw || !sh || (n.readyState !== undefined && e.kind !== 'image' && n.readyState < 2)) continue;
      const s = c.scale ?? 1, k = (c.fit === 'fill' ? Math.max(W / sw, H / sh) : Math.min(W / sw, H / sh)), dw = sw * k * s, dh = sh * k * s, x = (W - dw) / 2 + (c.x || 0) * W, y = (H - dh) / 2 + (c.y || 0) * H;
      if (c.fit === 'fill') { g.save(); g.beginPath(); g.rect((W - W * s) / 2 + (c.x || 0) * W, (H - H * s) / 2 + (c.y || 0) * H, W * s, H * s); g.clip(); g.drawImage(n, x, y, dw, dh); g.restore(); } else g.drawImage(n, x, y, dw, dh);
    }
    g.restore();
  },
  paint() {
    if (!this.p || App.module !== 'video') return; if (this.praf) return;
    this.praf = requestAnimationFrame(() => { this.praf = 0; if (!this.p) return; this.frame(this.g, this.cv.width, this.cv.height); this.drawClock(); this.drawHead(); });
  },
  toggle() { this.playing ? this.pause() : this.play(); },
  play() {
    if (!this.p || !this.p.clips.length) return;
    if (!this.ac) { try { this.ac = new AudioContext(); for (const e of this.els.values()) this.route(e); } catch (err) { this.ac = null; } }
    if (this.ac && this.ac.state === 'suspended') this.ac.resume();
    if (this.t >= this.total() - .02) this.t = 0;
    this.playing = true; this.t0 = performance.now() - this.t * 1000; this.sync(true); this.drawTransport(); document.body.classList.add('vd-playing');
    const tick = () => {
      if (!this.playing) return; this.t = (performance.now() - this.t0) / 1000;
      if (this.t >= this.total()) { this.t = this.total(); this.pause(); return; }
      this.sync(); this.frame(this.g, this.cv.width, this.cv.height); this.drawClock(); this.drawHead(true); this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  },
  pause() { if (!this.playing) return; this.playing = false; cancelAnimationFrame(this.raf); for (const e of this.els.values()) if (e.node.pause) e.node.pause(); document.body.classList.remove('vd-playing'); this.sync(true); this.drawTransport(); this.paint(); },
  seek(t) { if (!this.p) return; this.t = clamp(t, 0, Math.max(this.total(), 0)); if (this.playing) this.t0 = performance.now() - this.t * 1000; this.sync(true); this.paint(); this.drawInspTime(); },
  fmtT(t, frames) { const p = this.p, s = Math.max(0, t), m = Math.floor(s / 60), r = s - m * 60; return m + ':' + String(Math.floor(r)).padStart(2, '0') + (frames ? '.' + String(Math.floor((r % 1) * (p ? p.fps : 30))).padStart(2, '0') : ''); },

  /* ---- drawing the interface */
  draw() {
    if (!this.bar) return; const on = !!this.p;
    for (const el of [this.top, this.tl, $('.vd-split', this.top.parentNode), this.tools]) el.style.display = on ? '' : 'none';
    this.welcomeEl.style.display = on ? 'none' : '';
    this.drawBar(); if (!on) return this.drawWelcome();
    this.drawTools(); this.drawBin(); this.drawInsp(); this.drawTransport(); this.drawTimeline(); requestAnimationFrame(() => { this.fitScreen(); this.sync(true); this.paint(); });
  },
  btn(label, run, tip, cls) { const b = h('button', { class: 'btn ' + (cls || ''), onclick: () => { try { const r = run(); if (r && r.catch) r.catch(UI.error); } catch (e) { UI.error(e); } } }, label); if (tip) { b.dataset.tip = tip; b.dataset.tipName = label.replace(/…$/, ''); } return b; },
  async drawWelcome() {
    const list = await api('video_list').catch(() => []);
    this.welcomeEl.replaceChildren(h('div', { class: 'pd-welcome' }, h('img', { class: 'pd-logo', src: 'img/opia-video-icon.svg', alt: '' }), h('h2', {}, 'Motion'), h('p', { class: 'dim' }, 'Put clips, pictures, titles and music on a timeline, trim and split them, fade between them, and export an MP4.'),
      h('div', { class: 'pd-big' }, this.btn('New Video…', () => this.create(), null, 'primary big'), this.btn('Make a Slideshow from Selected Photos', () => this.addPhotos(), 'Start a project from the photos selected in Lens, four seconds each with crossfades.', 'big')),
      list.length ? h('div', { class: 'pd-recent' }, h('div', { class: 'fsec' }, 'Your projects'), list.slice(0, 10).map(pr => h('a', { data: { notr: 1 }, onclick: () => this.load(pr.name).catch(UI.error) }, pr.name))) : null));
  },
  drawBar() {
    const p = this.p, sep = () => h('span', { class: 'mu-sep' });
    if (!p) return this.bar.replaceChildren(this.btn('New…', () => this.create(), 'Start a new video project.', 'primary'), h('button', { class: 'btn', title: 'Open one of your video projects', onclick: e => this.projects(e).catch(UI.error) }, 'Projects ▾'), h('span', { class: 'dim' }, 'Start a project to edit video.'));
    const projBtn = h('button', { class: 'btn', onclick: e => this.projects(e).catch(UI.error) }, 'Projects ▾');
    this.bar.replaceChildren(projBtn, h('b', { class: 'mu-name', title: 'Double-click to rename', data: { notr: 1 }, ondblclick: () => this.rename().catch(UI.error) }, p.name), h('span', { class: 'dim' }, p.w + ' × ' + p.h + ', ' + p.fps + ' fps'), sep(),
      this.btn('Import Media…', () => this.importMedia(), 'Add video, sound or pictures to this project. You can also drop files on the media list or straight onto the timeline.'), this.btn('Add Title', () => this.addTitle(), 'Put words on screen at the playhead (T).'),
      this.btn('Add Selected Photos', () => this.addPhotos(), 'Add the photos selected in Lens, with their Develop edits, as a run of pictures with crossfades.', 'adv'),
      h('span', { style: { flex: 1 } }),
      h('button', { class: 'btn', title: 'Undo', disabled: !this.undo.length, onclick: () => this.step(this.undo, this.redo) }, '↶'), h('button', { class: 'btn', title: 'Redo', disabled: !this.redo.length, onclick: () => this.step(this.redo, this.undo) }, '↷'),
      this.btn('Export…', () => this.exportDialog(), 'Make an MP4 video file from the timeline.', 'primary'),
      h('button', { class: 'btn', onclick: e => { const r = e.currentTarget.getBoundingClientRect(); UI.menu(r.right - 240, r.bottom + 4, this.moreItems()); } }, 'More ▾'));
  },
  moreItems() {
    const it = (label, run, adv) => (adv && Modes.beginner ? null : { label, run: () => { const r = run(); if (r && r.catch) r.catch(UI.error); } });
    return [it('Project Settings…', () => this.settings()), it('Import from Disk…', () => this.importFromDisk(), 1), it('Add Selected Photos', () => this.addPhotos()), '-', it('Save Frame as Picture…', () => this.saveFrame()), it('Edit Frame in Imagine', () => this.frameToImage(), 1), '-', it('Add Video Track', () => this.addTrack('video'), 1), it('Add Audio Track', () => this.addTrack('audio'), 1)].filter(Boolean);
  },
  drawTools() {
    const sep = () => h('span', { class: 'mu-sep' }), one = this.picked()[0];
    this.tools.replaceChildren(
      this.btn('Split Clip', () => this.split(), 'Cut the clip under the playhead in two (S). With clips picked, only those are cut.'), this.btn('Delete', () => this.remove(), 'Remove the picked clips (Delete).'),
      this.btn('Delete and Close Gap', () => this.remove(true), 'Remove the picked clips and slide everything after them on the track to the left (Shift+Delete).', 'adv'), this.btn('Duplicate', () => this.duplicate(), 'Copy the picked clips to the end of their track (Ctrl+D).'),
      this.btn(one && one.xfade ? 'Remove Crossfade' : 'Crossfade', () => this.crossfade(), 'Blend the picked clip into the one before it on the same track: it slides back one second and fades in over it.'),
      this.btn('Detach Sound', () => this.detachAudio(), 'Give a video clip\'s sound a clip of its own on an audio track, to trim or move it separately.', 'adv'), sep(),
      h('label', { class: 'fcheck vd-snap', title: 'Clips snap to each other and to the playhead. Hold Alt while dragging to place freely.' }, h('input', { type: 'checkbox', checked: this.snap, onchange: e => { this.snap = e.target.checked; } }), 'Snap'),
      h('span', { class: 'dim' }, 'Zoom'), h('input', { type: 'range', class: 'vd-zoom', 'aria-label': 'Timeline zoom', min: 0, max: 100, value: Math.round(Math.log(this.z / 4) / Math.log(200 / 4 * 10) * 100), oninput: e => this.setZ(4 * Math.pow(500, e.target.value / 100)) }),
      this.btn('Show All', () => this.zoomFit(), 'Show the whole timeline (Ctrl+0).'),
      h('span', { class: 'dim vd-hint' }, this.p.clips.length ? 'Drag clips to move them, their ends to trim. Click the ruler to move the playhead.' : 'Import media, then drag it from the list on the left onto a track.'));
  },
  drawBin() {
    if (!this.p) return; const ms = [...this.media.values()];
    this.bin.replaceChildren(h('div', { class: 'panel-h ie-ph' }, h('span', { class: 'pt', data: { tip: 'Everything imported into this project. Drag a file onto a track, or double-click it to add it at the end.' } }, 'Media')),
      h('div', { class: 'vd-media' }, ms.length ? ms.map(m => h('div', { class: 'vd-m' + (m.missing ? ' missing' : ''), draggable: true, title: m.path, data: { notr: 1 }, tabindex: 0, role: 'button', 'aria-label': m.name + ', ' + (m.kind === 'image' ? 'picture' : m.kind + ', ' + this.fmtT(m.dur)) + '. Enter adds it to the timeline.', onkeydown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); this.place(m); } },
        ondragstart: e => { e.dataTransfer.setData('text/opia-media', m.path); e.dataTransfer.effectAllowed = 'copy'; }, ondblclick: () => this.place(m),
        oncontextmenu: e => UI.menu(e.clientX, e.clientY, [{ label: 'Add to Timeline', run: () => this.place(m) }, { label: 'Show in Finder', run: () => api('fs_reveal', { path: m.path }) }, { label: 'Remove from Project', run: () => { if (this.p.clips.some(c => c.src === m.path)) return UI.toast('It is used on the timeline. Delete those clips first.'); this.media.delete(m.path); this.saveSoon(); this.drawBin(); } }]) },
        h('div', { class: 'vd-mthumb ' + m.kind, style: m.kind === 'video' ? { backgroundImage: `url("/img/vstrip?path=${encodeURIComponent(m.play || m.path)}&n=1&h=72")` } : m.kind === 'image' ? { backgroundImage: `url("${this.mediaUrl(m.path)}")` } : null }, m.kind === 'audio' ? '♪' : ''),
        h('div', { class: 'vd-mname' }, h('b', {}, m.name), h('span', { class: 'dim' }, m.kind === 'image' ? 'Picture' : this.fmtT(m.dur) + (m.kind === 'video' ? '  ' + m.w + '×' + m.h : '')))))
        : h('div', { class: 'dim vd-empty' }, 'No media yet. Use Import Media, or drop video, sound or pictures here.')),
      h('div', { class: 'ie-lbtns' }, this.btn('Import…', () => this.importMedia(), 'Add video, sound or pictures.')));
  },
  drawTransport() {
    if (!this.p) return;
    this.transport.replaceChildren(h('button', { class: 'btn', title: 'Go to the start (Home)', onclick: () => this.seek(0) }, '⏮'), h('button', { class: 'btn', title: 'Previous edit (Up)', onclick: () => this.jump(-1) }, '⏪'),
      h('button', { class: 'btn primary mu-play', onclick: () => this.toggle() }, this.playing ? '❚❚ Pause' : '▶ Play'), h('button', { class: 'btn', title: 'Next edit (Down)', onclick: () => this.jump(1) }, '⏩'),
      h('span', { class: 'mu-pos vd-clock' }), h('span', { class: 'dim vd-len' }));
    this.drawClock();
  },
  drawClock() { const c = $('.vd-clock', this.transport), l = $('.vd-len', this.transport); if (c) c.textContent = this.fmtT(this.t, true); if (l) l.textContent = 'of ' + this.fmtT(this.total()); },

  /* ---- the timeline */
  setZ(z) { const sc = $('.vd-lanes', this.tl), mid = sc ? (sc.scrollLeft + sc.clientWidth / 2) / this.z : 0; this.z = clamp(z, 2, 2000); this.drawTimeline(); const s2 = $('.vd-lanes', this.tl); if (s2) s2.scrollLeft = mid * this.z - s2.clientWidth / 2; this.saveSoon(); },
  zoom(f) { this.setZ(this.z * f); this.drawTools(); },
  zoomFit() { const sc = $('.vd-lanes', this.tl); if (!sc) return; this.setZ((sc.clientWidth - 40) / Math.max(5, this.total())); this.drawTools(); },
  timeAt(e) { const sc = $('.vd-lanes', this.tl), r = sc.getBoundingClientRect(); return Math.max(0, (e.clientX - r.left + sc.scrollLeft) / this.z); },
  resizeTl(e) { const y0 = e.clientY, h0 = this.tl.getBoundingClientRect().height, mv = ev => { this.tl.style.height = clamp(h0 - (ev.clientY - y0), 120, innerHeight * .7) + 'px'; }, up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); this.fitScreen(); this.paint(); }; addEventListener('pointermove', mv); addEventListener('pointerup', up); },
  drawTimeline() {
    if (!this.p) return; const p = this.p, z = this.z, len = Math.max(this.total() + 30, (this.tl.clientWidth || 1200) / z), W = len * z, old = $('.vd-lanes', this.tl), sx = old ? old.scrollLeft : 0, sy = old ? old.scrollTop : 0;
    const step = [.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600].find(s => s * z >= 70) || 600, ticks = [];
    for (let s = 0; s <= len; s += step) ticks.push(h('span', { style: { left: s * z + 'px' } }, this.fmtT(s)));
    const ruler = h('div', { class: 'vd-ruler', style: { width: W + 'px' }, onpointerdown: e => this.scrub(e) }, ticks);
    const heads = p.tracks.map(t => h('div', { class: 'vd-th ' + t.kind, data: { notr: 1 }, oncontextmenu: e => UI.menu(e.clientX, e.clientY, [{ label: 'Rename Track…', run: async () => { const n = await UI.prompt('Rename Track', 'Name', t.name); if (n) this.setTrack(t, 'name', n); } }, { label: 'Delete Track', run: () => this.delTrack(t) }, '-', { label: 'Add Video Track', run: () => this.addTrack('video') }, { label: 'Add Audio Track', run: () => this.addTrack('audio') }]) },
      h('b', { ondblclick: async () => { const n = await UI.prompt('Rename Track', 'Name', t.name); if (n) this.setTrack(t, 'name', n); } }, t.name),
      t.kind === 'video' ? h('a', { class: 'vd-tb' + (t.hide ? ' on' : ''), title: t.hide ? 'Show this track' : 'Hide this track', onclick: () => this.setTrack(t, 'hide', !t.hide) }, t.hide ? '◌' : '◉') : null,
      h('a', { class: 'vd-tb' + (t.mute ? ' on' : ''), title: t.mute ? 'Turn the sound back on' : 'Mute this track', onclick: () => this.setTrack(t, 'mute', !t.mute) }, t.mute ? '🔇' : '🔊'),
      t.kind === 'audio' ? h('input', { type: 'range', class: 'vd-tvol adv', min: 0, max: 200, value: Math.round((t.vol ?? 1) * 100), title: 'Track volume', onchange: e => this.setTrack(t, 'vol', +e.target.value / 100) }) : null));
    const lanes = p.tracks.map(t => { const lane = h('div', { class: 'vd-lane ' + t.kind + (t.hide ? ' hid' : '') + (t.mute ? ' mut' : ''), style: { width: W + 'px' }, data: { track: t.id }, onpointerdown: e => { if (e.target === lane) { if (!e.ctrlKey && !e.shiftKey) { this.sel.clear(); this.drawInsp(); this.drawTools(); } this.scrub(e); } } });
      for (const c of p.clips.filter(c => c.track === t.id).sort((a, b) => a.start - b.start)) lane.append(this.clipEl(c));
      return lane; });
    const lanesBox = h('div', { class: 'vd-lanes', tabindex: -1, role: 'region', 'aria-label': 'Timeline. Tab moves between clips; Enter picks one; Alt+Left and Alt+Right move it by a frame, with Shift by a second.', onwheel: e => { if (e.ctrlKey) { e.preventDefault(); this.zoom(e.deltaY < 0 ? 1.15 : 1 / 1.15); } } }, h('div', { class: 'vd-inner', style: { width: W + 'px' } }, ruler, lanes, h('div', { class: 'vd-head' })));
    lanesBox.addEventListener('scroll', () => { const hs = $('.vd-heads', this.tl); if (hs) hs.scrollTop = lanesBox.scrollTop; });
    this.tl.replaceChildren(h('div', { class: 'vd-heads' }, h('div', { class: 'vd-rh' }, h('a', { class: 'adv', title: 'Add a video track', onclick: () => this.addTrack('video') }, '+ V'), h('a', { class: 'adv', title: 'Add an audio track', onclick: () => this.addTrack('audio') }, '+ A')), heads), lanesBox);
    lanesBox.scrollLeft = sx; lanesBox.scrollTop = sy; this.drawHead();
  },
  clipEl(c) {
    const z = this.z, m = this.media.get(c.src), w = Math.max(2, c.dur * z), miss = c.kind !== 'title' && (!m || m.missing);
    const el = h('div', { class: 'vd-clip ' + c.kind + (this.sel.has(c.id) ? ' sel' : '') + (miss ? ' missing' : '') + (c.mute ? ' muted' : ''), style: { left: c.start * z + 'px', width: w + 'px' }, data: { id: c.id }, onpointerdown: e => this.clipDown(e, c, el),
      tabindex: 0, role: 'button', 'aria-pressed': String(this.sel.has(c.id)), 'aria-label': ({ video: 'Video', image: 'Picture', title: 'Title', audio: 'Sound' })[c.kind] + ' ' + (c.kind === 'title' ? ((c.title && c.title.text) || '') : c.name) + ', from ' + this.fmtT(c.start) + ', ' + c.dur.toFixed(1) + ' seconds',
      onkeydown: e => { if (e.target === el && (e.key === 'Enter' || e.key === ' ') && !e.ctrlKey) { e.preventDefault(); e.stopPropagation(); if (e.shiftKey) { this.sel.has(c.id) ? this.sel.delete(c.id) : this.sel.add(c.id); } else this.sel = new Set([c.id]); this.seek(c.start); this.drawTimeline(); this.drawInsp(); this.drawTools(); const f = $(`.vd-clip[data-id="${c.id}"]`, this.tl); if (f) f.focus(); } } },
      h('span', { class: 'vd-cname', data: { notr: 1 } }, c.kind === 'title' ? '“' + ((c.title && c.title.text) || 'Title').split('\n')[0] + '”' : c.name));
    if (c.kind === 'video' && m && w > 30) { const n = clamp(Math.round(w / 72), 1, 24); el.style.backgroundImage = `url("/img/vstrip?path=${encodeURIComponent(m.play || c.src)}&n=${n}&h=44&a=${c.in.toFixed(1)}&b=${(c.in + c.dur).toFixed(1)}")`; }
    if (c.kind === 'image' && m) el.style.backgroundImage = `url("${this.mediaUrl(c.src)}")`;
    if (c.kind === 'audio' || (c.kind === 'video' && c.audio && !c.mute)) { const cv = h('canvas', { class: 'vd-wave', width: Math.min(4000, Math.round(w)), height: c.kind === 'audio' ? 40 : 14 }); el.append(cv); this.wave(c, cv); }
    const fin = Math.max(c.fadeIn || 0, c.xfade || 0); if (fin) el.append(h('i', { class: 'vd-fade in' + (c.xfade ? ' x' : ''), style: { width: fin * z + 'px' } }));
    if (c.fadeOut) el.append(h('i', { class: 'vd-fade out', style: { width: c.fadeOut * z + 'px' } }));
    el.append(h('i', { class: 'vd-grip l' }), h('i', { class: 'vd-grip r' }));
    return el;
  },
  async wave(c, cv) {
    let pk = this.peaks.get(c.src); if (!pk) { pk = api('video_peaks', { path: c.src }).catch(() => ({ rate: 50, peaks: [] })); this.peaks.set(c.src, pk); }
    const d = await pk, g = cv.getContext('2d'), w = cv.width, hh = cv.height; g.clearRect(0, 0, w, hh); g.fillStyle = c.kind === 'audio' ? 'rgba(120,220,170,.9)' : 'rgba(255,255,255,.55)';
    for (let x = 0; x < w; x++) { const t0 = c.in + x / w * c.dur, i = Math.floor(t0 * d.rate), j = Math.max(i + 1, Math.floor((c.in + (x + 1) / w * c.dur) * d.rate)); let v = 0; for (let k = i; k < j && k < d.peaks.length; k++) v = Math.max(v, d.peaks[k]); const y = v / 255 * hh * (c.vol ?? 1); g.fillRect(x, (hh - y) / 2, 1, Math.max(1, y)); }
  },
  drawHead(follow) {
    const hd = $('.vd-head', this.tl); if (!hd) return; const x = this.t * this.z; hd.style.left = x + 'px';
    if (follow) { const sc = $('.vd-lanes', this.tl); if (sc && (x < sc.scrollLeft || x > sc.scrollLeft + sc.clientWidth - 30)) sc.scrollLeft = x - 40; }
  },
  scrub(e) {
    if (e.button !== 0) return; e.preventDefault(); const was = this.playing; this.pause(); this.seek(this.snapTo(this.timeAt(e), new Set(), e));
    const mv = ev => this.seek(this.timeAt(ev)), up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); if (was) this.play(); };
    addEventListener('pointermove', mv); addEventListener('pointerup', up);
  },
  clipDown(e, c, el) {
    if (e.button !== 0) return; e.preventDefault(); e.stopPropagation();
    if (e.ctrlKey || e.shiftKey) { this.sel.has(c.id) ? this.sel.delete(c.id) : this.sel.add(c.id); } else if (!this.sel.has(c.id)) this.sel = new Set([c.id]);
    $$('.vd-clip', this.tl).forEach(x => x.classList.toggle('sel', this.sel.has(x.dataset.id))); this.drawInsp(); this.drawTools();
    const r = el.getBoundingClientRect(), edge = e.clientX - r.left < 7 ? 'l' : r.right - e.clientX < 7 ? 'r' : null, x0 = e.clientX, z = this.z, moving = edge ? [c] : this.picked(), orig = moving.map(x => ({ start: x.start, track: x.track })), o = { ...c };
    let changed = false;
    const mv = ev => {
      const dt = (ev.clientX - x0) / z; if (!changed && Math.abs(ev.clientX - x0) < 3) return; if (!changed) { changed = true; this.mark(); }
      const skip = new Set(moving.map(x => x.id)), lim = c.max ? c.max : Infinity;
      if (edge === 'l') { let s = this.snapTo(o.start + dt, skip, ev); const free = c.kind === 'image' || c.kind === 'title'; s = clamp(s, free ? 0 : Math.max(0, o.start - o.in), o.start + o.dur - .1); const d = s - o.start; c.start = s; c.in = c.kind === 'image' || c.kind === 'title' ? 0 : o.in + d; c.dur = o.dur - d; }
      else if (edge === 'r') { let end = this.snapTo(o.start + o.dur + dt, skip, ev); end = clamp(end, o.start + .1, c.kind === 'image' || c.kind === 'title' ? Infinity : o.start + (lim - o.in)); c.dur = end - o.start; }
      else {
        let d = dt; const snapS = this.snapTo(o.start + d, skip, ev), snapE = this.snapTo(o.start + o.dur + d, skip, ev) - o.dur; d = Math.abs(snapS - (o.start + d)) <= Math.abs(snapE - (o.start + d)) ? snapS - o.start : snapE - o.start;
        d = Math.max(d, -Math.min(...orig.map(q => q.start)));
        moving.forEach((x, k) => { x.start = orig[k].start + d; });
        const lane = document.elementFromPoint(ev.clientX, ev.clientY), ln = lane && lane.closest && lane.closest('.vd-lane'); if (ln && moving.length === 1) { const t = this.track(ln.dataset.track), want = c.kind === 'audio' ? 'audio' : 'video'; if (t && t.kind === want && t.id !== c.track) { c.track = t.id; ln.append(el); } }
      }
      for (const x of moving) { const ce = $(`.vd-clip[data-id="${x.id}"]`, this.tl); if (ce) { ce.style.left = x.start * z + 'px'; ce.style.width = Math.max(2, x.dur * z) + 'px'; } }
      if (edge) this.seek(edge === 'l' ? c.start : c.start + c.dur - 1 / this.p.fps); else this.paint();
    };
    const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); if (changed) this.after(false); };
    addEventListener('pointermove', mv); addEventListener('pointerup', up);
  },
  addTitle() {
    if (!this.p) return; const vt = this.tracksOf('video'), t = this.t, free = vt.find(tr => !this.p.clips.some(c => c.track === tr.id && c.start < t + 3 && c.start + c.dur > t)) || null;
    let tr = free; if (!tr) { tr = { id: this.uid(), kind: 'video', name: 'Titles', vol: 1 }; this.mark(); this.p.tracks.unshift(tr); }
    this.mark(); const c = { id: this.uid(), track: tr.id, kind: 'title', name: 'Title', src: null, in: 0, dur: 3, start: t, fadeIn: .4, fadeOut: .4, xfade: 0, opacity: 1, title: { text: 'Your title', size: 8, color: '#ffffff', pos: 'bottom', bold: true, box: false, font: 'Nunito, Arial, sans-serif' } };
    this.p.clips.push(c); this.sel = new Set([c.id]); this.after(); setTimeout(() => { const ta = $('.vd-ttext', this.insp); if (ta) { ta.focus(); ta.select(); } }, 50);
  },

  /* ---- the inspector: settings of the picked clip, or of the project */
  drawInspTime() { const el = $('.vd-ipos', this.insp); if (el) el.textContent = this.fmtT(this.t, true); },
  num(label, v, set, o = {}) { const inp = h('input', { type: 'number', class: 'mu-num', step: o.step ?? .1, min: o.min ?? 0, max: o.max, value: +(+v).toFixed(o.dp ?? 2), onchange: e => { this.mark(); set(+e.target.value); this.after(false); } }); return h('label', { class: 'frow' + (o.adv ? ' adv' : '') }, h('span', {}, label), h('span', {}, inp, o.unit ? ' ' + o.unit : '')); },
  slide(label, v, min, max, step, set, o = {}) { let marked = false; return UI.slider({ label, min, max, step, value: v, def: o.def ?? 0, cls: o.adv ? 'adv' : '', tip: o.tip, oninput: x => { if (!marked) { marked = true; this.mark(); } set(x); this.titleCache.clear(); this.paint(); this.sync(); }, onchange: () => { marked = false; this.after(false); } }); },
  drawInsp() {
    if (!this.p) return; const cs = this.picked(), c = cs.length === 1 ? cs[0] : null, p = this.p, out = [];
    if (!c) {
      out.push(h('div', { class: 'fsec' }, cs.length > 1 ? cs.length + ' clips picked' : 'Project'));
      if (!cs.length) out.push(h('label', { class: 'frow' }, h('span', {}, 'Size'), h('span', {}, p.w + ' × ' + p.h)), h('label', { class: 'frow' }, h('span', {}, 'Frame rate'), h('span', {}, p.fps + ' fps')), h('label', { class: 'frow' }, h('span', {}, 'Length'), h('span', {}, this.fmtT(this.total(), true))), this.btn('Project Settings…', () => this.settings()),
        h('p', { class: 'dim vd-tip' }, 'Click a clip to change it. Drag its ends to trim it, drag the middle to move it, and press S to split it at the playhead.'));
      else out.push(this.btn('Delete', () => this.remove()), this.btn('Duplicate', () => this.duplicate()));
      return this.insp.replaceChildren(h('div', { class: 'panel-h ie-ph' }, h('span', { class: 'pt' }, 'Details')), h('div', { class: 'vd-ibody' }, out));
    }
    const lim = c.max || 0, kindName = { video: 'Video clip', image: 'Picture', title: 'Title', audio: 'Sound clip' }[c.kind];
    out.push(h('div', { class: 'fsec' }, kindName), h('div', { class: 'vd-iname', data: { notr: 1 }, title: c.src || '' }, c.kind === 'title' ? '' : c.name));
    if (c.kind === 'title') {
      const T = c.title, setT = (k, v) => { this.mark(); T[k] = v; this.after(false); };
      out.push(h('textarea', { class: 'vd-ttext', rows: 3, value: T.text, data: { notr: 1 }, onfocus: () => { this.tBefore = this.state(); }, oninput: e => { T.text = e.target.value; this.titleCache.clear(); this.paint(); },
        onchange: e => { T.text = e.target.value; if (this.tBefore) { this.undo.push(this.tBefore); this.redo = []; this.tBefore = null; } this.saveSoon(); this.drawTimeline(); this.drawBar(); } }),
        h('label', { class: 'frow' }, h('span', {}, 'Where'), h('select', { onchange: e => setT('pos', e.target.value) }, VD_POS.map(([v, l]) => h('option', { value: v, selected: v === T.pos }, l)))),
        h('label', { class: 'frow' }, h('span', {}, 'Typeface'), h('select', { onchange: e => setT('font', e.target.value) }, IE_FONTS.map(([v, l]) => h('option', { value: v, selected: v === T.font }, l)))),
        this.slide('Size', T.size, 2, 30, .5, v => { T.size = v; }, { def: 8 }),
        h('label', { class: 'frow' }, h('span', {}, 'Colour'), h('input', { type: 'color', value: T.color, onchange: e => setT('color', e.target.value) })),
        h('label', { class: 'fcheck' }, h('input', { type: 'checkbox', checked: !!T.bold, onchange: e => setT('bold', e.target.checked) }), 'Bold'), h('label', { class: 'fcheck' }, h('input', { type: 'checkbox', checked: !!T.box, onchange: e => setT('box', e.target.checked) }), 'Dark box behind the words'));
    }
    out.push(h('div', { class: 'fsec' }, 'Timing'), this.num('Starts at', c.start, v => { c.start = Math.max(0, v); }, { unit: 's' }), this.num('Length', c.dur, v => { c.dur = clamp(v, .1, lim ? lim - c.in : 36000); }, { unit: 's', min: .1 }));
    if (lim) out.push(this.num('From the file at', c.in, v => { c.in = clamp(v, 0, lim - .1); c.dur = Math.min(c.dur, lim - c.in); }, { unit: 's', adv: true }));
    out.push(h('div', { class: 'fsec' }, 'Fades'), this.slide('Fade in', c.fadeIn || 0, 0, Math.min(10, c.dur), .1, v => { c.fadeIn = v; }), this.slide('Fade out', c.fadeOut || 0, 0, Math.min(10, c.dur), .1, v => { c.fadeOut = v; }),
      c.xfade ? h('div', { class: 'frow' }, h('span', {}, 'Crossfade'), h('span', {}, c.xfade.toFixed(1) + ' s ', h('a', { class: 'vd-link', onclick: () => this.crossfade(c, false) }, 'remove'))) : this.btn('Crossfade with the Clip Before', () => this.crossfade(c, true), 'The clip slides back one second and fades in over the end of the one before it.'));
    if (c.kind === 'audio' || (c.kind === 'video' && c.audio)) out.push(h('div', { class: 'fsec' }, 'Sound'), this.slide('Volume', Math.round((c.vol ?? 1) * 100), 0, 200, 1, v => { c.vol = v / 100; }, { def: 100 }), c.kind === 'video' ? h('label', { class: 'fcheck' }, h('input', { type: 'checkbox', checked: !!c.mute, onchange: e => { this.mark(); c.mute = e.target.checked; this.after(false); this.sync(true); } }), 'Mute this clip') : null);
    if (c.kind === 'video' || c.kind === 'image') out.push(h('div', { class: 'fsec' }, 'Picture'), h('div', { class: 'frow' }, h('span', {}, 'Frame'), h('span', { class: 'seg' }, [['fit', 'Fit'], ['fill', 'Fill']].map(([v, l]) => h('a', { class: (c.fit || 'fit') === v ? 'on' : '', title: v === 'fit' ? 'Show all of it, with bars if the shape differs' : 'Fill the frame, cutting off the edges', onclick: () => { this.mark(); c.fit = v; this.after(false); } }, l)))),
      this.slide('Size', Math.round((c.scale ?? 1) * 100), 10, 300, 1, v => { c.scale = v / 100; }, { def: 100, adv: true, tip: 'Smaller than 100 makes a picture-in-picture over the tracks below.' }),
      this.slide('Left / right', Math.round((c.x || 0) * 100), -100, 100, 1, v => { c.x = v / 100; }, { adv: true }), this.slide('Up / down', Math.round((c.y || 0) * 100), -100, 100, 1, v => { c.y = v / 100; }, { adv: true }));
    if (c.kind !== 'audio') out.push(this.slide('Opacity', Math.round((c.opacity ?? 1) * 100), 0, 100, 1, v => { c.opacity = v / 100; }, { def: 100, adv: true }));
    out.push(h('div', { class: 'ie-lbtns' }, this.btn('Split Clip', () => this.split()), this.btn('Delete', () => this.remove()), c.kind === 'video' && c.audio && !c.mute ? this.btn('Detach Sound', () => this.detachAudio(), null, 'adv') : null));
    this.insp.replaceChildren(h('div', { class: 'panel-h ie-ph' }, h('span', { class: 'pt' }, 'Details')), h('div', { class: 'vd-ibody' }, out));
  },
  async settings() {
    const p = this.p, w = h('input', { type: 'number', min: 16, max: 7680, value: p.w, class: 'mu-num' }), hh = h('input', { type: 'number', min: 16, max: 4320, value: p.h, class: 'mu-num' });
    const preset = h('select', { onchange: () => { const s = VD_SIZES[preset.selectedIndex - 1]; if (s) { w.value = s[1]; hh.value = s[2]; } } }, h('option', {}, 'Custom'), VD_SIZES.map(s => h('option', { selected: s[1] === p.w && s[2] === p.h }, s[0])));
    const fps = h('select', {}, [24, 25, 30, 50, 60].map(f => h('option', { value: f, selected: f === p.fps }, f + ' frames a second'))), bg = h('input', { type: 'color', value: p.bg || '#000000' });
    if (!await UI.dialog({ title: 'Project Settings', width: 460, body: h('div', { class: 'pd-form' }, h('label', { class: 'frow' }, h('span', {}, 'Shape'), preset), h('label', { class: 'frow' }, h('span', {}, 'Width'), h('span', {}, w, ' pixels')), h('label', { class: 'frow' }, h('span', {}, 'Height'), h('span', {}, hh, ' pixels')), h('label', { class: 'frow' }, h('span', {}, 'Frame rate'), fps), h('label', { class: 'frow' }, h('span', {}, 'Background'), bg), h('p', { class: 'dim' }, 'Clips are fitted into this frame. 30 frames a second suits most phone and web video; use 25 for PAL footage.')), buttons: [['Cancel', null], ['OK', true, 'primary']] })) return;
    this.mark(); p.w = clamp(Math.round(+w.value / 2) * 2, 16, 7680); p.h = clamp(Math.round(+hh.value / 2) * 2, 16, 4320); p.fps = +fps.value; p.bg = bg.value; this.after(); this.fitScreen();
  },

  /* ---- output */
  async exportDialog() {
    const p = this.p; if (!p || !p.clips.length) return UI.toast('Put something on the timeline first.');
    this.pause(); await this.saveNow();
    const miss = p.clips.filter(c => c.kind !== 'title' && (this.media.get(c.src) || {}).missing); if (miss.length) return UI.toast(miss.length + ' clip(s) point at files that are missing. Delete those clips or put the files back.', 'error');
    const folder = h('input', { type: 'text', value: App.conf('video_out', App.boot.pictures.replace(/Pictures$/, 'Videos')) }), name = h('input', { type: 'text', value: p.name });
    const sizes = [[1, 'Project size (' + p.w + ' × ' + p.h + ')']].concat([[1080, '1080p'], [720, '720p'], [480, '480p (small)']].filter(([s]) => s < Math.min(p.w, p.h)).map(([s, l]) => [s / Math.min(p.w, p.h), l]));
    const size = h('select', {}, sizes.map(([k, l], i) => h('option', { value: i }, l))), quality = h('select', {}, [['high', 'High (large file)'], ['medium', 'Good'], ['small', 'Small file']].map(([v, l]) => h('option', { value: v, selected: v === App.conf('video_q', 'medium') }, l)));
    if (!await UI.dialog({ title: 'Export Video', width: 560, body: h('div', { class: 'pd-form' }, h('label', { class: 'frow' }, h('span', {}, 'Name'), name), h('div', { class: 'frow' }, h('span', {}, 'Folder'), h('div', { class: 'pd-row' }, folder, h('button', { class: 'btn', onclick: async () => { const f = await UI.pickFolder(folder.value); if (f) folder.value = f; } }, 'Browse…'))),
      h('label', { class: 'frow' }, h('span', {}, 'Size'), size), h('label', { class: 'frow' }, h('span', {}, 'Quality'), quality), h('p', { class: 'dim' }, 'Makes an MP4 (H.264 video, AAC sound) that plays almost anywhere. Long or 4K videos take a while; you can keep working meanwhile.')),
      buttons: [['Cancel', null], ['Export', () => (name.value.trim() && folder.value.trim() ? true : false), 'primary']] })) return;
    const file = name.value.trim().replace(/[\\/:*?"<>|]/g, '').replace(/\.mp4$/i, '') + '.mp4', path = folder.value.trim().replace(/[\\/]+$/, '') + '\\' + file;
    if ((await api('fs_exists', { paths: [path] }))[0] && !await UI.confirm('Replace File?', file + ' is already in that folder. Replace it?', 'Replace')) return;
    App.setConf('video_out', folder.value.trim()); App.setConf('video_q', quality.value);
    const k = sizes[+size.value][0], dims = k === 1 ? null : [Math.round(p.w * k / 2) * 2, Math.round(p.h * k / 2) * 2];
    const titles = {}; for (const c of p.clips) if (c.kind === 'title') titles[c.id] = this.titleCanvas(c).toDataURL('image/png');
    const project = { ...this.data(), clips: p.clips.map(c => ({ ...c, audio: c.kind === 'video' ? !!c.audio : undefined })) };
    const r = await runJob(api('video_export', { project, path, titles, quality: quality.value, size: dims }), 'Exporting ' + file);
    UI.toast('Exported ' + r.path.split(/[\\/]/).pop() + ' (' + fmt.bytes(r.size) + ', ' + this.fmtT(r.dur) + ')'); api('fs_reveal', { path: r.path }).catch(() => {});
  },
  async frameCanvas() { const p = this.p, cv = h('canvas', { width: p.w, height: p.h }); this.sync(true); await new Promise(r => setTimeout(r, 250)); this.frame(cv.getContext('2d'), p.w, p.h); return cv; },
  async saveFrame() {
    if (!this.p) return; const cv = await this.frameCanvas(), folder = await UI.pickFolder(App.conf('img_out', App.boot.pictures + '\\Opia Exports')); if (!folder) return;
    const r = await upload('image_export', { path: folder.replace(/[\\/]+$/, '') + '\\' + this.p.name + ' ' + this.fmtT(this.t, true).replace(/[:.]/g, '-') + '.png', fmt: 'png' }, await new Promise(res => cv.toBlob(res, 'image/png')));
    UI.toast('Saved ' + r.path.split(/[\\/]/).pop());
  },
  async frameToImage() { if (!this.p) return; const cv = await this.frameCanvas(); App.show('image'); if (!await ImgEd.leave()) return; ImgEd.doc = null; ImgEd.addPixels(cv, this.p.name + ' frame'); },
};

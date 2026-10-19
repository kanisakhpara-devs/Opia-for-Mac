'use strict';
/* Music workspace. Beginner is a jam board: riff cards (drums, bass, chords, melody, your own audio) that loop together.
   Advanced lays the same song out on a timeline, adds a mixer, and gives audio tracks range editing and effects.
   Both views edit one song object and play through the same engine (music-engine.js). */

const uid = () => Math.random().toString(36).slice(2, 9);
const MU_TIPS = {
  swing: 'Pushes every second small step a little late, which turns a stiff beat into a relaxed, bouncy one. 0 is straight; 30 to 50 is a clear shuffle.',
  tempo: 'How fast the song is, in beats per minute. 80 to 100 feels relaxed, 120 and up feels like dancing.',
  key: 'The home note of the song. Change it to move everything higher or lower. If it sounds fine, leave it.',
  scale: 'The set of notes the riffs are allowed to use. Major sounds bright, Minor sounds moody. Because of it, no note you click will sound wrong.',
  bars: 'A bar is one count of four beats. This is how many bars the song lasts before it loops.',
  loop: 'When on, playback goes back to the start at the end of the song.',
  metro: 'A click on every beat while playing, to help you keep time when recording.',
  idea: 'Writes a fresh riff for this card that fits the rest of the song. Don’t like it? Press again, or Undo.',
  vol: 'How loud this part is.', pan: 'Places this part to the left or right.',
  room: 'Sends this part into a room echo (reverb) so it sounds further away and bigger.',
  echo: 'Repeats this part in time with the song (delay).',
  low: 'Boosts or cuts the deep, bassy end of this part.', high: 'Boosts or cuts the bright, crisp end of this part.',
};

const Music = {
  id: 'music', name: 'Groove', exclusive: true, song: null, files: new Map(), sel: null, clipSel: null, range: null, cursor: 0, pps: 40, undo: [], redo: [], grids: [], clipboard: null, rec: null, spec: false, snap: true, multi: new Set(),

  /* ---- song lifecycle */
  blank(name) { return { name, bpm: 100, key: 9, scale: 'minor', bars: 4, vol: .9, prog: null, tracks: [] }; },
  async init(el) {
    el.left.remove(); el.right.remove(); el.center.classList.add('music');
    this.bar = h('div', { class: 'mu-bar' }); this.tools = h('div', { class: 'mu-tools' }); this.stage = h('div', { class: 'mu-stage' }); this.editor = h('div', { class: 'mu-editor' });
    el.center.append(this.bar, this.tools, this.stage, this.editor);
    Player.onstop = () => { if (this.song) this.drawBar(); };
    document.addEventListener('keydown', e => { if (!this.live || App.module !== 'music' || e.ctrlKey || e.altKey || e.metaKey || $('#overlays').children.length || (e.target.matches && e.target.matches('input:not([type=range]),textarea,select'))) return; const i = 'ASDFGHJKL;'.indexOf(e.key.toUpperCase()); if (i < 0) return; e.preventDefault(); e.stopPropagation(); if (!e.repeat) this.strike(i); }, true);
    this.stage.addEventListener('dragover', e => { if (![...e.dataTransfer.types].includes('Files')) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; this.dropHint(e); });
    this.stage.addEventListener('dragleave', e => { if (!this.stage.contains(e.relatedTarget)) this.dropHint(null); });
    this.stage.addEventListener('drop', e => { e.preventDefault(); this.dropFiles(e).catch(UI.error); });
    App.on('prefs', k => { if (k === 'beginner') this.draw(); });
    App.on('theme', () => this.draw());
    this.saveSoon = debounce(() => this.save().catch(UI.error), 900);
    await Samples.init();
    const last = App.conf('music_last', null), data = last ? await api('music_load', { name: last }).catch(() => null) : null;
    if (data) await this.load(data); else await this.create(true);
    const frame = () => { if (App.module === 'music') this.frame(); requestAnimationFrame(frame); }; requestAnimationFrame(frame);
  },
  show() { if (this.song) this.draw(); },
  hide() { Player.stop(); this.stopRec(); document.body.classList.remove('mu-playing'); },
  async create(quiet) {
    const taken = new Set((await api('music_list')).map(s => s.name.toLowerCase())); let name = 'Untitled Song', n = 1;
    while (taken.has(name.toLowerCase())) name = 'Untitled Song ' + ++n;
    await this.load(this.blank(name)); if (!quiet) this.changed();
  },
  async load(data) {
    Player.stop(); Player.bufs.clear(); this.files.clear(); this.undo = []; this.redo = []; this.sel = this.clipSel = this.range = null; this.multi.clear(); this.cursor = Player.pos = 0;
    const bufs = data.bufs || {}; delete data.bufs;
    this.song = Player.song = data;
    for (const [id, path] of Object.entries(bufs)) { try { Player.bufs.set(id, await this.decode(path)); this.files.set(id, path); } catch (e) { UI.toast('Could not open ' + path.split(/[\\/]/).pop(), 'error'); } }
    App.setConf('music_last', data.name); this.draw(); Samples.need(data).catch(() => {});
  },
  async decode(path) { const r = await fetch('/img/audio?path=' + encodeURIComponent(path)); if (!r.ok) throw new Error('missing'); return Player.ready().decodeAudioData(await r.arrayBuffer()); },
  async save() {
    const song = this.song, used = new Set(song.tracks.flatMap(t => [...(t.clips || []).map(c => c.buf), ...Object.values(t.samples || {}), t.sample]).filter(Boolean)), bufs = {};
    for (const id of used) {
      if (!this.files.has(id) && Player.bufs.has(id)) this.files.set(id, (await upload('music_audio_put', { song: song.name, file: id + '.wav' }, encodeWav(Player.bufs.get(id)))).path);
      if (this.files.has(id)) bufs[id] = this.files.get(id);
    }
    await api('music_save', { name: song.name, song: { ...song, bufs } });
  },
  changed() { this.saveSoon(); },
  /* remember the song as it is now, so the next change can be undone */
  mark() { this.undo.push(JSON.stringify(this.song)); if (this.undo.length > 80) this.undo.shift(); this.redo = []; },
  clipSig() { return JSON.stringify(this.song.tracks.map(t => t.clips || 0)); },
  edit(fn, redraw = true) { this.mark(); const before = this.clipSig(); fn(); this.changed(); if (before !== this.clipSig()) Player.refresh(); if (redraw) this.draw(); },
  step(from, to) {
    if (!from.length) return; to.push(JSON.stringify(this.song));
    const name = this.song.name; this.song = Player.song = { ...JSON.parse(from.pop()), name };
    if (!this.track(this.sel)) this.sel = null; this.multi = new Set([...this.multi].filter(id => this.track(id))); this.range = this.clipSel = null; this.changed(); Player.refresh(); this.draw();
  },
  track(id) { return this.song.tracks.find(t => t.id === id); },
  get barDur() { return stepDur(this.song) * STEPS; },
  get end() { return Math.max(songDur(this.song), ...this.song.tracks.flatMap(t => (t.clips || []).map(c => c.start + c.dur))); },
  fit() { const need = Math.ceil(this.end / this.barDur - 1e-6); if (need > this.song.bars) this.song.bars = Math.min(400, need); },

  /* ---- tracks */
  newTrack(role) {
    const R = ROLES[role], st = STYLES[this.song.style] || {}, n = this.song.tracks.filter(t => t.role === role).length, tr = { id: uid(), role, type: role === 'drums' ? 'drums' : 'synth', name: R.name + (n ? ' ' + (n + 1) : ''), vol: .8, len: 4 };
    if (role === 'drums') { tr.steps = {}; tr.kit = st.kit || 'studio'; } else { tr.preset = Samples.prefer(st[role] || R.preset); tr.notes = []; }
    Gen.fill(this.song, tr); this.song.tracks.push(tr); this.sel = this.fresh = tr.id;
  },
  addTrack(role) { this.edit(() => this.newTrack(role)); },
  /* a whole first draft in a style: four parts written to fit each other */
  starter(style) {
    this.edit(() => { const s = this.song, st = STYLES[style = style || Gen.pick(Object.keys(STYLES))]; Object.assign(s, { style, bpm: st.bpm, scale: st.scale, swing: st.swing || 0 }); Gen.prog(s, true); for (const r of ['drums', 'bass', 'chords', 'melody']) this.newTrack(r); this.sel = null; });
    if (!Player.playing) Player.play(0); this.drawBar();
  },
  /* a sound of your own: for one drum row, or as the instrument of a riff */
  async pickSample(tr, row) {
    const path = await UI.pickFile(App.conf('music_dir', App.boot.pictures) + '\\x', ['.wav', '.mp3', '.ogg', '.flac', '.m4a', '.aac']); if (!path) return false;
    let buf; try { buf = await this.decode(path); } catch (e) { UI.toast('That file could not be read as audio.', 'error'); return false; }
    const id = uid(); Player.bufs.set(id, buf); this.files.set(id, path); App.setConf('music_dir', path.replace(/[\\/][^\\/]*$/, ''));
    this.edit(() => { if (row) tr.samples = { ...(tr.samples || {}), [row]: id }; else { tr.sample = id; tr.preset = 'sample'; } }); Player.tap(tr, row || 60); return true;
  },
  idea(tr) { this.edit(() => Gen.fill(this.song, tr)); },
  /* Which parts are selected. A plain click picks one; Ctrl-click adds or removes one; Shift-click adds. */
  pick(tr, e) {
    const m = this.multi, had = m.has(tr.id);
    if (e && (e.ctrlKey || e.metaKey)) { had ? m.delete(tr.id) : m.add(tr.id); } else if (e && e.shiftKey) m.add(tr.id); else if (!had) { m.clear(); m.add(tr.id); }
    this.sel = m.has(tr.id) ? tr.id : [...m].pop() || null; this.clipSel = this.range = null; this.marks();
  },
  picked() { return this.song.tracks.filter(t => this.multi.has(t.id)); },
  /* show the selection on what is already drawn */
  marks() { for (const el of $$('.mu-card, .tl-row', this.stage)) el.classList.toggle('sel', this.multi.has(el.dataset.id)); this.drawTools(); },
  selectAll() { this.multi = new Set(this.song.tracks.map(t => t.id)); this.sel = this.sel || (this.song.tracks[0] || {}).id || null; this.marks(); },
  selectNone() { if (this.multi.size) { this.multi.clear(); this.marks(); } },
  removePicked() { const gone = new Set(this.picked()); if (!gone.size) return; this.edit(() => { this.song.tracks = this.song.tracks.filter(t => !gone.has(t)); this.multi.clear(); this.sel = null; this.range = this.clipSel = null; }); UI.toast(gone.size + (gone.size > 1 ? ' parts removed. Undo brings them back.' : ' part removed. Undo brings it back.')); },
  duplicatePicked() { const src = this.picked(); if (!src.length) return; this.edit(() => { this.multi.clear(); for (const tr of src) { const c = clone(tr); c.id = uid(); c.name += ' copy'; delete c.x; delete c.y; (c.clips || []).forEach(k => { k.id = uid(); }); this.song.tracks.push(c); this.multi.add(c.id); this.sel = this.fresh = c.id; } }); },
  mutePicked() { const p = this.picked(), on = p.some(t => !t.mute); this.edit(() => { for (const t of p) t.mute = on; }); },
  ideaPicked() { this.edit(() => { for (const t of this.picked()) if (t.type !== 'audio') Gen.fill(this.song, t); }); },
  /* empty the song but keep it: its name, tempo, key and place in your list stay */
  clearSong() {
    if (!this.song.tracks.length) return UI.toast('The song is already empty.');
    Player.stop(); this.edit(() => { this.song.tracks = []; this.song.marks = []; this.multi.clear(); this.sel = null; this.range = this.clipSel = null; }); UI.toast('Song cleared. Undo (Ctrl+Z) brings everything back.');
  },
  /* make cards bigger or smaller; with several selected they all change */
  resize(tr, z) { for (const t of this.multi.has(tr.id) && this.multi.size > 1 ? this.picked() : [tr]) t.z = clamp(z, .6, 3); },
  sizeAll(f) { const list = this.multi.size > 1 ? this.picked() : this.song.tracks; for (const t of list) t.z = clamp((t.z || 1) * f, .6, 3); this.changed(); this.draw(); this.tidy(); },
  /* after cards change size, nudge any that now overlap down out of the way */
  tidy() {
    const board = $('.mu-board', this.stage); if (!board) return; const placed = [];
    for (const card of $$('.mu-card', board).sort((a, b) => this.track(a.dataset.id).y - this.track(b.dataset.id).y)) {
      const tr = this.track(card.dataset.id), w = card.offsetWidth, hh = card.offsetHeight; let hit;
      while ((hit = placed.find(p => tr.x < p.x + p.w + 12 && tr.x + w + 12 > p.x && tr.y < p.y + p.h + 12 && tr.y + hh + 12 > p.y))) tr.y = hit.y + hit.h + 16;
      card.style.top = tr.y + 'px'; placed.push({ x: tr.x, y: tr.y, w, h: hh });
    }
    const pad = $('.mu-pad', board); if (pad) pad.style.top = Math.max(0, ...placed.map(p => p.y + p.h)) + 56 + 'px'; this.changed();
  },
  removeTrack(tr) { this.edit(() => { this.song.tracks = this.song.tracks.filter(t => t !== tr); this.multi.delete(tr.id); if (this.sel === tr.id) this.sel = null; this.range = null; }); },
  duplicate(tr) { this.edit(() => { const c = clone(tr); c.id = uid(); c.name += ' copy'; delete c.x; delete c.y; (c.clips || []).forEach(k => { k.id = uid(); }); this.song.tracks.splice(this.song.tracks.indexOf(tr) + 1, 0, c); this.sel = this.fresh = c.id; }); },
  addAudio(buf, name, path, at = 0, trim = 0) {
    const id = uid(); Player.bufs.set(id, buf); if (path) this.files.set(id, path);
    this.edit(() => { const tr = { id: uid(), role: 'audio', type: 'audio', name, vol: .9, clips: [{ id: uid(), buf: id, start: at, off: trim, dur: buf.duration - trim, gain: 1 }] }; this.song.tracks.push(tr); this.sel = this.fresh = tr.id; this.fit(); });
  },
  /* Where a file being dragged in would land: a track (an audio track under the pointer, or a new one) and a time */
  dropSpot(e) {
    if (Modes.beginner || !$('.tl-scroll', this.stage)) return { tr: null, at: 0 };
    const row = e.target.closest && e.target.closest('.tl-row:not(.top)'), lane = $('.tl-row.top .tl-lane', this.stage), tr = row && this.track(row.dataset.id);
    const at = lane ? this.timeAt(e, lane) : this.cursor;
    return { tr: tr && tr.type === 'audio' ? tr : null, at, row: tr && tr.type === 'audio' ? row : null };
  },
  dropHint(e) {
    $$('.tl-drop', this.stage).forEach(x => x.remove()); $$('.tl-row.drop', this.stage).forEach(x => x.classList.remove('drop'));
    if (!e) return; const sp = this.dropSpot(e), content = $('.tl-content', this.stage); if (!content) return;
    if (sp.row) sp.row.classList.add('drop');
    content.append(h('div', { class: 'tl-drop', style: { left: 340 + sp.at * this.pps + 'px' } }, h('span', {}, (sp.tr ? 'Add to ' + sp.tr.name : 'New audio track') + ' at ' + fmtTime(sp.at))));
  },
  async dropFiles(e) {
    const sp = this.dropSpot(e); this.dropHint(null); let at = sp.at, tr = sp.tr;
    for (const f of e.dataTransfer.files) {
      let buf; try { buf = await Player.ready().decodeAudioData(await f.arrayBuffer()); } catch (err) { UI.toast(f.name + ' could not be read as audio.', 'error'); continue; }
      const name = f.name.replace(/\.[^.]+$/, '');
      if (tr) this.addClip(tr, buf, name, f.path || null, at); else { this.addAudio(buf, name, f.path || null, at); tr = Modes.beginner ? null : this.track(this.sel); }
      at += buf.duration;     // several files go one after another
    }
  },
  /* put a sound on an existing audio track; anything already there from that point on is left where it is */
  addClip(tr, buf, name, path, at) {
    const id = uid(); Player.bufs.set(id, buf); if (path) this.files.set(id, path);
    this.edit(() => { const c = { id: uid(), buf: id, start: Math.max(0, at), off: 0, dur: buf.duration, gain: 1 }; tr.clips.push(c); this.sel = tr.id; this.clipSel = c.id; this.range = null; this.fit(); });
    UI.toast(name + ' added to ' + tr.name);
  },
  async importAudio() {
    const path = await UI.pickFile(App.conf('music_dir', App.boot.pictures) + '\\x', Object.keys({ '.wav': 1, '.mp3': 1, '.ogg': 1, '.flac': 1, '.m4a': 1, '.aac': 1, '.opus': 1, '.webm': 1 })); if (!path) return;
    App.setConf('music_dir', path.replace(/[\\/][^\\/]*$/, ''));
    try { this.addAudio(await this.decode(path), path.split(/[\\/]/).pop().replace(/\.[^.]+$/, ''), path, Modes.beginner ? 0 : this.cursor); } catch (e) { UI.toast('That file could not be read as audio.', 'error'); }
  },
  async toggleRec() {
    if (this.rec) return this.stopRec();
    let stream; try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch (e) { return UI.toast('No microphone available, or permission was refused.', 'error'); }
    const mr = new MediaRecorder(stream), parts = [], at = Modes.beginner ? 0 : this.cursor, wasLoop = Player.loop;
    mr.ondataavailable = e => parts.push(e.data);
    mr.onstop = async () => {
      stream.getTracks().forEach(t => t.stop()); Player.loop = wasLoop; Player.stop(); this.rec = null;
      try { const buf = await Player.ready().decodeAudioData(await new Blob(parts).arrayBuffer()); const c = Player.ctx, late = Math.min(buf.duration / 2, (c.outputLatency || 0) + (c.baseLatency || 0));   // what you played against reached your ears this much late
        this.addAudio(buf, 'Recording ' + (this.song.tracks.filter(t => t.role === 'audio').length + 1), null, at, late); } catch (e) { UI.toast('The recording could not be read.', 'error'); this.drawBar(); }
    };
    this.rec = mr; Player.loop = false; mr.start(); Player.play(at); this.drawBar();
  },
  stopRec() { if (this.rec && this.rec.state !== 'inactive') this.rec.stop(); },
  exportWav() { return this.exportAudio('.wav'); },
  async outFolder() { if (!this.song.tracks.length) { UI.toast('There is nothing to export yet.'); return null; } const f = await UI.pickFolder(App.conf('music_out', App.boot.pictures)); if (f) App.setConf('music_out', f); return f; },
  async exportAudio(ext) {
    const folder = await this.outFolder(); if (!folder) return; UI.toast('Mixing down\u2026');
    const r = await upload('music_export', { path: folder + '\\' + this.song.name + ext }, encodeWav(await renderSong(this.song, Player.bufs)));
    UI.toast('Saved ' + r.path); api('fs_reveal', { path: r.path }).catch(() => {});
  },
  /* every track on its own, for mixing somewhere else */
  async exportStems() {
    const folder = await this.outFolder(); if (!folder) return; let last;
    for (const tr of this.song.tracks) { UI.toast('Rendering ' + tr.name + '\u2026'); const solo = { ...this.song, tracks: this.song.tracks.map(t => ({ ...t, mute: false, solo: t === tr })) }; last = await upload('music_export', { path: `${folder}\\${this.song.name} - ${tr.name.replace(/[\\/:*?"<>|]/g, '')}.wav` }, encodeWav(await renderSong(solo, Player.bufs))); }
    UI.toast(this.song.tracks.length + ' stems saved'); api('fs_reveal', { path: last.path }).catch(() => {});
  },
  async exportMidi() {
    if (!this.song.tracks.some(t => t.type !== 'audio')) return UI.toast('MIDI holds notes, so it needs at least one drums, bass, chords or melody part.');
    const folder = await this.outFolder(); if (!folder) return; const r = await upload('music_export', { path: folder + '\\' + this.song.name + '.mid' }, midiFile(this.song)); UI.toast('Saved ' + r.path); api('fs_reveal', { path: r.path }).catch(() => {});
  },
  exportMenu(e) {
    const r = e.currentTarget.getBoundingClientRect(), a = (label, ext) => ({ label, run: () => this.exportAudio(ext).catch(UI.error) });
    UI.menu(r.right - 250, r.bottom + 4, [a('Song as WAV (best quality)', '.wav'), a('Song as MP3 (small, plays anywhere)', '.mp3'), a('Song as FLAC (lossless, smaller)', '.flac'), a('Song as OGG', '.ogg'), '-', { label: 'Each track as its own WAV (stems)', run: () => this.exportStems().catch(UI.error) }, { label: 'Notes as a MIDI file', run: () => this.exportMidi().catch(UI.error) }]);
  },
  async importMidi() {
    const path = await UI.pickFile(App.conf('music_dir', App.boot.pictures) + '\\x', ['.mid', '.midi']); if (!path) return; let m;
    try { m = parseMidi(await (await fetch('/img/audio?path=' + encodeURIComponent(path))).arrayBuffer()); } catch (e) { return UI.toast('That MIDI file could not be read.', 'error'); }
    this.edit(() => {
      const s = this.song, per = m.tpq / 4, made = []; let last = 0; if (!s.tracks.length) s.bpm = clamp(Math.round(m.bpm), 40, 220); s.scale = 'chromatic';
      for (const mt of m.tracks) {
        if (mt.ch === 9) { const tr = { id: uid(), role: 'drums', type: 'drums', name: mt.name || 'Drums', vol: .8, kit: 'studio', steps: {} }; for (const n of mt.notes) { const k = GM_FROM[n.n], st = Math.round(n.t / per); if (k) { (tr.steps[k] = tr.steps[k] || [])[st] = true; last = Math.max(last, st); } } if (Object.keys(tr.steps).length) made.push(tr); continue; }
        const avg = mt.notes.reduce((a, n) => a + n.n, 0) / mt.notes.length, role = avg < 52 ? 'bass' : avg < 66 ? 'chords' : 'melody', lo = ROLES[role].base + keyOff(s);
        const tr = { id: uid(), role, type: 'synth', name: mt.name || ROLES[role].name, vol: .8, preset: ROLES[role].preset, notes: mt.notes.map(n => { let k = n.n; while (k < lo) k += 12; while (k > lo + 24) k -= 12; return { s: Math.round(n.t / per), d: Math.max(1, Math.round(n.d / per)), n: k }; }) };
        last = Math.max(last, ...tr.notes.map(n => n.s + n.d - 1)); made.push(tr);
      }
      s.bars = clamp(Math.max(s.bars, Math.ceil((last + 1) / STEPS)), 1, 400);
      for (const tr of made) { tr.len = s.bars; for (const k of Object.keys(tr.steps || {})) tr.steps[k] = Array.from({ length: s.bars * STEPS }, (_, i) => !!tr.steps[k][i]); s.tracks.push(tr); }
      if (!made.length) UI.toast('No notes were found in that MIDI file.'); else this.sel = made[0].id;
    });
  },
  async rename() {
    const n = await UI.prompt('Rename Song', 'Song name', this.song.name); if (!n || n === this.song.name) return;
    await this.save(); const r = await api('music_rename', { old: this.song.name, new: n });
    for (const [id, p] of this.files) if (p.startsWith(r.folder.replace(/[\\/][^\\/]*$/, ''))) this.files.set(id, r.folder + '\\' + p.split(/[\\/]/).pop());
    this.song.name = r.name; App.setConf('music_last', r.name); await this.save(); this.drawBar();
  },
  async songsMenu(e) {
    const r = e.currentTarget.getBoundingClientRect(), list = await api('music_list');
    UI.menu(r.left, r.bottom + 4, [{ label: 'New Song', run: () => this.save().then(() => this.create()) }, { label: 'Rename Song…', run: () => this.rename() }, { label: 'Lyrics and Notes…', run: () => this.lyrics() }, { label: 'Clear Song', run: () => this.clearSong() }, '-',
      ...list.map(s => ({ label: s.name, checked: s.name === this.song.name, run: async () => { await this.save(); const d = await api('music_load', { name: s.name }); if (d) this.load(d); } }))]);
  },
  retune(change) {
    this.edit(() => {
      const before = this.song.tracks.filter(t => t.type === 'synth').map(t => trackNotes(this.song, t)); change();
      this.song.tracks.filter(t => t.type === 'synth').forEach((t, i) => {
        const now = trackNotes(this.song, t), same = now.length === before[i].length;
        for (const n of t.notes) { const k = before[i].indexOf(n.n); n.n = same && k >= 0 ? now[k] : now.reduce((b, x) => (Math.abs(x - n.n) < Math.abs(b - n.n) ? x : b), now[0]); }
      });
    });
  },

  /* ---- audio editing (Advanced). Clips point into buffers, so cutting and moving never copies sound; effects write new buffers. */
  target() {
    const tr = this.track(this.range ? this.range.id : this.sel); if (!tr || tr.type !== 'audio') return null;
    if (this.range) return { tr, a: this.range.a, b: this.range.b };
    const c = tr.clips.find(k => k.id === this.clipSel); if (c) return { tr, a: c.start, b: c.start + c.dur };
    const e = Math.max(0, ...tr.clips.map(k => k.start + k.dur)); return e ? { tr, a: 0, b: e, whole: true } : null;
  },
  split(tr, t) { const c = tr.clips.find(k => t > k.start + .001 && t < k.start + k.dur - .001); if (c) { tr.clips.push({ ...c, id: uid(), start: t, off: c.off + t - c.start, dur: c.start + c.dur - t, fi: 0 }); c.dur = t - c.start; c.fo = 0; } },
  inside(tr, a, b) { this.split(tr, a); this.split(tr, b); return tr.clips.filter(k => k.start >= a - .001 && k.start + k.dur <= b + .001); },
  need(msg = 'Select an audio track first, then drag across the part you want.') { const t = this.target(); if (!t) UI.toast(msg); return t; },
  remove(ripple) {
    const t = this.need(); if (!t || (t.whole && !this.range)) return t && UI.toast('Drag across the part of the audio you want to remove.');
    this.edit(() => { const gone = new Set(this.inside(t.tr, t.a, t.b)); t.tr.clips = t.tr.clips.filter(k => !gone.has(k)); if (ripple) for (const k of t.tr.clips) if (k.start >= t.b - .001) k.start -= t.b - t.a; this.cursor = t.a; this.range = this.clipSel = null; });
  },
  copy() {
    const t = this.need(); if (!t) return false;
    this.clipboard = { len: t.b - t.a, clips: t.tr.clips.filter(k => k.start < t.b && k.start + k.dur > t.a).map(k => { const s = Math.max(k.start, t.a), e = Math.min(k.start + k.dur, t.b); return { buf: k.buf, gain: k.gain, off: k.off + s - k.start, dur: e - s, rel: s - t.a }; }) };
    UI.toast('Copied ' + this.clipboard.len.toFixed(2) + ' s'); return true;
  },
  cut() { if (this.copy()) this.remove(true); },
  paste() {
    const tr = this.track(this.sel), cb = this.clipboard; if (!cb) return UI.toast('Nothing copied yet.'); if (!tr || tr.type !== 'audio') return UI.toast('Select the audio track to paste into.');
    this.edit(() => { const t = this.cursor; this.split(tr, t); for (const k of tr.clips) if (k.start >= t - .001) k.start += cb.len; for (const c of cb.clips) tr.clips.push({ id: uid(), buf: c.buf, gain: c.gain, off: c.off, dur: c.dur, start: t + c.rel }); this.range = { id: tr.id, a: t, b: t + cb.len }; this.fit(); });
  },
  splitHere() { const tr = this.track(this.sel); if (!tr || tr.type !== 'audio') return UI.toast('Select an audio track, click where to split, then press Split.'); this.edit(() => { if (this.range) { this.split(tr, this.range.a); this.split(tr, this.range.b); } else this.split(tr, this.cursor); }); },
  trim() { const t = this.need(); if (!t || t.whole) return t && UI.toast('Drag across the part you want to keep.'); this.edit(() => { t.tr.clips = this.inside(t.tr, t.a, t.b); }); },
  slice(c) {
    const src = Player.bufs.get(c.buf), sr = src.sampleRate, i0 = Math.floor(c.off * sr), n = Math.max(1, Math.min(src.length - i0, Math.round(c.dur * sr))), out = new AudioBuffer({ length: n, numberOfChannels: src.numberOfChannels, sampleRate: sr });
    for (let k = 0; k < src.numberOfChannels; k++) out.copyToChannel(src.getChannelData(k).subarray(i0, i0 + n), k); return out;
  },
  /* Run every clip in the selection through fn(buffer, p0, p1, ctx) -> buffer (may be async); p runs 0..1 across the selection.
     scale says how much longer or shorter the result is, so later audio can be moved along. */
  async process(name, fn, { scale = 1, prep, mirror, repack } = {}) {
    const t = this.need(); if (!t) return;
    let shift = 0; this.mark(); const clips = this.inside(t.tr, t.a, t.b), span = t.b - t.a || 1, slices = clips.map(c => ({ c, buf: this.slice(c) })), ctx = prep ? prep(slices.map(x => x.buf)) : null;
    try {
      slices.sort((x, y) => x.c.start - y.c.start);
      for (const { c, buf } of slices) { const out = await fn(buf, (c.start - t.a) / span, (c.start + c.dur - t.a) / span, ctx), id = uid(), was = c.dur; Player.bufs.set(id, out); c.start = mirror ? t.a + (t.b - (c.start + c.dur)) : repack ? c.start + shift : t.a + (c.start - t.a) * scale; c.buf = id; c.off = 0; c.dur = out.duration; shift += out.duration - was; }
    } catch (e) { this.step(this.undo, []); return UI.error(e); }
    const d = repack ? shift : span * scale - span;
    if (Math.abs(d) > 1e-4) { for (const k of t.tr.clips) if (!clips.includes(k) && k.start >= t.b - .001) k.start += d; if (this.range) this.range.b = t.b + d; this.fit(); }
    this.changed(); Player.refresh(); this.draw(); UI.toast(name + ' applied');
  },
  each(name, fn, opts) { return this.process(name, (buf, p0, p1, ctx) => { for (let k = 0; k < buf.numberOfChannels; k++) fn(buf.getChannelData(k), p0, p1, ctx); return buf; }, opts); },
  /* an effect built from audio nodes, rendered offline */
  nodes(name, build) { return this.process(name, buf => { const ctx = new OfflineAudioContext(buf.numberOfChannels, buf.length, buf.sampleRate), src = ctx.createBufferSource(); src.buffer = buf; build(ctx, src).connect(ctx.destination); src.start(); return ctx.startRendering(); }); },
  /* an effect the engine computes (noise reduction, pitch, tempo) */
  server(name, op, v, scale = 1) {
    UI.toast(name + '\u2026');
    return this.process(name, async buf => { const r = await fetch('/api/upload/music_process?' + new URLSearchParams({ op, v }), { method: 'POST', body: encodeWav(buf) }); if (!r.ok || !(r.headers.get('Content-Type') || '').includes('audio')) throw new Error((await r.json().catch(() => ({}))).error || name + ' failed'); return Player.ready().decodeAudioData(await r.arrayBuffer()); }, { scale });
  },
  async ask(title, label, def, min, max) { const v = await UI.prompt(title, label, String(def)); return v == null || v === '' || !isFinite(+v) ? null : clamp(+v, min, max); },
  fade(inward) { this.each(inward ? 'Fade in' : 'Fade out', (d, p0, p1) => { for (let i = 0, n = d.length; i < n; i++) { const p = p0 + (p1 - p0) * i / n; d[i] *= inward ? p : 1 - p; } }); },
  async amplify() { const v = await this.ask('Amplify', 'Change in decibels (6 is about twice as loud, -6 about half)', 6, -60, 40); if (v == null) return; const g = 10 ** (v / 20); this.each('Amplify', d => { for (let i = 0; i < d.length; i++) d[i] = clamp(d[i] * g, -1, 1); }); },
  normalize() { this.each('Normalize', (d, p0, p1, g) => { for (let i = 0; i < d.length; i++) d[i] *= g; }, { prep: bufs => { let pk = 1e-6; for (const b of bufs) for (let k = 0; k < b.numberOfChannels; k++) { const d = b.getChannelData(k); for (let i = 0; i < d.length; i++) pk = Math.max(pk, Math.abs(d[i])); } return .97 / pk; } }); },
  reverse() { this.each('Reverse', d => { d.reverse(); }, { mirror: true }); },
  async filter(type) {
    const low = type === 'lowpass', f = await this.ask(low ? 'Low-pass Filter' : 'High-pass Filter', low ? 'Remove everything above this frequency in Hz (muffles hiss and harshness)' : 'Remove everything below this frequency in Hz (removes rumble and hum)', low ? 4000 : 120, 20, 20000); if (f == null) return;
    this.nodes(low ? 'Low-pass filter' : 'High-pass filter', (ctx, src) => { const a = ctx.createBiquadFilter(), b = ctx.createBiquadFilter(); a.type = b.type = type; a.frequency.value = b.frequency.value = f; src.connect(a); a.connect(b); return b; });
  },
  async echoFx() { const sec = await this.ask('Echo', 'Seconds between repeats', .3, .02, 2); if (sec == null) return; this.nodes('Echo', (ctx, src) => { const out = ctx.createGain(), d = ctx.createDelay(2.5), fb = ctx.createGain(); d.delayTime.value = sec; fb.gain.value = .45; src.connect(out); src.connect(d); d.connect(fb); fb.connect(d); d.connect(out); return out; }); },
  reverbFx() { this.nodes('Reverb', (ctx, src) => { const out = ctx.createGain(), cv = ctx.createConvolver(), wet = ctx.createGain(); cv.buffer = Sound.impulse(ctx); wet.gain.value = .35; src.connect(out); src.connect(cv); cv.connect(wet); wet.connect(out); return out; }); },
  compress() { this.nodes('Compressor', (ctx, src) => { const c = ctx.createDynamicsCompressor(), g = ctx.createGain(); c.threshold.value = -24; c.ratio.value = 4; c.attack.value = .005; c.release.value = .2; g.gain.value = 1.8; src.connect(c); c.connect(g); return g; }); },
  async noiseProfile() {
    const t = this.need(); if (!t || t.whole) return t && UI.toast('Drag across a stretch that holds only the noise (no talking or music), then choose this again.');
    const c = t.tr.clips.find(k => k.start < t.b && k.start + k.dur > t.a); if (!c) return; const a = Math.max(c.start, t.a), b = Math.min(c.start + c.dur, t.b);
    await upload('music_noise_profile', {}, encodeWav(this.slice({ ...c, off: c.off + a - c.start, dur: b - a }))); UI.toast('Noise profile taken. Now select the audio to clean and choose Noise Reduction.');
  },
  async denoise() { const v = await this.ask('Noise Reduction', 'Strength from 1 (gentle) to 10 (strong). Tip: take a noise profile first for a cleaner result.', 5, 1, 10); if (v != null) this.server('Noise reduction', 'denoise', v / 10); },
  async pitch() { const v = await this.ask('Change Pitch', 'Semitones up (+) or down (-), keeping the length. 12 is one octave.', 2, -24, 24); if (v) this.server('Change pitch', 'pitch', v); },
  async tempo() { const v = await this.ask('Change Tempo', 'Percent of the original speed, keeping the pitch (25 to 400)', 110, 25, 400); if (v && v !== 100) this.server('Change tempo', 'tempo', v / 100, 100 / v); },
  async speed() { const v = await this.ask('Change Speed', 'Percent of the original speed. Pitch follows, like a tape or a record (25 to 400)', 90, 25, 400); if (v && v !== 100) this.server('Change speed', 'speed', v / 100, 100 / v); },
  /* put a new piece of audio at the cursor of the selected audio track, or on a track of its own */
  insert(buf, name) {
    const tr = this.track(this.sel); if (!tr || tr.type !== 'audio') return this.addAudio(buf, name, null, this.cursor);
    const id = uid(); Player.bufs.set(id, buf);
    this.edit(() => { const t = this.cursor; this.split(tr, t); for (const k of tr.clips) if (k.start >= t - .001) k.start += buf.duration; tr.clips.push({ id: uid(), buf: id, start: t, off: 0, dur: buf.duration, gain: 1 }); this.range = { id: tr.id, a: t, b: t + buf.duration }; this.fit(); });
  },
  async generate(kind) {
    const secs = await this.ask(kind, 'Length in seconds', 2, .05, 600); if (secs == null) return; let f = 440;
    if (kind === 'Tone') { f = await this.ask('Tone', 'Frequency in Hz (440 is the note A)', 440, 20, 20000); if (f == null) return; }
    const sr = 44100, buf = new AudioBuffer({ length: Math.round(secs * sr), numberOfChannels: 1, sampleRate: sr }), d = buf.getChannelData(0);
    if (kind !== 'Silence') for (let i = 0; i < d.length; i++) d[i] = kind === 'Tone' ? .5 * Math.sin(2 * Math.PI * f * i / sr) : (Math.random() * 2 - 1) * .3;
    this.insert(buf, kind);
  },
  /* six-band tone control */
  async equalizer() {
    const bands = [60, 200, 600, 2000, 6000, 12000], gains = bands.map(() => 0);
    const ok = await UI.dialog({ title: 'Equalizer', width: 400, body: h('div', {}, h('div', { class: 'fnote' }, 'Boost or cut each part of the sound, from the deepest (left of the list) to the brightest.'), bands.map((f, i) => UI.slider({ label: f < 1000 ? f + ' Hz' : f / 1000 + ' kHz', min: -18, max: 18, step: 1, value: 0, def: 0, oninput: v => { gains[i] = v; } }))), buttons: [['Cancel', null], ['Apply', true, 'primary']] });
    if (ok && gains.some(Boolean)) this.nodes('Equalizer', (ctx, src) => bands.reduce((prev, f, i) => { const b = ctx.createBiquadFilter(); b.type = i === 0 ? 'lowshelf' : i === bands.length - 1 ? 'highshelf' : 'peaking'; b.frequency.value = f; b.Q.value = 1; b.gain.value = gains[i]; prev.connect(b); return b; }, src));
  },
  /* smooth over single-sample spikes (vinyl crackle, digital pops) */
  declick() {
    this.each('Remove clicks', d => { let sum = 0; for (let i = 1; i < d.length; i++) sum += (d[i] - d[i - 1]) ** 2; const thr = Math.max(.02, 8 * Math.sqrt(sum / d.length));
      for (let i = 1; i < d.length - 1; i++) { const a = d[i] - d[i - 1], b = d[i] - d[i + 1]; if (Math.abs(a) > thr && Math.abs(b) > thr && a * b > 0) d[i] = (d[i - 1] + d[i + 1]) / 2; } });
  },
  /* shorten every pause longer than half a second to a short breath */
  truncate() {
    this.process('Truncate silence', buf => {
      const sr = buf.sampleRate, n = buf.length, ch = Array.from({ length: buf.numberOfChannels }, (_, k) => buf.getChannelData(k)), quiet = i => ch.every(d => Math.abs(d[i]) < .01), min = Math.round(sr * .5), leave = Math.round(sr * .15), keep = [];
      let start = 0;
      for (let i = 0; i < n;) { if (!quiet(i)) { i++; continue; } let j = i; while (j < n && quiet(j)) j++; if (j - i > min) { keep.push([start, i + leave]); start = j - 0; } i = j + 1; }
      keep.push([start, n]);
      const len = keep.reduce((a, [x, y]) => a + Math.max(0, Math.min(n, y) - x), 0), out = new AudioBuffer({ length: Math.max(1, len), numberOfChannels: ch.length, sampleRate: sr });
      ch.forEach((d, k) => { const o = out.getChannelData(k); let at = 0; for (const [x, y] of keep) { const e = Math.min(n, y); if (e > x) { o.set(d.subarray(x, e), at); at += e - x; } } });
      return out;
    }, { repack: true });
  },
  /* stretch the selected audio so its beat matches the song's tempo (or just report what its tempo seems to be) */
  fitTempo(only) {
    const t = this.need(); if (!t) return; const c = t.tr.clips.find(k => k.start < t.b && k.start + k.dur > t.a); if (!c) return;
    const bpm = detectTempo(this.slice({ ...c, off: c.off + Math.max(0, t.a - c.start), dur: Math.min(c.start + c.dur, t.b) - Math.max(c.start, t.a) }));
    if (!bpm) return UI.toast('No steady beat could be found in that audio.');
    if (only) return UI.toast(`That sounds like about ${Math.round(bpm)} beats per minute (an estimate). The song is at ${this.song.bpm}.`);
    const rate = this.song.bpm / bpm; if (Math.abs(rate - 1) < .01) return UI.toast('It already matches the song tempo.');
    this.server(`Fit to tempo (${Math.round(bpm)} to ${this.song.bpm})`, 'tempo', rate, 1 / rate);
  },
  /* turn held chords into a rising run of single notes */
  arpeggiate(tr) {
    this.edit(() => { const by = new Map(); for (const n of tr.notes) (by.get(n.s) || by.set(n.s, []).get(n.s)).push(n); const out = [];
      for (const [s, ns] of by) { if (ns.length < 2) { out.push(...ns); continue; } ns.sort((a, b) => a.n - b.n); const len = Math.max(...ns.map(n => n.d)); for (let i = 0; i * 2 < len; i++) out.push({ s: s + i * 2, d: 2, n: ns[i % ns.length].n }); }
      tr.notes = out; });
  },
  addMarker() { UI.prompt('Marker', 'Name this point in the song', 'Chorus').then(n => { if (n) this.edit(() => { (this.song.marks = this.song.marks || []).push({ id: uid(), t: this.cursor, name: n }); }); }); },
  lyrics() {
    const ta = h('textarea', { rows: 16, value: this.song.lyrics || '', placeholder: 'Words, ideas, chords, to-dos\u2026' });
    UI.dialog({ title: this.song.name + ' \u2014 Lyrics and Notes', width: 520, body: ta, buttons: [['Cancel', null], ['Save', true, 'primary']] }).then(ok => { if (ok) { this.song.lyrics = ta.value; this.changed(); } });
  },
  /* play the selected part from the computer keyboard (A S D F G H J K L ;) or a MIDI keyboard; while the song plays, what you play is written into the riff */
  setLive(on) {
    this.live = on; this.drawTools();
    if (on && !this.midi && navigator.requestMIDIAccess) navigator.requestMIDIAccess().then(acc => { this.midi = acc; const hook = () => acc.inputs.forEach(inp => { inp.onmidimessage = e => { if ((e.data[0] & 240) === 144 && e.data[2] && this.live && App.module === 'music') this.strike(null, e.data[1]); }; }); hook(); acc.onstatechange = hook; }).catch(() => {});
    if (on) UI.toast('Play with A S D F G H J K L ; or a MIDI keyboard. Press Play first to record what you play into the selected part.');
  },
  strike(idx, midi) {
    const tr = this.track(this.sel) && this.track(this.sel).type !== 'audio' ? this.track(this.sel) : this.song.tracks.find(t => t.type !== 'audio'); if (!tr) return UI.toast('Add a drums, bass, chords or melody part to play.');
    const notes = tr.type === 'drums' ? KIT.map(k => k[0]) : trackNotes(this.song, tr);
    const what = midi == null ? notes[idx] : tr.type === 'drums' ? GM_FROM[midi] : notes.reduce((b, x) => (Math.abs((x - midi) % 12) + Math.abs(x - midi) / 100 < Math.abs((b - midi) % 12) + Math.abs(b - midi) / 100 ? x : b), notes[0]);
    if (what == null) return; Player.tap(tr, what);
    if (!Player.playing) return;
    const st = Math.round(Player.now() / stepDur(this.song)) % (tr.len * STEPS); this.mark();
    if (tr.type === 'drums') { const row = tr.steps[what] = (tr.steps[what] || []).slice(); while (row.length < tr.len * STEPS) row.push(false); row[st] = true; }
    else if (!tr.notes.some(n => n.s === st && n.n === what)) tr.notes.push({ s: st, d: { bass: 2, chords: 4, melody: 2 }[tr.role], n: what });
    this.changed(); for (const g of this.grids) if (g.tr === tr) { g.layout(); }
  },
  fxItems() {
    const i = (label, run) => ({ label, run });
    return [i('Fade In', () => this.fade(true)), i('Fade Out', () => this.fade(false)), i('Amplify\u2026', () => this.amplify()), i('Normalize', () => this.normalize()), i('Compressor', () => this.compress()), '-',
      i('Low-pass Filter\u2026', () => this.filter('lowpass')), i('High-pass Filter\u2026', () => this.filter('highpass')), i('Echo\u2026', () => this.echoFx()), i('Reverb', () => this.reverbFx()), i('Reverse', () => this.reverse()), '-',
      i('Change Pitch\u2026', () => this.pitch()), i('Change Tempo\u2026', () => this.tempo()), i('Change Speed\u2026', () => this.speed()), '-', i('Fit to Song Tempo', () => this.fitTempo()), i('Detect Tempo', () => this.fitTempo(true)), '-', i('Equalizer\u2026', () => this.equalizer()), i('Remove Clicks', () => this.declick()), i('Truncate Silence', () => this.truncate()), '-', i('Get Noise Profile', () => this.noiseProfile().catch(UI.error)), i('Noise Reduction\u2026', () => this.denoise())];
  },
  genItems() { return ['Silence', 'Tone', 'Noise'].map(k => ({ label: k + '\u2026', run: () => this.generate(k) })); },
  tapTempo() { const now = performance.now(), taps = this.taps = (this.taps || []).filter(t => now - t < 2500); taps.push(now); if (taps.length >= 3) { const bpm = clamp(Math.round(60000 * (taps.length - 1) / (now - taps[0])), 40, 220); if (bpm !== this.song.bpm) this.edit(() => { this.song.bpm = bpm; }, false); this.drawBar(); } },
  mixer(tr) {
    const S = (label, key, min, max, step, def) => UI.slider({ label, min, max, step, value: tr[key] ?? def, def, tip: MU_TIPS[key], oninput: v => { tr[key] = v; }, onchange: () => { this.changed(); this.draw(); } });
    this.mark(); UI.dialog({ title: tr.name + ' — Mixer', width: 380, body: h('div', {}, S('Volume', 'vol', 0, 1, .01, .8), S('Pan', 'pan', -1, 1, .01, 0), S('Bass', 'low', -18, 18, 1, 0), S('Treble', 'high', -18, 18, 1, 0), S('Room', 'room', 0, 1, .01, 0), S('Echo', 'echo', 0, 1, .01, 0)) });
  },
  trackMenu(e, tr) {
    const r = e.currentTarget.getBoundingClientRect();
    UI.menu(r.left, r.bottom + 4, [{ label: 'Rename…', run: async () => { const n = await UI.prompt('Rename', 'Name', tr.name); if (n) this.edit(() => { tr.name = n; }); } }, { label: 'Mixer…', run: () => this.mixer(tr) },
      tr.type === 'drums' || tr.type === 'synth' ? { label: 'Riff Length', sub: [...new Set([1, 2, 4, 8, tr.len])].sort((a, b) => a - b).map(n => ({ label: n + (n > 1 ? ' bars' : ' bar'), checked: tr.len === n, run: () => this.edit(() => { tr.len = n; if (tr.notes) tr.notes = tr.notes.filter(k => k.s < n * STEPS); }) })) } : null,
      tr.type === 'synth' ? { label: 'Arpeggiate Chords', run: () => this.arpeggiate(tr) } : null,
      tr.type !== 'audio' ? { label: 'Clear Riff', run: () => this.edit(() => { if (tr.steps) tr.steps = {}; else tr.notes = []; }) } : null, { label: 'Duplicate', run: () => this.duplicate(tr) }, '-', { label: 'Delete', run: () => this.removeTrack(tr) }]);
  },

  /* ---- drawing */
  draw() {
    if (!this.bar) return;
    this.grids = []; this.drawBar(); this.drawTools();
    if (Modes.beginner) { this.editor.replaceChildren(); this.drawBoard(); } else { this.drawTimeline(); this.drawEditor(); }
    if (this.fresh) this.reveal($('.mu-board, .tl-scroll', this.stage), Modes.beginner ? '.mu-card' : '.tl-row');
  },
  tip(el, key, name) { el.dataset.tip = MU_TIPS[key]; if (name) el.dataset.tipName = name; return el; },
  mini(tr, key, min, max, def, name) { return this.tip(h('input', { type: 'range', class: 'mini', min, max, step: .01, value: tr[key] ?? def, onmousedown: () => this.mark(), oninput: e => { tr[key] = +e.target.value; this.changed(); }, ondblclick: e => { tr[key] = def; e.target.value = def; this.changed(); } }), key, name); },
  drawBar() {
    document.body.classList.toggle('mu-playing', Player.playing);
    const s = this.song, adv = !Modes.beginner, lab = (text, key) => this.tip(h('span', { class: 'mu-lab' }, text), key);
    const num = (v, min, max, set) => h('input', { type: 'number', class: 'mu-num', value: v, min, max, onchange: e => { const n = clamp(Math.round(+e.target.value) || v, min, max); e.target.value = n; set(n); } });
    this.posEl = h('span', { class: 'mu-pos' });
    this.bar.replaceChildren(
      h('button', { class: 'btn primary mu-play', title: 'Play / Stop (Space)', onclick: () => this.toggle() }, Player.playing ? '■  Stop' : '▶  Play'),
      h('button', { class: 'btn mu-rec' + (this.rec ? ' on' : ''), title: 'Record from the microphone (R)', onclick: () => this.toggleRec() }, this.rec ? '●  Stop recording' : '●  Record'),
      adv ? this.tip(h('button', { class: 'tbtn' + (Player.loop ? ' on' : ''), onclick: () => { Player.loop = !Player.loop; Player.refresh(); this.drawBar(); } }, 'Loop'), 'loop') : null,
      adv ? this.tip(h('button', { class: 'tbtn' + (Player.metro ? ' on' : ''), onclick: () => { Player.metro = !Player.metro; this.drawBar(); } }, 'Click'), 'metro', 'Metronome') : null,
      this.posEl,
      h('span', { class: 'mu-group' }, lab('Tempo', 'tempo'), num(s.bpm, 40, 220, v => this.edit(() => { s.bpm = v; })), h('button', { class: 'tbtn', title: 'Tap this button in time with the beat you want', onclick: () => this.tapTempo() }, 'Tap')),
      h('span', { class: 'mu-group' }, lab('Key', 'key'), h('select', { onchange: e => this.retune(() => { s.key = e.target.selectedIndex; }) }, NOTE_NAMES.map((n, i) => h('option', { selected: i === s.key }, n))),
        this.tip(h('select', { onchange: e => this.retune(() => { s.scale = e.target.value; }) }, Object.entries(SCALE_NAMES).filter(([k]) => adv || k !== 'chromatic' || s.scale === k).map(([k, l]) => h('option', { value: k, selected: k === s.scale }, l))), 'scale', 'Scale')),
      h('span', { class: 'mu-group' }, lab('Bars', 'bars'), adv ? num(s.bars, 1, 400, v => this.edit(() => { s.bars = v; })) : h('select', { onchange: e => this.edit(() => { s.bars = +e.target.value; this.fit(); }) }, [...new Set([4, 8, 16, s.bars])].sort((a, b) => a - b).map(n => h('option', { selected: n === s.bars }, n)))),
      adv ? h('span', { class: 'mu-group' }, lab('Swing', 'swing'), num(Math.round((s.swing || 0) * 100), 0, 70, v => this.edit(() => { s.swing = v / 100; }))) : null,
      h('span', { class: 'tb-fill' }), this.meterEl = h('span', { class: 'mu-meter', title: 'Output level' }, h('i')),
      h('button', { class: 'tbtn', title: 'Undo (Ctrl+Z)', disabled: !this.undo.length, onclick: () => this.step(this.undo, this.redo) }, '↶'), h('button', { class: 'tbtn', title: 'Redo (Ctrl+Y)', disabled: !this.redo.length, onclick: () => this.step(this.redo, this.undo) }, '↷'),
      h('button', { class: 'tbtn mu-name', title: 'Your songs', onclick: e => this.songsMenu(e) }, s.name + '  ▾'),
      h('button', { class: 'btn', title: 'Save the song as WAV, MP3, FLAC or OGG, as separate tracks, or as MIDI', onclick: e => this.exportMenu(e) }, 'Export  \u25be'));
  },
  adders(big) {
    const b = (label, tipText, run) => { const el = h('button', { class: 'btn' + (big ? ' big' : ''), onclick: run }, label); el.dataset.tip = tipText; el.dataset.tipName = label.replace(/^\+\s*/, ''); return el; };
    return [b('+ Drums', 'A beat. Each row is a drum, each column a moment in the bar.', () => this.addTrack('drums')), b('+ Bass', 'The low notes that hold the song together.', () => this.addTrack('bass')),
      b('+ Chords', 'Several notes at once, giving the song its mood.', () => this.addTrack('chords')), b('+ Melody', 'The tune on top, the part you would hum.', () => this.addTrack('melody')),
      b('+ Audio file', 'Bring in a recording or a song from this computer.', () => this.importAudio())];
  },
  drawTools() {
    const adv = !Modes.beginner, t = (label, title, run) => h('button', { class: 'tbtn', title, onclick: run }, label), menu = (label, title, items) => h('button', { class: 'tbtn', title, onclick: e => { const r = e.currentTarget.getBoundingClientRect(); UI.menu(r.left, r.bottom + 4, items()); } }, label);
    this.tools.replaceChildren(h('span', { class: 'mu-lab' }, 'Add'), ...this.adders(), h('button', { class: 'tbtn' + (this.live ? ' on' : ''), title: 'Play the selected part from your keyboard (A S D F G H J K L ;) or a MIDI keyboard. While the song plays, what you play is written into the riff.', onclick: () => this.setLive(!this.live) }, '\u2328  Play keys'),
      ...(adv ? [] : [h('span', { class: 'mu-sep' }), h('span', { class: 'mu-lab' }, 'Card size'), t('\u2212', 'Make the cards smaller (the selected ones, or all of them)', () => this.sizeAll(1 / 1.25)), t('+', 'Make the cards bigger (the selected ones, or all of them)', () => this.sizeAll(1.25))]),
      ...(this.multi.size > 1 ? [h('span', { class: 'mu-sep' }), h('span', { class: 'mu-picked' }, h('b', {}, this.multi.size + ' selected'), t('New idea', 'Write a fresh riff for each selected part', () => this.ideaPicked()), t(this.picked().some(x => !x.mute) ? 'Mute' : 'Unmute', 'Silence or un-silence the selected parts', () => this.mutePicked()), t('Duplicate', 'Copy the selected parts (Ctrl+D)', () => this.duplicatePicked()), t('Delete', 'Remove the selected parts (Delete)', () => this.removePicked()), t('\u00d7', 'Clear the selection (Esc)', () => this.selectNone()))] : []),
      ...(adv ? [h('span', { class: 'mu-sep' }), h('span', { class: 'mu-lab' }, 'Edit audio'),
      t('Split', 'Split at the cursor or at both ends of the selection (S)', () => this.splitHere()), t('Cut', 'Cut the selection and close the gap (Ctrl+X)', () => this.cut()), t('Copy', 'Copy the selection (Ctrl+C)', () => this.copy()), t('Paste', 'Insert the copied audio at the cursor (Ctrl+V)', () => this.paste()),
      t('Delete', 'Delete the selection and close the gap (Delete)', () => this.remove(true)), t('Silence', 'Remove the selection but leave the gap', () => this.remove(false)), t('Trim', 'Keep only the selection', () => this.trim()),
      h('span', { class: 'mu-sep' }), menu('Effects  \u25be', 'Effects for the selected audio', () => this.fxItems()), menu('Generate  \u25be', 'Insert silence, a test tone or noise at the cursor', () => this.genItems()),
      h('span', { class: 'mu-sep' }), h('button', { class: 'tbtn' + (this.spec ? ' on' : ''), title: 'Show audio as a spectrogram: pitch from low (bottom) to high (top), brighter where it is louder', onclick: () => { this.spec = !this.spec; this.draw(); } }, 'Spectrogram'),
      h('button', { class: 'tbtn', title: 'Name the point under the cursor, e.g. Verse or Chorus (M)', onclick: () => this.addMarker() }, 'Marker'),
      h('button', { class: 'tbtn' + (this.snap ? ' on' : ''), title: 'Snap the cursor, selections and clips to the beat grid (hold Alt to override)', onclick: () => { this.snap = !this.snap; this.drawTools(); } }, 'Snap'),
      h('span', { class: 'tb-fill' }), t('−', 'Zoom out', () => this.zoom(1 / 1.5)), t('+', 'Zoom in', () => this.zoom(1.5)), t('Fit', 'Show the whole song', () => this.zoom(0))] : []));
  },
  head(tr, board) {
    const sel = e => { if (board) return; const was = this.sel; this.pick(tr, e); if (this.sel !== was) this.draw(); };
    return [h('i', { class: 'mu-dot' }), h('b', { class: 'mu-tname', title: tr.name, onclick: sel, ondblclick: async () => { const n = await UI.prompt('Rename', 'Name', tr.name); if (n) this.edit(() => { tr.name = n; }); } }, tr.name),
      tr.type === 'synth' ? h('select', { class: 'mu-preset', title: 'Instrument', onchange: async e => { const v = e.target.value; if (v === 'sample') { if (!await this.pickSample(tr)) e.target.value = tr.preset; } else { this.edit(() => { tr.preset = v; }, false); if (INSTR[v].smp) await Samples.load(INSTR[v].smp, Player.ready()); Player.tap(tr, trackNotes(this.song, tr)[7]); } } }, Object.entries(INSTR).map(([k, p]) => h('option', { value: k, selected: k === tr.preset }, p.name))) : null,
      tr.type === 'drums' ? h('select', { class: 'mu-preset', title: 'Drum kit', onchange: e => { this.edit(() => { tr.kit = e.target.value; }, false); Player.tap(tr, 'kick'); } }, Object.entries(KITS).map(([k, p]) => h('option', { value: k, selected: k === (tr.kit || 'studio') }, p.name))) : null,
      tr.type !== 'audio' ? this.tip(h('button', { class: 'tbtn', onclick: () => this.idea(tr) }, '🎲' + (board ? '  New idea' : '')), 'idea', 'New idea') : null,
      h('span', { class: 'tb-fill' }),
      h('button', { class: 'tbtn mu-m' + (tr.mute ? ' on' : ''), title: 'Mute', onclick: e => { tr.mute = !tr.mute; e.currentTarget.classList.toggle('on', tr.mute); if (board) e.currentTarget.textContent = tr.mute ? 'Muted' : 'On'; this.changed(); } }, board ? (tr.mute ? 'Muted' : 'On') : 'M'),
      board ? null : h('button', { class: 'tbtn mu-s' + (tr.solo ? ' on' : ''), title: 'Solo: hear only this track', onclick: e => { tr.solo = !tr.solo; e.currentTarget.classList.toggle('on', tr.solo); this.changed(); } }, 'S'),
      this.mini(tr, 'vol', 0, 1, .8, 'Volume'),
      h('button', { class: 'tbtn', title: 'More', onclick: e => this.trackMenu(e, tr) }, '⋯')];
  },

  /* Beginner: free-form board of cards */
  drawBoard() {
    const s = this.song, board = h('div', { class: 'mu-board' }), was = $('.mu-board', this.stage), keep = was ? [was.scrollLeft, was.scrollTop] : [0, 0];
    board.onmousedown = e => this.band(e, board);
    if (!s.tracks.length) {
      board.append(h('div', { class: 'mu-empty' }, h('h2', {}, 'Make something'), h('p', {}, 'A song here is a few short riffs that loop together. Add them one at a time, or let Opia start you off and then change whatever you like.'),
        h('button', { class: 'btn primary big', onclick: () => this.starter() }, '\u2728  Start me off'), h('div', { class: 'mu-or' }, 'or pick a style'), h('div', { class: 'mu-row' }, Object.entries(STYLES).map(([k, st]) => h('button', { class: 'btn', onclick: () => this.starter(k) }, st.name))),
        h('div', { class: 'mu-or' }, 'or add a part yourself'), h('div', { class: 'mu-row' }, this.adders(true))));
      return this.stage.replaceChildren(board);
    }
    let bottom = 16;
    for (const tr of s.tracks) {
      const body = tr.type === 'audio' ? this.audioCard(tr) : this.grid(tr, false).el;
      const card = h('div', { class: 'mu-card' + (this.multi.has(tr.id) ? ' sel' : ''), onmousedown: e => { if (!e.target.closest('.mc-head')) this.pick(tr, e.ctrlKey || e.metaKey || e.shiftKey ? e : null); } }, h('div', { class: 'mc-head', title: 'Drag to move. Ctrl-click or Shift-click to select several.', onmousedown: e => this.dragCard(e, tr, card) }, this.head(tr, true)), body,
        h('i', { class: 'mc-size', title: 'Drag to make this card bigger or smaller. Double-click to reset.', onmousedown: e => this.sizeDown(e, tr), ondblclick: () => { this.resize(tr, 1); this.changed(); this.draw(); this.tidy(); } }));
      card.style.setProperty('--c', ROLES[tr.role].color); board.append(card); card.fit = body.fit || (() => this.grids.find(g => g.tr === tr && !g.big).zoom());
      if (tr.x == null) { tr.x = 20; tr.y = -1; }
      card.dataset.id = tr.id;
    }
    this.stage.replaceChildren(board); board.scrollLeft = keep[0]; board.scrollTop = keep[1];
    for (const card of $$('.mu-card', board)) { const tr = this.track(card.dataset.id); if (tr.y >= 0) bottom = Math.max(bottom, tr.y + card.offsetHeight + 16); }
    for (const card of $$('.mu-card', board)) { const tr = this.track(card.dataset.id); if (tr.y < 0) { tr.y = bottom; bottom += card.offsetHeight + 16; } Object.assign(card.style, { left: tr.x + 'px', top: tr.y + 'px' }); }
    board.append(h('div', { class: 'mu-pad', style: { top: bottom + 40 + 'px' } }));
  },
  /* a part that was just added may land out of sight: scroll to it and flash it so the click visibly did something */
  reveal(root, sel) {
    const id = this.fresh; this.fresh = null; if (!id || !root) return;
    const el = $$(sel, root).find(c => c.dataset.id === id); if (!el) return;
    root.scrollTop = Math.max(0, el.offsetTop - (root.clientHeight - el.offsetHeight) / 2); el.classList.add('fresh'); setTimeout(() => el.classList.remove('fresh'), 1600);
  },
  dragCard(e, tr, card) {
    if (e.target.closest('button,select,input') || e.button) return;
    const mod = e.ctrlKey || e.metaKey || e.shiftKey; this.pick(tr, e); if (!this.multi.has(tr.id)) return;      // Ctrl-click took it out of the selection
    const board = card.parentNode, group = this.picked().map(t => ({ t, x: t.x, y: t.y, el: $$('.mu-card', board).find(c => c.dataset.id === t.id) })), x0 = e.clientX, y0 = e.clientY; let moved = false;
    const mv = ev => { const dx = ev.clientX - x0, dy = ev.clientY - y0; if (Math.abs(dx) + Math.abs(dy) > 3) moved = true; if (moved) for (const g of group) { g.t.x = Math.max(0, g.x + dx); g.t.y = Math.max(0, g.y + dy); if (g.el) Object.assign(g.el.style, { left: g.t.x + 'px', top: g.t.y + 'px' }); } };
    const up = () => { removeEventListener('mousemove', mv); removeEventListener('mouseup', up); if (moved) this.changed(); else if (!mod && this.multi.size > 1) { this.multi.clear(); this.pick(tr); } };
    addEventListener('mousemove', mv); addEventListener('mouseup', up); e.preventDefault();
  },
  /* drag the corner of a card to resize it */
  sizeDown(e, tr) {
    const x0 = e.clientX, z0 = tr.z || 1, board = $('.mu-board', this.stage); e.preventDefault(); e.stopPropagation(); if (!this.multi.has(tr.id)) this.pick(tr);
    const mv = ev => { this.resize(tr, z0 + (ev.clientX - x0) / 260); for (const c of $$('.mu-card', board)) if (c.fit && this.multi.has(c.dataset.id)) c.fit(); };
    const up = () => { removeEventListener('mousemove', mv); removeEventListener('mouseup', up); this.tidy(); }; addEventListener('mousemove', mv); addEventListener('mouseup', up);
  },
  /* drag across empty board to select every card the box touches */
  band(e, board) {
    if (e.button || (e.target !== board && !e.target.classList.contains('mu-pad'))) return;
    const b = board.getBoundingClientRect(), ax = e.clientX - b.left + board.scrollLeft, ay = e.clientY - b.top + board.scrollTop, box = h('div', { class: 'mu-band' }), keep = e.ctrlKey || e.metaKey || e.shiftKey ? new Set(this.multi) : new Set(); let moved = false; board.append(box);
    const mv = ev => {
      const x = ev.clientX - b.left + board.scrollLeft, y = ev.clientY - b.top + board.scrollTop, l = Math.min(ax, x), t = Math.min(ay, y), w = Math.abs(x - ax), hh = Math.abs(y - ay); if (w + hh > 4) moved = true;
      Object.assign(box.style, { left: l + 'px', top: t + 'px', width: w + 'px', height: hh + 'px' }); this.multi = new Set(keep);
      for (const c of $$('.mu-card', board)) { const tr = this.track(c.dataset.id), on = tr.x < l + w && tr.x + c.offsetWidth > l && tr.y < t + hh && tr.y + c.offsetHeight > t; if (on) this.multi.add(tr.id); c.classList.toggle('sel', this.multi.has(tr.id)); }
    };
    const up = () => { removeEventListener('mousemove', mv); removeEventListener('mouseup', up); box.remove(); if (!moved) this.multi = keep; this.sel = [...this.multi].pop() || null; this.marks(); };
    addEventListener('mousemove', mv); addEventListener('mouseup', up); e.preventDefault();
  },
  audioCard(tr) {
    const c = tr.clips[0], buf = c && Player.bufs.get(c.buf), cv = h('canvas', { class: 'mu-wave' }), note = h('div', { class: 'fnote' }), box = h('div', { class: 'mc-audio' }, cv, note);
    box.fit = () => { const z = tr.z || 1; cv.width = Math.round(420 * z); cv.height = Math.round(64 * z); Object.assign(cv.style, { width: cv.width + 'px', height: cv.height + 'px' }); box.style.width = cv.width + 'px'; if (buf) drawWave(cv, buf, c.off, c.dur, ROLES.audio.color); };
    box.fit(); note.textContent = buf ? `${fmtTime(Math.max(...tr.clips.map(k => k.start + k.dur)))} of audio, playing from the start. Switch to Advanced to cut, move or fade it.` : 'The audio file for this part is missing.';
    return box;
  },
  grid(tr, big) { const g = new RiffGrid(tr, big); this.grids.push(g); return g; },

  /* Advanced: timeline */
  zoom(f) { const view = this.stage.clientWidth - 340; this.pps = f ? clamp(this.pps * f, 6, 400) : clamp(view / (this.end + 1), 6, 400); this.drawTimeline(); },
  drawTimeline() {
    const s = this.song, pps = this.pps, barW = this.barDur * pps, W = Math.max(this.end * pps + 240, 600), old = $('.tl-scroll', this.stage), keep = old ? [old.scrollLeft, old.scrollTop] : [0, 0];
    const ruler = h('div', { class: 'tl-lane tl-ruler', style: { width: W + 'px' }, onmousedown: e => this.seek(e, ruler) });
    for (let b = 0; b < s.bars; b++) ruler.append(h('span', { style: { left: b * barW + 'px', width: barW + 'px' } }, barW > 22 || b % 4 === 0 ? b + 1 : ''));
    ruler.append(h('i', { class: 'tl-end', style: { left: s.bars * barW + 'px' } }));
    for (const m of s.marks || []) ruler.append(h('b', { class: 'tl-mark', title: 'Click to jump here. Right-click to remove.', style: { left: m.t * pps + 'px' }, onmousedown: e => { e.stopPropagation(); this.cursor = m.t; if (Player.playing) Player.play(m.t); else Player.pos = m.t; this.frame(); }, oncontextmenu: e => { e.preventDefault(); this.edit(() => { s.marks = s.marks.filter(k => k !== m); }); } }, m.name));
    const rows = [h('div', { class: 'tl-row top' }, h('div', { class: 'tl-head' }, h('span', { class: 'dim' }, 'Bars')), ruler)];
    for (const tr of s.tracks) {
      const lane = h('div', { class: 'tl-lane', style: { width: W + 'px' } });
      if (tr.type === 'audio') {
        lane.onmousedown = e => this.laneDown(e, tr, lane);
        for (const c of tr.clips) {
          const buf = Player.bufs.get(c.buf), w = Math.max(2, c.dur * pps), cv = h('canvas', { width: Math.min(16000, Math.ceil(w)), height: 52 });
          if (buf) { if (this.spec) drawSpec(cv, buf, c.buf, c.off, c.dur); else drawWave(cv, buf, c.off, c.dur, ROLES.audio.color); }
          lane.append(h('div', { class: 'tl-clip' + (c.id === this.clipSel ? ' sel' : ''), style: { left: c.start * pps + 'px', width: w + 'px' }, title: 'Drag to move it, also onto another audio track. Drag an end to trim it. Shift-drag to select part of it.', onmousedown: e => this.clipDown(e, tr, c) }, h('div', { class: 'tl-grip' }, buf ? tr.name : 'missing audio'), cv,
            h('i', { class: 'tl-edge l', title: 'Drag to trim the start' }), h('i', { class: 'tl-edge r', title: 'Drag to trim the end' }),
            h('div', { class: 'tl-fade in', style: { width: (c.fi || 0) * pps + 'px' } }), h('div', { class: 'tl-fade out', style: { width: (c.fo || 0) * pps + 'px' } }),
            h('i', { class: 'tl-fh in', title: 'Drag right to fade this clip in', style: { left: (c.fi || 0) * pps + 'px' }, onmousedown: e => this.fadeDown(e, c, 'fi') }), h('i', { class: 'tl-fh out', title: 'Drag left to fade this clip out', style: { right: (c.fo || 0) * pps + 'px' }, onmousedown: e => this.fadeDown(e, c, 'fo') })));
        }
        if (this.range && this.range.id === tr.id) lane.append(h('div', { class: 'tl-range', style: { left: this.range.a * pps + 'px', width: (this.range.b - this.range.a) * pps + 'px' } }));
      } else {
        lane.classList.add('riff');
        for (let b = 0; b < s.bars; b++) {
          const on = !tr.on || tr.on[b] !== false, cell = h('div', { class: 'tl-bar' + (on ? ' on' : ''), style: { left: b * barW + 'px', width: barW + 'px' }, title: on ? 'Click to silence this part in bar ' + (b + 1) : 'Click to play this part in bar ' + (b + 1),
            onclick: () => this.edit(() => { tr.on = Array.from({ length: s.bars }, (_, i) => !tr.on || tr.on[i] !== false); tr.on[b] = !on; this.sel = tr.id; }) });
          if (on) { const cv = h('canvas', { width: Math.max(4, Math.round(barW)), height: 52 }); RiffGrid.preview(cv, tr, b % tr.len); cell.append(cv); }
          lane.append(cell);
        }
      }
      rows.push(h('div', { class: 'tl-row' + (this.multi.has(tr.id) || tr.id === this.sel ? ' sel' : ''), style: { '--c': ROLES[tr.role].color } }, h('div', { class: 'tl-head', title: 'Ctrl-click or Shift-click to select several tracks', onmousedown: e => { if (e.target.closest('button,select,input,.mu-tname')) return; const was = this.sel; this.pick(tr, e); if (this.sel !== was) this.draw(); } }, this.head(tr, false)), lane));
      rows[rows.length - 1].style.setProperty('--c', ROLES[tr.role].color); rows[rows.length - 1].dataset.id = tr.id;
    }
    this.headEl = h('div', { class: 'tl-play' }); this.curEl = h('div', { class: 'tl-cur' });
    const content = h('div', { class: 'tl-content' }, rows, this.headEl, this.curEl);
    if (!s.tracks.length) content.append(h('div', { class: 'mu-empty small' }, h('p', {}, 'Nothing here yet. Add a part with the buttons above, or'), h('button', { class: 'btn primary', onclick: () => this.starter() }, '✨  Start me off')));
    const scroll = h('div', { class: 'tl-scroll', onwheel: e => { if (e.ctrlKey) { e.preventDefault(); this.zoom(Math.exp(-e.deltaY * .01)); } } }, content);
    this.stage.replaceChildren(scroll); scroll.scrollLeft = keep[0]; scroll.scrollTop = keep[1]; this.frame();
  },
  snapTo(t, e) { const g = stepDur(this.song); return this.snap && !(e && e.altKey) ? Math.round(t / g) * g : t; },
  timeAt(e, lane) { return this.snapTo(Math.max(0, (e.clientX - lane.getBoundingClientRect().left) / this.pps), e); },
  seek(e, lane) { this.cursor = this.timeAt(e, lane); this.range = null; if (Player.playing) Player.play(this.cursor); else Player.pos = this.cursor; this.drawTimeline(); },
  laneDown(e, tr, lane) {
    if (e.button || (e.target.closest('.tl-clip') && !e.shiftKey)) return;
    const a = this.timeAt(e, lane), box = h('div', { class: 'tl-range' }); let b = a, moved = false; lane.append(box);
    const mv = ev => { b = this.timeAt(ev, lane); if (Math.abs(b - a) * this.pps > 3) moved = true; Object.assign(box.style, { left: Math.min(a, b) * this.pps + 'px', width: Math.abs(b - a) * this.pps + 'px' }); };
    const up = () => {
      removeEventListener('mousemove', mv); removeEventListener('mouseup', up); this.sel = tr.id;
      if (moved) { this.range = { id: tr.id, a: Math.min(a, b), b: Math.max(a, b) }; this.cursor = this.range.a; this.clipSel = null; } else { this.range = null; this.cursor = a; const c = tr.clips.find(k => a >= k.start && a <= k.start + k.dur); this.clipSel = c ? c.id : null; }
      if (!Player.playing) Player.pos = this.cursor; this.draw();
    };
    addEventListener('mousemove', mv); addEventListener('mouseup', up); e.preventDefault();
  },
  fadeDown(e, c, key) {
    const x0 = e.clientX, v0 = c[key] || 0, dir = key === 'fi' ? 1 : -1; e.preventDefault(); e.stopPropagation(); this.mark();
    const mv = ev => { c[key] = clamp(v0 + dir * (ev.clientX - x0) / this.pps, 0, c.dur / 2); };
    const up = () => { removeEventListener('mousemove', mv); removeEventListener('mouseup', up); this.changed(); Player.refresh(); this.drawTimeline(); }; addEventListener('mousemove', mv); addEventListener('mouseup', up);
  },
  /* Drag a clip: the middle moves it (along, or onto another audio track), an end trims it. A click selects it. */
  clipDown(e, tr, c) {
    if (e.button || e.shiftKey || e.target.closest('.tl-fh')) return;      // Shift-drag selects a range (laneDown); the dots are the fades
    const el = e.currentTarget, edge = e.target.classList.contains('tl-edge') ? (e.target.classList.contains('l') ? 'l' : 'r') : null, buf = Player.bufs.get(c.buf);
    const x0 = e.clientX, o = { start: c.start, off: c.off, dur: c.dur }, lane0 = el.parentNode; let moved = false, home = tr;
    e.preventDefault(); e.stopPropagation(); this.mark(); el.classList.add('drag');
    const mv = ev => {
      const dx = (ev.clientX - x0) / this.pps; if (!moved && Math.abs(ev.clientX - x0) < 3) return; moved = true;
      if (edge === 'l') { const s = clamp(this.snapTo(o.start + dx, ev), Math.max(0, o.start - o.off), o.start + o.dur - .05); c.off = o.off + (s - o.start); c.dur = o.dur - (s - o.start); c.start = s; }
      else if (edge === 'r') { const end = clamp(this.snapTo(o.start + o.dur + dx, ev), o.start + .05, o.start + (buf ? buf.duration - o.off : o.dur)); c.dur = end - o.start; }
      else {
        c.start = this.snapTo(Math.max(0, o.start + dx), ev);
        const under = document.elementFromPoint(ev.clientX, ev.clientY), row = under && under.closest && under.closest('.tl-row:not(.top)'), t = row && this.track(row.dataset.id);
        if (t && t.type === 'audio' && t !== home) { const lane = $('.tl-lane', row); if (lane) { lane.append(el); home = t; } }
      }
      el.style.left = c.start * this.pps + 'px'; el.style.width = Math.max(2, c.dur * this.pps) + 'px';
    };
    const up = ev => {
      removeEventListener('mousemove', mv); removeEventListener('mouseup', up); el.classList.remove('drag');
      if (!moved) { this.undo.pop(); this.sel = tr.id; this.clipSel = c.id; this.range = null; this.cursor = clamp(this.timeAt(ev, lane0), c.start, c.start + c.dur); if (!Player.playing) Player.pos = this.cursor; return this.draw(); }
      if (home !== tr) { tr.clips = tr.clips.filter(k => k !== c); home.clips.push(c); }
      this.sel = home.id; this.clipSel = c.id; this.range = null; this.fit(); this.changed(); Player.refresh(); this.draw();
    };
    addEventListener('mousemove', mv); addEventListener('mouseup', up);
  },
  drawEditor() {
    const tr = this.track(this.sel);
    if (!tr || tr.type === 'audio') return this.editor.replaceChildren(h('div', { class: 'mu-hint' }, tr ? 'Drag a clip to move it, also onto another audio track, and drag its ends to trim it. Shift-drag across the waveform to select part of it; the Edit and Effects buttons act on that, or on the clicked clip. Drop sound files from your computer anywhere on the timeline.' : 'Select a drums, bass, chords or melody track to edit its riff here. Click the bars in its lane to choose where it plays. In a note grid, Shift-click adds a whole chord.'));
    this.editor.replaceChildren(h('div', { class: 'mu-ed-head', style: { '--c': ROLES[tr.role].color } }, h('i', { class: 'mu-dot' }), h('b', {}, tr.name), h('span', { class: 'dim' }, `riff of ${tr.len} bar${tr.len > 1 ? 's' : ''}, repeating`)), this.grid(tr, true).el);
    this.editor.firstChild.style.setProperty('--c', ROLES[tr.role].color);
  },

  /* ---- transport */
  toggle() { if (this.rec) return this.stopRec(); if (Player.playing) Player.stop(); else Player.play(Modes.beginner ? 0 : this.cursor); this.drawBar(); },
  frame() {
    if (!this.song || !this.posEl) return;
    const t = Player.now(), sd = stepDur(this.song), step = Math.floor(t / sd + 1e-6);
    this.posEl.textContent = `Bar ${Math.floor(step / STEPS) + 1}.${Math.floor(step % STEPS / 4) + 1}   ${fmtTime(t)}`;
    for (const g of this.grids) g.tick(Player.playing ? step : -1);
    if (this.meterEl) { const lv = Player.level(); this.meterEl.firstChild.style.width = Math.round(lv * 100) + '%'; this.meterEl.classList.toggle('hot', lv > .97); }
    if (this.headEl && this.headEl.isConnected) { this.headEl.style.transform = `translateX(${t * this.pps}px)`; this.headEl.style.opacity = Player.playing ? 1 : 0; this.curEl.style.transform = `translateX(${this.cursor * this.pps}px)`; }
  },
  keys: {
    Space: () => Music.toggle(), R: () => Music.toggleRec(), L: () => { Player.loop = !Player.loop; Player.refresh(); Music.drawBar(); },
    'Ctrl+Z': () => Music.step(Music.undo, Music.redo), 'Ctrl+Y': () => Music.step(Music.redo, Music.undo), 'Ctrl+Shift+Z': () => Music.step(Music.redo, Music.undo),
    'Ctrl+X': () => Music.adv(() => Music.cut()), 'Ctrl+C': () => Music.adv(() => Music.copy()), 'Ctrl+V': () => Music.adv(() => Music.paste()), Delete: () => Music.del(), Backspace: () => Music.del(), Escape: () => Music.selectNone(), 'Ctrl+D': () => Music.duplicatePicked(),
    S: () => Music.adv(() => Music.splitHere()), M: () => Music.adv(() => Music.addMarker()), Home: () => { Music.cursor = 0; Music.range = null; if (Player.playing) Player.play(0); else Player.pos = 0; },
    'Ctrl+A': () => { const t = Music.track(Music.sel); if (Modes.beginner || !t || t.type !== 'audio' || Music.multi.size > 1) return Music.selectAll(); { Music.clipSel = null; Music.range = null; const w = Music.target(); if (w) { Music.range = { id: t.id, a: w.a, b: w.b }; Music.drawTimeline(); } } },
  },
  adv(fn) { if (!Modes.beginner) fn(); },
  /* Delete: a stretch of audio if one is selected, otherwise the selected parts */
  del() { const t = this.track(this.sel); if (!Modes.beginner && t && t.type === 'audio' && (this.range || this.clipSel) && this.multi.size < 2) return this.remove(true); if (Modes.beginner || this.multi.size > 1) this.removePicked(); else this.remove(true); },
};

const fmtTime = t => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

/* The riff editor: a drum grid (rows are drums) or a note grid (rows are the notes of the scale), sixteen steps to the bar. */
class RiffGrid {
  constructor(tr, big) {
    this.tr = tr; this.big = big; this.drums = tr.type === 'drums'; this.step = -1;
    this.size();
    this.keys = h('div', { class: 'rg-keys' }); this.cv = h('canvas', { class: 'rg-cv', onmousedown: e => this.down(e) });
    this.el = h('div', { class: 'rg' + (this.drums ? ' drums' : '') }, this.keys, h('div', { class: 'rg-scroll' }, this.cv));
    this.size(); this.layout();
  }
  size() { const z = this.big ? 1 : this.tr.z || 1; this.cw = Math.max(4, Math.round((this.drums ? (this.big ? 30 : 22) : (this.big ? 16 : 10)) * z)); this.ch = Math.max(6, Math.round((this.drums ? (this.big ? 26 : 22) : (this.big ? 15 : 11)) * z)); this.el && this.el.style.setProperty('--z', Math.min(1.8, Math.max(.8, z))); }
  zoom() { this.size(); this.layout(); }
  layout() {
    const tr = this.tr, song = Music.song;
    this.rows = this.drums ? KIT.filter(([k], i) => this.big || !Modes.beginner || i < 4 || (tr.steps[k] || []).some(Boolean)).map(([k, label]) => ({ k, label }))
      : trackNotes(song, tr).reverse().map(n => ({ k: n, label: NOTE_NAMES[n % 12], root: n % 12 === song.key }));
    this.cols = tr.len * STEPS;
    const w = this.cols * this.cw, hh = this.rows.length * this.ch, r = devicePixelRatio || 1;
    this.cv.width = w * r; this.cv.height = hh * r; Object.assign(this.cv.style, { width: w + 'px', height: hh + 'px' });
    this.keys.replaceChildren(...this.rows.map(o => h('div', { class: (o.root ? 'root' : '') + (this.drums && tr.samples && tr.samples[o.k] ? ' own' : ''), title: this.drums ? 'Click to hear it. Right-click to use a sound of your own.' : null, style: { height: this.ch + 'px', lineHeight: this.ch + 'px' }, onmousedown: e => { if (!e.button) Player.tap(tr, o.k); },
      oncontextmenu: this.drums ? e => { e.preventDefault(); UI.menu(e.clientX, e.clientY, [{ label: 'Use My Own Sound\u2026', run: () => Music.pickSample(tr, o.k) }, { label: 'Back to the Kit Sound', disabled: !(tr.samples && tr.samples[o.k]), run: () => Music.edit(() => { delete tr.samples[o.k]; }) }]); } : null }, o.label)));
    this.draw();
  }
  draw() {
    const g = this.cv.getContext('2d'), r = devicePixelRatio || 1, { cw, ch, cols, rows, tr } = this, W = cols * cw, H = rows.length * ch, col = ROLES[tr.role].color;
    g.setTransform(r, 0, 0, r, 0, 0); g.fillStyle = Theme.css('--input'); g.fillRect(0, 0, W, H);
    g.fillStyle = Theme.css('--cell'); for (let c = 0; c < cols; c += 8) g.fillRect(c * cw, 0, cw * 4, H);
    if (!this.drums) { g.fillStyle = 'rgba(128,128,128,.13)'; rows.forEach((o, i) => { if (o.root) g.fillRect(0, i * ch, W, ch); }); }
    g.strokeStyle = Theme.css('--line2'); g.lineWidth = 1; g.beginPath();
    for (let c = 0; c <= cols; c++) { g.moveTo(c * cw + .5, 0); g.lineTo(c * cw + .5, H); } for (let i = 0; i <= rows.length; i++) { g.moveTo(0, i * ch + .5); g.lineTo(W, i * ch + .5); } g.globalAlpha = .55; g.stroke(); g.globalAlpha = 1;
    g.strokeStyle = Theme.css('--dim'); g.beginPath(); for (let c = STEPS; c < cols; c += STEPS) { g.moveTo(c * cw + .5, 0); g.lineTo(c * cw + .5, H); } g.stroke();
    g.fillStyle = col;
    const box = (c, i, n) => { g.beginPath(); g.roundRect(c * cw + 2, i * ch + 2, n * cw - 3, ch - 3, 3); g.fill(); };
    if (this.drums) rows.forEach((o, i) => (tr.steps[o.k] || []).forEach((on, c) => { if (on && c < cols) box(c, i, 1); }));
    else for (const n of tr.notes) { const i = rows.findIndex(o => o.k === n.n); if (i >= 0) box(n.s, i, Math.min(n.d, cols - n.s)); }
    if (this.step >= 0) { g.fillStyle = 'rgba(255,255,255,.16)'; g.fillRect(this.step * cw, 0, cw, H); }
  }
  tick(step) { const s = step < 0 ? -1 : step % this.cols; if (s !== this.step) { this.step = s; this.draw(); } }
  at(e) { const b = this.cv.getBoundingClientRect(); return [clamp(Math.floor((e.clientX - b.left) / this.cw), 0, this.cols - 1), clamp(Math.floor((e.clientY - b.top) / this.ch), 0, this.rows.length - 1)]; }
  down(e) {
    if (e.button) return; e.preventDefault(); Music.mark();
    const tr = this.tr, [c0, r0] = this.at(e), key = this.rows[r0].k; let move;
    if (this.drums) {
      const row = tr.steps[key] = (tr.steps[key] || []).slice(); while (row.length < this.cols) row.push(false);
      const val = !row[c0]; row[c0] = val; if (val) Player.tap(tr, key);
      move = ev => { const [c] = this.at(ev); if (row[c] !== val) { row[c] = val; this.draw(); } };
    } else {
      const hit = tr.notes.find(n => n.n === key && c0 >= n.s && c0 < n.s + n.d);
      if (hit) tr.notes = tr.notes.filter(n => n !== hit);
      else if (e.shiftKey && this.rows.length < 20) { for (const r of [r0, r0 - 2, r0 - 4]) if (r >= 0) { tr.notes.push({ s: c0, d: Math.min(4, this.cols - c0), n: this.rows[r].k }); Player.tap(tr, this.rows[r].k); } }   // Shift: a chord built on this note
      else { const n = { s: c0, d: Math.min({ bass: 2, chords: 4, melody: 2 }[tr.role], this.cols - c0), n: key }; let dragged = false; tr.notes.push(n); Player.tap(tr, key); move = ev => { const [c] = this.at(ev), d = clamp(c - c0 + 1, 1, this.cols - c0); if (c !== c0) dragged = true; if (dragged && d !== n.d) { n.d = d; this.draw(); } }; }
    }
    this.draw();
    const up = () => { removeEventListener('mousemove', mv); removeEventListener('mouseup', up); Music.changed(); if (!Modes.beginner) Music.drawTimeline(); Music.drawBar(); };
    const mv = ev => move && move(ev); addEventListener('mousemove', mv); addEventListener('mouseup', up);
  }
  /* a thumbnail of one bar of a riff, for the timeline */
  static preview(cv, tr, bar) {
    const g = cv.getContext('2d'), W = cv.width, H = cv.height, sw = W / STEPS, lo = bar * STEPS; g.fillStyle = ROLES[tr.role].color;
    if (tr.type === 'drums') { const names = KIT.map(k => k[0]); names.forEach((k, i) => (tr.steps[k] || []).forEach((on, c) => { if (on && c >= lo && c < lo + STEPS) g.fillRect((c - lo) * sw + 1, 4 + i * (H - 8) / names.length, Math.max(1, sw - 2), Math.max(2, (H - 8) / names.length - 1)); })); }
    else { const ns = tr.notes.map(n => n.n), mn = Math.min(...ns, 127), mx = Math.max(...ns, 0), span = Math.max(6, mx - mn); for (const n of tr.notes) if (n.s + n.d > lo && n.s < lo + STEPS) g.fillRect((Math.max(n.s, lo) - lo) * sw + 1, 4 + (H - 12) * (1 - (n.n - mn) / span), Math.max(2, (Math.min(n.s + n.d, lo + STEPS) - Math.max(n.s, lo)) * sw - 2), 4); }
  }
}

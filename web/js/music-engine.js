'use strict';
/* Music workspace, sound side: synthesised drums and instruments, the mixer graph, the playback scheduler
   (live, and offline for export), riff generators, waveform peaks and WAV encoding. Nothing here touches the page. */

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const SCALES = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10], dorian: [0, 2, 3, 5, 7, 9, 10], mixolydian: [0, 2, 4, 5, 7, 9, 10], lydian: [0, 2, 4, 6, 7, 9, 11], phrygian: [0, 1, 3, 5, 7, 8, 10], harmonic: [0, 2, 3, 5, 7, 8, 11], chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] };
const SCALE_NAMES = { major: 'Major (bright)', minor: 'Minor (moody)', dorian: 'Dorian (jazzy)', mixolydian: 'Mixolydian (bluesy)', lydian: 'Lydian (dreamy)', phrygian: 'Phrygian (dark)', harmonic: 'Harmonic minor (dramatic)', chromatic: 'All notes' };
const KIT = [['kick', 'Kick'], ['snare', 'Snare'], ['hat', 'Hi-hat'], ['clap', 'Clap'], ['ohat', 'Open hat'], ['tom', 'Tom'], ['rim', 'Rim'], ['shaker', 'Shaker']];
const STEPS = 16;   // steps in a bar (sixteenth notes)
const INSTR = {
  keys: { name: 'Keys', osc: [['triangle', 0, 1, .7], ['sine', 0, 2, .25]], a: .005, d: .35, s: .35, r: .25, c0: 5000, c1: 1800, fd: .3, gain: .5 },
  bass: { name: 'Bass', osc: [['sawtooth', 0, 1, .6], ['square', 0, .5, .5]], a: .005, d: .2, s: .7, r: .1, c0: 1400, c1: 380, fd: .12, q: 2, gain: .55 },
  pluck: { name: 'Pluck', osc: [['sawtooth', 0, 1, .6], ['square', 7, 1, .3]], a: .003, d: .12, s: .12, r: .15, c0: 6000, c1: 700, fd: .08, gain: .5 },
  pad: { name: 'Pad', osc: [['sawtooth', -9, 1, .4], ['sawtooth', 9, 1, .4], ['sine', 0, .5, .3]], a: .25, d: .6, s: .8, r: .7, c0: 1500, c1: 1900, fd: .5, gain: .28 },
  lead: { name: 'Lead', osc: [['square', 0, 1, .5], ['sawtooth', 5, 1, .3]], a: .01, d: .2, s: .7, r: .15, c0: 4500, c1: 2600, fd: .2, gain: .32 },
  bells: { name: 'Bells', osc: [['sine', 0, 1, .6], ['sine', 0, 3.01, .3], ['sine', 0, 5.4, .12]], a: .002, d: .5, s: 0, r: .6, c0: 9000, c1: 9000, fd: .5, gain: .45 },
  piano: { name: 'Piano', osc: [['sine', 0, 1, .6], ['sine', 0, 2, .25], ['sine', 0, 3, .12], ['sine', 0, 4.02, .06], ['triangle', 0, 1, .2]], a: .003, d: .5, s: .08, r: .3, c0: 7000, c1: 2200, fd: .4, gain: .5 },
  epiano: { name: 'Electric piano', osc: [['sine', 0, 1, .8], ['sine', 4, 1, .25]], fm: [14, 1.6], a: .003, d: .6, s: .2, r: .35, c0: 6000, c1: 3000, fd: .4, gain: .45 },
  organ: { name: 'Organ', osc: [['sine', 0, .5, .5], ['sine', 0, 1, .6], ['sine', 0, 2, .35], ['sine', 0, 3, .2], ['sine', 0, 4, .12]], a: .01, d: .1, s: 1, r: .08, c0: 6000, c1: 6000, fd: .2, gain: .3 },
  strings: { name: 'Strings', osc: [['sawtooth', -12, 1, .35], ['sawtooth', 12, 1, .35], ['sawtooth', 0, 2, .12]], vib: .005, a: .14, d: .5, s: .9, r: .5, c0: 2200, c1: 2600, fd: .5, gain: .3 },
  guitar: { name: 'Guitar', ks: .996, gain: .9, r: .12 },
  harp: { name: 'Harp', ks: .9985, gain: .8, r: .5 },
  marimba: { name: 'Marimba', osc: [['sine', 0, 1, .7], ['sine', 0, 4, .22], ['sine', 0, 10, .05]], a: .002, d: .14, s: 0, r: .2, c0: 8000, c1: 8000, fd: .2, gain: .55 },
  sub: { name: '808 bass', osc: [['sine', 0, 1, 1]], drop: 2.2, a: .003, d: .8, s: .35, r: .25, c0: 900, c1: 900, fd: .2, gain: .7 },
  sample: { name: 'My sample…' },
};
/* drum kits: the same eight sounds, voiced differently. All are synthesised; any row can be swapped for a sound of your own. */
const KITS = {
  studio: { name: 'Studio kit', kf0: 150, kf1: 42, kdrop: .12, kdur: .38, st: 220, sn: 1800, sdur: .18, hf: 7500, hdur: .05, odur: .32, tf: 190 },
  k808: { name: '808 kit', kf0: 130, kf1: 34, kdrop: .18, kdur: .9, st: 180, sn: 2500, sdur: .22, hf: 9000, hdur: .035, odur: .25, tf: 140 },
  lofi: { name: 'Lo-fi kit', kf0: 120, kf1: 48, kdrop: .1, kdur: .3, st: 190, sn: 1200, sdur: .2, hf: 5200, hdur: .06, odur: .28, tf: 170, lp: 4200 },
  electro: { name: 'Electro kit', kf0: 190, kf1: 50, kdrop: .07, kdur: .26, st: 260, sn: 2600, sdur: .14, hf: 8500, hdur: .04, odur: .2, tf: 230 },
};
/* starting points for Start me off: tempo, mood, kit, beat and which instrument plays each part */
const STYLES = {
  lofi: { name: 'Lo-fi', bpm: 78, scale: 'minor', kit: 'lofi', beat: 'boom', swing: .3, bass: 'bass', chords: 'epiano', melody: 'bells' },
  pop: { name: 'Pop', bpm: 108, scale: 'major', kit: 'studio', beat: 'four', bass: 'bass', chords: 'piano', melody: 'lead' },
  house: { name: 'House', bpm: 124, scale: 'minor', kit: 'electro', beat: 'four', bass: 'bass', chords: 'organ', melody: 'pluck' },
  trap: { name: 'Trap', bpm: 140, scale: 'harmonic', kit: 'k808', beat: 'trap', bass: 'sub', chords: 'pad', melody: 'bells' },
  rock: { name: 'Rock', bpm: 118, scale: 'mixolydian', kit: 'studio', beat: 'break', bass: 'bass', chords: 'guitar', melody: 'lead' },
  ambient: { name: 'Ambient', bpm: 68, scale: 'lydian', kit: 'lofi', beat: 'half', bass: 'sub', chords: 'strings', melody: 'harp' },
};
const ROLES = {
  drums: { name: 'Drums', color: '#e8b86a' },
  bass: { name: 'Bass', preset: 'bass', base: 36, color: '#7d92ff' },
  chords: { name: 'Chords', preset: 'pad', base: 48, color: '#6fcf97' },
  melody: { name: 'Melody', preset: 'pluck', base: 60, color: '#f2789f' },
  audio: { name: 'Audio', color: '#9aa0a6' },
};

/* Sampled instruments: recordings of real instruments, a few notes in every octave, shifted to the notes in between.
   They live in web/samples (see CREDITS there) and are listed in samples/index.json; without that folder the app simply has none. */
const Samples = {
  list: {}, bank: new Map(), busy: new Map(),
  async init() {
    try { const r = await fetch('samples/index.json'); this.list = r.ok ? await r.json() : {}; } catch (e) { this.list = {}; }
    const mine = INSTR.sample; delete INSTR.sample;
    for (const [k, d] of Object.entries(this.list)) INSTR['s_' + k] = { name: d.name, smp: k, fallback: d.fallback || 'keys', gain: d.gain || 1, gm: d.gm };
    INSTR.sample = mine;
  },
  /* the sampled version of a synth instrument, when one is installed */
  prefer(preset) { const k = Object.keys(this.list).find(n => this.list[n].fallback === preset && this.list[n].first); return k ? 's_' + k : preset; },
  load(name, ctx) {
    if (this.bank.has(name) || !this.list[name]) return Promise.resolve();
    if (!this.busy.has(name)) this.busy.set(name, Promise.all(this.list[name].notes.map(async ([midi, file]) => { try { return [midi, await ctx.decodeAudioData(await (await fetch(`samples/${name}/${file}`)).arrayBuffer())]; } catch (e) { return null; } }))
      .then(got => { const m = new Map(got.filter(Boolean)); if (m.size) this.bank.set(name, m); this.busy.delete(name); }));
    return this.busy.get(name);
  },
  need(song, ctx) { ctx = ctx || Player.ready(); return Promise.all(song.tracks.map(t => (INSTR[t.preset] || {}).smp).filter(Boolean).map(n => this.load(n, ctx))); },
  near(name, midi) { const m = this.bank.get(name); if (!m) return null; let best = null; for (const k of m.keys()) if (best == null || Math.abs(k - midi) < Math.abs(best - midi)) best = k; return [m.get(best), best]; },
};
const stepDur = song => 60 / song.bpm / 4;
/* when a step sounds: every second sixteenth is pushed late by the swing amount */
const stepTime = (song, step) => (step + (step % 2 ? (song.swing || 0) * .5 : 0)) * stepDur(song);
const songSteps = song => song.bars * STEPS;
const songDur = song => songSteps(song) * stepDur(song);
const keyOff = song => (song.key > 6 ? song.key - 12 : song.key);
/* the notes a riff track can use, low to high: two octaves of the song's scale from the track's base note */
function trackNotes(song, tr) {
  const sc = SCALES[song.scale] || SCALES.minor, base = ROLES[tr.role].base + keyOff(song), out = [];
  for (let o = 0; o < 2; o++) for (const s of sc) out.push(base + o * 12 + s);
  out.push(base + 24);
  return out;
}

const Sound = {
  _noise: new WeakMap(), _ir: new WeakMap(),
  noise(ctx) {
    if (!this._noise.has(ctx)) { const b = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate), d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; this._noise.set(ctx, b); }
    return this._noise.get(ctx);
  },
  impulse(ctx) {   // a plain decaying-noise room
    if (!this._ir.has(ctx)) { const n = Math.floor(ctx.sampleRate * 2.2), b = ctx.createBuffer(2, n, ctx.sampleRate); for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n) ** 3; } this._ir.set(ctx, b); }
    return this._ir.get(ctx);
  },
  one(ctx, out, buf, t, v, rate = 1, end = 0) {   // play a sample once
    const s = ctx.createBufferSource(), g = ctx.createGain(); s.buffer = buf; s.playbackRate.value = rate; g.gain.setValueAtTime(v, t); if (end) g.gain.setTargetAtTime(0, end, .04);
    s.connect(g); g.connect(out); s.start(t); if (end) s.stop(end + .4);
  },
  /* a plucked string (Karplus-Strong): a burst of noise circulating in a delay the length of one wave, losing its edge each lap */
  _pluck: new Map(),
  pluck(ctx, midi, damp) {
    const key = ctx.sampleRate + ':' + midi + ':' + damp; if (this._pluck.has(key)) return this._pluck.get(key);
    const sr = ctx.sampleRate, n = Math.max(2, Math.round(sr / (440 * 2 ** ((midi - 69) / 12)))), b = ctx.createBuffer(1, Math.floor(sr * 2.6), sr), d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    for (let i = n + 1; i < d.length; i++) d[i] = (d[i - n] + d[i - n - 1]) * .5 * damp;
    this._pluck.set(key, b); return b;
  },
  drum(ctx, out, name, t, v = 1, kit, smp) {
    if (smp) return this.one(ctx, out, smp, t, v);
    const K = KITS[kit] || KITS.studio;
    if (K.lp) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = K.lp; f.connect(out); out = f; }
    const g = ctx.createGain(); g.connect(out);
    const osc = (type, f0, f1, dur) => { const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, t); if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur); o.connect(g); o.start(t); o.stop(t + dur + .3); };
    const amp = (peak, dur) => { g.gain.setValueAtTime(peak * v, t); g.gain.exponentialRampToValueAtTime(.001, t + dur); };
    const nz = (type, freq, q, dur, level, at = t) => {
      const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), e = ctx.createGain();
      s.buffer = this.noise(ctx); s.loop = true; f.type = type; f.frequency.value = freq; f.Q.value = q;
      e.gain.setValueAtTime(level * v, at); e.gain.exponentialRampToValueAtTime(.001, at + dur);
      s.connect(f); f.connect(e); e.connect(out); s.start(at); s.stop(at + dur + .02);
    };
    switch (name) {
      case 'kick': osc('sine', K.kf0, K.kf1, K.kdrop); amp(1, K.kdur); break;
      case 'snare': osc('triangle', K.st, K.st * .7, .1); amp(.5, .14); nz('highpass', K.sn, .7, K.sdur, .7); break;
      case 'clap': for (const o of [0, .012, .024]) nz('bandpass', 1300, 1.2, o === .024 ? .18 : .03, .7, t + o); break;
      case 'hat': nz('highpass', K.hf, .8, K.hdur, .4); break;
      case 'ohat': nz('highpass', K.hf * .93, .8, K.odur, .35); break;
      case 'tom': osc('sine', K.tf, K.tf / 2, .2); amp(.8, .3); break;
      case 'rim': osc('square', 820, 0, .03); amp(.3, .04); nz('bandpass', 2500, 3, .03, .3); break;
      case 'shaker': nz('bandpass', 5500, 1.5, .09, .28); break;
    }
  },
  note(ctx, out, preset, midi, t, dur, v = .8, smp) {
    const P = INSTR[preset] || INSTR.keys, f = 440 * 2 ** ((midi - 69) / 12), end = t + Math.max(.04, dur), amp = ctx.createGain(), lp = ctx.createBiquadFilter();
    if (preset === 'sample') { if (smp) this.one(ctx, out, smp, t, v, 2 ** ((midi - 60) / 12), end); return; }
    if (P.smp) {                       // a recorded instrument: play the nearest recorded note, shifted to pitch
      const hit = Samples.near(P.smp, midi); if (!hit) { Samples.load(P.smp, ctx); return this.note(ctx, out, P.fallback, midi, t, dur, v); }
      return this.one(ctx, out, hit[0], t, v * P.gain, 2 ** ((midi - hit[1]) / 12), end + .03);
    }
    if (P.ks) return this.one(ctx, out, this.pluck(ctx, midi, P.ks), t, v * P.gain, 1, end + P.r);
    lp.type = 'lowpass'; lp.Q.value = P.q || .7; lp.frequency.setValueAtTime(P.c0, t); lp.frequency.setTargetAtTime(P.c1, t, P.fd);
    amp.gain.setValueAtTime(0, t); amp.gain.linearRampToValueAtTime(v * P.gain, t + P.a); amp.gain.setTargetAtTime(v * P.gain * P.s, t + P.a, P.d); amp.gain.setTargetAtTime(0, end, P.r / 3);
    lp.connect(amp); amp.connect(out);
    for (const [type, detune, ratio, level] of P.osc) {
      const o = ctx.createOscillator(), g = ctx.createGain(), stop = end + P.r * 2 + .1; o.type = type; o.frequency.value = f * ratio; o.detune.value = detune; g.gain.value = level;
      if (P.drop) { o.frequency.setValueAtTime(f * ratio * P.drop, t); o.frequency.exponentialRampToValueAtTime(f * ratio, t + .06); }
      const bend = (hz, depth, settle) => { const m = ctx.createOscillator(), mg = ctx.createGain(); m.frequency.value = hz; mg.gain.setValueAtTime(depth, t); if (settle) mg.gain.setTargetAtTime(depth * settle, t, .25); m.connect(mg); mg.connect(o.frequency); m.start(t); m.stop(stop); };
      if (P.fm) bend(f * P.fm[0], f * P.fm[1], .15);      // a fast wobble on the pitch gives the bell-like bite of an electric piano
      if (P.vib) bend(5.5, f * P.vib);
      o.connect(g); g.connect(lp); o.start(t); o.stop(stop);
    }
  },
};

/* One mixer: a strip per track (tone, pan, level, echo and room sends) into a limited master. Works on a live or an offline context. */
class Rig {
  constructor(ctx, bufs) {
    this.ctx = ctx; this.bufs = bufs; this.strips = new Map(); this.live = !(ctx instanceof OfflineAudioContext);
    this.master = ctx.createGain(); const lim = ctx.createDynamicsCompressor(); lim.threshold.value = -6; lim.ratio.value = 12; lim.attack.value = .003; lim.release.value = .2;
    this.master.connect(lim); lim.connect(ctx.destination);
    if (this.live) { this.meter = ctx.createAnalyser(); this.meter.fftSize = 1024; lim.connect(this.meter); }
    this.room = ctx.createConvolver(); this.room.buffer = Sound.impulse(ctx); this.room.connect(this.master);
    this.echo = ctx.createDelay(2); const fb = ctx.createGain(); fb.gain.value = .35; this.echo.connect(fb); fb.connect(this.echo); this.echo.connect(this.master);
  }
  set(param, v) { if (this.live) param.setTargetAtTime(v, this.ctx.currentTime, .015); else param.value = v; }
  strip(tr) {
    let s = this.strips.get(tr.id);
    if (!s) {
      const c = this.ctx; s = { in: c.createGain(), low: c.createBiquadFilter(), high: c.createBiquadFilter(), pan: c.createStereoPanner(), vol: c.createGain(), room: c.createGain(), echo: c.createGain() };
      s.low.type = 'lowshelf'; s.low.frequency.value = 220; s.high.type = 'highshelf'; s.high.frequency.value = 4200; s.vol.gain.value = 0; s.room.gain.value = 0; s.echo.gain.value = 0;
      s.in.connect(s.low); s.low.connect(s.high); s.high.connect(s.pan); s.pan.connect(s.vol); s.vol.connect(this.master); s.vol.connect(s.room); s.room.connect(this.room); s.vol.connect(s.echo); s.echo.connect(this.echo);
      this.strips.set(tr.id, s);
    }
    return s;
  }
  sync(song) {
    const solo = song.tracks.some(t => t.solo);
    for (const tr of song.tracks) {
      const s = this.strip(tr);
      this.set(s.vol.gain, tr.mute || (solo && !tr.solo) ? 0 : tr.vol ?? .8); this.set(s.pan.pan, tr.pan || 0); this.set(s.room.gain, tr.room || 0); this.set(s.echo.gain, tr.echo || 0);
      this.set(s.low.gain, tr.low || 0); this.set(s.high.gain, tr.high || 0);
    }
    this.set(this.master.gain, (song.vol ?? .9) * .7);   // headroom: four parts at once would otherwise hit the limiter this.set(this.echo.delayTime, clamp(60 / song.bpm * .75, .05, 1.9));
  }
  /* everything the riff tracks play on one step */
  fire(song, step, t) {
    const sd = stepDur(song), bar = Math.floor(step / STEPS);
    for (const tr of song.tracks) {
      if (tr.type === 'audio' || (tr.on && tr.on[bar] === false)) continue;
      const ps = step % (tr.len * STEPS), out = this.strip(tr).in;
      if (tr.type === 'drums') { for (const [name] of KIT) if (tr.steps[name] && tr.steps[name][ps]) Sound.drum(this.ctx, out, name, t, 1, tr.kit, tr.samples && this.bufs.get(tr.samples[name])); }
      else for (const n of tr.notes) if (n.s === ps) Sound.note(this.ctx, out, tr.preset, n.n, t, n.d * sd * .96, .8, this.bufs.get(tr.sample));
    }
  }
  /* start every audio clip that is still to come from `from` seconds into the song; `when` is the context time of that moment */
  clips(song, from, when, until = Infinity) {
    const made = [];
    for (const tr of song.tracks) {
      if (tr.type !== 'audio') continue;
      for (const c of tr.clips) {
        const buf = this.bufs.get(c.buf), skip = Math.max(0, from - c.start), len = Math.min(c.dur - skip, until - Math.max(c.start, from));
        if (!buf || len <= 0) continue;
        const src = this.ctx.createBufferSource(), g = this.ctx.createGain(), G = c.gain ?? 1, st = when + Math.max(0, c.start - from), fi = c.fi || 0, fo = c.fo || 0, rest = c.dur - skip;
        src.buffer = buf; src.connect(g); g.connect(this.strip(tr).in);
        g.gain.setValueAtTime(fi > skip ? G * skip / fi : G, st); if (fi > skip) g.gain.linearRampToValueAtTime(G, st + fi - skip);          // the clip's own fade in
        if (fo > 0 && len >= rest - .001) { g.gain.setValueAtTime(G, Math.max(st + Math.max(0, fi - skip), st + rest - fo)); g.gain.linearRampToValueAtTime(0, st + rest); }   // and fade out
        src.start(st, c.off + skip, len); made.push(src);
      }
    }
    return made;
  }
}

/* Live playback. Steps are scheduled a little ahead of the clock so timing stays tight. */
const Player = {
  ctx: null, rig: null, bufs: new Map(), song: null, playing: false, loop: true, metro: false, pos: 0, sources: [], onstop: null,
  ready() {
    if (!this.ctx) { this.ctx = new AudioContext(); this.rig = new Rig(this.ctx, this.bufs); }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  },
  play(from = this.pos) {
    const song = this.song; if (!song) return;
    this.ready(); this.stop(true);
    if (from >= songDur(song) - .01) from = 0;
    this.rig.sync(song); this.bpm = song.bpm;
    const t0 = this.ctx.currentTime + .08;
    this.origin = this.prev = t0 - from; this.next = Math.ceil(from / stepDur(song) - 1e-6); while (stepTime(song, this.next) < from - 1e-6) this.next++;
    this.sources = this.rig.clips(song, from, t0, this.loop ? songDur(song) : Infinity);
    this.playing = true; this.timer = setInterval(() => this.tick(), 25); this.tick();
  },
  stop(quiet) {
    if (this.playing) this.pos = this.now();
    clearInterval(this.timer); clearTimeout(this.ender); this.playing = false;
    for (const s of this.sources) { try { s.stop(); } catch (e) { /* already ended */ } } this.sources = [];
    if (this.rig && !quiet) { const m = this.rig.master, t = this.ctx.currentTime; m.gain.cancelScheduledValues(t); m.gain.setTargetAtTime(0, t, .01); setTimeout(() => { if (!this.playing && this.song) this.rig.set(m.gain, (this.song.vol ?? .9) * .7); }, 400); }
    if (!quiet && this.onstop) this.onstop();
  },
  /* pick up edits (tempo, clips) without losing the place */
  refresh() { if (this.playing) this.play(this.now()); },
  now() {
    if (!this.playing) return this.pos;
    const t = this.ctx.currentTime, x = t - (t < this.origin ? this.prev : this.origin);
    return clamp(x, 0, songDur(this.song));
  },
  tick() {
    const song = this.song, sd = stepDur(song), total = songSteps(song);
    if (song.bpm !== this.bpm) return this.refresh();
    this.rig.sync(song);
    for (;;) {
      const t = this.origin + stepTime(song, this.next);
      if (t > this.ctx.currentTime + .15) break;
      if (this.next >= total) {
        if (!this.loop) { clearInterval(this.timer); this.ender = setTimeout(() => { this.playing = false; this.pos = 0; this.stop(); }, Math.max(0, (t - this.ctx.currentTime) * 1000)); return; }
        for (const s of this.sources) { try { s.stop(t); } catch (e) { /* already ended */ } }
        this.prev = this.origin; this.origin = t; this.next = 0; this.sources = this.rig.clips(song, 0, t, songDur(song));
        continue;
      }
      this.rig.fire(song, this.next, t);
      if (this.metro && this.next % 4 === 0) { const o = this.ctx.createOscillator(), g = this.ctx.createGain(); o.frequency.value = this.next % STEPS ? 1000 : 1600; g.gain.setValueAtTime(.25, t); g.gain.exponentialRampToValueAtTime(.001, t + .05); o.connect(g); g.connect(this.ctx.destination); o.start(t); o.stop(t + .06); }
      this.next++;
    }
  },
  /* audition one sound while editing */
  tap(tr, what) {
    this.ready(); this.rig.sync(this.song); const out = this.rig.strip(tr).in, t = this.ctx.currentTime + .01;
    if (tr.type === 'drums') Sound.drum(this.ctx, out, what, t, 1, tr.kit, tr.samples && this.bufs.get(tr.samples[what])); else Sound.note(this.ctx, out, tr.preset, what, t, .3, .8, this.bufs.get(tr.sample));
  },
  /* how loud the output is right now, 0..1 */
  level() { if (!this.rig || !this.playing) return 0; const d = this._lv || (this._lv = new Float32Array(1024)); this.rig.meter.getFloatTimeDomainData(d); let pk = 0; for (let i = 0; i < d.length; i += 4) pk = Math.max(pk, Math.abs(d[i])); return Math.min(1, pk); },
};

/* the whole song as one AudioBuffer, for export */
async function renderSong(song, bufs) {
  await Samples.need(song);
  const sd = stepDur(song), total = songSteps(song), ctx = new OfflineAudioContext(2, Math.ceil((total * sd + 2.5) * 44100), 44100), rig = new Rig(ctx, bufs);
  rig.sync(song);
  for (let s = 0; s < total; s++) rig.fire(song, s, stepTime(song, s));
  rig.clips(song, 0, 0, total * sd);
  return ctx.startRendering().then(buf => {   // never write a clipped file
    let pk = 0; for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i++) pk = Math.max(pk, Math.abs(d[i])); }
    if (pk > .98) for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c), g = .98 / pk; for (let i = 0; i < d.length; i++) d[i] *= g; }
    return buf;
  });
}

function encodeWav(buf) {
  const ch = Math.min(2, buf.numberOfChannels), n = buf.length, out = new DataView(new ArrayBuffer(44 + n * ch * 2)), str = (o, s) => { for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); out.setUint32(4, 36 + n * ch * 2, true); str(8, 'WAVEfmt '); out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, ch, true);
  out.setUint32(24, buf.sampleRate, true); out.setUint32(28, buf.sampleRate * ch * 2, true); out.setUint16(32, ch * 2, true); out.setUint16(34, 16, true); str(36, 'data'); out.setUint32(40, n * ch * 2, true);
  const data = []; for (let c = 0; c < ch; c++) data.push(buf.getChannelData(c));
  for (let i = 0, o = 44; i < n; i++) for (let c = 0; c < ch; c++, o += 2) { const v = clamp(data[c][i], -1, 1); out.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true); }
  return out.buffer;
}

/* min/max per 128 samples, for drawing waveforms at any zoom */
const _peaks = new WeakMap();
function peaksOf(buf) {
  if (_peaks.has(buf)) return _peaks.get(buf);
  const B = 128, n = Math.ceil(buf.length / B), lo = new Float32Array(n), hi = new Float32Array(n), a = buf.getChannelData(0), b = buf.numberOfChannels > 1 ? buf.getChannelData(1) : a;
  for (let i = 0; i < n; i++) { let mn = 0, mx = 0; for (let j = i * B, e = Math.min(buf.length, j + B); j < e; j++) { const v = (a[j] + b[j]) / 2; if (v < mn) mn = v; if (v > mx) mx = v; } lo[i] = mn; hi[i] = mx; }
  const p = { lo, hi, per: B / buf.sampleRate }; _peaks.set(buf, p); return p;
}
function drawWave(cv, buf, off, dur, color) {
  const g = cv.getContext('2d'), W = cv.width, H = cv.height, p = peaksOf(buf), mid = H / 2;
  g.clearRect(0, 0, W, H); g.fillStyle = color;
  for (let x = 0; x < W; x++) {
    const i0 = Math.floor((off + dur * x / W) / p.per), i1 = Math.max(i0 + 1, Math.floor((off + dur * (x + 1) / W) / p.per)); let mn = 0, mx = 0;
    for (let i = i0; i < i1 && i < p.lo.length; i++) { if (p.lo[i] < mn) mn = p.lo[i]; if (p.hi[i] > mx) mx = p.hi[i]; }
    g.fillRect(x, mid - mx * mid, 1, Math.max(1, (mx - mn) * mid));
  }
}

/* Riff generators. Everything follows the song's four-bar chord pattern, so separately generated parts fit together. */
const Gen = {
  progs: { bright: [[0, 4, 5, 3], [0, 5, 3, 4], [0, 3, 4, 3], [5, 3, 0, 4]], moody: [[0, 5, 2, 6], [0, 3, 5, 4], [0, 6, 5, 6], [0, 2, 3, 5]] },
  pick(a) { return a[Math.floor(Math.random() * a.length)]; },
  prog(song, fresh) { if (fresh || !song.prog) song.prog = this.pick(this.progs[['major', 'mixolydian', 'lydian'].includes(song.scale) ? 'bright' : 'moody']); return song.prog; },
  /* scale degree (0 = the key note; 7 = an octave up) to a note for this track */
  deg(song, tr, d) { const notes = trackNotes({ ...song, scale: song.scale === 'chromatic' ? 'minor' : song.scale }, tr); return notes[clamp(d, 0, notes.length - 1)]; },
  drums(tr, beat) {
    const S = {}, on = (name, ...at) => { S[name] = S[name] || Array(STEPS).fill(false); for (const i of at) S[name][i] = true; }, style = beat || this.pick(['four', 'boom', 'half', 'break']);
    if (style === 'trap') { on('kick', 0, ...this.pick([[6, 10], [3, 10], [7, 11]])); on(this.pick(['clap', 'snare']), 8); on('hat', 0, 2, 4, 6, 8, 10, 12, 14, ...this.pick([[13, 15], [5, 7], [11, 13, 15]])); if (Math.random() < .5) on('ohat', 14); }
    if (style === 'four') { on('kick', 0, 4, 8, 12); on(this.pick(['clap', 'snare']), 4, 12); on('hat', 2, 6, 10, 14); if (Math.random() < .5) on('ohat', 14); }
    if (style === 'boom') { on('kick', 0, 7, 10); on('snare', 4, 12); on('hat', 0, 2, 4, 6, 8, 10, 12, 14); }
    if (style === 'half') { on('kick', 0, 10); on('snare', 8); on('hat', 0, 2, 4, 6, 8, 10, 12, 14, 15); if (Math.random() < .5) on('rim', 3, 13); }
    if (style === 'break') { on('kick', 0, 6, 10); on('snare', 4, 12); on('hat', 0, 2, 4, 6, 8, 10, 12, 14); if (Math.random() < .6) on('snare', 15); }
    if (Math.random() < .35) on('shaker', 1, 3, 5, 7, 9, 11, 13, 15);
    tr.len = 1; tr.steps = S;
  },
  bass(song, tr) {
    const prog = this.prog(song), rhythm = this.pick([[[0, 3], [6, 2], [10, 2], [14, 2]], [[0, 4], [8, 2], [11, 3]], [[0, 2], [4, 2], [8, 2], [12, 2]], [[0, 6], [10, 4]], [[0, 3], [3, 3], [6, 2], [10, 3], [14, 2]]]);
    tr.len = 4; tr.notes = [];
    prog.forEach((d, bar) => rhythm.forEach(([s, dur], i) => tr.notes.push({ s: bar * STEPS + s, d: dur, n: this.deg(song, tr, d + (i && Math.random() < .3 ? this.pick([7, 4]) : 0)) })));
  },
  chords(song, tr) {
    const prog = this.prog(song), hits = this.pick([[[0, 16]], [[0, 16]], [[0, 6], [6, 6], [12, 4]], [[0, 8], [8, 8]], [[0, 3], [4, 3], [10, 3]]]);
    tr.len = 4; tr.notes = [];
    prog.forEach((d, bar) => { for (const [s, dur] of hits) for (const k of [0, 2, 4]) tr.notes.push({ s: bar * STEPS + s, d: dur, n: this.deg(song, tr, d + k > 9 ? d + k - 7 : d + k) }); });
  },
  melody(song, tr) {
    const prog = this.prog(song), rhythms = [[[0, 2], [2, 2], [4, 4], [10, 2], [12, 4]], [[0, 4], [6, 2], [8, 4], [14, 2]], [[0, 2], [3, 2], [6, 2], [8, 6]], [[2, 2], [4, 2], [6, 2], [8, 4], [12, 2], [14, 2]], [[0, 6], [8, 3], [11, 5]]];
    const a = this.pick(rhythms), b = this.pick(rhythms); let cur = 7;
    tr.len = 4; tr.notes = [];
    prog.forEach((d, bar) => (bar % 2 ? b : a).forEach(([s, dur], i) => {
      if (i === 0) { const tones = [d, d + 2, d + 4, d + 7, d + 9].filter(x => x >= 3 && x <= 14); cur = tones.reduce((best, x) => (Math.abs(x - cur) < Math.abs(best - cur) ? x : best), tones[0]); }
      else cur = clamp(cur + this.pick([-2, -1, -1, 1, 1, 2]), 3, 14);
      tr.notes.push({ s: bar * STEPS + s, d: dur, n: this.deg(song, tr, cur) });
    }));
  },
  fill(song, tr) { if (tr.role === 'drums') this.drums(tr, (STYLES[song.style] || {}).beat); else this[tr.role](song, tr); },
};

/* ---- spectrogram: frequency (low at the bottom) against time, brighter where there is more sound */
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) { let cr = 1, ci = 0; for (let k = 0; k < len / 2; k++) { const a = i + k, b = a + len / 2, xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr; re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi; const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t; } }
  }
}
const _spec = new Map();
function drawSpec(cv, buf, key, off, dur) {
  const id = key + '|' + off.toFixed(3) + '|' + dur.toFixed(3) + '|' + cv.height, g = cv.getContext('2d');
  if (!_spec.has(id)) {
    const N = 1024, W = clamp(Math.round(dur * 120), 8, 2400), H = cv.height, c = document.createElement('canvas'), d = buf.getChannelData(0), sr = buf.sampleRate, re = new Float32Array(N), im = new Float32Array(N), win = Float32Array.from({ length: N }, (_, i) => .5 - .5 * Math.cos(2 * Math.PI * i / N));
    c.width = W; c.height = H; const cg = c.getContext('2d'), img = cg.createImageData(W, H), px = img.data, top = Math.min(N / 2, Math.round(12000 / sr * N));
    for (let x = 0; x < W; x++) {
      const s0 = Math.round((off + dur * (x + .5) / W) * sr) - N / 2; for (let i = 0; i < N; i++) { const j = s0 + i; re[i] = j >= 0 && j < d.length ? d[j] * win[i] : 0; im[i] = 0; }
      fft(re, im);
      for (let y = 0; y < H; y++) {
        const bin = Math.max(1, Math.floor((1 - y / H) ** 2 * top)), v = clamp((20 * Math.log10(Math.hypot(re[bin], im[bin]) / (N / 4) + 1e-9) + 96) / 80, 0, 1), o = (y * W + x) * 4;
        px[o] = 255 * clamp(v * 2.2 - .5, 0, 1); px[o + 1] = 255 * clamp(v * 2.4 - 1.25, 0, 1); px[o + 2] = 255 * clamp(v < .5 ? v * 1.7 : 1.35 - v, 0, 1); px[o + 3] = 255;
      }
    }
    cg.putImageData(img, 0, 0); if (_spec.size > 80) _spec.delete(_spec.keys().next().value); _spec.set(id, c);
  }
  g.imageSmoothingEnabled = true; g.drawImage(_spec.get(id), 0, 0, cv.width, cv.height);
}

/* ---- MIDI files: riffs out (one track per part, drums on channel 10), notes in */
const GM_DRUM = { kick: 36, snare: 38, hat: 42, clap: 39, ohat: 46, tom: 45, rim: 37, shaker: 70 };
const GM_FROM = { 35: 'kick', 36: 'kick', 37: 'rim', 38: 'snare', 39: 'clap', 40: 'snare', 41: 'tom', 42: 'hat', 43: 'tom', 44: 'hat', 45: 'tom', 46: 'ohat', 47: 'tom', 48: 'tom', 49: 'ohat', 50: 'tom', 51: 'ohat', 57: 'ohat', 69: 'shaker', 70: 'shaker', 82: 'shaker' };
const GM_PROG = { keys: 0, piano: 0, epiano: 4, organ: 16, guitar: 25, harp: 46, bass: 38, sub: 38, pluck: 45, pad: 89, strings: 48, lead: 80, bells: 14, marimba: 12, sample: 0 };
function midiFile(song) {
  const TPS = 24, vlq = n => { const o = [n & 127]; while ((n >>= 7)) o.unshift((n & 127) | 128); return o; }, text = s => [...s].map(c => c.charCodeAt(0) & 127);
  const chunk = (id, bytes) => [...text(id), bytes.length >>> 24 & 255, bytes.length >>> 16 & 255, bytes.length >>> 8 & 255, bytes.length & 255, ...bytes], us = Math.round(60e6 / song.bpm);
  const riffs = song.tracks.filter(t => t.type !== 'audio'), chunks = [chunk('MTrk', [0, 255, 81, 3, us >>> 16 & 255, us >>> 8 & 255, us & 255, 0, 255, 88, 4, 4, 2, 24, 8, 0, 255, 47, 0])];
  let ch = 0;
  for (const tr of riffs) {
    const drums = tr.type === 'drums', c = drums ? 9 : (ch === 9 ? ++ch : ch) % 16, ev = []; if (!drums) ch++;
    for (let s = 0; s < songSteps(song); s++) {
      if (tr.on && tr.on[Math.floor(s / STEPS)] === false) continue; const ps = s % (tr.len * STEPS);
      if (drums) { for (const [name] of KIT) if (tr.steps[name] && tr.steps[name][ps]) ev.push([s * TPS, 1, GM_DRUM[name]], [s * TPS + 12, 0, GM_DRUM[name]]); }
      else for (const n of tr.notes) if (n.s === ps) ev.push([s * TPS, 1, n.n], [(s + n.d) * TPS - 1, 0, n.n]);
    }
    ev.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const bytes = [0, 255, 3, ...vlq(tr.name.length), ...text(tr.name)]; if (!drums) bytes.push(0, 192 | c, (INSTR[tr.preset] || {}).gm ?? GM_PROG[tr.preset] ?? 0); let at = 0;
    for (const [t, on, note] of ev) { bytes.push(...vlq(t - at), (on ? 144 : 128) | c, note, on ? 96 : 0); at = t; }
    bytes.push(0, 255, 47, 0); chunks.push(chunk('MTrk', bytes));
  }
  return new Uint8Array([...chunk('MThd', [0, 1, 0, chunks.length, 0, 96]), ...chunks.flat()]).buffer;
}
function parseMidi(ab) {
  const d = new DataView(ab), str = (o, n) => String.fromCharCode(...new Uint8Array(ab, o, n)); if (str(0, 4) !== 'MThd') throw new Error('not midi');
  const tpq = d.getUint16(12), out = { tpq, bpm: 120, tracks: [] }; let p = 8 + d.getUint32(4);
  while (p < d.byteLength - 8) {
    const id = str(p, 4), len = d.getUint32(p + 4), end = p + 8 + len; p += 8; if (id !== 'MTrk') { p = end; continue; }
    let t = 0, status = 0, name = ''; const open = {}, byCh = {}, vlq = () => { let v = 0, b; do { b = d.getUint8(p++); v = v << 7 | (b & 127); } while (b & 128); return v; };
    while (p < end) {
      t += vlq(); let b = d.getUint8(p);
      if (b === 255) { const type = d.getUint8(p + 1); p += 2; const n = vlq(); if (type === 81 && n === 3) out.bpm = 60e6 / (d.getUint8(p) << 16 | d.getUint8(p + 1) << 8 | d.getUint8(p + 2)); if (type === 3) name = str(p, n); p += n; continue; }
      if (b === 240 || b === 247) { p++; p += vlq(); continue; }
      if (b & 128) { status = b; p++; }
      const kind = status & 240, c = status & 15, a = d.getUint8(p++), v = kind === 192 || kind === 208 ? 0 : d.getUint8(p++);
      if (kind === 144 && v) open[c + ':' + a] = t;
      else if (kind === 128 || kind === 144) { const k = c + ':' + a; if (open[k] != null) { (byCh[c] = byCh[c] || []).push({ t: open[k], d: t - open[k], n: a }); delete open[k]; } }
    }
    for (const [c, notes] of Object.entries(byCh)) out.tracks.push({ ch: +c, name, notes });
    p = end;
  }
  return out;
}

/* Roughly how fast a recording is: find how often its loud moments repeat. An estimate, best on music with a clear beat. */
function detectTempo(buf) {
  const d = buf.getChannelData(0), hop = 512, n = Math.floor(d.length / hop), env = new Float32Array(n), fps = buf.sampleRate / hop; let prev = 0;
  for (let i = 0; i < n; i++) { let e = 0; for (let j = i * hop, end = j + hop; j < end; j++) e += d[j] * d[j]; e = Math.sqrt(e / hop); env[i] = Math.max(0, e - prev); prev = e; }
  let best = 0, bpm = 0;
  for (let b = 60; b <= 180; b += .5) { const lag = fps * 60 / b; let sum = 0; for (let i = 0; i + lag * 2 < n; i++) { const a = env[i]; if (a) sum += a * (env[Math.round(i + lag)] + .5 * env[Math.round(i + lag * 2)]); } if (sum > best) { best = sum; bpm = b; } }
  return bpm;
}

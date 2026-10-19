'use strict';
/* First-run tour. The logo leaves the top bar: on every step its blue dot rolls over to the next feature,
   the rest of the logo tumbles after it, and a card opens beside it. Skippable at any point; replay from Help. */

const Tour = {
  S: 44, root: null, i: 0, run: 0, busy: false,
  steps: [
    { title: 'Welcome to Opia', text: 'A one-minute tour of where everything lives. Just follow the little blue dot.' },
    { sel: '#modpick', at: 'below', title: 'Seven modules', text: 'Library organises and Develop edits. Map, Book, Slideshow, Print and Web turn your photos into something to share. Switch here, or press Ctrl+Alt+1 to 7.' },
    { sel: '#apps', at: 'below', title: 'Your workspaces', text: 'Opia is five workspaces. Lens, for your photos, is where this tour continues. Imagine is a layered picture editor for painting, cutting out and adding text. Motion puts clips, titles and music on a timeline and exports an MP4. Groove is a studio for making songs from short riffs and for editing audio. Folio is for reading, signing and rearranging PDFs.' },
    { sel: '#mod-library .side.left', at: 'right', title: 'Your sources', text: 'Catalog, Folders and Collections decide which photos you are looking at. Open Local Disk to add a folder, or use File > Import Photos.' },
    { sel: '#lib-views', at: 'inside', title: 'The grid', text: 'Every photo in the current source. Press 1 to 5 to rate, P to flag a pick and X to reject. G and E switch between Grid and Loupe.' },
    { sel: '#lib-filter', at: 'below', title: 'Find anything', text: 'Narrow the grid by text, flags or stars. Ctrl+L turns the filters on and off.' },
    { sel: '#mod-library .side.right', at: 'left', title: 'Details and quick edits', text: 'Quick Develop, keywords and metadata for whatever is selected.' },
    { sel: '#filmstrip', at: 'above', title: 'The filmstrip', text: 'Your current photos stay along the bottom in every module. F6 hides it and Tab hides the side panels.' },
    { sel: '#modpick a[data-m="develop"]', at: 'below', title: 'Develop', text: 'Press D to edit the selected photo. Edits are kept in the catalog, so your original files are never changed.' },
    { sel: '#looks', at: 'below', title: 'Make it yours', text: 'Pick a theme and a language here. The Trackpad switch beside it makes two fingers pan and a pinch zoom.' },
    { sel: '#modes .seg', at: 'below', title: 'That was the Beginner tour', text: 'This tour covered Beginner mode, which keeps the essentials and tucks the specialist tools away. Switch to Advanced here whenever you want every panel and tool. You can replay the tour from Help > Take the Tour.' },
  ],

  start() {
    if (this.root) return;
    App.show('library');
    if (document.body.classList.contains('nopanels') || document.body.classList.contains('nofilm')) { document.body.classList.remove('nopanels', 'nofilm'); dispatchEvent(new Event('resize')); }
    document.activeElement && document.activeElement.blur();
    this.list = this.steps.filter(s => !s.sel || ($(s.sel) && $(s.sel).offsetWidth));
    this.hole = h('div', { class: 'tour-hole none' });
    this.logo = h('div', { class: 'tour-logo' }, $('#brand svg').cloneNode(true));
    this.ball = h('div', { class: 'tour-ball' });
    this.card = h('div', { class: 'tour-card' });
    this.root = h('div', { id: 'tour' }, this.hole, this.card, this.logo, this.ball);
    document.body.append(this.root);
    this.logo.style.transform = this.tf(this.home());
    $('#brand').style.visibility = 'hidden';
    this.onKey = e => {
      e.stopPropagation();
      const act = { Escape: () => this.finish(), Enter: () => this.go(this.i + 1), ArrowRight: () => this.go(this.i + 1), ArrowLeft: () => this.go(this.i - 1) }[e.key];
      if (act) { e.preventDefault(); act(); }
    };
    this.onSize = () => { if (!this.busy && !this.closing) this.place(this.layout(this.list[this.i])); };
    document.addEventListener('keydown', this.onKey, true); addEventListener('resize', this.onSize);
    this.busy = this.closing = false; this.i = -1; this.go(0);
  },

  home() { const r = $('#brand').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, s: r.width / this.S }; },
  tf(p, rot = 0) { return `translate(${p.x}px,${p.y}px) rotate(${rot}deg) scale(${p.s})`; },
  /* where the ball sits when it is docked in a logo at p, and how small it is there */
  dock(p) { const u = this.S * p.s / 64; return { x: p.x + 3.84 * u, y: p.y - 3.84 * u, k: 8.96 * u / 14 }; },
  ballTf(x, y, k, rot = 0) { return `translate(${x - 7}px,${y - 7}px) rotate(${rot}deg) scale(${k})`; },

  fill(st) {
    const n = this.list.length, i = this.list.indexOf(st), last = i === n - 1;
    this.card.replaceChildren(h('div', { class: 'tour-t' }, st.title), h('div', { class: 'tour-b' }, st.text),
      h('div', { class: 'tour-f' }, h('span', { class: 'tour-dots' }, this.list.map((_, k) => h('i', { class: k === i ? 'on' : k < i ? 'seen' : '' }))), h('span', { class: 'tb-fill' }),
        !last && h('a', { class: 'tour-skip', onclick: () => this.finish() }, 'Skip tour'),
        i > 0 && h('button', { class: 'btn', onclick: () => this.go(i - 1) }, 'Back'),
        h('button', { class: 'btn primary', onclick: () => this.go(i + 1) }, last ? 'Done' : 'Next')));
  },

  layout(st) {
    const W = innerWidth, H = innerHeight, cw = this.card.offsetWidth, ch = this.card.offsetHeight, g = 16, el = st.sel && $(st.sel);
    let hole = null, x = (W - cw) / 2, y = (H - ch) / 2;
    if (el) {
      const r = el.getBoundingClientRect(), p = 5, l = Math.max(4, r.left - p), t = Math.max(4, r.top - p), w = Math.min(W - 4, r.right + p) - l, hh = Math.min(H - 4, r.bottom + p) - t;
      hole = { l, t, w, h: hh };
      const cx = l + w / 2 - cw / 2;
      [x, y] = { right: [l + w + g, t + 24], left: [l - g - cw, t + 24], below: [cx, t + hh + g], above: [cx, t - g - ch], inside: [cx, t + hh / 2 - ch / 2] }[st.at];
    }
    x = clamp(x, 12, W - cw - 12); y = clamp(y, 12, H - ch - 12);
    return { hole, x, y, logo: { x: x + 36, y: y + 36, s: 1 } };
  },
  spot(hole) {
    const o = hole || { l: innerWidth / 2, t: innerHeight / 2, w: 0, h: 0 };
    this.hole.classList.toggle('none', !hole);
    Object.assign(this.hole.style, { left: o.l + 'px', top: o.t + 'px', width: o.w + 'px', height: o.h + 'px' });
  },
  place(L) { this.spot(L.hole); Object.assign(this.card.style, { left: L.x + 'px', top: L.y + 'px' }); this.logo.style.transform = this.tf(L.logo); },

  async go(n) {
    if (this.busy || this.closing || n < 0) return;
    if (n >= this.list.length) return this.finish();
    this.busy = true; this.i = n;
    const st = this.list[n];
    this.card.classList.remove('on'); this.fill(st);
    const L = this.layout(st);
    this.spot(L.hole);
    if (await this.travel(L.logo)) { Object.assign(this.card.style, { left: L.x + 'px', top: L.y + 'px' }); this.card.classList.add('on'); }
    this.busy = false;
  },

  /* ball first, logo after. Resolves false if another move (or Skip) took over on the way. */
  async travel(to) {
    const id = ++this.run, logo = this.logo, ball = this.ball, m = new DOMMatrix(getComputedStyle(logo).transform), from = { x: m.e, y: m.f, s: Math.hypot(m.a, m.b) };
    if (this.anim) this.anim.cancel();
    const land = () => { logo.style.transform = this.tf(to); logo.classList.remove('flying'); ball.style.display = ''; };
    if (matchMedia('(prefers-reduced-motion: reduce)').matches || Math.hypot(to.x - from.x, to.y - from.y) < 3) { land(); return true; }
    logo.style.transform = this.tf(from);
    const a = this.dock(from), b = this.dock(to);
    ball.style.transform = this.ballTf(a.x, a.y, a.k); ball.style.display = 'block'; logo.classList.add('flying');
    const rolled = this.fly(a, b, 540, id);
    await new Promise(r => setTimeout(r, 300));
    if (id !== this.run) return false;
    this.anim = logo.animate([{ transform: this.tf(from) }, { transform: this.tf(to, to.x < from.x ? -360 : 360) }], { duration: 480, easing: 'cubic-bezier(.3,1.35,.5,1)' });
    await Promise.all([rolled, this.anim.finished.catch(() => {})]);
    if (id !== this.run) return false;
    logo.style.transform = this.tf(to);
    await ball.animate([{ transform: this.ballTf(b.x, b.y, 1) }, { transform: this.ballTf(b.x, b.y, b.k) }], { duration: 150, easing: 'ease-in' }).finished;
    if (id !== this.run) return false;
    land();
    $('.lg-orbit', logo).animate([{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }], { duration: 700, easing: 'cubic-bezier(.5,.1,.3,1)' });
    return true;
  },

  /* one arc and a small bounce, shedding sparks on the way */
  fly(a, b, ms, id) {
    return new Promise(res => {
      const t0 = performance.now(), lift = clamp(Math.hypot(b.x - a.x, b.y - a.y) * .28, 36, 170), arc = .8; let last = 0;
      const tick = now => {
        if (id !== this.run) return res();
        const t = clamp((now - t0) / ms, 0, 1); let x = b.x, y;
        if (t < arc) { const u = t / arc, e = u * u * (3 - 2 * u); x = a.x + (b.x - a.x) * e; y = a.y + (b.y - a.y) * e - lift * 4 * u * (1 - u); }
        else { const u = (t - arc) / (1 - arc); y = b.y - lift * .14 * 4 * u * (1 - u); }
        this.ball.style.transform = this.ballTf(x, y, a.k + (1 - a.k) * Math.min(1, t * 5), t * 720);
        if (t < arc && now - last > 26) { last = now; this.puff('tour-trail', x, y); }
        if (t < 1) return requestAnimationFrame(tick);
        this.puff('tour-ripple', b.x, b.y); res();
      };
      requestAnimationFrame(tick);
    });
  },
  puff(cls, x, y) { const d = h('div', { class: cls, style: { left: x + 'px', top: y + 'px' } }); d.onanimationend = () => d.remove(); this.root.append(d); },

  async finish() {
    if (!this.root || this.closing) return;
    this.closing = true;
    document.removeEventListener('keydown', this.onKey, true); removeEventListener('resize', this.onSize);
    this.card.classList.remove('on'); this.root.classList.add('closing');
    await this.travel(this.home());
    this.root.remove(); this.root = null; this.closing = false;
    $('#brand').style.visibility = '';
    if (!App.pref('tourDone', false)) App.setPref('tourDone', true);
  },
};

'use strict';
/* Two workspace switches in the top bar.
   Beginner / Advanced: the same app, but Beginner tucks the specialist panels, tools and menu items away
   (everything marked .adv, plus the panels listed in the css) and makes what is left larger. Nothing is removed: shortcuts still work.
   Trackpad: two fingers pan, a pinch zooms, and sliders and rows get bigger targets. */

const Modes = {
  get beginner() { return !!App.pref('beginner', true); },
  get trackpad() { return !!App.pref('trackpad', false); },
  init() {
    addEventListener('wheel', e => { if (e.ctrlKey && this.trackpad) e.preventDefault(); }, { passive: false });   // a stray pinch must not zoom the whole window
    this.apply();
  },
  set(key, on) {
    if (this[key] === on) return;
    App.setPref(key, on); this.apply();
    if (key === 'beginner') { buildMenus(); UI.toast(on ? 'Beginner mode: the essentials, with specialist tools tucked away.' : 'Advanced mode: every panel and tool is showing.'); }
    else UI.toast(on ? 'Trackpad controls on: two fingers pan, pinch to zoom.' : 'Trackpad controls off: the wheel zooms.');
  },
  apply() {
    const b = this.beginner, t = this.trackpad, opt = (on, label, title) => h('a', { class: b === on ? 'on' : '', title, onclick: () => this.set('beginner', on) }, label);
    document.body.classList.toggle('beginner', b); document.body.classList.toggle('trackpad', t);
    $('#modes').replaceChildren(
      h('span', { class: 'seg' }, opt(true, 'Beginner', 'Show the essentials and tuck specialist tools away'), opt(false, 'Advanced', 'Show every panel and tool')),
      h('span', { class: 'tb-check', role: 'switch', tabindex: 0, 'aria-checked': String(t), title: 'Trackpad-friendly controls: two fingers pan, pinch zooms, bigger sliders', onclick: () => this.set('trackpad', !t), onkeydown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); this.set('trackpad', !t); } } }, h('span', { class: 'switch' + (t ? ' on' : ''), 'aria-hidden': 'true' }), 'Trackpad'));
    dispatchEvent(new Event('resize'));
  },
};

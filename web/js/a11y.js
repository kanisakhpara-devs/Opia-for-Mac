'use strict';
/* Accessibility: give every control a name a screen reader can say, and every picture a description.
   Most controls already carry one (their text, a label around them, a title). For the rest a name is taken from what is next to them
   on screen: the row label, a placeholder, the hover-help title. Runs on whatever is added to the page, a moment after it appears. */

const A11y = {
  queue: new Set(), timer: 0,
  init() {
    new MutationObserver(ms => { for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1) this.queue.add(n); if (!this.timer) this.timer = setTimeout(() => this.flush(), 120); })
      .observe(document.body, { childList: true, subtree: true });
    this.queue.add(document.body); this.flush();
  },
  flush() {
    this.timer = 0; const roots = [...this.queue]; this.queue.clear();
    for (const r of roots) { if (!r.isConnected) continue; this.fix(r); r.querySelectorAll && r.querySelectorAll('input,select,textarea,button,img,[role=button],.seg a,canvas').forEach(e => this.fix(e)); }
  },
  named(el) { return el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || (el.labels && el.labels.length && [...el.labels].some(l => l.textContent.trim())); },
  text(el) { return (el.textContent || '').replace(/\s+/g, ' ').trim(); },
  /* the words shown just before a control in its row */
  near(el) {
    const row = el.closest('.frow, .srow, label, .row, .ie-num, .mu-group, .tb-group');
    if (row) { const lab = row.querySelector(':scope > span, :scope > label, :scope > b, :scope > .sub'); const t = lab && lab !== el ? this.text(lab) : ''; if (t) return t; }
    let p = el.previousElementSibling; for (let k = 0; p && k < 2; k++, p = p.previousElementSibling) { const t = this.text(p); if (t && t.length < 40 && !p.matches('input,select,textarea,button')) return t; }
    return '';
  },
  fix(el) {
    if (el.nodeType !== 1) return; const tag = el.tagName;
    if (tag === 'IMG') { if (!el.hasAttribute('alt')) el.setAttribute('alt', el.closest('[title]') ? el.closest('[title]').getAttribute('title') : ''); return; }
    if (tag === 'CANVAS') { if (!el.hasAttribute('role') && !el.hasAttribute('aria-hidden')) el.setAttribute('aria-hidden', 'true'); return; }
    if (el.matches('.seg a')) { el.setAttribute('aria-pressed', el.classList.contains('on') ? 'true' : 'false'); }
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') {
      if (el.type === 'hidden' || el.type === 'file' || this.named(el)) return;
      const n = el.getAttribute('title') || el.getAttribute('placeholder') || this.near(el) || (tag === 'SELECT' && el.options[0] ? this.text(el.options[0]) : '') || (el.type === 'color' ? 'Colour' : el.type === 'search' ? 'Search' : '');
      if (n) el.setAttribute('aria-label', n.replace(/[:…]$/, ''));
      return;
    }
    if (tag === 'BUTTON' || el.getAttribute('role') === 'button') {
      if (this.text(el) && !/^[^\p{L}\p{N}]{1,3}$/u.test(this.text(el))) return;     // words are a name; a lone symbol (×, ↶, ▶) is not
      if (el.getAttribute('aria-label')) return;
      const n = el.getAttribute('title') || el.dataset.tipName || (el.dataset.tip ? el.dataset.tip.split('.')[0] : '');
      if (n) el.setAttribute('aria-label', n); else if (el.disabled) el.setAttribute('aria-label', 'Empty');
    }
  },
};
A11y.init();

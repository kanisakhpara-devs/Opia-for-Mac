'use strict';
/* The Mac. Opia's shortcuts were written for Windows, so on a Mac:
   - ⌘ does what Ctrl does (⌘Z undoes, ⌘-click adds to a selection), and Control-click stays a right-click;
   - a trackpad pinch reaches the page as Ctrl + mouse wheel, the way Chrome and Edge send it, so pinch-to-zoom works;
   - ⌘Q, ⌘H and ⌘W are left to the Mac (quit, hide, close), so HDR moves from Ctrl+H to ⇧⌘H;
   - the delete key (which the Mac calls Backspace) deletes, as Delete does on Windows;
   - shortcuts are shown the Mac way, ⇧⌘E rather than Ctrl+Shift+E (Lang does that, with Mac.keys below).
   It also keeps a list of script errors, which the Mac build's self-test reads before a version is published. */

window.__opiaErrors = [];
addEventListener('error', e => { if (e.message) window.__opiaErrors.push(e.message + ' (' + String(e.filename || '').split('/').pop() + ':' + e.lineno + ')'); });
addEventListener('unhandledrejection', e => window.__opiaErrors.push('promise: ' + String(e.reason && (e.reason.stack || e.reason.message) || e.reason)));
{ const err = console.error.bind(console); console.error = (...a) => { window.__opiaErrors.push('console: ' + a.map(x => String(x && x.stack || x)).join(' ')); err(...a); }; }

const Mac = {
  on: /Mac/.test(navigator.platform),

  /* "Ctrl+Shift+E" -> "⇧⌘E", "Ctrl-click" -> "⌘-click", "Alt" -> "Option" */
  keys(s) {
    return s
      .replace(/\b((?:(?:Ctrl|Alt|Shift)[+-])+)(\S)/g, (all, mods, next) => {
        if (!/Ctrl|Alt/.test(mods)) return all;
        return (/Alt/.test(mods) ? '⌥' : '') + (/Shift/.test(mods) ? '⇧' : '') + (/Ctrl/.test(mods) ? '⌘' : '') + (/[a-z]/.test(next) ? '-' : '') + next;
      })
      .replace(/\bCtrl\b/g, '⌘').replace(/\bAlt\b/g, 'Option');
  },

  editable(t) { return t && t.matches && t.matches('input:not([type=range]):not([type=checkbox]),textarea,select,[contenteditable]'); },

  init() {
    if (!this.on) return;
    document.documentElement.dataset.mac = '1';
    const set = (e, k, v) => Object.defineProperty(e, k, { value: v, configurable: true });
    addEventListener('keydown', e => {
      if (e.metaKey && !e.ctrlKey && /^[qhw]$/i.test(e.key)) { e.stopImmediatePropagation(); return; }   // ⌘Q quits, ⌘H hides, ⌘W closes, as in every Mac app
      if (e.metaKey && !e.ctrlKey) set(e, 'ctrlKey', true);
      if (e.key === 'Backspace' && !this.editable(e.target)) set(e, 'key', 'Delete');
    }, true);
    addEventListener('keyup', e => { if (e.metaKey && !e.ctrlKey) set(e, 'ctrlKey', true); }, true);
    for (const type of ['mousedown', 'mouseup', 'click', 'dblclick', 'mousemove', 'pointerdown', 'pointermove', 'pointerup', 'wheel', 'dragstart', 'dragover', 'drop']) {
      addEventListener(type, e => {
        if (e.metaKey && !e.ctrlKey) set(e, 'ctrlKey', true);
        else if (e.ctrlKey && !e.metaKey && type !== 'wheel') set(e, 'ctrlKey', false);   // Control-click is the Mac's right-click, not "add to selection"
      }, true);
    }
    /* Safari's own pinch events, turned into the Ctrl + wheel that the rest of Opia listens for (scale = e^(-deltaY/100), as in Chrome) */
    let last = 1;
    addEventListener('gesturestart', e => { e.preventDefault(); last = 1; }, { passive: false });
    addEventListener('gesturechange', e => {
      e.preventDefault();
      const at = document.elementFromPoint(e.clientX, e.clientY), step = e.scale / last; last = e.scale;
      if (!at || !step) return;
      const w = new WheelEvent('wheel', { bubbles: true, cancelable: true, composed: true, clientX: e.clientX, clientY: e.clientY, deltaY: -Math.log(step) * 100, deltaMode: 0, ctrlKey: true });
      w.__pinch = true;
      at.dispatchEvent(w);
    }, { passive: false });
    addEventListener('gestureend', e => e.preventDefault(), { passive: false });
  },
};
Mac.init();

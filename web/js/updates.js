'use strict';
/* Help › Check for Updates. Opia asks before it goes online, then checks GitHub, shows what's new, updates itself and
   restarts. Once a day it can check on its own, but only if you ticked that box. */

const Updates = {
  /* the question, asked once before anything goes online */
  async ask(first) {
    const auto = h('input', { type: 'checkbox', checked: true });
    const ok = await UI.dialog({ title: first ? 'New: updates from GitHub' : 'Check for updates?', width: 470, body: h('div', { class: 'upd' },
      h('p', { class: 'msg' }, 'To look for a new version, Opia needs to go online and ask GitHub, where Opia for Mac is published.'),
      h('p', { class: 'msg' }, 'Nothing about you, this computer or your files is sent. Opia goes online for nothing else except map tiles.'),
      h('label', { class: 'frow chk' }, auto, h('span', {}, 'Check automatically once a day'))),
      buttons: [['Not now', false], ['Allow', true, 'primary']] });
    await api('update_consent', { allow: !!ok, auto: !!ok && auto.checked }).catch(UI.error);
    return !!ok;
  },

  async open() {
    let s; try { s = await api('update_settings'); } catch (e) { return UI.error(e); }
    if (!s.consent && !(await this.ask())) return;
    UI.toast('Checking GitHub for updates…');
    let info; try { info = await api('update_check'); } catch (e) { return UI.error(e); }
    if (!info.available) return this.upToDate(info);
    this.offer(info);
  },

  /* the box at the foot of each result: keep checking automatically, or stop going online for updates */
  footer(s) {
    const auto = h('input', { type: 'checkbox', checked: !!s.auto, onchange: () => api('update_consent', { allow: true, auto: auto.checked }).catch(UI.error) });
    return h('div', { class: 'upd-foot' }, h('label', { class: 'frow chk' }, auto, h('span', {}, 'Check automatically once a day')),
      h('a', { href: '#', onclick: async e => { e.preventDefault(); await api('update_consent', { allow: false }); UI.toast('Opia won\'t go online for updates. You can allow it again from Help › Check for Updates.'); $$('#overlays .overlay').pop()?.close(null); } }, 'Don\'t go online for updates'));
  },

  async upToDate(info) {
    const s = await api('update_settings');
    const what = info.note || (info.kind === 'exe' ? `You have ${info.current.version ? 'Opia ' + info.current.version : 'the newest version'}.` : 'Your copy matches the newest code on GitHub.');
    UI.dialog({ title: 'Opia is up to date', width: 470, body: h('div', { class: 'upd' }, h('p', { class: 'msg' }, what), this.footer(s)) });
  },

  async offer(info) {
    const s = await api('update_settings');
    const head = info.kind === 'exe' ? `Opia ${info.latest.replace(/^v/, '')} is ready to download${info.size ? ` (${Math.round(info.size / 1048576)} MB)` : ''}.`
      : `There ${info.count === 1 ? 'is 1 change' : `are ${info.count || 'some'} changes`} on GitHub since your copy.`;
    const how = { exe: 'Opia will download the new version for this Mac, close, swap it in and open again.', git: 'Opia will fetch the changes with git, install any new Python packages, then close and open again.', folder: 'Opia will download the newest code, copy it over this folder, then close and open again.' }[info.kind];
    const go = await UI.dialog({ title: 'An update is ready', width: 520, body: h('div', { class: 'upd' },
      h('p', { class: 'msg' }, h('b', {}, head)),
      info.notes && info.notes.length ? [h('div', { class: 'upd-k' }, 'What\'s new'), h('ul', { class: 'upd-notes' }, info.notes.map(n => h('li', { data: { notr: 1 } }, n)))] : null,
      h('p', { class: 'msg dim' }, how + ' Your catalogs, pictures and settings are kept.'),
      this.footer(s)),
      buttons: [['Later', false], ['Update now', true, 'primary']] });
    if (!go) return;
    try { await runJob(api('update_install'), 'Updating Opia'); } catch (e) { return UI.alert('The update didn\'t finish', e.message); }
    const now = await UI.dialog({ title: 'Update ready', width: 440, body: h('p', { class: 'msg' }, 'Opia will close and open again with the new version.'), buttons: [['Later', false], ['Restart now', true, 'primary']] });
    if (now) { UI.toast('Restarting Opia…'); api('update_restart').catch(UI.error); }
  },

  /* at start: ask once, and run the daily check if it is switched on */
  async boot() {
    let s; try { s = await api('update_settings'); } catch (e) { return; }
    if (!s.consent) {
      if (App.conf('update_asked')) return;
      App.setConf('update_asked', true);
      if (await this.ask(true)) this.open();
      return;
    }
    if (!s.auto || Date.now() / 1000 - (s.last || 0) < 86400) return;
    try { const info = await api('update_check'); if (info.available) this.offer(info); } catch (e) { /* offline: try again tomorrow */ }
  },
};

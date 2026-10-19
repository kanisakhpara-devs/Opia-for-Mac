"""Opia launcher: starts the local engine and opens the app in its own window (falling back to Chrome/Edge app mode, then the default browser)."""
import argparse
import json
import os
import shutil
import subprocess
import sys
import threading
import time
import webbrowser

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


def find_browser():
    """Chrome or Edge can show the UI as a chromeless app window."""
    for app in ('Google Chrome', 'Microsoft Edge', 'Chromium'):
        for apps in ('/Applications', os.path.expanduser('~/Applications')):
            p = os.path.join(apps, app + '.app', 'Contents', 'MacOS', app)
            if os.path.exists(p):
                return p
    roots = [os.environ.get(k, '') for k in ('ProgramFiles(x86)', 'ProgramFiles', 'LocalAppData')]
    for rel in (r'Microsoft\Edge\Application\msedge.exe', r'Google\Chrome\Application\chrome.exe'):
        for root in roots:
            p = os.path.join(root, rel)
            if root and os.path.exists(p):
                return p
    return shutil.which('msedge') or shutil.which('chrome') or shutil.which('chromium')


class MacWindow:
    """What the page can ask of the window itself, as window.pywebview.api.*"""

    def __init__(self):
        self._window = None     # private: pywebview hands the page every public attribute

    def fullscreen(self):
        self._window.toggle_fullscreen()     # the page's own full screen doesn't work in the Mac's web view
        return True


def self_test(window, home):
    """OPIA_SELFTEST=1: wait for the page to start, write what it reports to self-test.json in the home folder, and close.
    The Mac build runs this before it publishes, so a build whose window comes up broken is never released."""
    out = {'loaded': False}
    try:
        window.events.loaded.wait(60)
        out['loaded'] = True
        script = ("JSON.stringify({module: typeof App !== 'undefined' ? App.module : null, mac: document.documentElement.dataset.mac || null,"
                  " menus: document.querySelectorAll('#menubar .mb').length, errors: window.__opiaErrors || [],"
                  " ua: navigator.userAgent, webgl2: !!document.createElement('canvas').getContext('webgl2'),"
                  " fatal: (document.querySelector('.fatal') || {}).innerText || null,"
                  " toasts: [...document.querySelectorAll('#toasts > *')].map(t => t.innerText)})")
        for _ in range(60):
            res = json.loads(window.evaluate_js(script) or '{}')
            out.update(res)
            if res.get('module') or res.get('errors') or res.get('fatal'):
                break
            time.sleep(1)
        time.sleep(4)        # the screenshot is taken now, from outside
        out.update(json.loads(window.evaluate_js(script) or '{}'))
    except Exception as e:
        out['error'] = repr(e)
    with open(os.path.join(home, 'self-test.json'), 'w', encoding='utf-8') as f:
        json.dump(out, f, indent=1)
    window.destroy()


def native_window(url, home):
    """Show the UI in Opia's own window (the Mac's built-in WebKit), blocking until it is closed. False if that is not available."""
    try:
        import webview
    except ImportError:
        return False
    try:
        import pyi_splash      # only present in the packaged single-file app
        pyi_splash.close()
    except Exception:
        pass
    api = MacWindow()
    api._window = webview.create_window('Opia', url, width=1500, height=950, min_size=(900, 600), background_color='#0f0f10', js_api=api)
    test = (self_test, (api._window, home)) if os.environ.get('OPIA_SELFTEST') else (None, ())
    webview.start(*test, private_mode=False, storage_path=os.path.join(home, '.app'))
    return True


def main():
    ap = argparse.ArgumentParser(description='Opia photo editor')
    ap.add_argument('--port', type=int, default=0, help='port to serve on (default: any free port)')
    ap.add_argument('--no-window', action='store_true', help='only run the engine; open the URL yourself')
    ap.add_argument('--catalog', help='open this .opiacat instead of the most recent one')
    ap.add_argument('--home', help='folder for catalogs and settings (default: Pictures/Opia)')
    args, _ = ap.parse_known_args()      # Finder may add arguments of its own (-psn_...)
    if args.home:
        os.environ['OPIA_HOME'] = os.path.abspath(args.home)
    from server import app, core      # imported late so --home takes effect

    httpd = app.serve(args.port)
    if args.catalog:
        from server import catalog
        catalog.open_catalog(args.catalog)
    url = 'http://127.0.0.1:%d/' % httpd.server_port
    print('Opia is running at', url, flush=True)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()

    try:
        if args.no_window:
            threading.Event().wait()
        if native_window(url, core.HOME):
            return               # shown, and now closed
        browser = find_browser()
        if browser:
            profile = os.path.join(core.HOME, '.window')
            proc = subprocess.Popen([browser, '--app=' + url, '--user-data-dir=' + profile, '--no-first-run',
                                     '--no-default-browser-check', '--window-size=1500,950'])
            proc.wait()      # the engine lives exactly as long as the window
        else:
            webbrowser.open(url)
            print('Close this console window to quit Opia.')
            threading.Event().wait()
    except KeyboardInterrupt:
        pass
    finally:
        app.shutdown()
        httpd.shutdown()


if __name__ == '__main__':
    main()

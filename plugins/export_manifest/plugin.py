"""Sample plug-in: an export hook. Called once per export with every file that was written."""
import csv
import hashlib
import os


def on_export(paths, settings, folder, ctx):
    if not paths:
        return None
    target = os.path.join(folder, 'manifest.csv')
    with open(target, 'w', newline='', encoding='utf-8') as f:
        w = csv.writer(f)
        w.writerow(['file', 'bytes', 'sha256'])
        for p in paths:
            if not os.path.isfile(p):
                continue
            h = hashlib.sha256()
            with open(p, 'rb') as src:
                for chunk in iter(lambda: src.read(1 << 20), b''):
                    h.update(chunk)
            w.writerow([os.path.relpath(p, folder), os.path.getsize(p), h.hexdigest()])
    return 'manifest.csv written'

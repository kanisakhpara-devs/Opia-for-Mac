"""Sample plug-in: a menu command that works on the selected photos."""
import datetime
import math
import os

from PIL import Image, ImageDraw


def run(command, ctx):
    if not ctx.photos:
        return 'Select some photos first'
    cols = min(6, max(2, math.ceil(math.sqrt(len(ctx.photos)))))
    rows = math.ceil(len(ctx.photos) / cols)
    cell, pad, label = 300, 16, 22
    sheet = Image.new('RGB', (cols * (cell + pad) + pad, rows * (cell + label + pad) + pad), (245, 245, 245))
    draw = ImageDraw.Draw(sheet)
    for i, p in enumerate(ctx.photos):
        try:
            im = Image.fromarray(ctx.image(p['id'], cell))
        except Exception:
            continue
        x = pad + (i % cols) * (cell + pad) + (cell - im.width) // 2
        y = pad + (i // cols) * (cell + label + pad) + (cell - im.height) // 2
        sheet.paste(im, (x, y))
        draw.text((pad + (i % cols) * (cell + pad), pad + (i // cols) * (cell + label + pad) + cell + 4), p['filename'][:40], fill=(40, 40, 40))
    folder = os.path.join(ctx.home, 'Contact Sheets')
    os.makedirs(folder, exist_ok=True)
    path = os.path.join(folder, 'Contact Sheet %s.jpg' % datetime.datetime.now().strftime('%Y-%m-%d %H%M%S'))
    sheet.save(path, 'JPEG', quality=90)
    return 'Contact sheet of %d photos saved to %s' % (len(ctx.photos), path)

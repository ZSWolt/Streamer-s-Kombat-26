"""Prepare the Concards booster pack from the source art in the models folder.

  python tools/props.py [--src G:/AI/Claude/Models] [--no-glb]

Concards Pack.png ->
  client/public/assets/props/concards_front.webp / concards_back.webp   textures of the in-game prop
      (client/src/render/props.ts builds the pack mesh; the serrated seal is cut into the alpha here)
  <src>/Concards Pack.glb                                               the pack as a standalone model file
      (tools/models/pack.py, via Blender; the serration is real geometry there)
  tools/models/props/concards_pack_preview.jpg                          what that model looks like
"""
import argparse
import os
import random
import subprocess

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'client', 'public', 'assets', 'props')
WORK = os.path.join(ROOT, 'tools', 'models', 'props')
W, H = 512, 776  # keeps the art's 0.66 aspect
BLENDER = [os.environ.get('BLENDER', ''), r'C:\Program Files\Blender Foundation\Blender 5.2\blender.exe',
           r'C:\Program Files\Blender Foundation\Blender 4.5\blender.exe']


def serrate(img: Image.Image, teeth=26, depth=10) -> Image.Image:
    """Zig-zag the top and bottom edges like a heat-sealed foil pack."""
    img = img.copy()
    a = img.getchannel('A')
    d = ImageDraw.Draw(a)
    step = img.width / teeth
    for i in range(teeth):
        x0, x1 = i * step, (i + 1) * step
        d.polygon([(x0, 0), (x1, 0), ((x0 + x1) / 2, depth)], fill=0)
        d.polygon([(x0, img.height), (x1, img.height), ((x0 + x1) / 2, img.height - depth)], fill=0)
    img.putalpha(a)
    return img


def opaque(img: Image.Image) -> Image.Image:
    """Fill the transparent rounded corners from the surrounding art (the model's outline is geometry, not alpha)."""
    rgba = np.array(img)
    mask = (rgba[:, :, 3] < 128).astype(np.uint8) * 255  # only the truly empty corners (the art itself peaks at alpha 252)
    return Image.fromarray(cv2.inpaint(np.ascontiguousarray(rgba[:, :, :3]), mask, 4, cv2.INPAINT_TELEA))


def font(size):
    for name in ('arialbd.ttf', 'impact.ttf', 'arial.ttf'):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            pass
    return ImageFont.load_default()


def make_back(art: Image.Image) -> Image.Image:
    """The same foil swirl, blurred and darkened, with the usual legal box, barcode and edition line."""
    back = ImageEnhance.Brightness(art.filter(ImageFilter.GaussianBlur(14))).enhance(0.55)
    back.putalpha(art.getchannel('A'))
    d = ImageDraw.Draw(back)
    d.rounded_rectangle((56, 250, W - 56, 520), radius=18, fill=(255, 255, 255, 235))
    d.text((W / 2, 292), 'ConCards', font=font(54), fill=(40, 20, 90), anchor='mm')
    d.text((W / 2, 344), 'GENESIS  ·  FIRST EDITION', font=font(22), fill=(60, 60, 70), anchor='mm')
    d.text((W / 2, 388), '10 TRADING CARDS', font=font(26), fill=(200, 30, 120), anchor='mm')
    x, rnd = 110, random.Random(26)
    while x < W - 110:  # barcode
        w = rnd.choice((2, 2, 3, 5))
        d.rectangle((x, 420, x + w, 492), fill=(15, 15, 20))
        x += w + rnd.choice((2, 3, 4))
    d.text((W / 2, 580), 'STREAM KOMBAT 26', font=font(24), fill=(255, 255, 255, 200), anchor='mm')
    return back


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--src', default=r'G:\AI\Claude\Models')
    ap.add_argument('--no-glb', action='store_true')
    a = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(WORK, exist_ok=True)
    art = Image.open(os.path.join(a.src, 'Concards Pack.png')).convert('RGBA').resize((W, H), Image.LANCZOS)
    back = make_back(art)

    serrate(art).save(os.path.join(OUT, 'concards_front.webp'), quality=88, method=6)
    serrate(back).save(os.path.join(OUT, 'concards_back.webp'), quality=84, method=6)
    for f in sorted(os.listdir(OUT)):
        print(f, os.path.getsize(os.path.join(OUT, f)) // 1024, 'KB')
    if a.no_glb:
        return

    blender = next((b for b in BLENDER if b and os.path.exists(b)), None)
    if not blender:
        print('Blender not found - skipped the GLB (set BLENDER=path/to/blender.exe)')
        return
    front_jpg, back_jpg = os.path.join(WORK, 'concards_front.jpg'), os.path.join(WORK, 'concards_back.jpg')
    hi = Image.open(os.path.join(a.src, 'Concards Pack.png')).convert('RGBA')  # full resolution for the model file
    opaque(hi).save(front_jpg, quality=92)
    opaque(back).save(back_jpg, quality=92)
    glb = os.path.join(a.src, 'Concards Pack.glb')
    r = subprocess.run([blender, '-b', '--factory-startup', '-P', os.path.join(ROOT, 'tools', 'models', 'pack.py'), '--',
                        front_jpg, back_jpg, glb, os.path.join(WORK, 'preview')], capture_output=True, text=True, encoding='utf8', errors='replace')
    for line in (r.stdout + r.stderr).splitlines():
        if line.startswith('@@') or 'Error' in line or 'Traceback' in line:
            print(line)
    views = [Image.open(os.path.join(WORK, 'preview', f'pack_{v}.png')).convert('RGB') for v in ('front', 'threeq', 'side', 'back')]
    sheet = Image.new('RGB', (sum(v.width for v in views), views[0].height))
    x = 0
    for v in views:
        sheet.paste(v, (x, 0))
        x += v.width
    sheet.save(os.path.join(WORK, 'concards_pack_preview.jpg'), quality=90)
    print('preview:', os.path.join(WORK, 'concards_pack_preview.jpg'))


if __name__ == '__main__':
    main()

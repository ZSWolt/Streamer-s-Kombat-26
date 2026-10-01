"""Prepare prop textures for the game from the source art in the models folder.

  python tools/props.py [--src G:/AI/Claude/Models]

Concards Pack.png -> client/public/assets/props/concards_front.webp / concards_back.webp
The 3D pack itself is built in client/src/render/props.ts (a foil pillow with crimped, serrated ends);
the serration is cut into the textures' alpha here so the mesh stays light.
"""
import argparse
import os

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'client', 'public', 'assets', 'props')
W, H = 512, 776  # keeps the art's 0.66 aspect


def serrate(img: Image.Image, teeth=26, depth=10) -> Image.Image:
    """Zig-zag the top and bottom edges like a heat-sealed foil pack."""
    a = img.getchannel('A')
    d = ImageDraw.Draw(a)
    step = img.width / teeth
    for i in range(teeth):
        x0, x1 = i * step, (i + 1) * step
        d.polygon([(x0, 0), (x1, 0), ((x0 + x1) / 2, depth)], fill=0)
        d.polygon([(x0, img.height), (x1, img.height), ((x0 + x1) / 2, img.height - depth)], fill=0)
    img.putalpha(a)
    return img


def font(size):
    for name in ('arialbd.ttf', 'impact.ttf', 'arial.ttf'):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            pass
    return ImageFont.load_default()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--src', default=r'G:\AI\Claude\Models')
    a = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)
    art = Image.open(os.path.join(a.src, 'Concards Pack.png')).convert('RGBA').resize((W, H), Image.LANCZOS)

    front = serrate(art.copy())
    front.save(os.path.join(OUT, 'concards_front.webp'), quality=88, method=6)

    # back: the same foil swirl, blurred and darkened, with the usual legal box, barcode and edition line
    back = ImageEnhance.Brightness(art.filter(ImageFilter.GaussianBlur(14))).enhance(0.55)
    back.putalpha(art.getchannel('A'))
    d = ImageDraw.Draw(back)
    d.rounded_rectangle((56, 250, W - 56, 520), radius=18, fill=(255, 255, 255, 235))
    d.text((W / 2, 292), 'ConCards', font=font(54), fill=(40, 20, 90), anchor='mm')
    d.text((W / 2, 344), 'GENESIS  ·  FIRST EDITION', font=font(22), fill=(60, 60, 70), anchor='mm')
    d.text((W / 2, 388), '10 TRADING CARDS', font=font(26), fill=(200, 30, 120), anchor='mm')
    x = 110
    import random
    rnd = random.Random(26)
    while x < W - 110:  # barcode
        w = rnd.choice((2, 2, 3, 5))
        d.rectangle((x, 420, x + w, 492), fill=(15, 15, 20))
        x += w + rnd.choice((2, 3, 4))
    d.text((W / 2, 580), 'STREAM KOMBAT 26', font=font(24), fill=(255, 255, 255, 200), anchor='mm')
    serrate(back).save(os.path.join(OUT, 'concards_back.webp'), quality=84, method=6)
    for f in os.listdir(OUT):
        print(f, os.path.getsize(os.path.join(OUT, f)) // 1024, 'KB')


if __name__ == '__main__':
    main()

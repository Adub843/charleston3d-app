"""Downloads the final Charleston3D logos (print-ready PNGs in Kittl) into brand/ and builds the
app icons and images from them. Run by the "Brand assets" workflow; needs Pillow."""
import io
import pathlib
import urllib.request

from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
KITTL = "https://cache.kittl.com/pr:sharp/plain/api/users/cmg2xuxy59gcc0h7o81r9dnid/uploads/"
LOGOS = {  # Aaron's picks, 26 Oct 2026
    "wordmark": "cmvoxor5xcpp10jf3gk7h1r9s",  # 4: main logo (white + teal, for dark backgrounds)
    "rainbow-row": "cmvoxot6qcs0k0jes0cs2e0kp",  # 1: hero
    "badge": "cmvoxouh5cppc0jf3gk7h1r9s",  # 3: stickers, packaging, labels
    "print-cube": "cmvoxow6dcppd0jf3x9kfs61z",  # 2: icon
}
NAVY = (21, 24, 31, 255)  # the app bar colour (#15181f)


def fetch(upload_id):
    req = urllib.request.Request(KITTL + upload_id + ".png", headers={"User-Agent": "charleston3d-app"})
    with urllib.request.urlopen(req, timeout=60) as res:
        return Image.open(io.BytesIO(res.read())).convert("RGBA")


def trimmed(im):
    box = im.getchannel("A").point(lambda a: 255 if a > 8 else 0).getbbox()
    return im.crop(box) if box else im


def on_square(im, size, pad, bg=NAVY):
    canvas = Image.new("RGBA", (size, size), bg)
    inner = size - 2 * pad
    im = im.copy()
    im.thumbnail((inner, inner), Image.LANCZOS)
    canvas.alpha_composite(im, ((size - im.width) // 2, (size - im.height) // 2))
    return canvas


def fit_width(im, width):
    h = round(im.height * width / im.width)
    return im.resize((width, h), Image.LANCZOS)


brand = ROOT / "brand"
icons = ROOT / "icons"
brand.mkdir(exist_ok=True)
logos = {}
for name, upload in LOGOS.items():
    logos[name] = trimmed(fetch(upload))
    logos[name].save(brand / f"{name}.png", optimize=True)
    print(name, logos[name].size)

cube = logos["print-cube"]
for size, pad in ((32, 1), (180, 14), (192, 14), (512, 40)):
    on_square(cube, size, pad).convert("RGB").save(icons / f"icon-{size}.png", optimize=True)
on_square(cube, 512, 40, (0, 0, 0, 0)).save(icons / "icon-512-transparent.png", optimize=True)
fit_width(logos["wordmark"], 440).save(icons / "wordmark.png", optimize=True)
fit_width(logos["badge"], 240).save(icons / "badge.png", optimize=True)
row = logos["rainbow-row"]
row.thumbnail((720, 720), Image.LANCZOS)
row.save(icons / "hero.png", optimize=True)
# Social card: 1200x630 on the app bar colour with the Rainbow Row logo centred.
social = Image.new("RGBA", (1200, 630), NAVY)
r = logos["rainbow-row"].copy()
r.thumbnail((1000, 540), Image.LANCZOS)
social.alpha_composite(r, ((1200 - r.width) // 2, (630 - r.height) // 2))
social.convert("RGB").save(icons / "social.png", optimize=True)

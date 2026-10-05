"""Extract the supplied blue/cyan logo without repainting its opaque interior."""
from pathlib import Path
import json
import numpy as np
from PIL import Image, ImageFilter, ImageDraw

ROOT = Path(__file__).resolve().parents[3]
SOURCE = Path('C:/Users/Aimer/Downloads/9b4611b981f644e18ac3f0265f3eec35.png')
OUT = ROOT / 'output/logo'
OUT.mkdir(parents=True, exist_ok=True)
source = Image.open(SOURCE).convert('RGB')
rgb = np.asarray(source).astype(np.float32)
chroma = rgb.max(axis=2) - rgb.min(axis=2)
core = (chroma > 90) & (rgb.min(axis=2) < 175)
core = np.asarray(Image.fromarray(core.astype(np.uint8) * 255).filter(ImageFilter.MinFilter(5))) > 0
known = core.copy()
nearest = np.zeros_like(rgb)
nearest[known] = rgb[known]

# Propagate nearby opaque foreground colors to estimate antialias coverage.
for _ in range(16):
    previous = known.copy()
    for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0), (1, 1), (-1, -1), (1, -1), (-1, 1)):
        shifted = np.roll(previous, (dy, dx), axis=(0, 1))
        if dy > 0:
            shifted[:dy] = False
        elif dy < 0:
            shifted[dy:] = False
        if dx > 0:
            shifted[:, :dx] = False
        elif dx < 0:
            shifted[:, dx:] = False
        take = ~known & shifted
        nearest[take] = np.roll(nearest, (dy, dx), axis=(0, 1))[take]
        known[take] = True

white = 255.0
delta = white - nearest
alpha = np.clip(np.sum((white - rgb) * delta, axis=2) / np.maximum(np.sum(delta * delta, axis=2), 1), 0, 1)
alpha[~known | (chroma < 8) | (alpha < 0.025)] = 0
alpha[core] = 1
foreground = np.clip((rgb - white * (1 - alpha[:, :, None])) / np.maximum(alpha[:, :, None], 0.001), 0, 255)
foreground[alpha == 0] = 0
rgba = np.dstack((np.rint(foreground).astype(np.uint8), np.rint(alpha * 255).astype(np.uint8)))
result = Image.fromarray(rgba)
result.save(OUT / 'tripweaver-logo-transparent.png')
bbox = result.getbbox()
cropped = result.crop(bbox)
padding = 24
tight = Image.new('RGBA', (cropped.width + padding * 2, cropped.height + padding * 2))
tight.paste(cropped, (padding, padding))
tight.save(OUT / 'tripweaver-logo-transparent-tight.png')

tile = 400
preview = Image.new('RGB', (tile * 3, tile), 'white')
small = tight.copy()
small.thumbnail((330, 330), Image.Resampling.LANCZOS)
for i, color in enumerate(('#ffffff', '#eef3fd', '#16325c')):
    panel = Image.new('RGBA', (tile, tile), color)
    if i == 0:
        draw = ImageDraw.Draw(panel)
        for y in range(0, tile, 16):
            for x in range(0, tile, 16):
                if (x // 16 + y // 16) % 2:
                    draw.rectangle((x, y, x + 15, y + 15), fill='#e2e5e9')
    panel.alpha_composite(small, ((tile - small.width) // 2, (tile - small.height) // 2))
    preview.paste(panel.convert('RGB'), (i * tile, 0))
preview.save(OUT / 'tripweaver-logo-preview.png')

assert result.mode == 'RGBA'
assert result.getpixel((0, 0))[3] == 0
assert np.all(rgba[core, :3] == rgb[core].astype(np.uint8))
report = {
    'size': result.size,
    'cropped_size': tight.size,
    'subject_bbox': bbox,
    'transparent_pixels': int((rgba[:, :, 3] == 0).sum()),
    'antialiased_pixels': int(((rgba[:, :, 3] > 0) & (rgba[:, :, 3] < 255)).sum()),
    'opaque_interior_preserved': True,
    'output_files': [str(p) for p in OUT.glob('*.png')],
}
(OUT / 'verification.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
print(json.dumps(report, indent=2))

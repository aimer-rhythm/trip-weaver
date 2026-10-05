"""Create small transparent production assets from the approved logo cutout."""
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parents[3]
source = Image.open(root / 'output/logo/tripweaver-logo-transparent.png').convert('RGBA')
subject = source.crop(source.getbbox())
target = root / 'apps/web/public/brand'
target.mkdir(parents=True, exist_ok=True)

for filename, size, inset in (
    ('logo-bird.png', 256, 8),
    ('favicon-32.png', 32, 1),
    ('favicon-16.png', 16, 0),
):
    mark = subject.copy()
    mark.thumbnail((size - inset * 2, size - inset * 2), Image.Resampling.LANCZOS)
    canvas = Image.new('RGBA', (size, size))
    canvas.paste(mark, ((size - mark.width) // 2, (size - mark.height) // 2))
    canvas.save(target / filename, optimize=True)
    print(f'{filename}: {size}x{size}, {(target / filename).stat().st_size} bytes')

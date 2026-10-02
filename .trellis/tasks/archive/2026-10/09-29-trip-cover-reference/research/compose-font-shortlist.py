from pathlib import Path
from PIL import Image

research = Path('.trellis/tasks/09-29-trip-cover-reference/research')
reference = Image.open(research / 'font-reference-originals.png').convert('RGB')
cards = [Image.open(research / f'font-reference-{label}.png').convert('RGB') for label in ('E', 'G')]
gap = 24
width = cards[0].width + gap + cards[1].width
canvas = Image.new('RGB', (width, reference.height + gap + max(card.height for card in cards)), '#eef4ff')
canvas.paste(reference, (0, 0))
canvas.paste(cards[0], (0, reference.height + gap))
canvas.paste(cards[1], (cards[0].width + gap, reference.height + gap))
canvas.save(research / 'font-reference-shortlist.png')
canvas.save('data/photo-pilot/review/font-reference-shortlist.png')
print(canvas.size)

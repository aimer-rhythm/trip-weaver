from pathlib import Path
path = Path('record-hangzhou-four-readthrough.py')
text = path.read_text(encoding='utf-8')
old = "(9473, '"
assert old in text
path.write_text(text.replace(old, "(2016, '", 1), encoding='utf-8')
print('patched 9473 -> 2016')

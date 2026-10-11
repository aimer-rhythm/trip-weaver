from pathlib import Path
path = Path('record-hangzhou-five-readthrough.py')
text = path.read_text(encoding='utf-8')
old = "风景超好！人很少，到处都有坐的地方"
assert old in text
text = text.replace(old, "风景超好！是我觉得超乎期待的景点")
path.write_text(text, encoding='utf-8')
print('patched 2176 quote')

from pathlib import Path
path = Path('record-hangzhou-five-readthrough.py')
text = path.read_text(encoding='utf-8')
old = "一个冷门的宝藏景点，景区人非常少"
assert old in text
text = text.replace(old, "一个冷门的宝藏景点")
path.write_text(text, encoding='utf-8')
print('patched 2133 quote')

from pathlib import Path
path = Path('record-hangzhou-five-readthrough.py')
text = path.read_text(encoding='utf-8')
old = "乌龟潭摇橹船 沿途风景真的好美"
assert old in text
text = text.replace(old, "沿途风景真的好美")
path.write_text(text, encoding='utf-8')
print('patched 1956 quote')

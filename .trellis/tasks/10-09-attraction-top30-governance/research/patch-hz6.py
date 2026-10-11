from pathlib import Path
p = Path('record-hangzhou-rest-readthrough.py')
s = p.read_text(encoding='utf-8')
old = '有很多小溪流，还有参天大树，适合玩水'
assert old in s
s = s.replace(old, '有很多小溪流')
p.write_text(s, encoding='utf-8')
print('patched 2249')

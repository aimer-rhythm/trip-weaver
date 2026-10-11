from pathlib import Path
p = Path('record-hangzhou-rest-readthrough.py')
s = p.read_text(encoding='utf-8')
old = '香积寺铜质唐风建筑'
assert old in s
s = s.replace(old, '铜质唐风建筑，适合顺路收尾')
p.write_text(s, encoding='utf-8')
print('patched 2239')

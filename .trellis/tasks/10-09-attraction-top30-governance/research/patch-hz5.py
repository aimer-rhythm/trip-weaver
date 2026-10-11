from pathlib import Path
path = Path('record-hangzhou-five-readthrough.py')
text = path.read_text(encoding='utf-8')
assert '认准正规游船，不要轻信路边黄牛' in text
text = text.replace("(2031, '认准正规游船，不要轻信路边黄牛')", "(2031, '认准正规游船')")
text = text.replace('不要轻信路边黄牛的所谓低价坐船骗局', '不要轻信路边黄🐂的所谓低价坐船骗局')
path.write_text(text, encoding='utf-8')
print('patched 2031 quote')

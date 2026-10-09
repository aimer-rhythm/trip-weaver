from pathlib import Path
root=Path(__file__).resolve().parent
s=(root/'freeze-remaining-streets.py').read_text(encoding='utf-8')
s=s.replace('五个街道廊道及店铺主体','四个剩余餐饮主体').replace('remaining-streets-source-packet-01','last-restaurants-source-packet-01').replace('==61','==63').replace("'entityBatch':61","'entityBatch':63")
a=s.index('ids=[');b=s.index('\nasync def main',a)
s=s[:a]+"ids=['5781e650f27ad011986a13e12281e79f','c057999eba2876818984ed6c93375936','4486ee493729467741a9428ba67b1b80','e2740e4ad547f99f5ff9311f7d5359b8']"+s[b:]
with (root/'freeze-last-restaurants.py').open('x',encoding='utf-8') as f:f.write(s)

from pathlib import Path
root=Path(__file__).resolve().parent
ids=['0d0968c2ca848678bcf24e2c0db83554','66c835ba565f34cbd12206d7169c8da1','78d5eff53c3692218e93a142d69021cf','88a3e4b4f75459daacfe23ed6ca4157d','ca1b5db55316182cf144e13eab8e402d','d4292fdc91029db1a1714b00686787ff','dc445410375df79cab73ba2b18448910']
names=['月下观棠','济南文字墙','山东大厦','济南墙','明珠天地C','夹心胡同','淘子外单']
s=(root/'freeze-remaining-food.py').read_text(encoding='utf-8')
s=s.replace('五个待核餐饮主体','七个店铺建筑及拍照主体').replace('remaining-food-source-packet','built-place-source-packet').replace('==59','==60').replace("'entityBatch':59","'entityBatch':60")
a=s.index('ids=[');b=s.index('\nasync def main',a);s=s[:a]+'ids='+repr(ids)+s[b:]
with (root/'freeze-built-place.py').open('x',encoding='utf-8') as f:f.write(s)
s=(root/'verify-remaining-food-photo-preflight.test.mts').read_text(encoding='utf-8')
s=s.replace('第60批','第61批').replace('五个待核餐饮主体','七个店铺建筑及拍照主体').replace('batch-59','batch-60').replace('remaining-food','built-place').replace('batch:60','batch:61').replace('fullCityAfterEntityBatch:59','fullCityAfterEntityBatch:60').replace('assert.equal(queued,5)','assert.equal(queued,7)')
a=s.index("['25c990");b=s.index('.includes(p.id)',a);s=s[:a]+repr(ids)+s[b:]
a=s.index("['超意兴'");b=s.index(') {',a);s=s[:a]+repr(names)+s[b:]
with (root/'verify-built-place-photo-preflight.test.mts').open('x',encoding='utf-8') as f:f.write(s)

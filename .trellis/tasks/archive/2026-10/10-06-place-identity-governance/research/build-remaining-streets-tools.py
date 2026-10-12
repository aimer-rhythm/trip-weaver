from pathlib import Path
root=Path(__file__).resolve().parent
ids=['747792d1b5834255f5feaa6c2dc62925','9dbf8ef94ec1777461c9d486973ce0c7','a16d03423b6c350d1d3526a2a1c4280d','e1cfa0121a1455efea5324938742d4f4','636406ca3bce1e8189be38c73b4e8ae4']
names=['芙蓉街','后宰门街','腊山河廊道','油旋张','泉源之眼']
s=(root/'freeze-built-place.py').read_text(encoding='utf-8').replace('七个店铺建筑及拍照主体','五个街道廊道及店铺主体').replace('built-place-source-packet','remaining-streets-source-packet').replace('==60','==61').replace("'entityBatch':60","'entityBatch':61")
a=s.index('ids=[');b=s.index('\nasync def main',a);s=s[:a]+'ids='+repr(ids)+s[b:]
with (root/'freeze-remaining-streets.py').open('x',encoding='utf-8') as f:f.write(s)
s=(root/'verify-built-place-photo-preflight.test.mts').read_text(encoding='utf-8').replace('第61批','第62批').replace('七个店铺建筑及拍照主体','五个街道廊道及店铺主体').replace('batch-60','batch-61').replace('built-place','remaining-streets').replace('batch:61','batch:62').replace('fullCityAfterEntityBatch:60','fullCityAfterEntityBatch:61').replace('assert.equal(queued,7)','assert.equal(queued,5)')
a=s.index("['0d0968");b=s.index('.includes(p.id)',a);s=s[:a]+repr(ids)+s[b:]
a=s.index("['月下观棠'");b=s.index(') {',a);s=s[:a]+repr(names)+s[b:]
with (root/'verify-remaining-streets-photo-preflight.test.mts').open('x',encoding='utf-8') as f:f.write(s)

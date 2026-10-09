from pathlib import Path
root=Path(__file__).resolve().parent
s=(root/'preview-remaining-food.py').read_text(encoding='utf-8')
s=s.replace('第60批','第61批').replace('品牌门店待审、明确西部提及','通用墙名提示串入、商店分店待审').replace('batch-60','batch-61').replace('7556e3bc2c55be829354f5907ea4eaf103e1c33ef0750a1e97f9b60f4cb05fae','f446be273e56ced83f9a1fb78022875ba968638b1372d8e953409ecf167bd334')
s=s.replace("len(old_export['places'])==4","len(old_export['places'])==2").replace("assert all(p['verified'] and p['lat'] is not None and p['lng'] is not None for p in old_by_id.values())","assert all(p['verified'] for p in old_by_id.values())")
s=s.replace('len(cat.assignments)==10 and len(cat.catalog.entities)==4','len(cat.assignments)==2 and len(cat.catalog.entities)==2').replace('len(pending)==9','len(pending)==1').replace("len(exported['places'])==4","len(exported['places'])==2")
a=s.index('        withdrawn=[]');b=s.index('        async with factory() as s:',a)
s=s[:a]+'''        withdrawn=[]
        for p in exported['places']:
            entity=next(g['entity'] for g in frozen['groups'] if g['entity']['entity_id']==p['id'])
            old=old_by_id[p['id']];approved=p['id']=='66c835ba565f34cbd12206d7169c8da1'
            assert p['name']==entity['canonical_name'] and p['category']==('文化' if approved else '其他')
            assert p['payload'].get('xhsPlaceType')==('photo_spot' if approved else None)
            assert set(p['payload']['aliases'])==set(entity['aliases']) and p['payload']['identity']['memberIds']==entity['legacy_ids']
            assert p['verified'] is approved and p['payload']['identity']['revision']==entity['revision']+1
            assert p.get('lat') is None and p.get('lng') is None and p['payload']['imageIdentity']['approved']==[]
            assert [m['mentionId'] for m in p['payload']['mentionSources']]==([12688] if approved else [])
            if approved:
                assert p['payload']['address']=='' and p['payload']['geoStatus']=='unresolvable'
                assert p['payload']['mentionCount']==1 and p['payload']['themes']==[]
                assert p['payload']['content']['highlights']==old['payload']['content']['highlights']
                assert p['payload']['topReasons']==old['payload']['topReasons']
                assert old['evidence']==[]
                assert [(e['kind'],e['content']) for e in p['evidence']]==[('xhs_reason','热门拍照打卡点')]
                assert any('月下观棠' in tip for tip in old['payload']['tips'])
                assert not p['payload'].get('tips')
                assert not p['payload'].get('typicalVisitMinutes')
                for field in ['openHours','reservation','price']:assert p['payload'].get(field)==old['payload'].get(field)
            else:
                assert p['payload']['identityWithdrawal']=={'version':1,'revision':2,'reason':'unavailable_source','candidateIds':[]}
                assert p['evidence']==[]
                for field in ['content','topReasons','address','openHours','reservation','price','tips','themes','typicalVisitMinutes']:
                    assert not p['payload'].get(field),(p['name'],field,p['payload'].get(field))
                withdrawn.append(p['id'])
        assert len(withdrawn)==1
''' + s[b:]
s=s.replace("'batch':60","'batch':61").replace("'sources':4,'historicalEntities':4,'mentions':10,'notes':5","'sources':2,'historicalEntities':2,'mentions':2,'notes':2").replace("'pendingAdded':9","'pendingAdded':1").replace("'withdrawals':3","'withdrawals':1").replace("'explicitPointCleared':1,'withdrawnCoordinatesRemoved':3","'explicitPointCleared':0,'withdrawnCoordinatesRemoved':1")
with (root/'preview-built-place.py').open('x',encoding='utf-8') as f:f.write(s)
s=(root/'verify-remaining-food-times.py').read_text(encoding='utf-8').replace('remaining-food','built-place').replace('第60批','第61批')
s=s.replace("'batch':60", "'batch':61").replace("'notes':7", "'notes':len(source['noteTimes'])")
with (root/'verify-built-place-times.py').open('x',encoding='utf-8') as f:f.write(s)

"""建立第52批隔离预演与消费检查；只写新研究脚本，不执行业务变更。"""
from pathlib import Path
root=Path(__file__).resolve().parent
p=(root/'preview-minzu.py').read_text(encoding='utf-8').replace('第47批','第52批').replace('batch-47','batch-52')
p=p.replace('99b165c1f57f20b0d3ca864e66b4d86ac683947e3a98c07ac70936dd0912e201','98cb83f0f63097059936a3b7257c34222c8b8e8bde96cb5fd88fa4a2e1e6099c')
p=p.replace('from pathlib import Path','from pathlib import Path\nfrom datetime import datetime')
p=p.replace("status='EXTRACTED'))", "status='EXTRACTED',created_at=datetime.fromisoformat(m['observed_at'])))")
p='\n'.join(line for line in p.splitlines() if 'setval(pg_get_serial_sequence' not in line)+'\n'
p=p.replace('len(cat.catalog.entities)==2','len(cat.catalog.entities)==1').replace("if m['id']==11608", "if m['id'] in [11664,12892]")
p=p.replace("assert len(pending)==1 and pending[0]['detail']['mentionId']==11608", "assert len(pending)==2 and {r['detail']['mentionId'] for r in pending}=={11664,12892}")
p=p.replace("len(exported['places'])==2", "len(exported['places'])==1")
a=p.index('        for p in exported');b=p.index('        async with factory() as s:',a)
p=p[:a]+'''        for p in exported['places']:
            entity=frozen['groups'][0]['entity'];src=frozen['sources'][0]['source']
            assert p['verified'] is True and p['payload']['identity']['revision']==2
            assert p['name']=='秦记火烧' and p['category']=='美食' and p['payload']['xhsPlaceType']=='food'
            assert p['payload']['aliases']==entity['aliases'] and sorted(p['payload']['identity']['memberIds'])==sorted(entity['legacy_ids'])
            assert sorted(m['mentionId'] for m in p['payload']['mentionSources'])==[11364,12605]
            assert (p['lat'],p['lng'])==(round(src['latitude'],6),round(src['longitude'],6)) and p['payload']['address']==src['address']
            assert p['payload']['mentionCount']==2 and p['payload'].get('typicalVisitMinutes') is None
            assert p['payload']['themes']==[] and p['payload']['imageIdentity']['approved']==[]
            assert p['payload']['topReasons']==['本地人推荐，有特色且味道好']
            assert p['payload']['content']['intro']=='本地人推荐，有特色且味道好。'
            assert len(p['payload']['content']['highlights'])==1
            assert p['payload']['content']['highlights'][0]['observedAt']==next(m for m in frozen['mentions'] if m['id']==11364)['observed_at']
            assert len(p['evidence'])==1 and p['evidence'][0]['content']=='本地人推荐，有特色且味道好'
            serialized=json.dumps(p,ensure_ascii=False)
            assert '肉火烧去制锦市' not in serialized and '其他去河边' not in serialized and '具体菜品未详述' not in serialized
            results.append({'entityId':p['id'],'name':p['name'],'mentions':2,'category':p['category'],'type':p['payload']['xhsPlaceType'],'locationPreservedNotNewlyVerified':True})
''' +p[b:]
p=p.replace("'batch':47", "'batch':52").replace("'sources':2,'historicalEntities':2", "'sources':1,'historicalEntities':1")
p=p.replace("'confirmed':3,'pendingAdded':1,'historicalReviewPreserved':369", "'confirmed':2,'pendingAdded':2,'historicalReviewPreserved':True")
with (root/'preview-qinji.py').open('x',encoding='utf-8') as f:f.write(p)

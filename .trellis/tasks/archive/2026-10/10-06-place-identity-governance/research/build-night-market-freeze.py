from pathlib import Path
root=Path(__file__).resolve().parent
p=(root/'freeze-restaurant-branches.py').read_text(encoding='utf-8')
p=p.replace('冻结燕喜堂、刘小忙、亮亮拉面的分店原文及现行身份','冻结环联夜市完整原文、来源时间及现行身份')
p=p.replace('restaurant-branches-source-packet','night-market-source-packet').replace("==56","==58").replace("'entityBatch':56","'entityBatch':58")
p=p.replace("ids=['84929fb3085880c48c0cebb71aae3ad4','58d542ebe18a1dd3505b7cdc60db030c','92a39f8f2d95070cc627828807686bac']","ids=['7950bfadd891932d01be8636aba8b51a']")
p=p.replace('CanonicalPlace,PlaceSummary,PlaceEntityReview','CanonicalPlace,PlaceSummary,PlaceEntityReview,RawNote')
needle="            history=[e for eid,e in cat.catalog.entities.items()"
assert needle in p
p=p.replace(needle,"""            note_times=[]
            for n in (await s.scalars(select(RawNote).where(RawNote.id.in_([n['id'] for n in notes])))).all():
                raw=n.raw_json or {}
                fields=[]
                def times(value,path=''):
                    if isinstance(value,dict):
                        for k,v in value.items():
                            key=path+'.'+k
                            if ('time' in k.lower() or 'date' in k.lower()) and isinstance(v,(str,int,float,type(None))):fields.append({'path':key,'value':v})
                            if isinstance(v,(dict,list)):times(v,key)
                    elif isinstance(value,list):
                        for i,v in enumerate(value):times(v,path+'.'+str(i))
                times(raw)
                note_times.append({'noteId':n.id,'publishTime':n.publish_time.isoformat() if n.publish_time else None,'collectedAt':n.created_at.isoformat(),
                    'rawJsonSha256':hashlib.sha256(json.dumps(raw,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest(),'rawTimeFields':fields})
"""+needle)
p=p.replace("'notes':notes,'imageComparison'","'notes':notes,'noteTimes':note_times,'imageComparison'")
with (root/'freeze-night-market.py').open('x',encoding='utf-8') as f:f.write(p)

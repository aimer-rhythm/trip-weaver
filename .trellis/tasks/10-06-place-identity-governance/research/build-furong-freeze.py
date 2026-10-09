from pathlib import Path
root=Path(__file__).resolve().parent
s=(root/'freeze-remaining-streets.py').read_text(encoding='utf-8')
s=s.replace('冻结五个街道廊道及店铺主体完整原文、来源时间及现行身份','冻结芙蓉街全部提及与补充警示原文、来源时间及现行身份')
s=s.replace('remaining-streets-source-packet-01','furong-source-packet-01').replace('==61','==62').replace("'entityBatch':61","'entityBatch':62")
a=s.index('ids=[');b=s.index('\nasync def main',a)
s=s[:a]+"ids=['747792d1b5834255f5feaa6c2dc62925']"+s[b:]
s=s.replace("note_times=[]", "note_times=[];note_details=[]")
s=s.replace("RawNote.id.in_([n['id'] for n in notes])", "RawNote.id.in_([n['id'] for n in notes]+[2568])")
s=s.replace("raw=n.raw_json or {}", """raw=n.raw_json or {}
                note_details.append({'id':n.id,'city':n.city,'title':n.title,'desc':n.desc,'status':n.status,
                    'sourceUrl':n.source_url,'images':n.img_analysis,'observedAt':n.created_at.isoformat(),
                    'publishedAt':n.publish_time.isoformat() if n.publish_time else None,
                    'analysisSha256':hashlib.sha256(json.dumps(n.img_analysis or [],ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()})""")
s=s.replace("'notes':notes,'noteTimes':note_times", "'notes':notes,'noteDetails':note_details,'noteTimes':note_times")
with (root/'freeze-furong.py').open('x',encoding='utf-8') as f:f.write(s)

from pathlib import Path
root=Path(__file__).resolve().parent
def rep(p,a,b):
    assert a in p,a
    return p.replace(a,b)
p=(root/'preview-qinji.py').read_text(encoding='utf-8')
for a,b in [('第52批','第58批'),('batch-52','batch-58'),("'batch':52","'batch':58"),
 ('98cb83f0f63097059936a3b7257c34222c8b8e8bde96cb5fd88fa4a2e1e6099c','2d3a64d8740dba030c9e65c6b3133334d6a5bf0a5dbe2ed3edb29cbe91f8de2a'),
 ("**g['source'],**g['derivedBefore']","**g['source'],**g['derivedBefore'],**g['supplement']"),
 ('len(cat.assignments)==4','len(cat.assignments)==2'),('if m[\'id\'] in [11664,12892]','if False'),
 ("assert [r for r in reviews if r['id']==369]==history['reviews']","assert reviews==history['reviews']"),
 ("assert len(pending)==2 and {r['detail']['mentionId'] for r in pending}=={11664,12892}","assert pending==[]"),
 ("p['name']=='秦记火烧' and p['category']=='美食' and p['payload']['xhsPlaceType']=='food'","p['name']=='护城河' and p['category']=='文化' and p['payload']['xhsPlaceType']=='attraction'"),
 ('[11364,12605]','[11404,12901]'),("'mentions':4,'notes':3","'mentions':2,'notes':2"),("'pendingAdded':2","'pendingAdded':0")]:p=rep(p,a,b)
start=p.index("            await s.flush()")
p=p[:start]+"""            for item in frozen['supplementalImageFactNotes']:
                n=item['note']
                if n['id'] in {n['id'] for n in frozen['notes']}:continue
                s.add(RawNote(id=n['id'],note_id=n['note_id'],city=n['city'],keyword='图片文字来源冻结',title=n['title'],desc=n['desc'],
                    img_analysis=n['img_analysis'],source_url=n['source_url'],status=n['status']))
"""+p[start:]
start=p.index("        async with factory() as s:\n            originals=")
p=p[:start]+"""        exporter.SessionFactory=factory
        before_output=folder/'before-xhs-places-济南.json'
        sys.argv=['export_to_tripweaver.py','--city','济南','--out',str(before_output)];await exporter.main()
        before_export=json.loads(before_output.read_text(encoding='utf-8'))['places'][0]
        wrong_tip=read('priority-cities/济南/river-source-review-01.json')['wrongTip']
        assert before_export['payload']['tips']==[wrong_tip]
"""+p[start:]
start=p.index("            assert p['payload']['topReasons']==")
end=p.index('            results.append(',start)
p=p[:start]+"""            assert p['payload']['topReasons']==before_export['payload']['topReasons']
            previous=copy.deepcopy(before_export['payload']['content']);previous['compiledAt']=p['payload']['content']['compiledAt']
            assert p['payload']['content']==previous
            assert len(p['payload']['content']['highlights'])==2
            assert sorted(e['content'] for e in p['evidence'])==sorted(m['reason'] for m in frozen['mentions'])
            assert len(p['evidence'])==2 and 'tips' not in p['payload']
            assert p['payload']['openHours']['status']=='unknown' and p['payload']['reservation']=='unknown'
            assert all(term not in json.dumps(p,ensure_ascii=False) for term in ['为纪念济南解放而建','登阁可看展览','扫码购票'])
"""+p[end:]
p=rep(p,"            await s.rollback()","""            for item in frozen['supplementalImageFactNotes']:
                original=item['note'];actual=await s.get(RawNote,original['id'])
                assert all(getattr(actual,k)==v for k,v in original.items())
            await s.rollback()""")
p=rep(p,"'originalSourcesAndMentionsUnchanged':True","'wrongTipReproducedBeforeScope':True,'wrongTipExcludedAfterScope':True,'supplementalImageTextPreserved':True,'originalSourcesAndMentionsUnchanged':True")
with (root/'preview-river.py').open('x',encoding='utf-8') as f:f.write(p)
p=(root/'verify-restaurant-branches-photo-preflight.test.mts').read_text(encoding='utf-8')
for a,b in [('第57批','第58批'),('batch-56-v2','batch-57'),('restaurant-branches-photo-metadata','ordinary-outdoors-photo-metadata'),
 ('restaurant-branches-photo-preflight','river-photo-preflight'),('三家餐饮分店实际图库与scope门禁','护城河实际图库与scope门禁'),
 ("['84929fb3085880c48c0cebb71aae3ad4','58d542ebe18a1dd3505b7cdc60db030c','92a39f8f2d95070cc627828807686bac']","['4dfda3371793b69de15122bb7e330eac']"),
 ("['燕喜堂','刘小忙把子肉','亮亮拉面']","['护城河']"),('assert.equal(queued,3)','assert.equal(queued,1)'),('batch:57','batch:58'),('fullCityAfterEntityBatch:56','fullCityAfterEntityBatch:57')]:p=rep(p,a,b)
with (root/'verify-river-photo-preflight.test.mts').open('x',encoding='utf-8') as f:f.write(p)
path=root/'run-upstream-tests.mjs';p=path.read_text(encoding='utf-8');needle="    process.argv.includes('--restaurant-branches-preview')"
p=rep(p,needle,"    process.argv.includes('--river-preview') ? ['-B', '.trellis/tasks/10-06-place-identity-governance/research/preview-river.py'] :\n"+needle);path.write_text(p,encoding='utf-8')

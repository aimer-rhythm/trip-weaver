from pathlib import Path
root=Path(__file__).resolve().parent
def write(p,s):
    with (root/p).open('x',encoding='utf-8') as f:f.write(s)
s=(root/'preview-built-place.py').read_text(encoding='utf-8').replace('第61批','第62批').replace('通用墙名提示串入、商店分店待审','街道类别、明确30分钟停留及品牌分店待审').replace('batch-61','batch-62').replace('f446be273e56ced83f9a1fb78022875ba968638b1372d8e953409ecf167bd334','4a9b3d7ed4789bc055ec5c27596e2286c572be528cd1cb390c7a1e03708fbd1a')
s=s.replace("len(old_export['places'])==2","len(old_export['places'])==4").replace("{m['id']:mention_fingerprint(m) for m in originals}=={i:a['inputHash'] for i,a in expected.items()}","{m['id']:mention_fingerprint(m) for m in originals}=={m['id']:m['inputHash'] for m in frozen['mentions']}")
s=s.replace('len(cat.assignments)==2 and len(cat.catalog.entities)==2','len(cat.assignments)==6 and len(cat.catalog.entities)==4').replace("                result=cat.resolve(m)\n", "                if m['id'] not in expected:continue\n                result=cat.resolve(m)\n").replace('len(pending)==1','len(pending)==3').replace("len(exported['places'])==2","len(exported['places'])==4")
a=s.index('        withdrawn=[]');b=s.index('        async with factory() as s:',a)
s=s[:a]+'''        withdrawn=[]
        for p in exported['places']:
            e=next(g['entity'] for g in frozen['groups'] if g['entity']['entity_id']==p['id']);sid=e['primary_place_id'];old=old_by_id[p['id']]
            assert p['name']==e['canonical_name'] and p['payload']['identity']['memberIds']==e['legacy_ids']
            assert p['payload']['identity']['revision']==e['revision']+(2 if sid==5393 else 1)
            assert p['payload']['aliases']==e['aliases']
            if sid==5382:
                assert not p['verified'] and p['category']=='其他' and p.get('lat') is None and p.get('lng') is None
                assert p['payload']['identityWithdrawal']=={'version':1,'revision':2,'reason':'unavailable_source','candidateIds':[]}
                assert p['payload']['mentionSources']==[] and p['payload']['imageIdentity']['approved']==[] and p['evidence']==[]
                for k in ['content','topReasons','address','openHours','reservation','price','tips','themes','typicalVisitMinutes','xhsPlaceType']:assert not p['payload'].get(k),(sid,k)
                withdrawn.append(p['id']);continue
            assert p['verified'] and p['lat']==old['lat'] and p['lng']==old['lng']
            assert p['category']==('自然' if sid==5403 else '文化')
            assert p['payload']['xhsPlaceType']==('attraction' if sid==5403 else 'other')
            assert p['payload'].get('address')==old['payload'].get('address') and p['payload'].get('geoStatus')==old['payload'].get('geoStatus')
            if sid==5393:
                assert sorted(m['mentionId'] for m in p['payload']['mentionSources'])==[11460,12690,12726]
                assert p['payload']['typicalVisitMinutes']==old['payload']['typicalVisitMinutes']==30
                assert p['payload']['mentionCount']==3 and p['payload']['content']['highlights']==old['payload']['content']['highlights']
                assert {(x['kind'],x['content']) for x in p['evidence']}=={('xhs_reason','有济南府大字墙，适合拍照'),('xhs_reason','有簪花济南文字墙，热门打卡点'),('xhs_reason','可拍济南府大字墙')}
                assert p['payload']['imageIdentity']['approved']==[]
                for k in ['openHours','reservation','price','tips']:assert p['payload'].get(k)==old['payload'].get(k),(sid,k)
            else:
                assert 'mentionSources' not in p['payload']
                before_payload=copy.deepcopy(old['payload']);after_payload=copy.deepcopy(p['payload'])
                for v in [before_payload,after_payload]:
                    for k in ['identity','xhsPlaceType']:v.pop(k,None)
                    if v.get('content'):v['content'].pop('compiledAt',None)
                assert before_payload==after_payload,(sid,before_payload,after_payload)
                assert p['evidence']==old['evidence']
        assert len(withdrawn)==1
''' + s[b:]
s=s.replace("'batch':61","'batch':62").replace("'sources':2,'historicalEntities':2,'mentions':2,'notes':2","'sources':4,'historicalEntities':4,'mentions':37,'notes':28").replace("'confirmed':1,'pendingAdded':1","'confirmed':3,'pendingAdded':3").replace("'preciseLocationResolved':False", "'categoryDecisions':3,'preciseLocationResolved':False")
write('preview-remaining-streets.py',s)
s=(root/'verify-built-place-times.py').read_text(encoding='utf-8').replace('built-place','remaining-streets').replace("'batch':61","'batch':62")
s=s.replace("        report={", "            extra=json.loads((root/'priority-cities/济南/remaining-streets-mixed-tip-source-01.json').read_text(encoding='utf-8'))\n            for t in extra['notes']:\n                n=await s.get(RawNote,t['noteId']);assert n.publish_time.isoformat()==t['publishTime'] and n.created_at.isoformat()==t['collectedAt']\n                assert hashlib.sha256(json.dumps(n.raw_json or {},ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()==t['rawJsonSha256']\n                assert hashlib.sha256(json.dumps(n.img_analysis or [],ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()==t['analysisSha256']\n        report={")
s=s.replace("'notes':len(source['noteTimes'])", "'notes':len(source['noteTimes']),'supplementalNotes':1,'supplementalAnalysisPreserved':True")
write('verify-remaining-streets-times.py',s)
s=(root/'verify-built-place-data.mts').read_text(encoding='utf-8').replace('第61批实际库核对：未定位品牌撤回、济南西提及保留、陈氏只读','第62批实际库核对：街道廊道类别、30分钟街道停留、分店撤回及负面意见保全').replace('batch-61','batch-62').replace('built-place','remaining-streets').replace('57,58,59,60,61]','57,58,59,60,61,62]')
s="import {assertRemainingStreetRow} from './remaining-streets-assertions';\n"+s
s=s.replace('vectorProbes.length,1','vectorProbes.length,3').replace("folder+'verification-vectors.json'","folder+'verification-vectors-positive.json'")
a=s.index('    const wall=');b=s.index("    let used=''",a)
s=s[:a]+'''    const sid=g.entity.primary_place_id,street=sid===5393,withdrawn=sid===5382,ordinary=!street&&!withdrawn;
    assert.equal((p.payload?.identity as any).revision,g.entity.revision+(street?2:sid===6002?0:1));
    const evidence=(await db.query('SELECT kind,content FROM research_evidence WHERE place_id=$1 AND kind LIKE $2',[eid,'xhs_%'])).rows;
    const prior=library.tables.research_evidence.filter((e:any)=>e.place_id===eid&&e.kind.startsWith('xhs_')).map((e:any)=>({kind:e.kind,content:e.content}));
    assertRemainingStreetRow(p,old,sid,evidence,prior);
    const stored=(await db.query("SELECT embedding IS NOT NULL embedded,payload->>'embeddedText' text FROM canonical_places WHERE id=$1",[eid])).rows[0];
    assert.equal(stored.embedded,!withdrawn);if(!withdrawn)assert.equal(stored.text,placeEmbeddingText(p));
''' + s[b:]
a=s.index('    const boundaries=');b=s.index('  const fallbackObservedAtChanges',a)
s=s[:a]+'''    const boundaries=street?['济南墙','簪花济南文字墙','后宰门街大字墙']:withdrawn?['油旋张（大观园店）','油旋张（纬三路店）','油旋张油旋']:sid===5353?['芙蓉街鲁菜馆','宽厚里','芙蓉街西更道餐馆']:sid===5403?['腊山河','腊山河西路南延','济南森林公园']:['泉城之眼','泉城之眼·高空观景台','沃德酒店'];
    for(const id of [undefined,...(p.payload?.identity as any).memberIds])for(const name of boundaries){const resolved=index.resolve(city,name,id);assert.ok(resolved.status!=='resolved'||resolved.canonicalPlaceId!==eid);boundaryProbes++;}
    results.push({entityId:eid,name:p.name,withdrawn,ordinaryFactsPreserved:ordinary,confirmed:street?3:0,pending:withdrawn?3:0,preciseLocationNewlyVerified:false});
  }
''' + s[b:]
s=s.replace('assignments.length,312','assignments.length,318').replace('graph.manifest.revision,35','graph.manifest.revision,36').replace('pending.length,127','pending.length,130').replace('const newPending=[11536]','const newPending=[11478,11528,12738]').replace('audit/run-60/snapshot','audit/run-61/snapshot').replace('audit/run-59/snapshot','audit/run-60/snapshot').replace('added.length,1','added.length,3').replace('const sourceIds=[5954,5400]','const sourceIds=[5393,5382]')
s=s.replace('batch:61','batch:62').replace('assignmentRows:312,pendingMentions:127','assignmentRows:318,pendingMentions:130').replace('scopesAdded:2,confirmed:1,pendingAdded:1','scopesAdded:2,confirmed:3,pendingAdded:3').replace('categoriesCorrected:0,readOnlyBoundaryPending:5','categoriesCorrected:3,readOnlyBoundaryPending:1').replace('foreignWallTipsRemoved:2','furongNegativeOpinionsPreserved:true,furongDescriptionGovernanceDeferred:true')
s=s.replace("  assert.deepEqual(graph.relations,library.tables.place_relation_snapshots[0].relations);", """  const expectedRelations=structuredClone(library.tables.place_relation_snapshots[0].relations);let relationEndpointRevisionsUpdated=0;
  for(const r of expectedRelations)for(const end of ['from','to'])if(r[end+'EntityId']==='747792d1b5834255f5feaa6c2dc62925') {
    assert.equal(r[end+'Revision'],2);r[end+'Revision']=3;relationEndpointRevisionsUpdated++;
    for(const e of r.evidence){assert.equal(e[end].revision,2);e[end].revision=3;}
  }
  assert.equal(relationEndpointRevisionsUpdated,2);assert.deepEqual(graph.relations,expectedRelations);""")
s=s.replace('relationEvidenceAndStrengthPreserved:true,priorReviewRowsPreserved', 'relationEvidenceAndStrengthPreserved:true,relationEndpointRevisionsUpdated,priorReviewRowsPreserved')
write('verify-remaining-streets-data.mts',s)
s=(root/'verify-built-place-consumption.test.mts').read_text(encoding='utf-8').replace('batch-61','batch-62').replace('built-place','remaining-streets').replace('文字墙外来提示隔离、商店分店待审及其余五主体消费保持','街道/廊道类别、独立停留和分店撤回；芙蓉街正负评价保留')
s="import {assertRemainingStreetRow} from './remaining-streets-assertions';\n"+s
s=s.replace('beforeMockEnqueues,7','beforeMockEnqueues,5')
a=s.index('    const eid=g.entity.entity_id,wall=');b=s.index('  for(const [name,value] of before)',a)
s=s[:a]+'''    const eid=g.entity.entity_id,sid=g.entity.primary_place_id,street=sid===5393,withdrawn=sid===5382;
    const current=facts.get(placeNameKey(g.entity.canonical_name)),old=before.get(placeNameKey(g.entity.canonical_name));assert.ok(old);
    const p=(await pool.query('SELECT id,name,payload,verified,category,lat,lng FROM canonical_places WHERE id=$1',[eid])).rows[0];
    const previous=library.tables.canonical_places.find((p:any)=>p.id===eid);
    const evidence=(await pool.query('SELECT kind,content FROM research_evidence WHERE place_id=$1 AND kind LIKE $2',[eid,'xhs_%'])).rows;
    const prior=library.tables.research_evidence.filter((e:any)=>e.place_id===eid&&e.kind.startsWith('xhs_')).map((e:any)=>({kind:e.kind,content:e.content}));
    assertRemainingStreetRow(p,previous,sid,evidence,prior);
    if(withdrawn)assert.equal(current,undefined);
    else {
      assert.ok(current);assert.equal(current.canonicalPlaceId,eid);
      assert.equal(current.category,p.category);assert.equal(current.placeType,p.payload.xhsPlaceType);
      if(street){assert.equal(current.mentionCount,3);assert.equal(current.visitMinutes,30);}
      else assert.deepEqual(current,{...old,category:p.category,placeType:p.payload.xhsPlaceType});
    }
  }
''' + s[b:]
s=s.replace('assert.equal(queued,5)','assert.equal(queued,3)').replace('batch:61','batch:62').replace('readOnlyBoundaryPending:5','readOnlyBoundaryPending:1').replace('categoriesCorrected:0','categoriesCorrected:3').replace('foreignWallTipsRemoved:2','furongNegativeOpinionsPreserved:true,furongDescriptionGovernanceDeferred:true').replace('七主体实际无图，两完整scope阻止补图，mock7→5；其余五主体保持，旧3/1/2图库保持，真实队列未写入。','五主体实际无图，两完整scope阻止补图，mock5→3；两实体分类修订及一只读主体保持普通补图路径，旧3/1/2图库保持，真实队列未写入。')
write('verify-remaining-streets-consumption.test.mts',s)

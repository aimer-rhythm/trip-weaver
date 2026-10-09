from pathlib import Path
root=Path(__file__).resolve().parent
p=root/'preview-remaining-food.py';assert not p.exists()
s=(root/'preview-night-market.py').read_text(encoding='utf-8')
s=s.replace('第59批真实资料隔离验证：迁址旧导航待审、评价保留、幂等和逆序回滚。','第60批真实资料隔离验证：品牌门店待审、明确西部提及、幂等和逆序回滚。').replace('batch-59','batch-60')
s=s.replace('77fe3d6aa918a4e231b14305e9f626ce21b72c153c8eaa81e75f44de0ebde393','7556e3bc2c55be829354f5907ea4eaf103e1c33ef0750a1e97f9b60f4cb05fae')
start=s.index("        old=(await export('before-places.json'))")
end=s.index('        async with factory() as s:',start)
s=s[:start]+'''        old_export=await export('before-places.json');assert len(old_export['places'])==4
        old_by_id={p['id']:p for p in old_export['places']}
        assert all(p['verified'] and p['lat'] is not None and p['lng'] is not None for p in old_by_id.values())
''' +s[end:]
s=s.replace('len(cat.assignments)==5 and len(cat.catalog.entities)==1','len(cat.assignments)==10 and len(cat.catalog.entities)==4')
s=s.replace("if m['id']==11464:","if expected[m['id']]['entityId'] is None:")
s=s.replace("assert len(pending)==1 and pending[0]['detail']['mentionId']==11464","assert len(pending)==9 and {r['detail']['mentionId'] for r in pending}=={mid for mid,a in expected.items() if a['entityId'] is None}")
start=s.index("        exported=await export('xhs-places-济南.json')")
end=s.index('        async with factory() as s:',start)
s=s[:start]+'''        exported=await export('xhs-places-济南.json');assert len(exported['places'])==4
        withdrawn=[]
        for p in exported['places']:
            entity=next(g['entity'] for g in frozen['groups'] if g['entity']['entity_id']==p['id'])
            old=old_by_id[p['id']];approved=p['id']=='b8880b34d9a4e56942c76ea7a4e5555c'
            assert p['name']==entity['canonical_name'] and p['category']==('美食' if approved else '其他')
            assert p['payload'].get('xhsPlaceType')==('food' if approved else None)
            assert set(p['payload']['aliases'])==set(entity['aliases']) and p['payload']['identity']['memberIds']==entity['legacy_ids']
            assert p['verified'] is approved and p['payload']['identity']['revision']==(3 if approved else 2)
            assert p.get('lat') is None and p.get('lng') is None and p['payload']['imageIdentity']['approved']==[]
            assert [m['mentionId'] for m in p['payload']['mentionSources']]==([11375] if approved else [])
            if approved:
                assert p['payload']['address']=='济南西周边' and p['payload']['geoStatus']=='unresolvable'
                assert p['payload']['mentionCount']==1 and p['payload']['themes']==[]
                assert p['payload']['content']['highlights']==old['payload']['content']['highlights'][:2]
                assert len(p['evidence'])==1 and p['evidence'][0]['content']==next(m['reason'] for m in frozen['mentions'] if m['id']==11375)
                assert next(m['reason'] for m in frozen['mentions'] if m['id']==12806) not in json.dumps(p,ensure_ascii=False)
                for field in ['openHours','reservation','price','tips']:assert p['payload'].get(field)==old['payload'].get(field)
            else:
                assert p['payload']['identityWithdrawal']=={'version':1,'revision':2,'reason':'unavailable_source','candidateIds':[]}
                assert p['evidence']==[]
                for field in ['content','topReasons','address','openHours','reservation','price','tips','themes','typicalVisitMinutes']:
                    assert not p['payload'].get(field),(p['name'],field,p['payload'].get(field))
                withdrawn.append(p['id'])
        assert len(withdrawn)==3
''' +s[end:]
start=s.index("        report={'batch':59")
end=s.index("        with (folder/'report.json')",start)
s=s[:start]+'''        report={'batch':60,'isolated':True,'synthetic':False,'partialCityReconstruction':True,'sources':4,'historicalEntities':4,'mentions':10,'notes':5,
            'confirmed':1,'pendingAdded':9,'historicalReviewPreserved':True,'newEntities':0,'withdrawals':3,'withdrawnIds':withdrawn,
            'explicitPointCleared':1,'withdrawnCoordinatesRemoved':3,'preciseLocationResolved':False,'confirmedFactsAndDatesPreserved':True,'idempotent':True,'reverseRollback':True,
            'originalSourcesAndMentionsUnchanged':True,'publicationDatesPreserved':True,'imageComparison':'deferred_by_user','fullReviewPassed':False,'failures':[],
            'exportSha256':hashlib.sha256((folder/'xhs-places-济南.json').read_bytes()).hexdigest()}
''' +s[end:]
p.write_text(s,encoding='utf-8')

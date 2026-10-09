"""冻结锦里完整scope、字段排除和原评价；武侯祠只读保全，不应用业务改动。"""
from pathlib import Path
from datetime import datetime, timezone
import asyncio
import hashlib
import json
import sys

sys.dont_write_bytecode = True
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0, 'D:/Project/xhs-travel-pipeline')
from sqlalchemy import select, text
from app.db import SessionFactory, engine
from app.models import CanonicalPlace, PlaceSummary, RawNote
from app.aggregate.mention_identity import load_mention_catalog, load_mention_rows, source_input
from app.aggregate.note_text_warnings import load_warning_notes
from app.aggregate.image_identity import load_image_rows
from app.clean.mention_identity import mention_fingerprint, source_fingerprint, scope_matches, validate_fact_exclusions
from app.clean.note_text_warnings import warning_input, validate_text_warnings

root = Path(__file__).resolve().parent
eid = '8a433260acdd259716088f8009e0fbdc'
source_file = 'priority-cities/成都/wuhou-jinli-source-01.json'
review_file = 'priority-cities/成都/jinli-source-review-01.json'


def read(p):
    return json.loads((root/p).read_text(encoding='utf-8'))


def sha(p):
    return hashlib.sha256((root/p).read_bytes()).hexdigest()


def digest(v):
    return hashlib.sha256(json.dumps(v, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


async def main():
    pointer = read('cleaning-scope/current.json')
    assert pointer['latestAppliedEntityBatch'] == 69 and pointer['pendingVerification'] == [] and not pointer['userAcceptance']
    assert pointer['imageComparisonPolicy']['status'] == 'deferred_by_user'
    assert sha(source_file) == 'd49aa33671cdf873ed879c9f93e2849e05db4a673fc4d3f0dfa506dd0d6191d6'
    packet = read(source_file)
    preflight = read('priority-cities/成都/wuhou-jinli-photo-preflight-01.json')
    assert preflight['existingPhotoConsumptionPreserved'] and preflight['actualFactsChecked']
    assert all(r['factsImages'] == r['lookupImages'] == r['eligible'] == r['assignments'] == 0 for r in preflight['results'])
    paths = [f'all-cities/batch-70-{k}.json' for k in ['source', 'catalog', 'scope-decisions', 'decisions', 'export-expectations']]
    assert all(not (root/p).exists() for p in [review_file, *paths])
    try:
        async with SessionFactory() as session:
            await session.execute(text('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'))
            catalog = await load_mention_catalog(session, '成都')
            assert len(catalog.assignments) == 47
            all_rows = await load_mention_rows(session, '成都')
            for group in packet['groups']:
                entity = group['entity']
                assert catalog.catalog.entities[entity['entity_id']] == entity
                assert catalog.scope_for_source(entity['primary_place_id']) is None
                selected = [m for m in all_rows if scope_matches({'city': '成都', 'name_keys': group['nameKeys']}, m)]
                assert {m['id']: mention_fingerprint(m) for m in selected} == {m['id']: m['inputHash'] for m in packet['mentions'] if m['id'] in group['mentionIds']}
            for entry in packet['sources']:
                p = await session.get(CanonicalPlace, entry['source']['id'])
                assert source_fingerprint(source_input(p)) == entry['sourceHash']
                for key, value in {**entry['source'], **entry['derivedBefore'], **entry['supplement']}.items():
                    assert getattr(p, key) == value
                summary = await session.scalar(select(PlaceSummary).where(PlaceSummary.canonical_place_id == entry['summary']['canonical_place_id']))
                for key, value in entry['summary'].items():
                    assert getattr(summary, key) == value
            for n in packet['noteDetails']:
                actual = await session.get(RawNote, n['id'])
                for key in ['city', 'title', 'desc', 'status']:
                    assert getattr(actual, key) == n[key]
                assert actual.img_analysis == n['images'] and digest(actual.raw_json) == n['rawJsonSha256']
                assert actual.source_url == n['sourceUrl'] and actual.created_at.isoformat() == n['observedAt']
                assert (actual.publish_time.isoformat() if actual.publish_time else None) == n['publishedAt']
            group = next(g for g in packet['groups'] if g['entity']['entity_id'] == eid)
            rows = [m for m in packet['mentions'] if m['id'] in group['mentionIds']]
            assert len(rows) == 17
            assignments = []
            area_quote = '2. 第二天可换住武侯祠/宽窄巷子附近\n靠近人文古迹片区，去草堂、锦里、玉林路不用长途赶路，周边烟火小店多，生活氛围浓厚'
            duration_quote = '13:00-14:15打车到锦里古街，武侯祠就紧邻着（图7-11）'
            for row in rows:
                assignment = {'mentionId': row['id'], 'inputHash': row['inputHash'], 'entityId': None if row['id'] == 3702 else eid}
                if row['id'] == 3822:
                    assignment['factExclusions'] = {field: {'reason': 'subject_mismatch', 'quote': area_quote} for field in ['reason', 'evidence_text']}
                if row['id'] == 4061:
                    assignment['factExclusions'] = {'visit_duration': {'reason': 'group_duration', 'quote': duration_quote}}
                if 'factExclusions' in assignment:
                    validate_fact_exclusions(assignment['factExclusions'], row, eid)
                assignments.append(assignment)
            warning_notes = await load_warning_notes(session, [{'noteId': n} for n in [910, 902, 948]])
            warnings = []
            for nid, index, heading, count in [(910, 5, '4. 武侯祠毗邻锦里', 1), (902, 5, '❤️注意4：锦里', 1), (948, 2, '11、锦里古街🏮 7.2', 2)]:
                n = warning_notes[nid]
                original = n['images'][index]['text_content']
                start = original.index(heading)
                quote = ''.join(original[start:].splitlines(keepends=True)[:count]).rstrip('\r\n')
                warnings.append({**warning_input(nid, index, n), 'start': start, 'end': start+len(quote), 'quote': quote, 'entityId': eid})
            assert validate_text_warnings(warnings, city='成都', notes=warning_notes, entities=catalog.catalog.entities, confirmed_ids={eid}) == warnings
            images = [im for im in await load_image_rows(session, '成都') if im['source_place_id'] in [1688, 1689]]
            assert images == []
        evidence = [{'kind': 'reviewed_full_text_and_original_opinions', 'file': review_file,
                     'conclusion': '锦里主巷为路线子项待审，其余16条身份确认；住宿片区字段和含交通75分钟排除，3条原评价逐字承接。完整scope只使用已审核名称合同，文化粗类保持、细类修正market，原名称/ID/日期/观点不改写。'}]
        scope = {'key': 'all-cities-20261009-batch-70-jinli-scope', 'city': '成都', 'sourcePlaceId': 1689,
                 'expectedSourceHash': next(s['sourceHash'] for s in packet['sources'] if s['source']['id'] == 1689),
                 'expectedScopeRevision': 0, 'expectedRevisions': {eid: 1}, 'assignments': assignments,
                 'textWarnings': warnings, 'evidence': evidence}
        decision = {'key': 'all-cities-20261009-batch-70-jinli-type', 'city': '成都', 'entityId': eid,
                    'expectedRevisions': {eid: 2}, 'mergeEntityIds': [], 'canonicalName': '锦里', 'aliases': group['entity']['aliases'],
                    'overrides': {'category': '文化', 'xhsPlaceType': 'market'}, 'evidence': evidence}
        source = {**packet, 'capturedAt': datetime.now(timezone.utc).isoformat(), 'originalSourceFile': source_file,
                  'originalSourceSha256': sha(source_file), 'images': [], 'reviews': packet['catalog']['reviews'],
                  'notes': [{k: n[k] for k in ['id', 'city', 'title', 'desc']} for n in packet['noteDetails']]}
        research = read('priority-cities/成都/wuhou-jinli-source-review-01.json')
        review = {'batch': 70, 'city': '成都', 'state': 'prepared_not_applied', 'sourceFile': 'all-cities/batch-70-source.json',
                  'sourcesRead': 2, 'sourcesGoverned': 1, 'mentionsRead': 43, 'directFullNotes': 27, 'supplementalFullNotes': 1,
                  'scopeMentions': 17, 'confirmed': 16, 'pendingAdded': 1, 'pendingMentionIds': [3702],
                  'rows': [m for m in research['mentionReviews'] if m['entityId'] == eid], 'assignments': assignments, 'textWarnings': warnings,
                  'namePolicy': '不将待审主巷假确认后排除，不放宽既有名称排除保护；完整scope最终memberNames仅锦里/锦里古街。',
                  'factPolicy': '3822的住宿片区reason/evidence均排除，原句在笔记保留；4061含打车75分钟不作为独立时长。所有作者正负意见保留，旧原价/预约片段保留原文历史，非现行政策确认。',
                  'mediaPolicy': '两主体当前facts/lookup无图；不看图、不绑定新图，正式应用后仍需实际消费核对。',
                  'supplementalOpinionPolicy': '逐字保全原混合tips中的910与948作者锦里评价，另补902价格意见。936锦里段仍完整保存在原分析，不剪裁成两行新quote，不声称其全文已进入消费。',
                  'wuhouPolicy': '武侯祠1源26提及和旧web profile只读，150分钟/住宿片区问题未应用，网页绑定及营业冲突另行治理。',
                  'newEntities': 0, 'withdrawals': 0, 'coordinatesCleared': 0, 'preciseLocationsResolved': 0,
                  'imageComparison': 'deferred_by_user', 'imagesViewed': 0, 'fullReviewPassed': False, 'userAcceptance': False}
        values = [source, packet['catalog'], [scope], [decision], [{'city': '成都', 'id': eid, 'name': '锦里', 'revision': 3,
                   'verified': True, 'mentionIds': sorted(m['id'] for m in rows if m['id'] != 3702)}]]
        for path, value in [(review_file, review), *zip(paths, values)]:
            with (root/path).open('x', encoding='utf-8') as out:
                json.dump(value, out, ensure_ascii=False, indent=2)
                out.write('\n')
        print(json.dumps({'batch': 70, 'prepared': True, 'applied': False, 'confirmed': 16, 'pending': 1,
                          'warnings': 3, 'factExclusions': 3, 'sourceSha256': sha(paths[0])}, ensure_ascii=False))
    finally:
        await engine.dispose()


asyncio.run(main())

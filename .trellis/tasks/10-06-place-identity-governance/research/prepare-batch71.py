"""只读冻结武侯祠完整scope与网页保全审阅；不应用业务改动。"""
from pathlib import Path
from datetime import datetime, timezone
import asyncio
import copy
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
from app.clean.mention_identity import digest, mention_fingerprint, source_fingerprint, scope_matches, validate_fact_exclusions
from app.clean.note_text_warnings import warning_input, validate_text_warnings

root = Path(__file__).resolve().parent
eid = '300d2ae16b4e2787a84d7661a06f580e'
review_file = 'priority-cities/成都/wuhou-source-review-02.json'
profile_review = 'priority-cities/成都/wuhou-web-profile-review-01.json'


def read(p):
    return json.loads((root / p).read_text(encoding='utf-8'))


def sha(p):
    return hashlib.sha256((root / p).read_bytes()).hexdigest()


async def main():
    pointer = read('cleaning-scope/current.json')
    assert pointer['latestAppliedEntityBatch'] == 70 and pointer['pendingVerification'] == [] and not pointer['userAcceptance']
    assert pointer['imageComparisonPolicy']['status'] == 'deferred_by_user'
    assert sha('all-cities/batch-70-source.json') == '21f57b6b992060060171b5f474872c968443148fc616e62ba79e155386b2c597'
    packet = read('all-cities/batch-70-source.json')
    group = next(g for g in packet['groups'] if g['entity']['entity_id'] == eid)
    source = next(s for s in packet['sources'] if s['source']['id'] == 1688)
    rows = [m for m in packet['mentions'] if m['id'] in group['mentionIds']]
    assert len(rows) == 26
    note_ids = {m['raw_note_id'] for m in rows} | {948}
    notes = [n for n in packet['noteDetails'] if n['id'] in note_ids]
    assert len(notes) == 27
    baseline = next(p for p in read('all-cities/batch-70/sync-01/xhs-places-成都.json')['places'] if p['id'] == eid)
    profile = source['derivedBefore']['content_profile']
    assert profile == baseline['payload']['content'] and len(profile['highlights']) == 3
    assert all(h['basis'] == 'web' for h in profile['highlights']) and 'identityBinding' not in profile
    paths = [f'all-cities/batch-71-{k}.json' for k in ['source', 'catalog', 'scope-decisions', 'decisions', 'export-expectations']]
    assert all(not (root / p).exists() for p in [review_file, profile_review, *paths])
    try:
        async with SessionFactory() as session:
            await session.execute(text('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'))
            catalog = await load_mention_catalog(session, '成都')
            assert len(catalog.assignments) == 64
            assert catalog.catalog.entities[eid] == group['entity'] and catalog.scope_for_source(1688) is None
            selected = [m for m in await load_mention_rows(session, '成都') if scope_matches({'city': '成都', 'name_keys': group['nameKeys']}, m)]
            assert {m['id']: mention_fingerprint(m) for m in selected} == {m['id']: m['inputHash'] for m in rows}
            actual = await session.get(CanonicalPlace, 1688)
            assert source_fingerprint(source_input(actual)) == source['sourceHash']
            for k, value in {**source['source'], **source['derivedBefore'], **source['supplement']}.items():
                assert getattr(actual, k) == value
            summary = await session.scalar(select(PlaceSummary).where(PlaceSummary.canonical_place_id == 1688))
            for k, value in source['summary'].items(): assert getattr(summary, k) == value
            for n in notes:
                actual = await session.get(RawNote, n['id'])
                for k in ['city', 'title', 'desc', 'status']: assert getattr(actual, k) == n[k]
                # 历史冻结raw_json用紧凑JSON指纹；不得输出原始分析或签名URL。
                raw_digest = hashlib.sha256(json.dumps(actual.raw_json, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
                assert actual.img_analysis == n['images'] and raw_digest == n['rawJsonSha256']
                assert actual.source_url == n['sourceUrl'] and actual.created_at.isoformat() == n['observedAt']
                assert (actual.publish_time.isoformat() if actual.publish_time else None) == n['publishedAt']
            assignments = []
            area_quote = '2. 第二天可换住武侯祠/宽窄巷子附近\n靠近人文古迹片区，去草堂、锦里、玉林路不用长途赶路，周边烟火小店多，生活氛围浓厚'
            duration_quote = next(m for m in rows if m['id'] == 4031)['note_desc'].split('\n\t\n省时指南')[0]
            assert '2‑2.5小时' in duration_quote and '锦里古街' in duration_quote
            for row in rows:
                item = {'mentionId': row['id'], 'inputHash': row['inputHash'], 'entityId': eid}
                if row['id'] == 3818:
                    item['factExclusions'] = {field: {'reason': 'subject_mismatch', 'quote': area_quote} for field in ['reason', 'evidence_text']}
                if row['id'] == 4031:
                    item['factExclusions'] = {'visit_duration': {'reason': 'group_duration', 'quote': duration_quote}}
                if 'factExclusions' in item: validate_fact_exclusions(item['factExclusions'], row, eid)
                assignments.append(item)
            warning_notes = await load_warning_notes(session, [{'noteId': 948}])
            n = warning_notes[948]
            original = n['images'][1]['text_content']
            start = original.index('6、武侯祠 8.3')
            quote = ''.join(original[start:].splitlines(keepends=True)[:2]).rstrip('\r\n')
            warnings = [{**warning_input(948, 1, n), 'start': start, 'end': start + len(quote), 'quote': quote, 'entityId': eid}]
            assert validate_text_warnings(warnings, city='成都', notes=warning_notes, entities=catalog.catalog.entities, confirmed_ids={eid}) == warnings
            assert not [im for im in await load_image_rows(session, '成都') if im['source_place_id'] == 1688]
        profile_evidence = [{'kind': 'subject_only_preservation', 'file': profile_review,
            'conclusion': '三条网页看点均描述现行武侯祠稳定主体；博物馆组成说明不等于把锦里合并。完整保留原内容、引用和旧日期；政府链接本轮抓取失败，不宣称重新核实每项事实或当前营业政策。'}]
        evidence = [{'kind': 'reviewed_full_text_and_original_opinions', 'file': review_file,
            'conclusion': '26条均确认；住宿片区2字段及含锦里的150分钟排除。原4项负面意见与历史教师节条件保留；948编号标题和完整原评价逐字承接；旧网页profile按原主体审阅并绑定，不改旧点或当前营业政策。'}]
        scope = {'key': 'all-cities-20261009-batch-71-wuhou-scope', 'city': '成都', 'sourcePlaceId': 1688,
            'expectedSourceHash': source['sourceHash'], 'expectedScopeRevision': 0, 'expectedRevisions': {eid: 1},
            'assignments': assignments, 'textWarnings': warnings,
            'preserveWebProfiles': [{'entityId': eid, 'sourcePlaceId': 1688, 'profileHash': digest(profile), 'evidence': profile_evidence}], 'evidence': evidence}
        subset_catalog = {'entities': [group['entity']], 'members': [m for m in packet['catalog']['members'] if m['entity_id'] == eid], 'reviews': []}
        frozen = {**packet, 'capturedAt': datetime.now(timezone.utc).isoformat(), 'entityBatch': 70,
            'originalSourceFile': 'all-cities/batch-70-source.json', 'originalSourceSha256': sha('all-cities/batch-70-source.json'),
            'groups': [group], 'sources': [source], 'mentions': rows, 'noteDetails': notes, 'catalog': subset_catalog,
            'cityWideAssignments': 64, 'images': [], 'reviews': [], 'notes': [{k: n[k] for k in ['id', 'city', 'title', 'desc']} for n in notes],
            'tipSources': [t for t in packet['tipSources'] if (t['noteId'], t['imageIndex']) in [(910, 2), (948, 1)]]}
        research = read('priority-cities/成都/wuhou-jinli-source-review-01.json')
        review = {'batch': 71, 'city': '成都', 'state': 'prepared_not_applied', 'sourceFile': paths[0],
            'sourcesRead': 1, 'mentionsRead': 26, 'directFullNotes': 26, 'supplementalFullNotes': 1,
            'confirmed': 26, 'pendingAdded': 0, 'rows': [m for m in research['mentionReviews'] if m['entityId'] == eid],
            'assignments': assignments, 'textWarnings': warnings, 'profilePreservation': scope['preserveWebProfiles'],
            'factsPolicy': '保留4项负面意见、原价格/教师优惠及其来源日期，历史9.10–9.20教师资格条件不升级为普遍免票；不混合官网及票务页现行时间。只排除住宿字段和合游时长，现行独立时长未知。',
            'mediaPolicy': '不看图，原facts/lookup均无图；正式应用后仍须对全城实际返回验证，不增加绑定。',
            'imageComparison': 'deferred_by_user', 'imagesViewed': 0, 'fullReviewPassed': False, 'userAcceptance': False}
        profile_record = {'entityId': eid, 'name': '武侯祠', 'sourcePlaceId': 1688, 'profileHash': digest(profile),
            'scope': 'subject_only_preservation', 'webHighlights': 3, 'profile': copy.deepcopy(profile),
            'evidence': profile_evidence, 'newlyFetchedOrVerified': False, 'originalDatesPreserved': True,
            'governmentReferenceFetch': 'failed_in_previous_read_only_review', 'currentHours': 'conflicting_unresolved',
            'businessMutationApplied': False, 'userAcceptance': False}
        values = [frozen, subset_catalog, [scope], [], [{'city': '成都', 'id': eid, 'name': '武侯祠', 'revision': 2, 'verified': True, 'mentionIds': sorted(m['id'] for m in rows)}]]
        for path, value in [(review_file, review), (profile_review, profile_record), *zip(paths, values)]:
            with (root / path).open('x', encoding='utf-8') as out:
                json.dump(value, out, ensure_ascii=False, indent=2)
                out.write('\n')
        print(json.dumps({'batch': 71, 'prepared': True, 'applied': False, 'sources': 1, 'mentions': 26, 'fullNotes': 27,
            'confirmed': 26, 'pending': 0, 'warnings': 1, 'factExclusions': 3, 'webHighlightsPreservedInPlan': 3, 'sourceSha256': sha(paths[0])}, ensure_ascii=False))
    finally:
        await engine.dispose()


asyncio.run(main())

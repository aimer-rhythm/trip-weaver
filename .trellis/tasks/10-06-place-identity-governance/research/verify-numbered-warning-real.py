"""已安装校验器核对真实编号原评价；实库事务只读，不改scope或笔记。"""
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
from sqlalchemy import text
from app.db import SessionFactory, engine
from app.models import RawNote
from app.aggregate.mention_identity import load_mention_catalog, load_warning_notes
from app.clean import note_text_warnings as validator

root = Path(__file__).resolve().parent
source = root / 'priority-cities/成都/wuhou-jinli-source-01.json'
target = root / 'priority-cities/成都/numbered-warning-real-proof-01.json'


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


async def main():
    assert not target.exists(), '已有真实来源证明，禁止覆盖'
    assert source.exists() and hashlib.sha256(source.read_bytes()).hexdigest() == 'd49aa33671cdf873ed879c9f93e2849e05db4a673fc4d3f0dfa506dd0d6191d6'
    packet = json.loads(source.read_text(encoding='utf-8'))
    frozen = next(n for n in packet['noteDetails'] if n['id'] == 948)
    module = Path(validator.__file__).resolve()
    assert module == Path('D:/Project/xhs-travel-pipeline/app/clean/note_text_warnings.py').resolve()
    assert module.read_bytes() == (root / 'upstream/app/clean/note_text_warnings.py').read_bytes()
    cases = [(1, '6、武侯祠 8.3', '300d2ae16b4e2787a84d7661a06f580e'),
             (2, '11、锦里古街🏮 7.2', '8a433260acdd259716088f8009e0fbdc')]
    results = []
    try:
        async with SessionFactory() as session:
            await session.execute(text('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'))
            catalog = await load_mention_catalog(session, '成都')
            assert len(catalog.assignments) == 47
            notes = await load_warning_notes(session, [{'noteId': 948}])
            raw = await session.get(RawNote, 948)
            assert (raw.title, raw.desc, raw.img_analysis, raw.created_at.isoformat(), raw.publish_time.isoformat()) == (
                frozen['title'], frozen['desc'], frozen['images'], frozen['observedAt'], frozen['publishedAt'])
            assert digest(raw.raw_json) == frozen['rawJsonSha256']
            assert digest(raw.img_analysis) == frozen['analysisSha256']
            for image_index, heading, entity_id in cases:
                entity = catalog.catalog.entities[entity_id]
                assert entity['revision'] == 1 and catalog.scope_for_source(entity['primary_place_id']) is None
                original = validator.warning_text(notes[948], image_index)
                start = original.index(heading)
                lines = original[start:].splitlines(keepends=True)
                assert lines[0].rstrip('\r\n') == heading
                quote = ''.join(lines[:2]).rstrip('\r\n')
                end = start + len(quote)
                assert original[start:end] == quote
                item = {**validator.warning_input(948, image_index, notes[948]),
                        'entityId': entity_id, 'start': start, 'end': end, 'quote': quote}
                context = {'city': '成都', 'notes': notes, 'entities': catalog.catalog.entities, 'confirmed_ids': {entity_id}}
                assert validator.validate_text_warnings([item], **context) == [item]
                rejected = []
                for case in ('clipped_heading', 'clipped_opinion', 'changed_text', 'stale_date', 'unconfirmed_subject'):
                    changed_item, changed_context = copy.deepcopy(item), copy.deepcopy(context)
                    if case == 'clipped_heading':
                        changed_item['start'] += 1
                        changed_item['quote'] = changed_item['quote'][1:]
                    elif case == 'clipped_opinion':
                        changed_item['end'] -= 1
                        changed_item['quote'] = changed_item['quote'][:-1]
                    elif case == 'changed_text':
                        changed_item['quote'] = changed_item['quote'].replace('去。', '去！', 1)
                        assert changed_item['quote'] != item['quote']
                    elif case == 'stale_date':
                        changed_context['notes'][948]['publishedAt'] = '2026-10-09T00:00:00+00:00'
                    else:
                        changed_context['confirmed_ids'] = set()
                    try:
                        validator.validate_text_warnings([changed_item], **changed_context)
                    except ValueError:
                        rejected.append(case)
                    else:
                        raise AssertionError(case)
                results.append({**item, 'name': entity['canonical_name'], 'revision': entity['revision'],
                                'quoteSha256': hashlib.sha256(quote.encode()).hexdigest(),
                                'rejectedCases': rejected, 'originalQuotePreserved': True})
            report = {'capturedAt': datetime.now(timezone.utc).isoformat(), 'readOnly': True,
                      'installedValidator': str(module), 'validatorSha256': hashlib.sha256(module.read_bytes()).hexdigest(),
                      'sourceFile': str(source.relative_to(root)), 'sourceSha256': hashlib.sha256(source.read_bytes()).hexdigest(),
                      'noteId': 948, 'observedAt': frozen['observedAt'], 'publishedAt': frozen['publishedAt'],
                      'rawJsonSha256': frozen['rawJsonSha256'], 'analysisSha256': frozen['analysisSha256'],
                      'noteUnchanged': True, 'cases': results, 'validatedQuotes': 2, 'rejectedMutations': 10,
                      'confirmedIdsAreValidatorInputsOnly': True, 'businessScopeApplied': False,
                      'assignmentsBeforeAndAfter': 47, 'imagesViewed': 0, 'failures': []}
            with target.open('x', encoding='utf-8') as out:
                json.dump(report, out, ensure_ascii=False, indent=2)
                out.write('\n')
        print(json.dumps({'file': str(target.relative_to(root)), 'validatedQuotes': 2,
                          'rejectedMutations': 10, 'businessScopeApplied': False, 'failures': []}, ensure_ascii=False))
    finally:
        await engine.dispose()


asyncio.run(main())

"""黄厝沙滩34篇完整阅读，隔离住宿及节庆，保留路线和原评价。"""
import asyncio
import hashlib
import importlib.util
import json
import sys
import traceback
from pathlib import Path

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('scope_runner', ROOT/'govern-disney-scopes.py')
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)
from app.clean.mention_identity import source_fingerprint, effective_mention
from app.clean.recommendation import recommendation_metrics
from app.aggregate.mention_identity import load_mention_catalog, load_mention_rows

runner.CITY,runner.BATCH='厦门','batch-111'
runner.SNAPSHOT=ROOT/'snapshot-20261009T224916589831Z/input.json'
runner.EXTRAS=ROOT/'xiamen-scope-06-extras.json'
runner.BASELINE=ROOT/'xiamen-scope-06-baseline.json'
EID,SID='15f4085f90907345a822ac07663783c3',2613
runner.TARGETS={EID}
runner.UNASSIGNED={6163,6238,6572,6853}
runner.FORBIDDEN_PHRASES=['焰火晚会超震撼但需提前占位','沙滩开阔松弛，适合营地式海边跨年',
    '海边live演出配零点冷焰','附近民宿性价比高','黄厝沙滩附近就有许多民宿']
FACTS={5662:(['reason','evidence_text'],
    '✅选酒店：黄厝沙滩附近就有许多民宿，从四星级到普通民宿，看个人追求，我个人觉得我在黄厝这里住的酒店要比市区的更舒服，卫生也更好点，而且价格也很美丽')}


def inputs():
    raw=runner.SNAPSHOT.read_bytes()
    frozen=next(c for c in json.loads(raw)['cities'] if c['city']=='厦门')
    entity=next(e for e in frozen['entities'] if e['entity_id']==EID)
    assert entity['revision']==2 and entity['primary_place_id']==SID
    assert entity['overrides']=={'recommendationPolicy':'resolved_attraction_mentions_v1'}
    assert sorted(int(k) for k,v in frozen['members'].items() if v==EID)==[2613,2656]
    assert not any(EID in [*s['entity_ids'],*s.get('withdrawal_entity_ids',[])] for s in frozen['scopes'])
    rows=[m for m in frozen['mentions'] if m['entityId']==EID]
    assert len(rows)==len({m['raw_note_id'] for m in rows})==34
    notes=frozen['notes']
    quotes=[(1380,'🏡厦门住宿参考\n🛕中山路、八市、轮渡周边，靠近鼓浪屿码头，吃喝出行都方便\n🌅黄厝沙滩沿线安静，适合想看海上日出、偏爱慢节奏海边游玩的人'),
        (1453,'🎆海峡两岸春节焰火晚会\n⏰2月17日（大年初一）20:00\n📍思明区黄厝海滩\n✨两岸同庆超震撼！建议提前占位'),
        (1475,'3️⃣黄厝沙滩跨年（海边跨年）\n松弛一点，开阔一点，来黄厝沙滩营地一起跨年'),
        (1528,'🎉黄厝沙滩跨年派对\n📍地址：黄厝沙滩 左来右去海岛日记沙滩餐酒吧'),
        (1260,'但是秉着来都来了的心态，我来了第三回，这次我终于摸透了黄厝最适合女生的玩法！'),
        (1316,'白城沙滩和黄厝沙滩人超多，体验感一般很差'),
        (1317,'想去沙滩玩的岛内可以选择黄厝沙滩，五缘湾沙滩，岛外去彩虹沙滩。'),
        (1354,'📍黄厝海滩\n🏝️定位玩月坡，海边这棵树超级出片！！海边很美！！看海喝咖啡拍照超惬意。'),
        (1347,'2️⃣黄厝海滩：定位鲸喜蓝眼泪，海边巴士和蓝色大门，清新治愈。'),
        (1263,'日落在音乐广场、白城沙滩，日出在后面三个沙滩\n白城沙滩➠音乐广场➠黄厝沙滩➠椰风寨沙滩➠一国两制沙滩'),
        (1585,'4️⃣思明区：忠仑公园（厕所有热水可以接 这点nice）、黄厝沙滩（停车1h10r）、海湾公园'),
        (1580,'黄厝沙滩🏖️（环岛路风景线，沙滩，草地日出超美）'),
        (1336,'白城沙滩-珍珠湾-音乐广场-玩月坡-黄村海滩'),
        (1243,'溪头下→海韵台→黄厝海滨→玩月坡→黄厝海滩→椰风寨'),
        (1279,'✔️一定去：鼓浪屿、厦大、环岛路/黄厝、南普陀、植物园、集美、钟鼓索道（7个）'),
        (1568,'逛完步道还能顺路去黄厝吃海鲜大排档'),
        (1456,'住宿强烈推荐：黄厝一带的别墅')]
    for nid,quote in quotes:
        assert quote in notes[str(nid)]['note_desc'],nid
    assignments=[]
    for m in rows:
        a={'mentionId':m['id'],'inputHash':m['inputHash'],'entityId':None if m['id'] in runner.UNASSIGNED else EID}
        if m['id'] in FACTS:
            fields,quote=FACTS[m['id']]
            assert quote in notes[str(m['raw_note_id'])]['note_desc']
            a['factExclusions']={field:{'reason':'subject_mismatch','quote':quote} for field in fields}
        assignments.append(a)
    evidence=[{'kind':'reviewed_attraction_source_scope','snapshotSha256':hashlib.sha256(raw).hexdigest(),
        'file':str(Path(__file__).relative_to(ROOT.parents[3])),
        'noteQuotes':[{'noteId':nid,'quote':quote} for nid,quote in quotes],
        'reviewedNotes':[{'noteId':nid,'noteDescSha256':hashlib.sha256(notes[str(nid)]['note_desc'].encode()).hexdigest()}
            for nid in sorted({m['raw_note_id'] for m in rows})],
        'additionalBoundaryNotes':[{'noteId':nid,'noteDescSha256':hashlib.sha256(notes[str(nid)]['note_desc'].encode()).hexdigest()}
            for nid in [1243,1247,1279,1456,1568]],
        'conclusion':'34条提及/34篇正文完整阅读；其中15篇与白城110同篇原文已比较保持，另外19篇本轮全文阅读，另5篇边界正文只读。沿用黄厝沙滩/黄厝海滩旧同体，两源联合scope。6163只有住宿选区，6238春节焰火、6572营地跨年、6853左来右去餐酒吧跨年派对，四条隔离待审，不新建酒店、活动或餐酒吧。5662全文明确第三次来沙滩看日出，身份保留，仅排混入民宿性价比的reason和酒店evidence_text；不把酒店描述当沙滩评价。其余29条有效提及全字段保持，含5764人多体验差负评与6083推荐岛内沙滩。5372明确黄厝标题及海边景色，但定位玩月坡树与咖啡；5516路线明确海滩但具体设施定位鲸喜蓝眼泪。保留其有限海边路线身份和原描述，店铺/独立机位与整片边界未闭合，不能把这些设施升级为整片已核事实或强行同义。6878虽然引文是烟花，独立Day1列出海滩及日出路线，保留身份，不因活动关键词整条隔离。6323/6525是沙滩露营地点清单，非已确认独立经营营地，保持原观点及停车原说法，不确认现行露营许可/停车费。5803原文错写黄村海滩且路线语境清楚，保留旧归属但不新增错名别名。黄厝裸名混有看海、吃饭、住宿，黄厝海滨6917与黄厝海滩在同路线分别出现，5408又以两家店导航；不合并为沙滩、不确认等同公交站、不借旧坐标完成范围证明。黄厝石胄头、溪头下、玩月坡、椰风寨、各店保持原独立主体，源2656与主源2613的位置差异未新增地理结论。只治理来源身份，不全量核实日出日落、店铺设施、运营或媒体。'}]
    # 复用正文先做全字段比较，不能只因noteId相同便假定没有变化。
    old=next(c for c in json.loads((ROOT/'snapshot-20261009T223050497667Z/input.json').read_bytes())['cities'] if c['city']=='厦门')
    white,=json.loads((runner.merges.PARENT/'batch-110-scope-decisions.json').read_bytes())
    shared={n['noteId'] for n in white['evidence'][0]['reviewedNotes']}&{m['raw_note_id'] for m in rows}
    assert len(shared)==15 and all(old['notes'][str(n)]==notes[str(n)] for n in shared)
    sources={s['id']:s for s in frozen['sources']}
    scope={'key':'top30-20261010-batch-111-scope-2613','city':'厦门','sourcePlaceId':SID,
        'expectedSourceHash':source_fingerprint(sources[SID]),'expectedScopeRevision':0,
        'sources':[{'sourcePlaceId':sid,'sourceHash':source_fingerprint(sources[sid])} for sid in [2613,2656]],
        'expectedRevisions':{EID:2},'assignments':assignments,'evidence':evidence}
    own=[m for m in rows if m['id'] not in runner.UNASSIGNED]
    expected={'city':'厦门','id':EID,'name':entity['canonical_name'],'revision':3,'verified':True,
        'mentionIds':[m['id'] for m in own],**recommendation_metrics(own)}
    assert expected['mentionCount']==30
    return frozen,[scope],[expected]


original_apply_checked=runner.apply_checked


async def apply_checked(session,frozen,scopes,expected):
    report=await original_apply_checked(session,frozen,scopes,expected)
    catalog=await load_mention_catalog(session,'厦门')
    for m in await load_mention_rows(session,'厦门'):
        if m['id'] in expected[0]['mentionIds']:
            wanted={**m,'fact_value':m['fact_value'] or {}}
            if m['id'] in FACTS:
                wanted.update({field:None for field in FACTS[m['id']][0]})
            assert effective_mention(m,catalog.resolve(m))==wanted
    assert {5372,5510,5516,5662,5764,5803,6083,6323,6525,6878}.issubset(expected[0]['mentionIds'])
    assert catalog.catalog.entities[EID]['overrides']==next(e['overrides'] for e in frozen['entities'] if e['entity_id']==EID)
    report['checks'].update(originalOpinionsAndLimitedRoutesPreserved=True,selectiveHotelFieldsOnly=True,
        existingGeographyCategoryAndScorePolicyPreserved=True)
    return report


runner.inputs,runner.apply_checked=inputs,apply_checked
if __name__=='__main__':
    try:
        asyncio.run(runner.main())
    except Exception as error:
        print(json.dumps({'failed':True,'errorType':type(error).__name__,'frames':[
            {'file':Path(f.filename).name,'line':f.lineno,'function':f.name}
            for f in traceback.extract_tb(error.__traceback__) if str(ROOT) in f.filename]},ensure_ascii=False))
        sys.exit(1)

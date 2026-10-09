"""生成可人工逐行核查的完整清单；完成状态必须与证据强度一致。"""
import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
NOTES = {
    '故宫博物院': '故宫与故宫博物馆为现有别名；角楼、御花园、门和藻井不能按子串归为同义名。3407为藻井名称，须辨认真实主体。',
    '天坛公园': '天坛为现有别名；祈年殿、东门、西门和摄影机位仍需保持粒度区别。',
    '景山公园': '明确缺陷、尚未修复：石景山公园不是全局同义名。第21批把504笔记中3148的一次误写纠正扩大成实体合并，新同名提及仍会误归景山；详见《景山误归并原因排查.md》。景山为正常别名。',
    '雍和宫': '与雍和宫大街、法物流通处及周边店铺有明确主体区别。',
    '颐和园': '1878/3295实际为冰场语境，本轮不治理活动或设施；其旧分数不能直接继承为景点推荐分。',
    '什刹海': '原来源混有后海、西海湿地；目前既未逐提及拆分，也不能把湖区子项统一当什刹海同义词。',
    '八达岭长城': '八达岭为现有别名；长城泛称、南线与活动不能都凭 normalized_name 自动认领。',
    '国家博物馆': '已合并中国国家博物馆/国博；4375为带抽取说明的装饰名称，需依据原文处理，不能把说明文字直接当正式别名。',
    '北海公园': '北海为现有别名；1883是冰场语境，活动不属于本轮写入范围。',
    '鼓楼': '鼓楼、钟楼、钟鼓楼组合及鼓楼大街须分别处理；源2419等仍需补查归属。',
    '圆明园': '圆明园遗址公园为现有别名；冰场、灯夜游、园门保持独立粒度。',
    '地坛公园': '地坛为现有别名；2875北京地坛公园的内容涉及书市，需区分景点和活动事实。',
    '南锣鼓巷': '与北锣鼓巷不同；两侧老胡同、鼓楼南锣鼓巷组合及主街记录需要界定范围。',
    '烟袋斜街': '现有主体为街道；同游的鼓楼、银锭桥不构成同义关系。',
    '杨梅竹斜街': '现有主体为街道；沿街书店、商户保持独立。',
    '前门大街': '前门泛称源895含片区和出行语境，不能直接整源归入前门大街。',
    '天安门广场': '第75批按用户明确决定将天安门合并为同一行程地点；两名与旧ID均指向本ID，32提及/82.09分。城楼、升降旗、安检口等仍独立，城楼周一闭馆未引入广场。此决定不等于所有提及的事实均已复核。',
    '慕田峪长城': '慕田峪为现有别名；与八达岭长城保持独立。',
    '北锣鼓巷': '与南锣鼓巷保持独立；南北锣鼓巷组合不是任一条街的别名。',
    '三里河公园': '三里河为现有别名，已合并两条来源；不等于三里河路钓鱼台银杏林。',
    '中山公园': '仅指本城实体；同名跨城公园不得互相归并。',
    '恭王府': '本批72已应用：新增恭王府博物馆同义名，2034提及现可解析；主ID不变，SQL、真实向量及隔离消费链路通过。',
    '人民大会堂': '建筑主体，与天安门广场、国博保持独立。',
    '银锭桥': '现有别名含金锭桥/银锭桥组合写法；此次保留历史结果，需人工重点核实是否把相邻桥混作同一主体。',
    '西兴隆街': '与草厂三条及组合线路有边界区别，不能按同游关系合并。',
    '五道营胡同': '第74批已将源2448五道营归入源725五道营胡同，旧实体ID重定向；13条提及来自12篇笔记，分数37。原market是同一胡同类型误分，未合并街内商店。',
    '国子监街': '街道与国子监建筑、孔庙和国子监博物馆不是同一粒度。',
    '国子监': '天安门合并后补入第30名；第76批将旧31.55分修正为9条已解析提及/8篇笔记的26.44分。孔庙国子监2557、北京孔庙国子监4985为组合名称，保持未归属，不注册同义名；与国子监街、孔庙独立。',
    '香山公园': '香山为现有别名；香山寺、双清别墅、碧云寺仍为不同主体。',
    '北京环球影城': '已有两源合并；第73批已将旧分16.5修正为实体重算26.94并核实落库。内部游乐项目不作为整个乐园的同义名。',
    '大明湖': '已有大明湖公园/景区归一；17条提及仍待审，超然楼保持独立。',
    '曲水亭街': '曲水亭为现有别名；10条提及仍待审，不能借附近店铺宣传确定地点事实。',
    '黑虎泉': '11条提及仍待审，泉池、护城河及环城公园需分别确认。',
    '解放阁': '1条提及仍待审；与黑虎泉同游不构成同一实体。',
    '泉城广场': '3条提及仍待审；广场和内部演出/音乐喷泉不直接互作同义名。',
    '五龙潭公园': '25条已确认，18条待审；旧五龙潭泛称ID已撤回，审核365未结，不能算整组完成。',
    '超然楼': '大明湖超然楼为现有别名；楼体独立于大明湖，亮灯活动不能另算景点或同义名。',
    '趵突泉公园': '22条已确认，38条待审；旧趵突泉泛称ID已撤回，审核364未结，主泉和公园范围仍需明确。',
    '山东博物馆': '山东省博物馆为现有别名；两源已归一，第73批推荐分已按当前实体提及重算并核实落库。',
    '融汇老商埠': '沿用旧归一；历史片区与现行商业街区需辨别，本轮应人工复核其是否符合“仅景点”范围。',
    '百花洲': '4条提及仍待审；不能根据与曲水亭街相邻直接合并。',
    '千佛山': '3条提及仍待审；寺庙、洞窟和山顶不作为整个山岳景区同义名。',
    '山东美术馆': '山东省美术馆为现有别名，与相邻山东博物馆保持独立。',
    '珍珠泉': '泉池与珍珠泉大院已区分；不把院落作为泉池同义名。',
    '洪家楼天主教堂': '洪家楼教堂为现有别名；裸名洪家楼仍可能指片区，不直接合并。',
    '王府池子': '与相邻腾蛟泉、起凤泉、刘氏泉保持不同主体。',
    '大观园': '现有文化类城市游览主体，商业属性需人工复核；错误点已清空，无有效坐标，行程可用性待解决。',
    '西更道街': '西更道为现有别名；不等于老舍主题墙等机位。',
    '明水古城': '整体古城实体，内部街区和活动不自动归为同义名。',
    '老舍故居': '沿用济南老舍纪念馆/老舍纪念馆别名；与西更道主题墙保持独立。',
    '腾蛟泉': '与周边其它泉池独立；原文合游时长不能变成单点时长。',
    '护城河': '河流与环城公园、沿岸泉池为不同粒度，不直接整体合并。',
    '刘氏泉': '仍有1条待分配提及；与相邻泉池保持独立。',
    '经三路': '道路整体与融汇老商埠商业街区、爱心红绿灯机位不直接合并。',
    '东更道': '两次提取来自同一篇note2574；当前评分按现有规则保留两mention，一篇笔记不等于两独立来源。',
    '珍池街': '与东更道、曲水亭、双忠祠街是不同街道；两条提及来自同一篇note2574。',
    '双忠祠街': '独立街道，不能因同一citywalk路线归并；两条提及来自同一篇note2574。',
    '西公界街': '独立街道；两条提及来自同一篇note2574。',
    '四窟万象': '原文描述千佛山内仿制石窟，保留独立主体；无有效坐标，需核实正式名称与地点。',
    '起凤泉': '与腾蛟泉、王府池子等独立；仅1篇笔记，处在7.5分并列边界。',
}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--ranking', required=True)
    parser.add_argument('--catalog', required=True)
    parser.add_argument('--retrieval', required=True)
    parser.add_argument('--flow', required=True)
    parser.add_argument('--ledger', required=True)
    args = parser.parse_args()
    ranking_path = ROOT / args.ranking
    ledger_path = ROOT / args.ledger
    assert not ledger_path.exists(), '审核工件不可覆盖'
    rank = json.loads(ranking_path.read_bytes())
    verification = json.loads((ROOT / args.catalog).read_bytes())
    assert verification['passed'] and verification['snapshotSha256'] == rank['snapshotSha256']
    retrieval = json.loads((ROOT / args.retrieval).read_bytes())
    assert retrieval['passed'] and retrieval['snapshotSha256'] == rank['snapshotSha256']
    parent = ROOT.parents[1] / '10-06-place-identity-governance/research/all-cities'
    flow = json.loads((parent / f'flow/{args.flow}/report.json').read_bytes())
    assert not flow['failures']
    for city in ['北京','济南']:
        coverage = next(c for c in flow['cities'] if c['city'] == city)['targetCoverage']
        assert coverage['requested'] == coverage['passed'] == 30
        assert coverage['snapshotSha256'] == rank['snapshotSha256']
    assert all(r['score'] == r['downstreamScore'] for c in rank['cities'] for r in c['top30'])
    score_ids = {d['entityId'] for d in json.loads((parent / 'batch-73-decisions.json').read_bytes())}
    score_ids.add('0854db5911778c6722637d896e9c2904')
    score_ids.discard('298e600416cbc4f85119932e8a3c966c')
    lines = ['# 北京、济南前30景点：首轮治理与人工审核清单', '',
        '**当前未达到“每城前30全部治理完成”。下表为当前已解析实体提及重算得到的60个候选，不能当作60个已完成结果。**', '',
        '本轮已实际应用第72—76批，涉及20个现行景点主实体、22条不同实体记录（多批重复变更只计一次）。最新变化：按用户决定将天安门归入天安门广场；重排后国子监补入第30名，修正其旧分数。原始记录保留。', '',
        '**用户指出的景山错误已确认：石景山公园被错误登记为全局别名，当前尚未修复。名单中保留实库值并明确标错，不能把它当作已确认同义名。**', '',
        '天安门合并的内容变化：原广场社区摘要被原天安门已审核网页简介及3条引文替换，逐字段等于原源690资料；广场主源1163没有网页简介。原4条社区看点保留在历史快照/审计及原始提及中，当前主简介不再展示。广场坐标、图片和所有原始来源保持。第75批证据中“原主源1163网页介绍继续优先”的表述不准确，以本次实测及followup-preservation-02为准。', '',
        '快照时间：' + rank['capturedAt'] + '；SHA256：`' + rank['snapshotSha256'] + '`。', '',
        '排序：推荐分降序 → 不同笔记数降序 → 稳定实体ID升序。公式：提及数×2 + recommend提及占比×5 + 不同笔记数×0.5。', '',
        '仅按唯一mention ID去重；重复提取产生的不同mention ID沿用现有公式计分。坐标缺失不会被偷偷从名单删除。', '',
        '60个入选实体的重算分均与实库一致。19个主实体具有显式recommendationIdentity分数绑定，避免重导入保留旧高分。25条潜在影响排名的记录仍须核查（含2个已撤回泛称，不是25个独立待治理景点）。', '',
        f'生产解析器{verification["totalChecks"]}项配置一致性检查通过，覆盖60行主名、现存别名、旧ID、跨城ID及错误名称+ID；60行实际SQL与真实向量参与的混合召回通过。{args.flow}明确覆盖两城各30个目标的候选、排程身份、保存、编辑去重与重访。现存别名能被解析不表示语义正确：景山另有独立负例复现错误。测试使用隔离库与空地图/搜索提供者，不等于真实路线地理可行性。', '',
        '实库1588条旧地点行、200个原图片字段及201条应用行程保持；1576条原始来源、3484条提及原指纹、470篇原笔记及503条既有逐提及分配保持。图片字段保全不等于图片治理完成。', '',
        '全城同步还使此前已安装的日期修复生效：962条记录的1345个旧看点日期，从旧导出时间恢复为来源笔记日期；每一项均按原sourceUrl和observed_at核对通过。包括非景点记录，未新增其身份治理；文字、引文及其它内容保持。重新导出另会刷新content.compiledAt，不能将全城同步描述为非目标记录完全零写入。', '',
        '前阶段8条分数不一致已在batch-73/sync-03修复；新补位国子监在retrieval-verification-03中发现旧分，已由batch-76修复。失败证据均保留。batch-75与76均完成真实导入预演、重复导入、逆序回滚、实库前后核对及向量同步。北京关系由141条变为140条、强关系36条保持；合并后无自环或悬空端点。', '']
    ledger = {'taskCompleted': False, 'userAcceptance': False, 'ranking': ranking_path.name,
              'newAppliedBatches': [72,73,74,75,76], 'scoreRepairSync': 'batch-76/sync-01',
              'knownIncorrectAliases': [{'name':'石景山公园','wrongTarget':'景山公园','fixed':False}],
              'newAppliedEntities': sorted(score_ids | {'c5250326550bc954a0a07f41679bf87f','fde55b90529621c6f3ba9a237046a7ee'}), 'rows': []}
    for city in rank['cities']:
        lines += ['## ' + city['city'], '', '| 名次 | 景点 | 重算分 / 下游分 | 现有别名 | 待归属提及 | 本轮状态 |',
                  '| --- | --- | --- | --- | --- | --- |']
        for row in city['top30']:
            state = ('72批别名已修复' if row['name'] == '恭王府' else
                     '明确错误别名；尚未修复' if row['name'] == '景山公园' else
                     '75批按用户决定合并' if row['name'] == '天安门广场' else
                     '76批补位分数已修正；组合边界待核' if row['name'] == '国子监' else
                     '74批两源已归并并重算分' if row['name'] == '五道营胡同' else
                     '73批分数已修正；语义待核' if row['entityId'] in score_ids else '目录与链路通过；语义待核')
            aliases = '、'.join(n+'（错误全局别名）' if row['name']=='景山公园' and n=='石景山公园' else n for n in row['aliases']) or '—'
            lines.append(f"| {row['rank']} | {row['name']} | {row['score']} / {row['downstreamScore']} | {aliases} | {len(row['uncertainMentionIds'])} | {state} |")
            ledger['rows'].append({**row, 'catalogChecksPassed': True, 'reviewNote': NOTES[row['name']],
                                   'humanReview': '未审', 'newAppliedThisRound': row['entityId'] in ledger['newAppliedEntities'],
                                   'sqlAndMixedVectorPassed':True,'isolatedFlowPassed':True,'scoreMatchesDatabase':True})
        lines += ['', '### 逐项核查要点与稳定ID', '']
        for row in city['top30']:
            lines += [f"{row['rank']}. **{row['name']}** — {NOTES[row['name']]}",
                      f"   - 实体ID：`{row['entityId']}`；版本{row['revision']}；原始来源ID：{', '.join(map(str, row['sourceIds']))}。",
                      f"   - 当前已解析：{row['mentionCount']}条提及 / {row['noteCount']}篇笔记；人工结论：未审。"]
        lines += ['', '### 第30名边界及榜外待查', '',
                  f"第30名重算分：{city['boundaryScore']}。同分的全部景点共{sum(r['score'] == city['boundaryScore'] for r in city['allAttractions'])}个；这是确定性排序结果，不表示第30名一定比同分对象更常用。", '',
                  '| 后续名次 | 景点 | 重算分 | 笔记数 |', '| --- | --- | --- | --- |']
        for row in city['allAttractions'][30:40]:
            lines.append(f"| {row['rank']} | {row['name']} | {row['score']} | {row['noteCount']} |")
        lines += ['', '| 潜在影响排名的对象 | 当前分 | 数学保守上界 | 未归属提及数 | 未结实体审核 |',
                  '| --- | --- | --- | --- | --- | --- |']
        for row in city['rankAffectingUncertainty']:
            lines.append(f"| {row['name']} | {row['score']} | {row['potentialScore']} | {len(row['uncertainMentionIds'])} | {','.join(map(str,row['pendingReviewIds'])) or '—'} |")
        lines += ['', '上界仅用于防止漏查，不是确认分数；其中冰场、升旗等活动不能因旧normalized_name指向公园就被分配给公园，也不属于本轮新增治理范围。', '']
    lines += ['## 仍须完成的工作', '',
        '1. 修复景山的错误全局别名；继续解决什刹海、钟鼓楼、银锭桥、前门、国子监、趵突泉/五龙潭等来源与组成边界。天安门/广场的行程粒度已由用户明确并完成合并，不再作为未决合并问题，详见《剩余阻塞项.md》。',
        '2. 部分原文只有泛称或组合写法，不能从邻近坐标或LLM抽取normalized_name反推唯一主体。保留原文待审不等于已解决归属，也不能自动按公园/景区补齐。',
        '3. 完成证据审核后重排补位；高分待审对象不能直接跳过后宣称真实前30全部完成。若用户调整收口为按已确认提及排名，须另记标准及排名不确定性。',
        '4. 大观园、四窟万象仍缺有效坐标；本轮身份链路通过不能证明实际导航与地理排程可用。',
        '5. 保持in_progress，完整名单交付人工核查；尚未达到原完成标准，不提交、不归档、不标记完成。', '',
        '人工反馈可以按“城市 + 景点 + 正确主名/应合并对象/应独立对象”给出，当前未审标记不表示已经判错。', '']
    (ROOT.parent / '人工审核名单.md').write_text('\n'.join(lines), encoding='utf-8', newline='\n')
    with ledger_path.open('x',encoding='utf-8') as f:
        json.dump(ledger,f,ensure_ascii=False,indent=2)
    assert len(ledger['rows']) == 60
    print(json.dumps({'rows': 60, 'completed': False, 'file': str(ROOT.parent / '人工审核名单.md')}, ensure_ascii=False))


if __name__ == '__main__':
    main()

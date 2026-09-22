// 调研、首次编排、局部修订与审校 prompt：步骤编号、工具纪律、token 节制（R2/R8）
import { LONG_HAUL_THRESHOLDS, type GenerateForm, type LegMode, type PoiCategory, type ResearchPoi, type TransportMode } from '@tripweaver/shared';
import type { LongHaulPoi } from './longHaul';
import type { RetrievedPlace } from './retrieveContext';

const TRANSPORT_LABEL: Record<TransportMode, string> = { transit: '公共交通', drive: '自驾', walk: '步行优先' };

export function formBrief(form: GenerateForm): string {
  const prefs = form.preferences?.length ? form.preferences.join('、') : '无特别偏好';
  return [
    `目的地：${form.destination}｜天数：${form.days} 天｜出发日期：${form.startDate || '未定'}`,
    `人数：${form.partySize} 人｜偏好：${prefs}`,
    `出行方式：${TRANSPORT_LABEL[form.transportMode ?? 'transit']}｜住宿位置：${form.lodging?.trim() || '未指定（请建议一个区域）'}`,
    form.extraNotes ? `补充要求：${form.extraNotes}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export const RESEARCH_SYSTEM_PROMPT = `你是旅行调研员，任务是以自有已验证地点库为主力信息源，为一次行程搜集真实地点与情报，产出结构化候选池。

可用工具：
- search_verified_places(keyword)：查社区已验证地点库（含避坑/预约/价格情报）——本阶段的主力信息源，命中的地点可信度高，优先 add_candidate；换不同关键词多查几次
- search_pois(category, keyword)：搜真实地点（attraction 景点 / food 美食 / hotel 住宿）——用来补地点事实（坐标/地址/图片），不做攻略情报；餐饮结果只用于识别片区、菜系与候选，不提供可承诺的实时价格/评分/排队信息
- search_web(query)：全网搜攻略（玩法、避雷、是否需要预约）——**降级兜底工具**，知识库覆盖不足时才用
- add_candidate(...)：把筛选后的地点写入候选池（前端会展示成卡片）
- submit_research(summary)：提交摘要并结束调研

工作流程（严格按顺序）：
0. 主力步骤：用 search_verified_places 查社区已验证地点库。按行程主题/偏好换不同关键词检索 3~6 次（如「城市名+夜景」「亲子」「必吃」「避坑」），命中的地点优先 add_candidate。
1. 补知识库没覆盖的地点：用 search_pois 按类目搜真实地点（景点 2~3 次、美食 1~2 次、住宿 1 次，全阶段 ≤8 次）。它给的是地点事实（地址/评分/封面图），不提供攻略情报；知识库候选已有坐标，**不必为了坐标反复调它**，只为拿封面图时才按同名补搜一次。
2. 降级兜底：**仅当**知识库连续两次以上无命中、或候选明显凑不齐时，才用 search_web 查攻略与预约政策（如「景点名 门票 预约」），全阶段最多 2 次。知识库能覆盖时一次都不要调。
3. 边调研边 add_candidate 写入候选（可在一条消息里并行发多个）。数量指引（按天数伸缩）：景点 8~12 个、美食 4~8 个、住宿 2~4 个；≤2 天取下限。
4. 全部写完后调用 submit_research，随后立即停止。

add_candidate 撰写规范：
- intro ≤120 字：一句话讲清「是什么 + 为什么值得去」，可综合搜索摘要与你自己的知识，不要罗列营业时间/评分等原始字段
- 已验证库命中的地点，其避坑/预约/价格情报可作为 intro/reservation/reservationNote 的素材，但仍需遵守字数与措辞规范
- coverUrl 只能用 search_pois 返回的图片链接，没有就不填；禁止编造
- reservation 三态：搜索结果中有官方/权威渠道明确说要预约 → required（reservationNote 写清渠道与提前天数）；明确说无需预约/现场购票 → none；没查到或拿不准 → unknown（宁可 unknown，不要猜）
- sourceLinks 只能用工具返回中出现过的 url（≤3 条），禁止编造
- 美食结果只作为片区、菜系和可替换门店候选；评分、人均、营业与排队均是动态信息，不得写成稳定事实，提醒用户到大众点评/美团确认

摘要要求（500 字以内）：行程节奏与路线建议（哪些地点相邻、适合同一天）、整体避雷提示；候选明细不必重复。
若数据源不可用或持续无结果，直接基于你自己的知识 add_candidate（coverUrl 留空、reservation 填 unknown），并在摘要开头注明「（部分/全部来自模型知识）」。`;

/** 餐次要求的两种措辞：仅当用户偏好含「美食」时才强制每天午晚餐（09-21 决策 D3/D6） */
const MEAL_REQUIREMENTS = {
  focused:
    '- 每天必须同时包含午餐与晚餐：午餐建议 11:00-14:30，晚餐建议 17:00-21:30，category 均为「美食」；名称使用「午餐/晚餐｜片区 · 菜系或代表菜」，不要把某一家餐厅设为不可替换的硬依赖\n- 餐饮 description 必须说明就餐片区、当地菜系或代表菜，并提醒“具体门店、价格、评价、营业与排队情况请到大众点评或美团确认”；不得编造实时评分、价格、营业或排队信息',
  free:
    '- 本次非美食导向：**不要求**安排午餐与晚餐，行程可以是纯景点/体验安排。仅当某段路线确实顺路适合作中途休息时才安排餐饮，不要为了凑餐次单独插入就餐活动\n- 若安排了餐饮：description 必须说明就餐片区、当地菜系或代表菜，并提醒“具体门店、价格、评价、营业与排队情况请到大众点评或美团确认”；不得编造实时评分、价格、营业或排队信息',
} as const;

function activityRequirements(foodFocused: boolean): string {
  return `活动要求：
- 优先从候选池选点；采用候选中的实际地点时填写对应 poiId，定位名与候选名称保持一致。餐次按就餐片区定位，不要用某家餐厅的 poiId 代指整个片区；候选不足或不合需求时可用你自己的知识补充
- placeName 只填写真实地点或片区名称，与展示 name 分开；如 name="午餐｜春熙路 · 川菜" 时 placeName="春熙路"。不得把菜系、餐次标签或整句建议当定位地名
- startTime/endTime 用 24 小时制（如 "09:00"），同一天内不得重叠，顺序合理（上午→下午→晚上）；相邻活动间要留出足够的通勤时间，避免「上一个刚结束下一个已开始」
- description ≤100 字，说明亮点与实用提示；候选标注「需预约」的活动，务必在 description 提醒提前预约
- category 从：美食/文化/自然/购物/住宿/交通/娱乐/其他 中选
- 本次餐次纪律：${MEAL_REQUIREMENTS[foodFocused ? 'focused' : 'free']}
- 来自候选池且候选带来源链接的活动，把该链接填入 sourceNotes（title + url）；禁止编造 url
- 相邻活动地理上应顺路，减少折返；单日不要塞太满（活动占用 + 通勤 ≤14 小时，否则一定排不下）
- 长途点纪律：用户需求若附带「长途点情报」（系统按坐标确定性算出，比语感可靠），必须遵守——【强独占级】地点独占一天，当天只排该点及同方向顺路的活动，往返通勤计入当天时间预算；【长途级】地点当天按同方向顺路组织，勿与反方向活动混排`;
}

export function plannerSystemPrompt(foodFocused: boolean): string {
  return `你是行程规划师，根据用户需求、候选池和调研摘要制定逐日行程草稿。

工作流程（严格按顺序）：
1. 调用 set_trip_skeleton：起一个吸引人的行程标题，并为每一天定一个主题短语。
2. 逐天调用 add_activity 填充活动，每天 4~6 个（${foodFocused ? '必须同时包含午餐与晚餐' : '以景点/体验为主'}），可在一条消息里并行发出多个工具调用以提高效率。
3. 坐标不需要逐个查询：系统会在规划阶段结束后统一解析全部活动坐标。仅当某个地点名称易混淆、你没把握时才调用 geocode_place 消歧，把返回坐标填入对应活动；其余活动坐标留空即可，禁止编造坐标。
4. 住宿（可选）：若用户需求中「住宿位置」为未指定，可以调用一次 set_lodging 建议一个**区域**（如「西湖景区周边」「新宿站附近」），只给区域名称——严禁推荐具体酒店、民宿或任何价格；用户已指定则不要调用。这是可选建议，不是必须完成的步骤。
5. 提交前调用 check_feasibility 自查时空可行性：**硬性问题**（通勤排不下、单日严重过载）必须修正才能提交；**可优化提示**（步行偏多、节奏偏赶、路线回折）尽量改善但不强制——同一项最多调整一次，随后必须提交，不要反复微调。留空坐标的活动待系统解析后才能算准，自查以已填信息为准。
6. 全部填完后调用 submit_plan 校验；若返回完整性或可行性硬性问题清单，逐条修正后重新提交，直到通过。

${activityRequirements(foodFocused)}`;
}

export function plannerRevisionSystemPrompt(foodFocused: boolean): string {
  return `你是行程规划师，当前执行局部修订：在已有草稿基础上处理审校要求。

工作流程：
1. userPrompt 已提供当前草稿与活动 ID，先定位审校指出的问题天和活动；需要更新视图时调用 get_draft。
2. 用 update_activity 修改时间、描述或地点；跨天调整用 move_activity，保留已有活动 ID。仅在确有缺项或重复时调用 add_activity / remove_activity。
3. 保留未受影响的天、活动、住宿和已解析地点，禁止清空草稿、重建骨架或把整程删除后重建。修改地点时同时更新 placeName / poiId；只改时间时不要重填地点或坐标。
4. 检查${foodFocused ? '每日餐次、' : ''}通勤间隔和长途点纪律后调用 submit_plan。失败时按返回的问题继续局部修复。

${activityRequirements(foodFocused)}`;
}

export function reviewerSystemPrompt(foodFocused: boolean): string {
  return `你是行程审校员，负责把关行程草稿的质量，然后给出结论。

工作流程（严格按顺序）：
1. 调用 get_draft 查看草稿全貌。
2. 参考 userPrompt 附带的「可行性引擎报告」：这是系统用代码逐日推演真实时间线算出的结构性问题（坐标/通勤已解析），比你的语感更可靠。硬性问题（通勤排不下、单日过载）优先处理；可优化提示（步行多、节奏赶、回折）酌情。
3. 再检查：天数与节奏、时间是否冲突或过满、${foodFocused ? '每天是否同时有午餐和晚餐、' : ''}餐饮是否按片区/菜系表达且提示外部平台确认、描述质量（坐标由系统统一解析，无需关注）。
4. 小问题（≤5 处，如时间微调、描述空洞）直接用 update_activity / remove_activity 修正${foodFocused ? '；不得删除某天仅有的午餐或晚餐' : ''}。
5. 结构性问题（某天需要重排、活动方向完全不符偏好、可行性硬性问题无法就地小修）写入 revisionRequests，交回规划师在已有草稿上局部调整。
6. 最后调用 submit_review 收尾：
   - 无结构性问题 → approved: true，notes 里给 ≤3 条改进建议（可把可行性报告里的可优化提示转述给用户，可为空）
   - 有结构性问题 → approved: false，revisionRequests 列出具体要求（每条一句话）
提交 submit_review 后立即停止。不要重建骨架，不要大规模增删活动。`;
}

/** 文案撰写阶段（第二期 D4）：结构/顺序/时间已由确定性排程定下，本阶段只改 description。 */
export const WRITER_SYSTEM_PROMPT = `你是行程文案撰写员。行程的天数、顺序、时间与地点由系统按知识库确定性排定，你只负责写说明文案。

工作流程（严格按顺序）：
1. 调用 get_draft 查看每天的活动列表；description 里是候选简介或待补写的占位。
2. 逐个用 update_description 改写说明（≤100 字）：讲清「是什么 + 为什么值得去 + 一条实用提示」。每天都要覆盖到，不要漏；可在一条消息里并行发多个 update_description，不要一个一个慢慢来。
3. 全部写完后调用 submit_review 收尾（approved: true；notes 可留空，或写 ≤3 条给用户的实用建议）。

硬约束：
- 只能使用草稿里已有的名称与说明素材，不得编造门票价格、评分、营业时间、排队或预约信息；需要预约的活动只提醒「提前预约」，不要写具体规则
- 不得新增、删除、移动任何活动，也不要改时间或名称——你调不到那些工具
- 文案属增强路径：部分活动没写完也算合格，但仍应尽量覆盖全部活动（系统会按已写内容落库）
- 餐饮活动说明就餐片区或菜系，并提醒「具体门店、价格、评价、营业与排队情况请到大众点评或美团确认」`;

/** 文案阶段的 user prompt：只给需求与排好的草稿，不给可行性报告（结构不归它管，给了只会诱发无效推理） */
export function writerUserPrompt(form: GenerateForm, draftRender: string): string {
  return [
    `用户需求：\n${formBrief(form)}`,
    `当前草稿（天数/顺序/时间已由系统确定性排定，你只改 description，不要动结构）：\n${draftRender}`,
  ].join('\n\n');
}

const CATEGORY_LABEL: Record<PoiCategory, string> = { attraction: '景点', food: '美食', hotel: '住宿' };
const RESERVATION_MARK = { required: '【需预约】', none: '', unknown: '【预约情况未知】' } as const;
const LEG_MODE_LABEL: Record<LegMode, string> = { transit: '公交', drive: '驾车', walk: '步行', cycle: '骑行' };
const TIER_MARK = { exclusive: '【强独占级】', longHaul: '【长途级】' } as const;

/** 候选池紧凑索引：给编排 Agent 的引用视图（含首条来源链接，供回填 sourceNotes） */
export function renderPoolIndex(pool: ResearchPoi[]): string {
  if (!pool.length) return '';
  const lines = pool.map((p) => {
    const src = p.sourceLinks[0];
    return [
      `- ${p.name}｜poiId=${p.id}｜${CATEGORY_LABEL[p.category]}${RESERVATION_MARK[p.reservation]}`,
      p.intro,
      src ? `来源：${src.title} ${src.url}` : '',
    ]
      .filter(Boolean)
      .join('｜');
  });
  return lines.join('\n');
}

/** 长途点情报段落（层2 编排预防）：确定性预计算的标级结果 + 独占日硬规则。
 *  无长途点时返回空串、规划 user prompt 逐字保持原样（金集 walk/drive 短途类 case 即此形态），压回归风险 */
export function renderLongHaulIntel(intel: LongHaulPoi[], mode: LegMode): string {
  if (!intel.length) return '';
  const lines = intel.map((p) => `- ${p.name}：距市区 POI 主体估算${LEG_MODE_LABEL[mode]}单程约 ${p.durationMin} 分钟${TIER_MARK[p.tier]}`);
  return [
    '长途点情报（系统按坐标确定性计算，务必遵守）：',
    ...lines,
    `规则：安排【强独占级】地点的那天必须为其独占——当天只排该点及其同方向顺路的活动（多个同方向长途点可同日顺路组织），返程后至多在住宿附近加一个轻量活动，且须为往返通勤预留充足时间；【长途级】（单程约 ${LONG_HAUL_THRESHOLDS.longHaulMin}-${LONG_HAUL_THRESHOLDS.exclusiveMin} 分钟）地点当天的活动须按同方向顺路组织，不与反方向活动混排。`,
  ].join('\n');
}

export function plannerUserPrompt(
  form: GenerateForm,
  research: { summary: string; pool: ResearchPoi[] },
  revisionRequests: string[] = [],
  longHaulIntel: LongHaulPoi[] = [],
  currentDraft?: string,
  ragContext?: RetrievedPlace[],
): string {
  const parts = [`用户需求：\n${formBrief(form)}`];
  const poolIndex = renderPoolIndex(research.pool);
  if (poolIndex) parts.push(`候选池（优先从中选点，名称保持一致）：\n${poolIndex}`);
  // 长途点情报（层2）：修订轮与首轮共用本构造，情报在每一轮规划中都可见
  const intel = renderLongHaulIntel(longHaulIntel, form.transportMode ?? 'transit');
  if (intel) parts.push(intel);
  // 已验证地点情报（RAG 检索）：ragContext 为空时不出现，保护金集可复现性
  const rag = renderRagContext(ragContext);
  if (rag) parts.push(rag);
  parts.push(`调研摘要：\n${research.summary || '（无调研数据，请基于你自己的知识规划）'}`);
  if (currentDraft) parts.push(`当前草稿（保留已有活动 ID，按下列实际状态局部修改）：\n${currentDraft}`);
  if (revisionRequests.length) {
    parts.push(`审校员的修订要求（在现有草稿基础上修改，勿推倒重来）：\n${revisionRequests.map((r, i) => `${i + 1}. ${r}`).join('\n')}`);
  }
  return parts.join('\n\n');
}

/** 已验证地点情报段落（RAG 检索）：每个 place 一行，evidence 每条 ≤80 字截断，
 *  整体小节 ≤1200 字截断（防 prompt 膨胀）。空数组/undefined 返回空串（旧行为逐字不变）。
 *  情报为参考依据（预约/避坑优先），非强制约束——对齐「可信规划器」定位。 */
const EVIDENCE_KIND_LABEL: Record<string, string> = {
  xhs_warning: '避坑',
  xhs_reservation: '预约',
  xhs_price: '价格',
  xhs_reason: '口碑',
};
/** 证据强度标签（09-21）：措辞按强度封顶，对齐 Yuntu 证据授权分级 */
const EVIDENCE_STRENGTH_LABEL: Record<string, string> = {
  direct: '实证',
  risk_only: '仅风险',
  weak: '体验',
};

function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max) + '…';
}

export function renderRagContext(ragContext?: RetrievedPlace[]): string {
  if (!ragContext?.length) return '';
  const lines: string[] = [];
  for (const place of ragContext) {
    const evidence = place.evidence
      .map((e) => `${EVIDENCE_KIND_LABEL[e.kind] ?? e.kind}·${EVIDENCE_STRENGTH_LABEL[e.strength] ?? '体验'}：${truncate(e.content, 80)}`)
      .join('；');
    lines.push(`- ${place.name}（${place.category}）：${evidence}`);
  }
  const body = lines.join('\n');
  const truncated = body.length > 1200 ? body.slice(0, 1200) + '\n…（更多情报略）' : body;
  return [
    '已验证地点情报（社区已验证，可作预约/避坑依据，优先级高于你的记忆；供参考，勿当强制约束写进行程）：',
    '措辞按情报强度封顶：「实证」可当事实陈述（价格类须提「以实际为准」）；「体验」只是网友主观感受，只能用「整体/相对/适合/可以」等弱表达，不得写成确定事实；「仅风险」只能写成条件性提醒（如「旺季可能排队，建议早到」），不得当成必然发生。',
    truncated,
  ].join('\n');
}

export function reviewerUserPrompt(form: GenerateForm, round: number, feasibilityReport?: string): string {
  const parts = [
    formBrief(form),
    `这是第 ${round} 轮审校${round > 1 ? '（上一轮的修订要求已交规划师处理，请复核）' : ''}。请开始。`,
  ];
  // 可行性引擎（M0-A）：代码算出的时空违规清单，作为审校结构性判断的弹药（不再纯语感）
  if (feasibilityReport) {
    parts.push(`可行性引擎报告（代码逐日推演所得，坐标/通勤已解析）：\n${feasibilityReport}`);
  }
  return parts.join('\n\n');
}

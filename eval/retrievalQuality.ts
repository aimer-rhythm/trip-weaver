// 检索质量的纯函数层：字面层覆盖面与召回指标。
// 口径与 .trellis/tasks/10-11-retrieval-quality-baseline/research/retrieval-baseline-findings.md 一致。
// 不连接数据库、不做外部调用：调用方负责取数与执行真实检索，这里只做可单测的统计。

export interface PlaceCoverageRow {
  id: string;
  city: string;
  name: string;
  category: string;
  source: string;
  /** 只保留统计所需字段（aliases / themes），不搬运 content 等大字段。 */
  payload: Record<string, unknown> | null;
  /** 是否存在 research_evidence 行；对应检索的第二跳。 */
  hasEvidence: boolean;
}

export interface RecallCase {
  city: string;
  query: string;
  /** 目标地点在本轮结果里的期望行 ID。 */
  expectId: string;
  expectName: string;
  /** 每个返回实体的成员行 ID 集合，按检索排序；合并实体时成员 ID 都在这里。 */
  hitGroups: readonly (readonly string[])[];
  /** 与 hitGroups 同序的展示名，供人工核对未命中原因。 */
  actualNames: readonly string[];
}

export interface CityCoverage {
  city: string;
  total: number;
  withRealAlias: number;
  withThemes: number;
  withEvidence: number;
}

export interface LiteralCoverage {
  total: number;
  withRealAlias: number;
  withThemes: number;
  withEvidence: number;
  duplicateNameGroups: number;
  duplicateNameRows: number;
  byCity: CityCoverage[];
  method: string;
}

export interface RecallMetrics {
  total: number;
  depth: number;
  at1: number;
  atDepth: number;
  byCity: Array<{ city: string; total: number; at1: number; atDepth: number }>;
  misses: Array<{ city: string; query: string; expectName: string; actualNames: string[] }>;
  method: string;
}

export interface RetrievalQualityReport {
  coverage: LiteralCoverage;
  recall: RecallMetrics;
}

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

const payloadOf = (row: PlaceCoverageRow): Record<string, unknown> => row.payload ?? {};

/**
 * 真别名 = `payload.aliases` 中还有 trim 后不等于主名的写法。
 * 只填充主名本身的 aliases 数组是空覆盖，不能算作别名覆盖率。
 */
export function realAliases(row: PlaceCoverageRow): string[] {
  const name = row.name.trim();
  return strings(payloadOf(row).aliases).filter((alias) => {
    const value = alias.trim();
    return value !== '' && value !== name;
  });
}

export function literalCoverage(rows: readonly PlaceCoverageRow[]): LiteralCoverage {
  const cities = new Map<string, CityCoverage>();
  const nameCounts = new Map<string, number>();
  let withRealAlias = 0;
  let withThemes = 0;
  let withEvidence = 0;
  for (const row of rows) {
    const alias = realAliases(row).length > 0;
    const theme = strings(payloadOf(row).themes).length > 0;
    if (alias) withRealAlias += 1;
    if (theme) withThemes += 1;
    if (row.hasEvidence) withEvidence += 1;
    const nameKey = `${row.city}\u0000${row.name.trim()}`;
    nameCounts.set(nameKey, (nameCounts.get(nameKey) ?? 0) + 1);
    const city = cities.get(row.city) ?? { city: row.city, total: 0, withRealAlias: 0, withThemes: 0, withEvidence: 0 };
    city.total += 1;
    if (alias) city.withRealAlias += 1;
    if (theme) city.withThemes += 1;
    if (row.hasEvidence) city.withEvidence += 1;
    cities.set(row.city, city);
  }
  const duplicates = [...nameCounts.values()].filter((count) => count > 1);
  return {
    total: rows.length,
    withRealAlias,
    withThemes,
    withEvidence,
    duplicateNameGroups: duplicates.length,
    duplicateNameRows: duplicates.reduce((sum, count) => sum + count, 0),
    byCity: [...cities.values()].sort((a, b) => b.total - a.total || a.city.localeCompare(b.city, 'zh-CN')),
    method: '真别名 = payload.aliases 中存在 trim 后不等于主名的元素，只填充主名的数组不计入。证据覆盖指该地点存在 research_evidence 行，'
      + '即检索第二跳有资料可取，不代表资料质量或事实正确性。同城同名按 (city, name) 精确分组，不做归一化。',
  };
}

/**
 * 召回指标。分母是实际执行的 query 数，不是抽样行数 —— 把未参与检索的样本算进分母会得出假指标。
 * 命中判定用返回实体的成员 ID 集合包含目标行 ID；rank 为实体在结果中的下标。
 */
export function recallMetrics(cases: readonly RecallCase[], depth = 8): RecallMetrics {
  let at1 = 0;
  let atDepth = 0;
  const cities = new Map<string, { city: string; total: number; at1: number; atDepth: number }>();
  const misses: RecallMetrics['misses'] = [];
  for (const item of cases) {
    const rank = item.hitGroups.findIndex((group) => group.includes(item.expectId));
    const hit = rank >= 0 && rank < depth;
    if (rank === 0) at1 += 1;
    if (hit) atDepth += 1;
    else misses.push({ city: item.city, query: item.query, expectName: item.expectName, actualNames: [...item.actualNames] });
    const city = cities.get(item.city) ?? { city: item.city, total: 0, at1: 0, atDepth: 0 };
    city.total += 1;
    if (rank === 0) city.at1 += 1;
    if (hit) city.atDepth += 1;
    cities.set(item.city, city);
  }
  return {
    total: cases.length,
    depth,
    at1,
    atDepth,
    byCity: [...cities.values()].sort((a, b) => b.total - a.total || a.city.localeCompare(b.city, 'zh-CN')),
    misses,
    method: `命中判定为返回实体的规范实体 ID（canonicalPlaceId，合并实体共享）包含目标规范 ID；排位取实体在 limit=${depth} 结果中的下标。`
      + '分母是实际执行的 query 数，未参与检索的样本不计入。这是字面层（vector 关闭）结果，不代表语义召回能力。',
  };
}

export function retrievalQualityReport(rows: readonly PlaceCoverageRow[], cases: readonly RecallCase[], depth = 8): RetrievalQualityReport {
  return { coverage: literalCoverage(rows), recall: recallMetrics(cases, depth) };
}

/** 人读摘要。未命中清单只列前 limit 条，完整清单在 JSON 报告里。 */
export function renderRetrievalQuality(report: RetrievalQualityReport, missLimit = 10): string {
  const percent = (part: number, whole: number) => (whole ? `${((part / whole) * 100).toFixed(1)}%` : '—');
  const { coverage, recall } = report;
  const lines = [
    `字面层覆盖（${coverage.total} active verified places）`,
    `  真别名        ${String(coverage.withRealAlias).padStart(5)}  ${percent(coverage.withRealAlias, coverage.total)}`,
    `  主题标签      ${String(coverage.withThemes).padStart(5)}  ${percent(coverage.withThemes, coverage.total)}`,
    `  证据覆盖      ${String(coverage.withEvidence).padStart(5)}  ${percent(coverage.withEvidence, coverage.total)}`,
    `  同城同名冲突  ${String(coverage.duplicateNameGroups).padStart(5)} 组 / ${coverage.duplicateNameRows} 行`,
    '',
    `召回（字面层，vector 关闭；${recall.total} 条 query）`,
    `  Recall@1      ${percent(recall.at1, recall.total)}`,
    `  Recall@${recall.depth}      ${percent(recall.atDepth, recall.total)}`,
  ];
  for (const city of recall.byCity) lines.push(`    ${city.city}\t${city.at1}/${city.total} @1\t${city.atDepth}/${city.total} @${recall.depth}`);
  if (recall.misses.length) {
    lines.push('', `未命中 ${recall.misses.length} 条${recall.misses.length > missLimit ? `（只列前 ${missLimit} 条）` : ''}`);
    for (const miss of recall.misses.slice(0, missLimit)) {
      lines.push(`  ${miss.city} 「${miss.query}」→ 期望「${miss.expectName}」，实得 ${miss.actualNames.join(' / ') || '(空)'}`);
    }
  }
  return lines.join('\n');
}

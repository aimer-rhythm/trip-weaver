// 知识库可用于「确定性排程」的形状盘点：类目分布 / 语料 kind 分布 / 是否有停留时长信号
// 决定 plan 阶段能否靠代码排程（需要：类目粒度 + 停留时长 + 坐标覆盖率）
// 用法（apps/server 目录）：npx tsx test-kb-shape.mts
import 'dotenv/config';
import { pool } from './src/db/client';

const q = async (label: string, sql: string) => {
  const { rows } = await pool.query<Record<string, unknown>>(sql);
  console.log(`\n--- ${label} ---`);
  for (const row of rows) console.log('  ' + JSON.stringify(row));
};

await q(
  'canonical_places 类目分布（category 是自由文本，可能比 3 类更细）',
  `SELECT coalesce(nullif(category, ''), '(空)') AS cat, count(*)::int AS n,
          count(*) FILTER (WHERE lat IS NOT NULL AND lng IS NOT NULL)::int AS with_coord
   FROM canonical_places GROUP BY 1 ORDER BY n DESC LIMIT 25`,
);
await q(
  'canonical_places 城市覆盖（前 15）',
  `SELECT city, count(*)::int AS n FROM canonical_places GROUP BY 1 ORDER BY n DESC LIMIT 15`,
);
await q(
  'research_evidence kind 分布（现有的语料种类）',
  `SELECT kind, count(*)::int AS n FROM research_evidence GROUP BY 1 ORDER BY n DESC LIMIT 25`,
);
await q(
  'research_evidence 里有无停留时长信号（含「小时/分钟/半天」等表述）',
  `SELECT kind, count(*)::int AS n FROM research_evidence
   WHERE content ~ '(小时|分钟|半天|h|min)' GROUP BY 1 ORDER BY n DESC LIMIT 10`,
);
await q(
  'payload 里出现过的 key（看上游是否已存 duration/order 类字段）',
  `SELECT k, count(*)::int AS n
   FROM canonical_places, jsonb_object_keys(coalesce(payload, '{}'::jsonb)) AS k
   GROUP BY 1 ORDER BY n DESC LIMIT 30`,
);
await q(
  'research_evidence 全部列（确认是否只有 kind/content/source_url）',
  `SELECT column_name, data_type FROM information_schema.columns
   WHERE table_name = 'research_evidence' ORDER BY ordinal_position`,
);
await q(
  'payload.xhsPlaceType 分布（上游的细粒度地点类型）',
  `SELECT payload->>'xhsPlaceType' AS ptype, count(*)::int AS n
   FROM canonical_places WHERE payload ? 'xhsPlaceType' GROUP BY 1 ORDER BY n DESC LIMIT 30`,
);
await q(
  'payload.typicalVisitMinutes 覆盖与分布（排程需要的停留时长）',
  `SELECT (payload->>'typicalVisitMinutes') AS minutes, count(*)::int AS n,
          count(DISTINCT city)::int AS cities
   FROM canonical_places WHERE payload ? 'typicalVisitMinutes' GROUP BY 1 ORDER BY n DESC LIMIT 25`,
);
await q(
  '有停留时长的地点，按 category 分布',
  `SELECT coalesce(nullif(category,''),'(空)') AS cat, count(*)::int AS n
   FROM canonical_places WHERE payload ? 'typicalVisitMinutes' GROUP BY 1 ORDER BY n DESC`,
);
await q(
  '北京可用素材：文化/自然类且有坐标、有 recommendScore 的数量',
  `SELECT count(*)::int AS total,
          count(*) FILTER (WHERE payload ? 'typicalVisitMinutes')::int AS with_duration,
          count(*) FILTER (WHERE payload ? 'themes')::int AS with_themes
   FROM canonical_places WHERE city = '北京' AND lat IS NOT NULL`,
);

await pool.end();

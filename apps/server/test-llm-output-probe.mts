// 输出 token 去向排查：单轮的 output token 里，隐藏推理(thinking) / 工具参数(toolCall) / 可见文本 各占多少
// 两个查询都做服务端聚合，只回传长度——远端 Neon 拉 jsonb 全量极慢
// 用法（apps/server 目录）：npx tsx test-llm-output-probe.mts
import 'dotenv/config';
import { pool } from './src/db/client';

// ① 最近两次 job 的单轮用量总览（服务端只算长度）
const summary = await pool.query<{
  job_id: string; phase: string; turn: number; stop: string | null;
  out_tok: number | null; chars: number; msg_chars: number;
}>(`
  SELECT job_id, phase, turn,
         response->>'stopReason'                 AS stop,
         (response->'usage'->>'output')::int     AS out_tok,
         coalesce(length(response->>'text'), 0)  AS chars,
         length(messages::text)                  AS msg_chars
  FROM llm_request_logs
  ORDER BY created_at DESC
  LIMIT 60
`);

const byJob = new Map<string, typeof summary.rows>();
for (const r of summary.rows) {
  const list = byJob.get(r.job_id) ?? [];
  list.push(r);
  byJob.set(r.job_id, list);
}

for (const [jobId, list] of [...byJob.entries()].slice(0, 2)) {
  console.log(`\n===== job ${jobId.slice(0, 8)}｜${list.length} 条请求 =====`);
  console.log('phase    turn   out_tok  可见文本字符  输入msg字符  stop');
  for (const r of list.reverse()) {
    console.log(
      `${r.phase.padEnd(8)}${String(r.turn).padStart(4)}${String(r.out_tok ?? 0).padStart(9)}` +
        `${String(r.chars).padStart(13)}${String(r.msg_chars).padStart(13)}  ${r.stop ?? '无'}`,
    );
  }
}

// ② 最新一条 plan 请求携带的 assistant 历史：按 content part 类型拆字符数
const detail = await pool.query<{ job_id: string; turn: number; messages: unknown[] }>(`
  SELECT job_id, turn, messages
  FROM llm_request_logs
  WHERE phase = 'plan' AND turn >= 2
  ORDER BY created_at DESC
  LIMIT 1
`);

const row = detail.rows[0];
if (row) {
  console.log(`\n===== job ${row.job_id.slice(0, 8)} turn${row.turn} 的 assistant 历史（按 part 类型拆字符）=====`);
  const msgs = row.messages as Record<string, unknown>[];
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i] as { role?: string; content?: unknown };
    if (m.role !== 'assistant' || !Array.isArray(m.content)) continue;
    const byType = new Map<string, number>();
    for (const p of m.content as Record<string, unknown>[]) {
      const t = String(p.type ?? '?');
      byType.set(t, (byType.get(t) ?? 0) + (JSON.stringify(p)?.length ?? 0));
    }
    const toolCount = (m.content as Record<string, unknown>[]).filter((p) => p.type === 'toolCall').length;
    console.log(
      `  msg[${String(i).padStart(3)}] parts=${(m.content as unknown[]).length} toolCalls=${toolCount}  ` +
        [...byType.entries()].map(([t, n]) => `${t}:${n}`).join('  '),
    );
  }
}
await pool.end();

// 验证 llm_request_logs 落库情况
import 'dotenv/config';
import { db } from './src/db/client';
import { llmRequestLogs } from './src/db/schema';
import { desc } from 'drizzle-orm';

const rows = await db.select().from(llmRequestLogs).orderBy(desc(llmRequestLogs.createdAt)).limit(40);
const groups = new Map<string, typeof rows>();
for (const r of rows) {
  const k = `${r.phase}/round${r.round}`;
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k)!.push(r);
}
console.log(`共查到 ${rows.length} 行（最近 40 条）\n`);
for (const [k, rs] of groups) {
  const turns = rs.map((r) => r.turn).sort((a, b) => a - b);
  const last = rs.find((r) => r.turn === Math.max(...turns))!;
  const msgs = last.messages as unknown[];
  const tools = last.tools as unknown[];
  const resp = last.response as { stopReason?: string; usage?: { input: number; output: number } } | null;
  console.log(
    `${k}: turns=${turns.join(',')}｜最后 turn messages=${msgs.length} 条 tools=${tools.length} 个` +
      `｜response: stopReason=${resp?.stopReason ?? '无'} usage=${resp?.usage ? `${resp.usage.input}/${resp.usage.output}` : '无'}`,
  );
}
const sample = rows.find((r) => r.turn === 1 && r.phase === 'research');
if (sample) {
  console.log(`\n样例（research turn1）: system_prompt ${sample.systemPrompt.length} 字，首条消息：`);
  console.log(JSON.stringify((sample.messages as unknown[])[0]).slice(0, 200));
}
process.exit(0);

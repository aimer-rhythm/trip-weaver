// reasoning effort 验证：同一提示词在 off / medium 两档下，请求体与 thinking 输出各是什么
// 目的：证明 ① buildModel().reasoning 为 true（否则 pi-ai 把任何档位夹回 off）
//       ② options.reasoning 会变成请求体的 reasoning_effort
//       ③ 开启后模型确实产出 thinking（并观察 output token 变化）
// 用法（apps/server 目录）：npx tsx test-reasoning-effort.mts
import 'dotenv/config';
import { streamSimple } from '@mariozechner/pi-ai';
import { buildModel } from './src/generation/model';

const model = await buildModel({
  baseUrl: process.env.SITE_LLM_BASE_URL!,
  apiKey: process.env.SITE_LLM_API_KEY!,
  model: process.env.SITE_LLM_MODEL!,
  byok: false,
});
console.log(`model.reasoning = ${model.reasoning}（false 时 pi-ai 会把任何 thinkingLevel 夹回 off）\n`);

const context = {
  systemPrompt: '你是行程规划师，回答尽量简短。',
  messages: [
    {
      role: 'user' as const,
      content: '比较「上午故宫、下午景山」与「上午景山、下午故宫」两种排法，用一句话给出结论。',
      timestamp: Date.now(),
    },
  ],
};

async function probe(reasoning: 'medium' | undefined) {
  let payload = '';
  let thinking = 0;
  let text = '';
  let output = 0;
  let stop = '';
  const started = performance.now();
  for await (const ev of streamSimple(model, context as never, {
    apiKey: process.env.SITE_LLM_API_KEY!,
    reasoning,
    maxTokens: 4000,
    onPayload: (body: unknown) => {
      payload = JSON.stringify(body);
    },
  })) {
    if (ev.type === 'thinking_delta') thinking += ev.delta?.length ?? 0;
    if (ev.type === 'text_delta') text += ev.delta ?? '';
    if (ev.type === 'done') {
      output = ev.message.usage.output ?? 0;
      stop = ev.message.stopReason ?? '';
    }
    if (ev.type === 'error') stop = `error: ${ev.error.errorMessage ?? ''}`;
  }
  const effort = payload.match(/"reasoning_effort":"([^"]+)"/)?.[1] ?? '(未出现在请求体)';
  const ms = performance.now() - started;
  console.log(`reasoning=${String(reasoning).padEnd(8)} → 请求体 reasoning_effort=${effort}｜耗时 ${(ms / 1000).toFixed(1)}s`);
  console.log(`   thinking ${thinking} 字符｜可见文本 ${text.length} 字符｜output ${output} token｜stopReason=${stop}`);
  console.log(`   输出速度 ${output ? (output / (ms / 1000)).toFixed(1) : '?'} tok/s｜请求体字段：${[...payload.matchAll(/"(reasoning_effort|max_tokens|max_completion_tokens|stream)":([^,}]+)/g)].map((m) => m[0]).join(' ')}\n`);
}

await probe(undefined);
await probe('medium');
process.exit(0);

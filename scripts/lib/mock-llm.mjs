// mock OpenAI 兼容端点：按 system prompt 关键词分阶段回放工具调用（verify-c2 / verify-c3 共用）
import { createServer } from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';
import crypto from 'node:crypto';

function sseChunk(res, obj) {
  res.write(`data: ${JSON.stringify(obj)}\n\n`);
}

function respondWithToolCalls(res, model, calls) {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const base = { id: 'chatcmpl-mock', object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model };
  sseChunk(res, { ...base, choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }] });
  const tool_calls = calls.map((c, i) => ({
    index: i,
    id: `call_${crypto.randomUUID().slice(0, 8)}`,
    type: 'function',
    function: { name: c.name, arguments: JSON.stringify(c.args) },
  }));
  sseChunk(res, { ...base, choices: [{ index: 0, delta: { tool_calls }, finish_reason: null }] });
  sseChunk(res, { ...base, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] });
  sseChunk(res, { ...base, choices: [], usage: { prompt_tokens: 100, completion_tokens: 20 } });
  res.write('data: [DONE]\n\n');
  res.end();
}

function researchCalls(turnHasToolResults) {
  if (turnHasToolResults) {
    return [{ name: 'submit_research', args: { summary: '（来自模型知识）候选已入池：故宫博物院、测试食堂、测试酒店。建议第 1 天集中在市中心。' } }];
  }
  // 覆盖新工具面：地点搜索 + 攻略搜索 + 候选写入（含预约种子表命中与同名去重）
  return [
    { name: 'search_pois', args: { category: 'attraction', keyword: '必去景点' } },
    { name: 'search_web', args: { query: '攻略 预约' } },
    { name: 'add_candidate', args: { name: '故宫博物院', category: 'attraction', intro: '明清两代皇宫，世界文化遗产。', reservation: 'none' } },
    { name: 'add_candidate', args: { name: '测试食堂', category: 'food', intro: '本地人气小馆，招牌菜实惠。', reservation: 'unknown' } },
    { name: 'add_candidate', args: { name: '测试酒店', category: 'hotel', intro: '交通便利的舒适型酒店。' } },
    { name: 'add_candidate', args: { name: '故宫博物院', category: 'attraction', intro: '重复添加应被去重。' } },
  ];
}

function plannerCalls(days, turnHasToolResults, { geocodedActivities, includeLodging }) {
  if (turnHasToolResults) return [{ name: 'submit_plan', args: {} }];
  const calls = [
    { name: 'set_trip_skeleton', args: { title: '测试之旅', dayTitles: Array.from({ length: days }, (_, i) => `第${i + 1}天主题`) } },
  ];
  // ST3 住宿锚点：用户未指定时建议一个区域（用户已指定时工具幂等返回提示，不报错）
  if (includeLodging) calls.push({ name: 'set_lodging', args: { name: '市中心站前区域' } });
  for (let d = 1; d <= days; d++) {
    const activities = [
      { name: `活动${d}-1`, startTime: '09:00', endTime: '11:00', category: '文化' },
      { name: `午餐｜活动${d}-1周边当地风味`, startTime: '12:00', endTime: '13:15', category: '美食' },
      { name: `晚餐｜市中心片区当地风味`, startTime: '18:00', endTime: '19:15', category: '美食' },
    ];
    for (const [j, activity] of activities.entries()) {
      calls.push({
        name: 'add_activity',
        args: {
          dayIndex: d,
          ...activity,
          description: activity.category === '美食'
            ? '建议选择所在片区的当地菜系或代表菜，具体门店与实时信息到本地生活平台确认。'
            : '测试活动描述',
          lat: 35.68 + d * 0.01 + j * 0.001,
          lng: 139.76 + d * 0.01 + j * 0.001,
          ...(geocodedActivities ? { coordSource: 'geocoded' } : {}),
        },
      });
    }
  }
  return calls;
}

/**
 * 启动 mock 端点；返回 { server, seenAuthHeaders, close }
 * delayMs：每次补全前的延迟（留出取消窗口 / 模拟真实节奏）
 */
export async function startMockLlm(
  port,
  { delayMs = 300, reviewerOverrunOnce = false, geocodedActivities = false, includeLodging = true } = {},
) {
  const seenAuthHeaders = [];
  let reviewerOverrunAvailable = reviewerOverrunOnce;
  let reviewerOverrunActive = false;
  const server = createServer((req, res) => {
    if (!req.url?.includes('/chat/completions')) {
      res.writeHead(404).end();
      return;
    }
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      await sleep(delayMs);
      seenAuthHeaders.push(req.headers.authorization ?? '');
      const payload = JSON.parse(body);
      const system = payload.messages.find((m) => m.role === 'system')?.content ?? '';
      const toolResults = payload.messages.filter((m) => m.role === 'tool').length;
      // content 可能是字符串或 [{type:'text',text}] 数组（pi-ai 按 OpenAI 规范发数组）
      const rawUser = payload.messages.find((m) => m.role === 'user')?.content;
      const userText = typeof rawUser === 'string' ? rawUser : Array.isArray(rawUser) ? rawUser.map((c) => c?.text ?? '').join('\n') : '';
      const days = Number(/天数：(\d+) 天/.exec(userText)?.[1] ?? 2);

      if (system.includes('旅行调研员')) {
        respondWithToolCalls(res, payload.model, researchCalls(toolResults > 0));
      } else if (system.includes('行程规划师')) {
        respondWithToolCalls(res, payload.model, plannerCalls(days, toolResults > 0, { geocodedActivities, includeLodging }));
      } else if (system.includes('行程审校员')) {
        if (toolResults === 0) {
          reviewerOverrunActive = reviewerOverrunAvailable;
          reviewerOverrunAvailable = false;
        }
        respondWithToolCalls(
          res,
          payload.model,
          reviewerOverrunActive
            ? [{ name: 'get_draft', args: {} }]
            : [{ name: 'submit_review', args: { approved: true, notes: ['测试建议：留意闭馆时间'], revisionRequests: [] } }],
        );
      } else {
        respondWithToolCalls(res, payload.model, [{ name: 'submit_research', args: { summary: '兜底' } }]);
      }
    });
  });
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  return { server, seenAuthHeaders, close: () => server.close() };
}

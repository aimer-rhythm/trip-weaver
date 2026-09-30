// 与首页一致：独立会话 + Brief 快照；不可复用原会话，否则后续编辑会串到另一份行程。
import assert from 'node:assert/strict';
export async function createReplayConversation(headers, form, sourceTripId) {
  const request = async (url, options, status) => {
    const response = await fetch(`http://127.0.0.1:8787/api${url}`, { headers, signal: AbortSignal.timeout(15000), ...options });
    const data = await response.json();
    assert.equal(response.status, status, JSON.stringify(data));
    return data;
  };
  const source = await request(`/trips/${sourceTripId}/conversation`, {}, 200);
  const detail = source.conversationId ? await request(`/conversations/${source.conversationId}`, {}, 200) : null;
  const patch = { destination: form.destination, startDate: form.startDate, days: form.days, partySize: form.partySize };
  for (const key of ['preferences', 'transportMode']) if (form[key] !== undefined) patch[key] = form[key];
  // Trip 不保存 pace；只复用原会话里实际记录的节奏，不从图片任务猜测偏好。
  if (detail?.conversation?.brief?.data?.pace) patch.pace = detail.conversation.brief.data.pace;
  const conversation = await request('/conversations', { method: 'POST', body: JSON.stringify({ title: `${form.destination} · ${form.days}天行程` }) }, 201);
  try {
    await request(`/conversations/${conversation.id}/brief`, { method: 'PATCH', body: JSON.stringify(patch) }, 200);
    return conversation.id;
  } catch (error) {
    await fetch(`http://127.0.0.1:8787/api/conversations/${conversation.id}`, { method: 'DELETE', headers, signal: AbortSignal.timeout(15000) });
    throw error;
  }
}

// 地图 marker 的 HTML（AmapCanvas 与 LeafletCanvas 共用）。
//
// 共用不是为了省这几行，而是为了不漂移：名称避让（lib/labelCollision.ts）靠
// `.map-marker` / `.marker-pin` / `.map-label` 三个类名找元素，两套渲染一旦各写各的 HTML，
// 避让就会在其中一套上静默失效 —— 而失效的样子只是「名字不避让」，很容易被当成没做。
//
// marker DOM 契约（改这里时不要顺手删类名）：
//   .map-marker                 28×28 定位框，relative；避让的查询起点
//     .marker-pin               编号圆形 pin，绝对居中
//     .map-label                名称文本，绝对定位在 pin 下方，不参与命中
//   .map-marker--dimmed         按天筛选后被淡化的整天 marker

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** 活动名 / 简介来自模型输出，拼进 HTML 前必须转义（marker 与 InfoWindow 都走 innerHTML） */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]!);
}

export interface MarkerHtmlInput {
  color: string;
  order: number;
  /** 坐标为估算：pin 走虚线边框 + 降透明度（`.marker-estimated`） */
  estimated: boolean;
  /** 按天筛选后非当天 */
  dimmed: boolean;
  label: string;
}

export function markerHtml({ color, order, estimated, dimmed, label }: MarkerHtmlInput): string {
  return [
    `<div class="map-marker${dimmed ? ' map-marker--dimmed' : ''}">`,
    `<div class="marker-pin${estimated ? ' marker-estimated' : ''}" style="background:${color}">${order}</div>`,
    `<div class="map-label">${escapeHtml(label)}</div>`,
    '</div>',
  ].join('');
}

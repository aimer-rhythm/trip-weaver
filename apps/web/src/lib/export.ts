// 导出三件套的纯函数层（PRD F5）：长图 dataUrl / JSON 下载 / 打印 / 微信环境探测
import { toPng } from 'html-to-image';
import { TRIP_EXPORT_VERSION, type Trip, type TripExport } from '@tripweaver/shared';

export function isWeChat(): boolean {
  return /MicroMessenger/i.test(navigator.userAgent);
}

function safeFileName(title: string): string {
  return title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 50) || 'tripweaver';
}

function downloadUrl(url: string, filename: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** JSON 备份：版本化完整数据（与导入成对，跨账号还原） */
export function exportTripJson(trip: Trip): void {
  const payload: TripExport = { version: TRIP_EXPORT_VERSION, trip };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  downloadUrl(url, `${safeFileName(trip.title)}.json`);
  URL.revokeObjectURL(url);
}

/** 长图 PNG：2x 清晰度渲染指定节点（微信主场景） */
export function buildTripPng(node: HTMLElement): Promise<string> {
  return toPng(node, { pixelRatio: 2, backgroundColor: '#ffffff', cacheBust: true });
}

/** 非微信环境直接触发下载；微信由调用方走「长按保存」引导（R12） */
export function downloadPng(dataUrl: string, title: string): void {
  downloadUrl(dataUrl, `${safeFileName(title)}.png`);
}

export function printTrip(): void {
  window.print();
}

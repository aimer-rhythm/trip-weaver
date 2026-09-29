// 导出浏览器工具：AI 图片下载 / JSON 下载 / 打印 / 微信环境探测
import { TRIP_EXPORT_VERSION, type Trip, type TripExport, type TripShareImageResponse } from '@tripweaver/shared';

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

/** 非微信环境直接触发下载；微信由调用方走「长按保存」引导（R12） */
export function downloadShareImage(image: TripShareImageResponse, title: string): void {
  const extension = image.mimeType === 'image/jpeg' ? 'jpg' : image.mimeType === 'image/webp' ? 'webp' : 'png';
  downloadUrl(image.dataUrl, `${safeFileName(title)}-AI分享图.${extension}`);
}

export function printTrip(): void {
  window.print();
}

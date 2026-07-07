// 导出菜单：长图 PNG（微信「长按保存」兜底）/ JSON 备份 / 打印（PRD F5, R12）
import { useRef, useState } from 'react';
import type { Trip } from '@tripweaver/shared';
import { buildTripPng, downloadPng, exportTripJson, isWeChat, printTrip } from '../lib/export';
import { PrintView } from './PrintView';

export function ExportMenu({ trip }: { trip: Trip }) {
  const menuRef = useRef<HTMLDetailsElement>(null);
  const printHostRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [longPressImg, setLongPressImg] = useState<string | null>(null);
  const [error, setError] = useState('');

  const closeMenu = () => menuRef.current?.removeAttribute('open');

  const onPng = async () => {
    closeMenu();
    const node = printHostRef.current?.firstElementChild as HTMLElement | null;
    if (!node || busy) return;
    setBusy(true);
    setError('');
    try {
      const dataUrl = await buildTripPng(node);
      if (isWeChat()) {
        setLongPressImg(dataUrl);      // 微信内置浏览器 download 不可靠 → 长按保存引导
      } else {
        downloadPng(dataUrl, trip.title);
      }
    } catch {
      setError('长图生成失败，请重试');
    } finally {
      setBusy(false);
    }
  };

  const onJson = () => {
    closeMenu();
    exportTripJson(trip);
  };

  const onPrint = () => {
    closeMenu();
    printTrip();
  };

  return (
    <>
      <details ref={menuRef} className="export-menu">
        <summary className="btn btn-ghost">{busy ? '导出中…' : '导出'}</summary>
        <div className="export-menu-list">
          <button type="button" className="btn" onClick={onPng} disabled={busy}>
            🖼️ 长图 PNG（分享）
          </button>
          <button type="button" className="btn" onClick={onJson}>
            💾 JSON 备份
          </button>
          <button type="button" className="btn" onClick={onPrint}>
            🖨️ 打印 / PDF
          </button>
          {error && <p className="form-error">{error}</p>}
        </div>
      </details>

      {/* 常驻离屏：长图取材 + @media print 显示 */}
      <div className="print-host" ref={printHostRef} aria-hidden="true">
        <PrintView trip={trip} />
      </div>

      {longPressImg && (
        <div className="longpress-overlay" onClick={() => setLongPressImg(null)}>
          <p className="longpress-hint">长按下方图片，选择「保存图片」或「发送给朋友」</p>
          <img src={longPressImg} alt={`${trip.title} 行程长图`} onClick={(e) => e.stopPropagation()} />
          <button type="button" className="btn btn-ghost longpress-close" onClick={() => setLongPressImg(null)}>
            关闭
          </button>
        </div>
      )}
    </>
  );
}

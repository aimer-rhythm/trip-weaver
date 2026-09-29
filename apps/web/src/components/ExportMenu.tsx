// 导出菜单：长图 PNG（微信「长按保存」兜底）/ JSON 备份 / 打印（PRD F5, R12）
import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
      menuRef.current?.setAttribute('open', '');
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
      <details ref={menuRef} className={"export-menu relative [z-index:1100] [&_summary]:[list-style:none] [&_summary::-webkit-details-marker]:hidden"}>
        <summary className={"btn [border:1px_solid_transparent] [border-radius:var(--radius)] [padding:8px_14px] [font-size:0.9rem] cursor-pointer [color:var(--color-text)] inline-flex items-center [gap:4px] [&:disabled]:[opacity:0.55] [&:disabled]:[cursor:not-allowed] btn-ghost [border-color:var(--color-border)] [background:var(--color-card)] [&:not(:disabled):hover]:[border-color:var(--color-primary)] [&:not(:disabled):hover]:[color:var(--color-primary)]"}>{busy ? '导出中…' : '导出行程'}</summary>
        <div className={"export-menu-list absolute [right:0] [top:calc(100%_+_6px)] [z-index:40] [background:var(--color-card)] [border:1px_solid_var(--color-border)] [border-radius:10px] [box-shadow:0_6px_20px_rgba(16,_36,_46,_0.15)] [padding:6px] [min-width:180px] flex flex-col [&_.btn]:justify-start [&_.btn]:w-full [&_.btn]:[border-radius:8px] [&_.btn:hover]:[background:var(--color-btn-icon-background-9)]"}>
          <button type="button" className={"btn [border:1px_solid_transparent] [border-radius:var(--radius)] [padding:8px_14px] [font-size:0.9rem] cursor-pointer [background:none] [color:var(--color-text)] inline-flex items-center [gap:4px] [&:disabled]:[opacity:0.55] [&:disabled]:[cursor:not-allowed]"} onClick={onPng} disabled={busy}>
            🖼️ 长图 PNG（分享）
          </button>
          <button type="button" className={"btn [border:1px_solid_transparent] [border-radius:var(--radius)] [padding:8px_14px] [font-size:0.9rem] cursor-pointer [background:none] [color:var(--color-text)] inline-flex items-center [gap:4px] [&:disabled]:[opacity:0.55] [&:disabled]:[cursor:not-allowed]"} onClick={onJson}>
            💾 JSON 备份
          </button>
          <button type="button" className={"btn [border:1px_solid_transparent] [border-radius:var(--radius)] [padding:8px_14px] [font-size:0.9rem] cursor-pointer [background:none] [color:var(--color-text)] inline-flex items-center [gap:4px] [&:disabled]:[opacity:0.55] [&:disabled]:[cursor:not-allowed]"} onClick={onPrint}>
            🖨️ 打印 / PDF
          </button>
          {error && <p className={"form-error [color:var(--color-danger)] [font-size:0.85rem] m-0"}>{error}</p>}
        </div>
      </details>

      {/* 常驻离屏：长图取材 + @media print 显示 */}
      {createPortal(<div className={"print-host fixed [left:-10000px] [top:0] [width:720px] [background:var(--color-btn-primary-color-3)] pointer-events-none [z-index:-1] [@media_print]:visible [@media_print]:[&_*]:visible [@media_print]:absolute! [@media_print]:[left:0]! [@media_print]:[top:0]! [@media_print]:w-full! [@media_print]:[z-index:9999]"} ref={printHostRef} aria-hidden="true">
        <PrintView trip={trip} />
      </div>, document.body)}

      {longPressImg && createPortal(
        <div className={"longpress-overlay fixed [inset:0] [z-index:200] [background:rgba(19,_32,_40,_0.75)] flex flex-col items-center [gap:12px] [padding:20px_16px] overflow-y-auto [&_img]:w-full [&_img]:[max-width:480px] [&_img]:[border-radius:8px]"} onClick={() => setLongPressImg(null)}>
          <p className={"longpress-hint [color:var(--color-btn-primary-color-3)] [font-size:0.95rem] m-0 text-center"}>长按下方图片，选择「保存图片」或「发送给朋友」</p>
          <img src={longPressImg} alt={`${trip.title} 行程长图`} onClick={(e) => e.stopPropagation()} />
          <button type="button" className={"btn [border:1px_solid_transparent] [border-radius:var(--radius)] [padding:8px_14px] [font-size:0.9rem] cursor-pointer [color:var(--color-text)] inline-flex items-center [gap:4px] [&:disabled]:[opacity:0.55] [&:disabled]:[cursor:not-allowed] btn-ghost [border-color:var(--color-border)] [&:not(:disabled):hover]:[border-color:var(--color-primary)] [&:not(:disabled):hover]:[color:var(--color-primary)] longpress-close [background:var(--color-btn-primary-color-3)]"} onClick={() => setLongPressImg(null)}>
            关闭
          </button>
        </div>, document.body
      )}
    </>
  );
}

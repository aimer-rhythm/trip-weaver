import { Button, buttonClassName } from './ui/Button';
import { Dropdown } from './ui/Dropdown';
import { Modal } from './Modal';
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
      <Dropdown label="导出行程" menuRef={menuRef} className="export-menu z-[1100]" summaryClassName={buttonClassName('secondary')} panelClassName="export-menu-list [&_button]:justify-start" trigger={busy ? '导出中…' : '导出行程'}>
          <Button variant="ghost" type="button" onClick={onPng} disabled={busy}>
            长图 PNG（分享）
          </Button>
          <Button variant="ghost" type="button" onClick={onJson}>
            JSON 备份
          </Button>
          <Button variant="ghost" type="button" onClick={onPrint}>
            打印 / PDF
          </Button>
          {error && <p className={"form-error [color:var(--color-danger)] [font-size:0.85rem] m-0"}>{error}</p>}
      </Dropdown>

      {/* 常驻离屏：长图取材 + @media print 显示 */}
      {createPortal(<div className={"print-host fixed [left:-10000px] [top:0] [width:720px] [background:var(--color-btn-primary-color-3)] pointer-events-none [z-index:-1] [@media_print]:visible [@media_print]:[&_*]:visible [@media_print]:absolute! [@media_print]:[left:0]! [@media_print]:[top:0]! [@media_print]:w-full! [@media_print]:[z-index:9999]"} ref={printHostRef} aria-hidden="true">
        <PrintView trip={trip} />
      </div>, document.body)}

      {longPressImg && <Modal title="保存行程长图" onClose={() => setLongPressImg(null)}>
        <p className="text-sm text-[var(--color-muted)]">长按下方图片，选择「保存图片」或「发送给朋友」</p>
        <img className="w-full rounded-xl" src={longPressImg} alt={`${trip.title} 行程长图`} />
      </Modal>}

    </>
  );
}

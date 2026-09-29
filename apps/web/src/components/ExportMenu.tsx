import { Button, buttonClassName } from './ui/Button';
import { Dropdown } from './ui/Dropdown';
// 导出菜单：AI 分享图 / JSON 备份 / 打印
import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Trip } from '@tripweaver/shared';
import { exportTripJson, printTrip } from '../lib/export';
import { PrintView } from './PrintView';
import { TripShareImageDialog } from './TripShareImageDialog';

export function ExportMenu({ trip }: { trip: Trip }) {
  const menuRef = useRef<HTMLDetailsElement>(null);
  const [shareOpen, setShareOpen] = useState(false);

  const closeMenu = () => menuRef.current?.removeAttribute('open');

  const onPng = () => {
    closeMenu();
    setShareOpen(true);
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
      <Dropdown label="导出行程" menuRef={menuRef} className="export-menu z-[1100]" summaryClassName={buttonClassName('secondary')} panelClassName="export-menu-list [&_button]:justify-start" trigger="导出行程">
          <Button variant="ghost" type="button" onClick={onPng}>
            AI 分享图
          </Button>
          <Button variant="ghost" type="button" onClick={onJson}>
            JSON 备份
          </Button>
          <Button variant="ghost" type="button" onClick={onPrint}>
            打印 / PDF
          </Button>
      </Dropdown>

      {/* 常驻离屏：@media print 显示 */}
      {createPortal(<div className={"print-host fixed [left:-10000px] [top:0] [width:720px] [background:var(--color-btn-primary-color-3)] pointer-events-none [z-index:-1] [@media_print]:visible [@media_print]:[&_*]:visible [@media_print]:absolute! [@media_print]:[left:0]! [@media_print]:[top:0]! [@media_print]:w-full! [@media_print]:[z-index:9999]"} aria-hidden="true">
        <PrintView trip={trip} />
      </div>, document.body)}

      <TripShareImageDialog key={trip.id} trip={trip} open={shareOpen} onClose={() => setShareOpen(false)} />

    </>
  );
}

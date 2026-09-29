import { useState, type FormEvent } from 'react';
import { useEditorStore } from '../../store/editorStore';
import { Modal } from '../Modal';

export function TripMetaDialog({ onClose }: { onClose: () => void }) {
  const trip = useEditorStore((s) => s.trip);
  const updateMeta = useEditorStore((s) => s.updateMeta);
  const updateLodging = useEditorStore((s) => s.updateLodging);
  const updateDayLodging = useEditorStore((s) => s.updateDayLodging);

  const [title, setTitle] = useState(trip?.title ?? '');
  const [destination, setDestination] = useState(trip?.destination ?? '');
  const [startDate, setStartDate] = useState(trip?.startDate ?? '');
  const [partySize, setPartySize] = useState(String(trip?.partySize ?? 2));
  // 住宿锚点（ST3）：改名即清空坐标并丢弃相关住宿 leg（保存时经 store 处理，无客户端重编码）
  const [lodgingName, setLodgingName] = useState(trip?.lodging?.name ?? '');
  const [dayLodgings, setDayLodgings] = useState<Record<string, string>>(() =>
    Object.fromEntries((trip?.days ?? []).filter((d) => d.lodging).map((d) => [d.id, d.lodging!.name])),
  );
  const [error, setError] = useState('');

  if (!trip) return null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return setError('请填写行程名称');
    if (!destination.trim()) return setError('请填写目的地');
    const partyNum = Math.min(50, Math.max(1, Math.round(Number(partySize) || 1)));
    updateMeta({
      title: title.trim(),
      destination: destination.trim(),
      startDate,
      partySize: partyNum,
    });
    updateLodging(lodgingName);
    for (const day of trip.days) {
      updateDayLodging(day.id, dayLodgings[day.id] ?? '');
    }
    onClose();
  };

  return (
    <Modal title="行程信息" onClose={onClose}>
      <form onSubmit={submit} className={"form flex flex-col [gap:12px] [&_label]:flex [&_label]:flex-col [&_label]:[gap:5px] [&_label]:[font-size:0.88rem] [&_label]:[color:var(--color-muted)] [&_input:not([type='checkbox'])]:[border:1px_solid_var(--color-border)] [&_input:not([type='checkbox'])]:[border-radius:var(--radius)] [&_input:not([type='checkbox'])]:[padding:9px_11px] [&_input:not([type='checkbox'])]:[font-size:0.95rem] [&_input:not([type='checkbox'])]:[color:var(--color-text)] [&_input:not([type='checkbox'])]:[background:var(--color-card)] [&_input:focus]:[outline:2px_solid_var(--color-primary)] [&_input:focus]:[outline-offset:0] [&_input:focus]:[border-color:transparent] [&_select]:[border:1px_solid_var(--color-border)] [&_select]:[border-radius:var(--radius)] [&_select]:[padding:9px_11px] [&_select]:[font-size:0.95rem] [&_select]:[background:var(--color-card)] [&_select]:[color:var(--color-text)]"}>
        <label>
          行程名称
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={60} />
        </label>
        <div className={"form-grid-2 grid [grid-template-columns:1fr_1fr] [gap:10px]"}>
          <label>
            目的地
            <input value={destination} onChange={(e) => setDestination(e.target.value)} maxLength={40} />
          </label>
          <label>
            出发日期
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </label>
        </div>
        <label>
          出行人数
          <input inputMode="numeric" value={partySize} onChange={(e) => setPartySize(e.target.value)} />
        </label>
        <label>
          住宿位置（通勤锚点，可选）
          <input
            value={lodgingName}
            onChange={(e) => setLodgingName(e.target.value)}
            maxLength={60}
            placeholder="酒店名或大致区域，如「西湖景区周边」"
          />
        </label>
        {lodgingName.trim() !== (trip.lodging?.name ?? '') && (
          <p className={"muted [color:var(--color-muted)] [font-size:0.88rem]"}>修改住宿位置后将清除原坐标与住宿通勤段（重新生成行程可恢复）。</p>
        )}
        <details className="form-day-lodging">
          <summary className={"muted [color:var(--color-muted)] [font-size:0.88rem]"}>按天覆盖住宿（多城市场景，可选）</summary>
          {trip.days.map((d) => (
            <label key={d.id}>
              Day {d.dayIndex} 住宿
              <input
                value={dayLodgings[d.id] ?? ''}
                onChange={(e) => setDayLodgings((prev) => ({ ...prev, [d.id]: e.target.value }))}
                maxLength={60}
                placeholder="留空则用整程住宿"
              />
            </label>
          ))}
        </details>
        {error && <p className={"form-error [color:var(--color-danger)] [font-size:0.85rem] m-0"}>{error}</p>}
        <div className={"form-foot flex items-center [justify-content:flex-end] [gap:12px]"}>
          <button type="button" className={"btn [border:1px_solid_transparent] [border-radius:var(--radius)] [padding:8px_14px] [font-size:0.9rem] cursor-pointer [color:var(--color-text)] inline-flex items-center [gap:4px] [&:disabled]:[opacity:0.55] [&:disabled]:[cursor:not-allowed] btn-ghost [border-color:var(--color-border)] [background:var(--color-card)] [&:not(:disabled):hover]:[border-color:var(--color-primary)] [&:not(:disabled):hover]:[color:var(--color-primary)]"} onClick={onClose}>
            取消
          </button>
          <button type="submit" className={"btn [border:1px_solid_transparent] [border-radius:var(--radius)] [padding:8px_14px] [font-size:0.9rem] cursor-pointer inline-flex items-center [gap:4px] [&:disabled]:[opacity:0.55] [&:disabled]:[cursor:not-allowed] btn-primary [background:var(--color-primary)] [color:var(--color-btn-primary-color-3)] [&:not(:disabled):hover]:[background:var(--color-primary-dark)]"}>
            保存
          </button>
        </div>
      </form>
    </Modal>
  );
}

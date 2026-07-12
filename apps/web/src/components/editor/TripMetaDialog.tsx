import { useState, type FormEvent } from 'react';
import { BUDGET_LEVELS, type BudgetLevel } from '@tripweaver/shared';
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
  const [budgetLevel, setBudgetLevel] = useState<BudgetLevel>(trip?.budgetLevel ?? '舒适');
  const [totalBudget, setTotalBudget] = useState(String(trip?.totalBudget ?? 0));
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
    const budgetNum = Math.max(0, Number(totalBudget) || 0);
    const partyNum = Math.min(50, Math.max(1, Math.round(Number(partySize) || 1)));
    updateMeta({
      title: title.trim(),
      destination: destination.trim(),
      startDate,
      budgetLevel,
      totalBudget: budgetNum,
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
      <form onSubmit={submit} className="form">
        <label>
          行程名称
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={60} />
        </label>
        <div className="form-grid-2">
          <label>
            目的地
            <input value={destination} onChange={(e) => setDestination(e.target.value)} maxLength={40} />
          </label>
          <label>
            出发日期
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </label>
        </div>
        <div className="form-grid-2">
          <label>
            预算档次
            <select value={budgetLevel} onChange={(e) => setBudgetLevel(e.target.value as BudgetLevel)}>
              {BUDGET_LEVELS.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </label>
          <label>
            总预算（¥，0 为不限）
            <input inputMode="numeric" value={totalBudget} onChange={(e) => setTotalBudget(e.target.value)} />
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
          <p className="muted">修改住宿位置后将清除原坐标与住宿通勤段（重新生成行程可恢复）。</p>
        )}
        <details className="form-day-lodging">
          <summary className="muted">按天覆盖住宿（多城市场景，可选）</summary>
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
        {error && <p className="form-error">{error}</p>}
        <div className="form-foot">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            取消
          </button>
          <button type="submit" className="btn btn-primary">
            保存
          </button>
        </div>
      </form>
    </Modal>
  );
}

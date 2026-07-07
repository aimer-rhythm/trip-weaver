import { useState, type FormEvent } from 'react';
import { BUDGET_LEVELS, type BudgetLevel } from '@tripweaver/shared';
import { useEditorStore } from '../../store/editorStore';
import { Modal } from '../Modal';

export function TripMetaDialog({ onClose }: { onClose: () => void }) {
  const trip = useEditorStore((s) => s.trip);
  const updateMeta = useEditorStore((s) => s.updateMeta);

  const [title, setTitle] = useState(trip?.title ?? '');
  const [destination, setDestination] = useState(trip?.destination ?? '');
  const [startDate, setStartDate] = useState(trip?.startDate ?? '');
  const [budgetLevel, setBudgetLevel] = useState<BudgetLevel>(trip?.budgetLevel ?? '舒适');
  const [totalBudget, setTotalBudget] = useState(String(trip?.totalBudget ?? 0));
  const [partySize, setPartySize] = useState(String(trip?.partySize ?? 2));
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

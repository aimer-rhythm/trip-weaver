import { useState } from 'react';
import { dateForDayIndex, foodPositionProblem, MEAL_KINDS, MEAL_LABELS, type FoodCandidate, type MealPosition, type Trip } from '@tripweaver/shared';
import { Button } from '../ui/Button';

interface Props {
  trip: Trip; candidate: FoodCandidate; initial: MealPosition; disabled: boolean;
  onSelect: (position: MealPosition) => void; onCancel: () => void;
}

/** 卡片内逐项问答；每页至多三项，最后的位置选择就是添加操作。 */
export function FoodPositionChoices({ trip, candidate, initial, disabled, onSelect, onCancel }: Props) {
  const [position, setPosition] = useState(initial);
  const [step, setStep] = useState<'day' | 'meal' | 'position'>('day');
  const [page, setPage] = useState(0);
  const day = trip.days.find((item) => item.id === position.dayId);
  const advance = (next: MealPosition, nextStep: typeof step) => { setPosition(next); setStep(nextStep); setPage(0); };
  const question = step === 'day' ? `想把「${candidate.name}」安排在哪一天？`
    : step === 'meal' ? '想把它安排为哪一餐？' : `作为${MEAL_LABELS[position.meal]}，放在哪个位置？`;
  const choices = step === 'day' ? trip.days.map((item) => ({
    id: item.id, label: `第 ${item.dayIndex} 天 · ${dateForDayIndex(trip.startDate, item.dayIndex) || '日期待定'}`,
    choose: () => advance({ ...position, dayId: item.id, beforeActivityId: undefined }, 'meal'), problem: null,
  })) : step === 'meal' ? MEAL_KINDS.map((meal) => ({
    id: meal, label: MEAL_LABELS[meal], choose: () => advance({ ...position, meal }, 'position'), problem: null,
  })) : [...(day?.activities.map((activity, index) => ({ id: activity.id, label: index ? `${day.activities[index - 1]!.name}之后 · ${activity.name}之前` : `${activity.name}之前`, beforeActivityId: activity.id })) ?? []), {
    id: 'end', label: day?.activities.length ? `${day.activities.at(-1)!.name}之后` : '当天第一个活动', beforeActivityId: undefined,
  }].map((item) => {
    const selected = { ...position, beforeActivityId: item.beforeActivityId };
    return { id: item.id, label: item.label, choose: () => onSelect(selected), problem: foodPositionProblem(trip, candidate, selected) };
  });
  const pages = Math.ceil(choices.length / 3);
  const visible = choices.slice(page * 3, page * 3 + 3);
  return <div className="food-position-choices mt-4 rounded-2xl bg-[var(--color-editor-page-background-97)] p-3 text-[16px]">
    {step !== 'day' && <div className="mb-3 flex flex-wrap justify-end gap-2">
      <Button variant="plain" className="min-h-11 rounded-2xl bg-white/80 px-3 py-2 text-brand" disabled={disabled} onClick={() => { setStep('day'); setPage(0); }}>第 {day?.dayIndex} 天 · 更改</Button>
      {step === 'position' && <Button variant="plain" className="min-h-11 rounded-2xl bg-white/80 px-3 py-2 text-brand" disabled={disabled} onClick={() => { setStep('meal'); setPage(0); }}>{MEAL_LABELS[position.meal]} · 更改</Button>}
    </div>}
    <p className="mb-3 mt-0 font-medium" aria-live="polite">{question}</p>
    {step === 'position' && <p className="mb-3 mt-0 text-[14px] text-ink-muted">选好位置后，会直接加入行程。</p>}
    <div className="flex flex-col gap-2" role="group" aria-label={question}>
      {visible.map((choice) => <div key={choice.id}>
        <Button variant="plain" className="min-h-11 w-full rounded-xl border border-solid border-white bg-white/80 px-3 py-2 text-left text-[16px] text-brand hover:bg-white disabled:opacity-50" disabled={disabled || Boolean(choice.problem)} onClick={choice.choose}>{choice.label}</Button>
        {choice.problem && <p className="mb-1 mt-1 px-1 text-[14px] text-ink-muted">{choice.problem}</p>}
      </div>)}
    </div>
    <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
      {pages > 1 && <div className="flex items-center gap-2">
        <Button variant="ghost" disabled={disabled || page === 0} onClick={() => setPage(page - 1)}>上一组</Button>
        <span className="text-[14px] text-ink-muted">{page + 1}/{pages}</span>
        <Button variant="ghost" disabled={disabled || page + 1 >= pages} onClick={() => setPage(page + 1)}>下一组</Button>
      </div>}
      <Button variant="ghost" disabled={disabled} onClick={onCancel}>取消添加</Button>
    </div>
  </div>;
}

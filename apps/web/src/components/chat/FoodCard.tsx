import { useRef, useState } from 'react';
import { foodAlreadyAdded, recommendedFoodPosition, MEAL_LABELS, uid, type FoodCandidate, type Trip, type TripOperationResult, type MealPosition, type AddFoodRequest } from '@tripweaver/shared';
import { addFood } from '../../api/detailChat';
import { Button } from '../ui/Button';
import { FoodPositionChoices } from './FoodPositionChoices';
import { useEditorStore } from '../../store/editorStore';
import { EditorIcon } from '../editor/EditorIcon';

interface Props {
  candidate: FoodCandidate; trip: Trip; conversationId: string; disabled: boolean; readOnly: boolean;
  begin: () => Promise<Trip>; end: () => void; onTrip: (id: string, result?: TripOperationResult) => Promise<void>;
}
export function FoodCard({ candidate, trip, conversationId, disabled, readOnly, begin, end, onTrip }: Props) {
  const recommendation = recommendedFoodPosition(trip, candidate);
  const [position, setPosition] = useState<MealPosition>(recommendation ?? { dayId: candidate.dayId, meal: candidate.meal ?? 'lunch' });
  const [adjusting, setAdjusting] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const request = useRef<AddFoodRequest | null>(null);
  const inFlight = useRef(false);
  const existingDay = trip.days.find((d) => d.id === position.dayId && foodAlreadyAdded(d, candidate));
  const existing = existingDay && foodAlreadyAdded(existingDay, candidate);
  const showActivity = () => {
    if (!existingDay || !existing) return;
    useEditorStore.getState().setDayFilter(existingDay.dayIndex);
    requestAnimationFrame(() => document.getElementById(`activity-${existing.id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
  };
  const submit = async (selected: MealPosition) => {
    if (inFlight.current || disabled) return;
    inFlight.current = true; setPending(true); setError(''); setPosition(selected);
    let acquired = false;
    try {
      const saved = await begin();
      acquired = true;
      // 保留失败请求的完整标识和目标；断线后重试先由后端检查原操作。
      request.current ??= { operationId: uid(), expectedTripId: saved.id, updatedAt: saved.updatedAt, candidateId: candidate.id, position: selected };
      const result = await addFood(conversationId, request.current);
      await onTrip(result.trip.id, result); setAdjusting(false); request.current = null;
    } catch (err) { setError(err instanceof Error ? err.message : '添加失败，请重试'); }
    finally { inFlight.current = false; setPending(false); if (acquired) end(); }
  };
  const anchor = recommendation?.beforeActivityId ? trip.days.find((d) => d.id === recommendation.dayId)?.activities.find((a) => a.id === recommendation.beforeActivityId)?.name : undefined;
  const sources = candidate.sources.filter((source, index, all) => all.findIndex((entry) => entry.url === source.url && entry.title === source.title) === index);
  // 旧候选可能携带地点供应商的数字分类码，不能作为可读菜系展示。
  const cuisine = candidate.cuisine && /\p{L}/u.test(candidate.cuisine) ? candidate.cuisine : undefined;
  return <article className="food-card my-3 min-w-0 rounded-[22px] border border-solid border-white bg-[var(--color-editor-page-background-95)] p-4 text-[16px] leading-[1.6] shadow-[0_4px_16px_var(--color-editor-page-box-shadow-71)]" aria-label={candidate.name}>
    <div className="flex items-start gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--color-editor-page-background-97)] text-brand" aria-hidden="true"><EditorIcon name="food" /></span><div className="min-w-0"><strong className="break-words font-semibold">{candidate.name}</strong><p className="mb-0 mt-1 text-[14px] text-ink-muted">第 {candidate.dayIndex} 天{candidate.nearby ? ` · ${candidate.nearby}附近` : ''}</p></div></div>
    <p className="mb-3 mt-3 break-words text-[var(--color-editor-page-color-96)]">{candidate.reason}</p>
    {candidate.address && <p className="my-2 break-words">{candidate.address}</p>}
    {cuisine && <p className="my-2">{cuisine}</p>}
    {candidate.openTime && <p className="my-2">营业信息：{candidate.openTime}</p>}
    <details className="text-[14px] text-ink-muted"><summary className="min-h-11 cursor-pointer leading-[44px]">参考来源 · {sources.length}</summary><div className="flex flex-col gap-1 pb-2">{sources.map((source, i) => /^https?:\/\//.test(source.url) ? <a className="inline-flex min-h-11 items-center text-inherit underline underline-offset-4" key={i} href={source.url} target="_blank" rel="noreferrer">{source.title}{sources.length > 1 ? ` ${i + 1}` : ''} ↗</a> : <span key={i}>{source.title}</span>)}</div></details>
    {anchor && <p className="my-2">{anchor}之前 · 推荐位置</p>}
    {existing ? <Button variant="ghost" className="min-h-11 rounded-full text-[16px] text-brand" onClick={showActivity}>已加入第 {existingDay?.dayIndex} 天 · 查看新增活动</Button> : readOnly ? <p>返回最新版本后可添加</p> : <div className="mt-2 flex flex-wrap gap-2">
      <Button variant={recommendation ? 'primary' : 'secondary'} className="min-h-11 rounded-full text-[16px]" disabled={disabled || pending} onClick={() => recommendation && !error ? void submit(recommendation) : error && request.current ? void submit(request.current.position) : setAdjusting(true)}>{pending ? '正在添加…' : error && request.current ? '重试添加' : recommendation ? `加入第 ${trip.days.find((d) => d.id === recommendation.dayId)?.dayIndex} 天 · ${MEAL_LABELS[recommendation.meal]}` : '选择添加位置'}</Button>
      {recommendation && <Button variant="ghost" className="min-h-11 rounded-full text-[16px] text-brand" disabled={disabled || pending} onClick={() => setAdjusting(true)}>调整位置</Button>}
    </div>}
    {adjusting && !existing && !readOnly && <FoodPositionChoices trip={trip} candidate={candidate} initial={position} disabled={disabled || pending} onCancel={() => setAdjusting(false)} onSelect={(selected) => { request.current = null; setError(''); void submit(selected); }} />}
    {error && <p className="mb-0 text-[var(--color-danger)]" role="alert">{error}</p>}
  </article>;
}

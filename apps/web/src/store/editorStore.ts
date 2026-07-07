import { create } from 'zustand';
import { uid, type Activity, type Trip, type TripDay } from '@tripweaver/shared';

// 编辑器交互态：业务数据以服务端为唯一事实源，此处仅为编辑期副本
// revision 驱动防抖自动保存；结构化更新用 structuredClone（行程体量 <50KB，KISS）
interface EditorState {
  trip: Trip | null;
  revision: number;
  dayFilter: number | null;         // null = 全部天
  load: (trip: Trip) => void;
  clear: () => void;
  setDayFilter: (dayIndex: number | null) => void;
  updateMeta: (patch: Partial<Pick<Trip, 'title' | 'destination' | 'startDate' | 'budgetLevel' | 'totalBudget' | 'partySize' | 'extraNotes'>>) => void;
  addDay: () => void;
  deleteDay: (dayId: string) => void;
  updateDayTitle: (dayId: string, title: string) => void;
  addActivity: (dayId: string, activity: Omit<Activity, 'id'>) => void;
  updateActivity: (dayId: string, activityId: string, patch: Partial<Omit<Activity, 'id'>>) => void;
  deleteActivity: (dayId: string, activityId: string) => void;
  moveActivity: (dayId: string, activityId: string, dir: 'up' | 'down') => void;
  moveActivityToDay: (fromDayId: string, activityId: string, toDayId: string) => void;
}

function renumber(days: TripDay[]): void {
  days.forEach((d, i) => {
    d.dayIndex = i + 1;
  });
}

export const useEditorStore = create<EditorState>((set, get) => {
  const mutate = (fn: (draft: Trip) => void) => {
    const cur = get().trip;
    if (!cur) return;
    const draft = structuredClone(cur);
    fn(draft);
    set({ trip: draft, revision: get().revision + 1 });
  };

  const findDay = (draft: Trip, dayId: string) => draft.days.find((d) => d.id === dayId);

  return {
    trip: null,
    revision: 0,
    dayFilter: null,
    load: (trip) => set({ trip: structuredClone(trip), revision: 0, dayFilter: null }),
    clear: () => set({ trip: null, revision: 0, dayFilter: null }),
    setDayFilter: (dayIndex) => set({ dayFilter: dayIndex }),

    updateMeta: (patch) => mutate((draft) => Object.assign(draft, patch)),

    addDay: () =>
      mutate((draft) => {
        draft.days.push({ id: uid(), dayIndex: draft.days.length + 1, title: '', activities: [] });
      }),

    deleteDay: (dayId) =>
      mutate((draft) => {
        draft.days = draft.days.filter((d) => d.id !== dayId);
        renumber(draft.days);
      }),

    updateDayTitle: (dayId, title) =>
      mutate((draft) => {
        const day = findDay(draft, dayId);
        if (day) day.title = title;
      }),

    addActivity: (dayId, activity) =>
      mutate((draft) => {
        findDay(draft, dayId)?.activities.push({ ...activity, id: uid() });
      }),

    updateActivity: (dayId, activityId, patch) =>
      mutate((draft) => {
        const list = findDay(draft, dayId)?.activities;
        const target = list?.find((a) => a.id === activityId);
        if (target) Object.assign(target, patch);
      }),

    deleteActivity: (dayId, activityId) =>
      mutate((draft) => {
        const day = findDay(draft, dayId);
        if (day) day.activities = day.activities.filter((a) => a.id !== activityId);
      }),

    moveActivity: (dayId, activityId, dir) =>
      mutate((draft) => {
        const list = findDay(draft, dayId)?.activities;
        if (!list) return;
        const i = list.findIndex((a) => a.id === activityId);
        const j = dir === 'up' ? i - 1 : i + 1;
        if (i < 0 || j < 0 || j >= list.length) return;
        const a = list[i]!;
        list[i] = list[j]!;
        list[j] = a;
      }),

    moveActivityToDay: (fromDayId, activityId, toDayId) =>
      mutate((draft) => {
        const from = findDay(draft, fromDayId);
        const to = findDay(draft, toDayId);
        if (!from || !to || from === to) return;
        const i = from.activities.findIndex((a) => a.id === activityId);
        if (i < 0) return;
        const [moved] = from.activities.splice(i, 1);
        if (moved) to.activities.push(moved);
      }),
  };
});

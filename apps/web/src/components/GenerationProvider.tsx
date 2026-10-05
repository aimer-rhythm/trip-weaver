import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { TravelPreferences } from '@tripweaver/shared';
import { keys, useCurrentGeneration, type GenerationRequest, type MeView } from '../api/hooks';
import { useGenerationRun, type GenerationRun } from '../hooks/useGenerationRun';
import { useTravelPreferencesDraft } from './TravelPreferencesProvider';

interface GenerationContext extends GenerationRun {
  running: boolean;
  discovering: boolean;
  destination: string;
  days: number;
}
const Context = createContext<GenerationContext | null>(null);

export function GenerationProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const qc = useQueryClient();
  const preferences = useTravelPreferencesDraft();
  const pendingPreference = useRef<TravelPreferences | undefined>(undefined);
  const submitted = useRef(new Map<string, TravelPreferences>());
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const current = useCurrentGeneration(userId);
  const run = useGenerationRun({
    enabled: Boolean(userId),
    onStarted: (id) => {
      if (pendingPreference.current) submitted.current.set(id, pendingPreference.current);
      pendingPreference.current = undefined;
      void qc.invalidateQueries({ queryKey: keys.currentGeneration(userId) });
    },
    onDone: (_tripId, jobId) => {
      const snapshot = submitted.current.get(jobId);
      submitted.current.delete(jobId);
      if (snapshot) void preferences.persist(snapshot);
      void qc.invalidateQueries({ queryKey: keys.notifications(userId) });
      void qc.invalidateQueries({ queryKey: keys.currentGeneration(userId) });
    },
  });
  const terminal = run.events.some((event) => event.type === 'job_done' || event.type === 'job_error' || event.type === 'job_cancelled');
  const running = Boolean(run.jobId && !terminal && run.completed?.jobId !== run.jobId);
  const runRef = useRef(run); runRef.current = run;
  useEffect(() => {
    if (run.restoring || run.starting) return;
    const snapshot = current.data;
    if (snapshot?.status === 'running' && snapshot.jobId !== runRef.current.jobId) runRef.current.adopt(snapshot.jobId);
  }, [current.data, run.restoring, run.starting]);
  useEffect(() => {
    if (!terminal) return;
    void qc.invalidateQueries({ queryKey: keys.notifications(userId) });
    void qc.invalidateQueries({ queryKey: keys.currentGeneration(userId) });
  }, [terminal, userId, qc]);
  const start = (form: GenerationRequest) => {
    // 建会话／写 Brief 期间可能切页或退出；迟到调用不能借新账号启动任务。
    if (!mounted.current || qc.getQueryData<MeView>(keys.me)?.id !== userId || running || run.starting) return;
    // 以实际提交的表单为准；生成完成时不能误存用户刚在首页修改的新草稿。
    pendingPreference.current = {
      preferences: [...new Set(form.preferences)], transportMode: form.transportMode ?? 'transit',
      pace: form.pace ?? 'moderate', partySize: form.partySize, extraNotes: form.extraNotes,
    };
    run.start(form);
  };
  const startEvent = run.events.find((event) => event.type === 'job_start');
  return <Context.Provider value={{ ...run, start, running, discovering: current.isPending,
    destination: startEvent?.destination ?? current.data?.destination ?? '',
    days: startEvent?.days ?? current.data?.days ?? 0,
  }}>{children}</Context.Provider>;
}

export function useActiveGeneration() {
  const value = useContext(Context);
  if (!value) throw new Error('GenerationProvider is required');
  return value;
}

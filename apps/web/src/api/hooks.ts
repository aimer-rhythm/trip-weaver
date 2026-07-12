import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  GenerateForm,
  GenerationJobView,
  GenerationJobStatus,
  LoginBody,
  RegisterBody,
  SettingsPut,
  Trip,
  TripExport,
  TripListItem,
  UsageView,
} from '@tripweaver/shared';
import { ApiError, api } from './client';

export interface MeView {
  id: string;
  email: string;
}

export interface AuthConfigView {
  registrationMode: 'open' | 'invite' | 'closed';
  githubEnabled: boolean;
}

export interface SettingsView {
  byokEnabled: boolean;
  baseUrl: string;
  model: string;
  apiKeyLast4: string;
  hasSiteKey: boolean;
  hasPersonalAmapKey: boolean;
  amapApiKeyLast4: string;
  hasSiteAmapKey: boolean;
  hasPersonalSearchKey: boolean;
  searchApiKeyLast4: string;
  searchApiBaseUrl: string;
  hasSiteSearchKey: boolean;
}

export const keys = {
  me: ['me'] as const,
  authConfig: ['auth-config'] as const,
  settings: ['settings'] as const,
  sourcesStatus: ['sources-status'] as const,
  usage: ['usage'] as const,
  trips: ['trips'] as const,
  trip: (id: string) => ['trips', id] as const,
};

export function useAuthConfig() {
  return useQuery({
    queryKey: keys.authConfig,
    queryFn: () => api.get<AuthConfigView>('/api/auth/config'),
    staleTime: 10 * 60_000,
  });
}

export function useMe() {
  return useQuery({
    queryKey: keys.me,
    queryFn: () => api.get<MeView>('/api/auth/me'),
    retry: (count, error) => !(error instanceof ApiError && error.status === 401) && count < 2,
    staleTime: 5 * 60_000,
  });
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: LoginBody) => api.post<MeView>('/api/auth/login', body),
    onSuccess: () => qc.invalidateQueries(),
  });
}

export function useRegister() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: RegisterBody) => api.post<MeView>('/api/auth/register', body),
    onSuccess: () => qc.invalidateQueries(),
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ ok: true }>('/api/auth/logout'),
    onSuccess: () => qc.clear(),
  });
}

export function useSettings() {
  return useQuery({ queryKey: keys.settings, queryFn: () => api.get<SettingsView>('/api/settings') });
}

export function useSaveSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SettingsPut) => api.put<SettingsView>('/api/settings', body),
    onSuccess: (view) => {
      qc.setQueryData(keys.settings, view);
      qc.invalidateQueries({ queryKey: keys.sourcesStatus });
    },
  });
}

export function useUsage() {
  return useQuery({ queryKey: keys.usage, queryFn: () => api.get<UsageView>('/api/usage') });
}

export function useTrips() {
  return useQuery({ queryKey: keys.trips, queryFn: () => api.get<TripListItem[]>('/api/trips') });
}

export function useTrip(id: string) {
  return useQuery({ queryKey: keys.trip(id), queryFn: () => api.get<Trip>(`/api/trips/${id}`) });
}

export function useImportTrip() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: TripExport) => api.post<Trip>('/api/trips', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.trips }),
  });
}

export function useSaveTrip() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (trip: Trip) => api.put<Trip>(`/api/trips/${trip.id}`, trip),
    onSuccess: (trip) => {
      qc.setQueryData(keys.trip(trip.id), trip);
      qc.invalidateQueries({ queryKey: keys.trips });
    },
  });
}

export function useRenameTrip() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) =>
      api.patch<{ ok: true }>(`/api/trips/${id}/title`, { title }),
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: keys.trips });
      qc.invalidateQueries({ queryKey: keys.trip(id) });
    },
  });
}

export function useDeleteTrip() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<{ ok: true }>(`/api/trips/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.trips }),
  });
}

// ---------- 智能生成（C3） ----------

/** 单个调研数据源自检状态（服务端 integrations/sourceStatus 同形状） */
export interface SourceStatusView {
  configured: boolean;
  checked: boolean;
  ok: boolean | null;   // null = 未配置（无从探测）
  message: string;
}

export interface SourcesStatusView {
  amap: SourceStatusView;
  websearch: SourceStatusView;
}

export function useStartGeneration() {
  return useMutation({
    mutationFn: (form: GenerateForm) => api.post<{ jobId: string }>('/api/generations', form),
  });
}

const CANCEL_STATUS_POLL_INTERVAL_MS = 250;
const CANCEL_STATUS_POLL_ATTEMPTS = 40;

interface CancelGenerationResponse {
  ok: boolean;
  status?: GenerationJobStatus;
}

function cancellationStatusError(status: GenerationJobStatus): Error {
  const statusLabel = status === 'done' ? '已完成' : status === 'error' ? '已失败' : status;
  return new Error(`任务${statusLabel}，无法取消`);
}

async function cancelGenerationAndWait(jobId: string): Promise<GenerationJobView> {
  const response = await api.post<CancelGenerationResponse>(`/api/generations/${jobId}/cancel`);
  if (!response.ok && response.status && response.status !== 'cancelled') {
    throw cancellationStatusError(response.status);
  }

  for (let attempt = 0; attempt < CANCEL_STATUS_POLL_ATTEMPTS; attempt += 1) {
    const snapshot = await fetchJobSnapshot(jobId);
    if (snapshot.status === 'cancelled') return snapshot;
    if (snapshot.status !== 'running') throw cancellationStatusError(snapshot.status);
    await new Promise<void>((resolve) => setTimeout(resolve, CANCEL_STATUS_POLL_INTERVAL_MS));
  }

  throw new Error('取消请求已接受，但状态确认超时，请重试');
}

export function useCancelGeneration() {
  return useMutation({
    mutationFn: cancelGenerationAndWait,
  });
}

/** 刷新恢复：查任务快照（404 = 任务过期） */
export function fetchJobSnapshot(jobId: string): Promise<GenerationJobView> {
  return api.get<GenerationJobView>(`/api/generations/${jobId}`);
}

export function useSourcesStatus(enabled: boolean) {
  return useQuery({
    queryKey: keys.sourcesStatus,
    queryFn: () => api.get<SourcesStatusView>('/api/settings/sources-status'),
    enabled,
    staleTime: 30_000,
    retry: false,
  });
}

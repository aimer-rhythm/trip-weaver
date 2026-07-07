import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  GenerateForm,
  GenerationJobView,
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

export interface SettingsView {
  byokEnabled: boolean;
  baseUrl: string;
  model: string;
  apiKeyLast4: string;
  hasSiteKey: boolean;
}

export const keys = {
  me: ['me'] as const,
  settings: ['settings'] as const,
  usage: ['usage'] as const,
  trips: ['trips'] as const,
  trip: (id: string) => ['trips', id] as const,
};

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
    onSuccess: (view) => qc.setQueryData(keys.settings, view),
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

export interface XhsStatusView {
  configured: boolean;
  checked: boolean;
  ok: boolean | null;
  loggedIn: boolean | null;
  message: string;
}

export function useStartGeneration() {
  return useMutation({
    mutationFn: (form: GenerateForm) => api.post<{ jobId: string }>('/api/generations', form),
  });
}

export function useCancelGeneration() {
  return useMutation({
    mutationFn: (jobId: string) => api.post<{ ok: boolean }>(`/api/generations/${jobId}/cancel`),
  });
}

/** 刷新恢复：查任务快照（404 = 任务过期） */
export function fetchJobSnapshot(jobId: string): Promise<GenerationJobView> {
  return api.get<GenerationJobView>(`/api/generations/${jobId}`);
}

export function useXhsStatus(enabled: boolean) {
  return useQuery({
    queryKey: ['xhs-status'] as const,
    queryFn: () => api.get<XhsStatusView>('/api/settings/xhs-status'),
    enabled,
    staleTime: 30_000,
    retry: false,
  });
}

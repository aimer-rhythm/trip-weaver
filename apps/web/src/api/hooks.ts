import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  Conversation,
  ConversationDetail,
  GenerateForm,
  GenerationJobView,
  GenerationJobStatus,
  LoginBody,
  PlanningBriefPatch,
  RegisterBody,
  SendMessageResult,
  SettingsPut,
  Trip,
  TripExport,
  TripListItem,
  TripVersionChain,
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
  conversations: ['conversations'] as const,
  conversation: (id: string) => ['conversations', id] as const,
  tripVersions: (id: string) => ['trips', id, 'versions'] as const,
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

/** 版本链（详情页版本切换）。只有一版时也要请求：用它判断要不要显示切换器 */
export function useTripVersions(id: string) {
  return useQuery({
    queryKey: keys.tripVersions(id),
    queryFn: () => api.get<TripVersionChain>(`/api/trips/${id}/versions`),
    enabled: Boolean(id),
  });
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

/**
 * 生成请求：既有表单 + 对话来源标注。
 * conversationId / kind / targetTripId 都是可选的（表单入口全不传）；
 * kind=revision 时必须带 targetTripId，服务端会校验行程归属。
 */
export type GenerationRequest = GenerateForm & {
  conversationId?: string;
  kind?: 'generation' | 'revision';
  targetTripId?: string;
};

export function useStartGeneration() {
  return useMutation({
    mutationFn: (form: GenerationRequest) => api.post<{ jobId: string }>('/api/generations', form),
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

// ---------- 问答式入口（09-23） ----------

/** Conversation 列表响应（服务端与 chatUsage 一起返回，省一次请求） */
export interface ConversationListView {
  conversations: Conversation[];
  chatUsage: UsageView;
}

export function useConversations() {
  return useQuery({ queryKey: keys.conversations, queryFn: () => api.get<ConversationListView>('/api/conversations') });
}

export function useConversation(id: string | null) {
  return useQuery({
    queryKey: keys.conversation(id ?? ''),
    queryFn: () => api.get<ConversationDetail>(`/api/conversations/${id}`),
    enabled: Boolean(id),
  });
}

/** 行程 → 来源会话反查（编辑器内嵌对话用）；无关联会话时 conversationId 为 null */
export function useTripConversation(tripId: string | null) {
  return useQuery({
    queryKey: ['trips', tripId ?? '', 'conversation'] as const,
    queryFn: () => api.get<{ conversationId: string | null }>(`/api/trips/${tripId}/conversation`),
    enabled: Boolean(tripId),
  });
}

/** 惰性建会话：只在真正要发第一条消息时创建，不在页面挂载时就留下空会话行 */
export function useCreateConversation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<Conversation>('/api/conversations', {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.conversations }),
  });
}

export function useDeleteConversation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<{ ok: true }>(`/api/conversations/${id}`),
    onSuccess: (_data, id) => {
      qc.removeQueries({ queryKey: keys.conversation(id) });
      qc.invalidateQueries({ queryKey: keys.conversations });
    },
  });
}

/**
 * 一轮往返后让详情失效重取，而不是把服务端对象拼进缓存：
 * 会话刚创建时详情请求可能在途，拼缓存会与之竞态；一次重取的代价远小于脏读。
 * 乐观气泡（pendingText）负责观感上的即时性。
 */
function refreshAfterTurn(qc: ReturnType<typeof useQueryClient>, id: string): void {
  qc.invalidateQueries({ queryKey: keys.conversation(id) });
  qc.invalidateQueries({ queryKey: keys.conversations });
}

export function useSendMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, text }: { id: string; text: string }) =>
      api.post<SendMessageResult>(`/api/conversations/${id}/messages`, { text }),
    onSuccess: (_result, { id }) => refreshAfterTurn(qc, id),
  });
}

/** 确认卡上的字段编辑：服务端补 id / 来源序号，返回与发消息同形状的结果 */
export function usePatchBrief() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: PlanningBriefPatch }) =>
      api.patch<SendMessageResult>(`/api/conversations/${id}/brief`, patch),
    onSuccess: (_result, { id }) => refreshAfterTurn(qc, id),
  });
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

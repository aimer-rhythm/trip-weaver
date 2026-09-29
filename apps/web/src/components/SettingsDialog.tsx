import { useState, type FormEvent } from 'react';
import { useSaveSettings, useSettings, useSourcesStatus, useUsage, type SourceStatusView } from '../api/hooks';
import { Modal } from './Modal';

// 两条链的服务商显示名（09-25 二次调整：两家属**互补分工**，不再有单一开关）。
// 自检卡片要让用户看出每条链实际走的是哪家，不用去翻服务端日志。
const PROVIDER_LABEL: Record<'amap' | 'tianditu' | 'null', string> = {
  amap: '高德',
  tianditu: '天地图',
  null: '未配置（整链降级）',
};

// 常见厂商预设：直接给完整 /v1 地址，绕开 baseUrl 填写坑
const PRESETS = [
  { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { label: 'Kimi', baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-32k' },
  { label: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-air' },
  { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
];

// 数据源状态行：● 正常 / ● 异常 / ○ 未配置
function SourceStatusRow({ label, status, loading }: { label: string; status?: SourceStatusView; loading: boolean }) {
  return (
    <p className={"source-status flex [gap:10px] [font-size:0.85rem] [margin:0_0_8px] [align-items:baseline] [&_.muted:first-child]:[min-width:88px]"}>
      <span className={"muted [color:var(--color-muted)] [font-size:0.88rem]"}>{label}</span>
      {loading ? (
        <span className={"muted [color:var(--color-muted)] [font-size:0.88rem]"}>检测中…</span>
      ) : status ? (
        <span className={status.ok ? "status-ok [color:var(--color-ok)]" : status.ok === false ? "status-err [color:var(--color-danger)]" : "muted [color:var(--color-muted)] [font-size:0.88rem]"}>
          {status.ok ? '● ' : status.ok === false ? '● ' : '○ '}
          {status.message}
        </span>
      ) : (
        <span className={"muted [color:var(--color-muted)] [font-size:0.88rem]"}>—</span>
      )}
    </p>
  );
}

export function SettingsDialog({ email, onClose }: { email: string; onClose: () => void }) {
  const settings = useSettings();
  const usage = useUsage();
  const save = useSaveSettings();

  const [advancedOpen, setAdvancedOpen] = useState(false);
  const sources = useSourcesStatus(advancedOpen);   // 折叠区展开才探测，避免无谓外呼

  const [byokEnabled, setByokEnabled] = useState<boolean | null>(null);
  const [baseUrl, setBaseUrl] = useState<string | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [amapApiKey, setAmapApiKey] = useState('');
  const [clearAmapApiKey, setClearAmapApiKey] = useState(false);
  const [searchApiKey, setSearchApiKey] = useState('');
  const [searchApiBaseUrl, setSearchApiBaseUrl] = useState<string | null>(null);
  const [clearSearchConfig, setClearSearchConfig] = useState(false);
  const [message, setMessage] = useState('');

  if (settings.isPending) {
    return (
      <Modal title="设置" onClose={onClose}>
        <p>加载中…</p>
      </Modal>
    );
  }
  const view = settings.data;

  const curByok = byokEnabled ?? view?.byokEnabled ?? false;
  const curBaseUrl = baseUrl ?? view?.baseUrl ?? '';
  const curModel = model ?? view?.model ?? '';
  const curSearchApiBaseUrl = searchApiBaseUrl ?? view?.searchApiBaseUrl ?? '';

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setMessage('');
    save.mutate(
      {
        byokEnabled: curByok,
        baseUrl: curBaseUrl,
        model: curModel,
        ...(apiKey ? { apiKey } : {}),
        ...(amapApiKey ? { amapApiKey } : {}),
        ...(clearAmapApiKey ? { clearAmapApiKey: true } : {}),
        ...(clearSearchConfig
          ? { clearSearchConfig: true }
          : {
              searchApiBaseUrl: curSearchApiBaseUrl,
              ...(searchApiKey ? { searchApiKey } : {}),
            }),
      },
      {
        onSuccess: () => {
          setApiKey('');
          setAmapApiKey('');
          setClearAmapApiKey(false);
          setSearchApiKey('');
          setSearchApiBaseUrl(null);
          setClearSearchConfig(false);
          setMessage('已保存');
        },
        onError: (err) => setMessage(err.message),
      },
    );
  };

  return (
    <Modal title="设置" onClose={onClose}>
      <section className={"settings-plain [&_p]:[margin:6px_0] [&_p]:[font-size:0.92rem] [&_p]:flex [&_p]:[gap:10px] [&_.muted]:[min-width:88px]"}>
        <p>
          <span className={"muted [color:var(--color-muted)] [font-size:0.88rem]"}>账号</span> {email}
        </p>
        {usage.data && (
          <p>
            <span className={"muted [color:var(--color-muted)] [font-size:0.88rem]"}>今日生成额度</span> 剩余 {usage.data.remaining} / {usage.data.dailyLimit} 次（次日零点重置）
          </p>
        )}
        <p>
          <span className={"muted [color:var(--color-muted)] [font-size:0.88rem]"}>AI 服务</span>{' '}
          {view?.byokEnabled ? '使用我自己的 Key' : view?.hasSiteKey ? '由本站提供（无需配置）' : '站点未配置，需在高级选项填写自有 Key'}
        </p>
      </section>

      <details className={"settings-advanced [margin-top:16px] [border-top:1px_solid_var(--color-border)] [padding-top:12px] [&_summary]:cursor-pointer [&_summary]:[color:var(--color-muted)] [&_summary]:[font-size:0.88rem] [&_summary]:[margin-bottom:12px]"} open={advancedOpen} onToggle={(e) => setAdvancedOpen((e.target as HTMLDetailsElement).open)}>
        <summary>高级选项（API Key 与数据源）</summary>
        <SourceStatusRow
          label={`地点搜索（${PROVIDER_LABEL[sources.data?.searchProvider ?? 'tianditu']}）`}
          status={sources.data?.poi}
          loading={sources.isFetching}
        />
        {/* 路线链不做主动探测（无 selfCheck）：只如实报告当前走哪家，异常由生成时的 [amap-route] warn 暴露 */}
        <SourceStatusRow
          label="路线与地理编码"
          status={
            sources.data
              ? {
                  configured: sources.data.routeProvider !== 'null',
                  checked: false,
                  ok: null,
                  message: `当前走 ${PROVIDER_LABEL[sources.data.routeProvider]}（高德优先，缺 AMAP_KEY 时降级天地图）`,
                }
              : undefined
          }
          loading={sources.isFetching}
        />
        <SourceStatusRow label="全网搜索" status={sources.data?.websearch} loading={sources.isFetching} />
        <form onSubmit={submit} className={"form flex flex-col [gap:12px] [&_label]:flex [&_label]:flex-col [&_label]:[gap:5px] [&_label]:[font-size:0.88rem] [&_label]:[color:var(--color-muted)] [&_input:not([type='checkbox'])]:[border:1px_solid_var(--color-border)] [&_input:not([type='checkbox'])]:[border-radius:var(--radius)] [&_input:not([type='checkbox'])]:[padding:9px_11px] [&_input:not([type='checkbox'])]:[font-size:0.95rem] [&_input:not([type='checkbox'])]:[color:var(--color-text)] [&_input:not([type='checkbox'])]:[background:var(--color-card)] [&_input:focus]:[outline:2px_solid_var(--color-primary)] [&_input:focus]:[outline-offset:0] [&_input:focus]:[border-color:transparent] [&_select]:[border:1px_solid_var(--color-border)] [&_select]:[border-radius:var(--radius)] [&_select]:[padding:9px_11px] [&_select]:[font-size:0.95rem] [&_select]:[background:var(--color-card)] [&_select]:[color:var(--color-text)]"}>
          <label className={"check-row [flex-direction:row]! items-center [gap:8px]! [color:var(--color-text)]!"}>
            <input type="checkbox" checked={curByok} onChange={(e) => setByokEnabled(e.target.checked)} />
            使用我自己的 OpenAI 兼容 Key（配置后生成走你自己的账户计费）
          </label>
          <div className={"preset-row flex [gap:8px] flex-wrap"}>
            {PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                className={"btn [border:1px_solid_transparent] cursor-pointer [background:none] [color:var(--color-text)] inline-flex items-center [gap:4px] [&:disabled]:[opacity:0.55] [&:disabled]:[cursor:not-allowed] btn-chip [border-color:var(--color-border)] rounded-full [padding:4px_12px] [font-size:0.82rem] [&.is-active]:[background:var(--color-primary)] [&.is-active]:[border-color:var(--color-primary)] [&.is-active]:[color:var(--color-btn-primary-color-3)]"}
                onClick={() => {
                  setBaseUrl(p.baseUrl);
                  setModel(p.model);
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
          <label>
            Base URL
            <input value={curBaseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.deepseek.com/v1" />
          </label>
          <label>
            API Key
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={view?.apiKeyLast4 ? `已保存（尾号 ${view.apiKeyLast4}），留空则不修改` : 'sk-…'}
            />
          </label>
          <label>
            模型名
            <input value={curModel} onChange={(e) => setModel(e.target.value)} placeholder="deepseek-chat" />
          </label>
          <label>
            高德 Web 服务 Key
            <input
              type="password"
              value={amapApiKey}
              onChange={(e) => {
                setAmapApiKey(e.target.value);
                if (e.target.value) setClearAmapApiKey(false);
              }}
              placeholder={
                view?.hasPersonalAmapKey
                  ? `已保存个人 Key（尾号 ${view.amapApiKeyLast4}），留空则不修改`
                  : view?.hasSiteAmapKey
                    ? '当前使用站点默认 Key；填写后仅你的任务优先使用个人 Key'
                    : '填写高德 Web 服务 Key；留空保持未配置'
              }
            />
          </label>
          <p className={"muted [color:var(--color-muted)] [font-size:0.88rem]"}>
            当前高德配置：
            {view?.hasPersonalAmapKey
              ? `个人 Key（尾号 ${view.amapApiKeyLast4}）`
              : view?.hasSiteAmapKey
                ? '站点默认 Key'
                : '未配置，生成时自动降级'}
          </p>
          {view?.hasPersonalAmapKey && (
            <label className={"check-row [flex-direction:row]! items-center [gap:8px]! [color:var(--color-text)]!"}>
              <input
                type="checkbox"
                checked={clearAmapApiKey}
                onChange={(e) => {
                  setClearAmapApiKey(e.target.checked);
                  if (e.target.checked) setAmapApiKey('');
                }}
              />
              清除已保存的个人高德 Key（保存后恢复站点默认或未配置降级）
            </label>
          )}
          <label>
            Web 搜索 API Key
            <input
              type="password"
              value={searchApiKey}
              disabled={clearSearchConfig}
              onChange={(e) => {
                setSearchApiKey(e.target.value);
                if (e.target.value) setClearSearchConfig(false);
              }}
              placeholder={
                view?.hasPersonalSearchKey
                  ? `已保存个人 Key（尾号 ${view.searchApiKeyLast4}），留空则不修改`
                  : view?.hasSiteSearchKey
                    ? '当前使用站点默认 Key；填写后仅你的任务优先使用个人配置'
                    : '填写 LangSearch 或兼容服务 API Key'
              }
            />
          </label>
          <label>
            Web 搜索 Base URL
            <input
              value={curSearchApiBaseUrl}
              disabled={clearSearchConfig}
              onChange={(e) => setSearchApiBaseUrl(e.target.value)}
              placeholder="https://api.langsearch.com（新配置留空时使用此默认值）"
            />
          </label>
          <p className={"muted [color:var(--color-muted)] [font-size:0.88rem]"}>
            当前 Web 搜索配置：
            {view?.hasPersonalSearchKey
              ? `个人配置（Key 尾号 ${view.searchApiKeyLast4}，${view.searchApiBaseUrl}）`
              : view?.hasSiteSearchKey
                ? '站点默认配置'
                : '未配置，生成时自动降级'}
          </p>
          {view?.hasPersonalSearchKey && (
            <label className={"check-row [flex-direction:row]! items-center [gap:8px]! [color:var(--color-text)]!"}>
              <input
                type="checkbox"
                checked={clearSearchConfig}
                onChange={(e) => {
                  setClearSearchConfig(e.target.checked);
                  if (e.target.checked) {
                    setSearchApiKey('');
                    setSearchApiBaseUrl(null);
                  }
                }}
              />
              清除已保存的个人 Web 搜索 Key 与 Base URL（保存后恢复站点默认或未配置降级）
            </label>
          )}
          <div className={"form-foot flex items-center [justify-content:flex-end] [gap:12px]"}>
            {message && <span className={"form-msg [color:var(--color-ok)] [font-size:0.85rem]"}>{message}</span>}
            <button type="submit" className={"btn [border:1px_solid_transparent] [border-radius:var(--radius)] [padding:8px_14px] [font-size:0.9rem] cursor-pointer inline-flex items-center [gap:4px] [&:disabled]:[opacity:0.55] [&:disabled]:[cursor:not-allowed] btn-primary [background:var(--color-primary)] [color:var(--color-btn-primary-color-3)] [&:not(:disabled):hover]:[background:var(--color-primary-dark)]"} disabled={save.isPending}>
              {save.isPending ? '保存中…' : '保存'}
            </button>
          </div>
        </form>
      </details>
    </Modal>
  );
}

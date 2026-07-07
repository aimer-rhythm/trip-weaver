import { useState, type FormEvent } from 'react';
import { useSaveSettings, useSettings, useUsage, useXhsStatus } from '../api/hooks';
import { Modal } from './Modal';

// 常见厂商预设：直接给完整 /v1 地址，绕开 baseUrl 填写坑
const PRESETS = [
  { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { label: 'Kimi', baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-32k' },
  { label: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-air' },
  { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
];

export function SettingsDialog({ email, onClose }: { email: string; onClose: () => void }) {
  const settings = useSettings();
  const usage = useUsage();
  const save = useSaveSettings();

  const [advancedOpen, setAdvancedOpen] = useState(false);
  const xhs = useXhsStatus(advancedOpen);   // 折叠区展开才探测，避免无谓外呼

  const [byokEnabled, setByokEnabled] = useState<boolean | null>(null);
  const [baseUrl, setBaseUrl] = useState<string | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState('');
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

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setMessage('');
    save.mutate(
      {
        byokEnabled: curByok,
        baseUrl: curBaseUrl,
        model: curModel,
        ...(apiKey ? { apiKey } : {}),
      },
      {
        onSuccess: () => {
          setApiKey('');
          setMessage('已保存');
        },
        onError: (err) => setMessage(err.message),
      },
    );
  };

  return (
    <Modal title="设置" onClose={onClose}>
      <section className="settings-plain">
        <p>
          <span className="muted">账号</span> {email}
        </p>
        {usage.data && (
          <p>
            <span className="muted">今日生成额度</span> 剩余 {usage.data.remaining} / {usage.data.dailyLimit} 次（次日零点重置）
          </p>
        )}
        <p>
          <span className="muted">AI 服务</span>{' '}
          {view?.byokEnabled ? '使用我自己的 Key' : view?.hasSiteKey ? '由本站提供（无需配置）' : '站点未配置，需在高级选项填写自有 Key'}
        </p>
      </section>

      <details className="settings-advanced" open={advancedOpen} onToggle={(e) => setAdvancedOpen((e.target as HTMLDetailsElement).open)}>
        <summary>高级选项（使用自己的 API Key）</summary>
        <p className="xhs-status">
          <span className="muted">小红书数据源</span>
          {xhs.isFetching ? (
            <span className="muted">检测中…</span>
          ) : xhs.data ? (
            <span className={xhs.data.ok && xhs.data.loggedIn ? 'status-ok' : xhs.data.ok === false ? 'status-err' : 'muted'}>
              {xhs.data.ok && xhs.data.loggedIn ? '● ' : xhs.data.ok === false ? '● ' : '○ '}
              {xhs.data.message}
            </span>
          ) : (
            <span className="muted">—</span>
          )}
        </p>
        <form onSubmit={submit} className="form">
          <label className="check-row">
            <input type="checkbox" checked={curByok} onChange={(e) => setByokEnabled(e.target.checked)} />
            使用我自己的 OpenAI 兼容 Key（配置后生成走你自己的账户计费）
          </label>
          <div className="preset-row">
            {PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                className="btn btn-chip"
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
          <div className="form-foot">
            {message && <span className="form-msg">{message}</span>}
            <button type="submit" className="btn btn-primary" disabled={save.isPending}>
              {save.isPending ? '保存中…' : '保存'}
            </button>
          </div>
        </form>
      </details>
    </Modal>
  );
}

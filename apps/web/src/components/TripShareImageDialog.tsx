import { useEffect, useRef, useState } from 'react';
import type { Trip, TripShareImageResponse } from '@tripweaver/shared';
import { api } from '../api/client';
import { downloadShareImage, isWeChat } from '../lib/export';
import { Modal } from './Modal';
import { Button, Spinner } from './ui/Button';

export function TripShareImageDialog({ trip, open, onClose }: { trip: Trip; open: boolean; onClose: () => void }) {
  const [image, setImage] = useState<TripShareImageResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const mounted = useRef(true);
  const inFlight = useRef(false);
  const signature = JSON.stringify([trip.id, trip.title, trip.destination, trip.days.map(day => day.activities.map(activity => [activity.category, activity.name]))]);
  const currentSignature = useRef(signature);
  currentSignature.current = signature;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { setImage(null); setError(''); }, [signature]);

  async function generate() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    const requestedSignature = signature;
    try {
      const result = await api.post<TripShareImageResponse>(`/api/trips/${encodeURIComponent(trip.id)}/share-image`, { trip });
      if (!mounted.current) return;
      if (requestedSignature !== currentSignature.current) { setError('行程已更新，请根据最新行程重新生成'); return; }
      if (!result || !['image/png', 'image/jpeg', 'image/webp'].includes(result.mimeType) || typeof result.dataUrl !== 'string' || !result.dataUrl.startsWith(`data:${result.mimeType};base64,`)) throw new Error('图片响应异常，请重试');
      setImage(result);
    } catch (reason) {
      if (mounted.current) setError(reason instanceof Error ? reason.message : '图片生成失败，请重试');
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  if (!open) return null;
  return <Modal title="AI 行程分享图" onClose={onClose}>
    <p className="mt-0 text-sm leading-relaxed text-ink-muted">把每日路线与目的地风景，绘成一张适合分享的旅行海报。</p>
    <div className="overflow-hidden rounded-2xl border border-solid border-[var(--color-border)] bg-canvas">
      {image ? <img src={image.dataUrl} alt={`${trip.title} AI 行程分享图`} className="block h-auto w-full" /> :
        <div className="flex min-h-64 flex-col items-center justify-center gap-4 px-6 py-10 text-center" aria-busy={busy}>
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand/10 text-brand">
            {busy ? <Spinner /> : <svg aria-hidden="true" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="3" width="18" height="18" rx="4" /><path d="m3 16 5-5 5 5 3-3 5 5" /><circle cx="16" cy="8" r="1.5" /></svg>}
          </div>
          <div role="status" aria-live="polite">
            <p className="m-0 font-semibold">{busy ? '正在绘制你的旅行海报…' : trip.destination}</p>
            <p className="mb-0 mt-2 text-sm text-ink-muted">{busy ? '生成可能需要几分钟，关闭弹窗后仍会继续。' : `${trip.days.length} 天行程 · 竖版插画 · 中文路线摘要`}</p>
          </div>
        </div>}
    </div>
    {error && <p role="alert" className="mt-3 text-sm text-[var(--color-danger)]">{error}</p>}
    <p className="my-3 text-xs leading-relaxed text-ink-muted">AI 图片用于灵感分享，出行请以行程详情为准。{image && isWeChat() ? '长按图片可保存或发送给朋友。' : ''}</p>
    <div className="flex justify-end gap-2">
      <Button onClick={onClose}>{busy ? '稍后查看' : '关闭'}</Button>
      {image ? <Button variant="primary" onClick={() => downloadShareImage(image, trip.title)}>下载图片</Button> :
        <Button variant="primary" loading={busy} loadingText="生成中…" onClick={() => { void generate(); }}>{error ? '重试生成' : '生成分享图'}</Button>}
    </div>
  </Modal>;
}

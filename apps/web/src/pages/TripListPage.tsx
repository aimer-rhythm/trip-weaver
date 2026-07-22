import { useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { TRIP_EXPORT_VERSION, makeSampleTrip, type Trip } from '@tripweaver/shared';
import { useDeleteTrip, useImportTrip, useRenameTrip, useTrips } from '../api/hooks';
import { api } from '../api/client';
import { exportTripJson } from '../lib/export';

function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${d.getMonth() + 1}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function TripListPage() {
  const trips = useTrips();
  const importTrip = useImportTrip();
  const renameTrip = useRenameTrip();
  const deleteTrip = useDeleteTrip();
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);

  const loadSample = () => {
    importTrip.mutate(
      { version: TRIP_EXPORT_VERSION, trip: makeSampleTrip() },
      { onSuccess: (trip) => navigate(`/trips/${trip.id}`) },
    );
  };

  const onImportFile = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text());
      importTrip.mutate(parsed, {
        onSuccess: (trip) => navigate(`/trips/${trip.id}`),
        onError: (err) => alert(`导入失败：${err.message}`),
      });
    } catch {
      alert('导入失败：文件不是合法的 JSON');
    }
  };

  const onRename = (id: string, current: string) => {
    const title = window.prompt('新的行程名称', current)?.trim();
    if (title && title !== current) renameTrip.mutate({ id, title });
  };

  const onDelete = (id: string, title: string) => {
    if (window.confirm(`确定删除行程「${title}」？此操作不可恢复。`)) deleteTrip.mutate(id);
  };

  // 列表级导出：取全量数据后走统一导出函数（F7）
  const onExport = async (id: string) => {
    try {
      exportTripJson(await api.get<Trip>(`/api/trips/${id}`));
    } catch (err) {
      alert(`导出失败：${err instanceof Error ? err.message : '未知错误'}`);
    }
  };

  return (
    <div className="page trip-list-page">
      <div className="page-head">
        <h1>我的行程</h1>
        <div className="page-head-actions">
          <button type="button" className="btn btn-ghost" onClick={() => fileRef.current?.click()}>
            导入 JSON
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onImportFile(f);
              e.target.value = '';
            }}
          />
          <Link to="/trips/new" className="btn btn-primary">
            ＋ 新建行程
          </Link>
        </div>
      </div>

      {trips.isPending && <p className="muted">加载中…</p>}

      {trips.data && trips.data.length === 0 && (
        <div className="empty-state">
          <p className="empty-title">还没有行程</p>
          <p className="muted">让 AI 为你规划一趟旅行，或先用示例行程逛逛各项功能。</p>
          <div className="empty-actions">
            <Link to="/trips/new" className="btn btn-primary">
              开始规划
            </Link>
            <button type="button" className="btn btn-ghost" onClick={loadSample} disabled={importTrip.isPending}>
              {importTrip.isPending ? '加载中…' : '加载示例行程'}
            </button>
          </div>
        </div>
      )}

      <div className="trip-cards">
        {trips.data?.map((t) => (
          <div key={t.id} className="trip-card">
            <Link to={`/trips/${t.id}`} className="trip-card-main">
              <span className="trip-card-title">{t.title}</span>
              <span className="trip-card-meta">
                {t.destination} · {t.daysCount} 天 · {t.activityCount} 个活动
              </span>
              <span className="trip-card-time muted">更新于 {formatTime(t.updatedAt)}</span>
            </Link>
            <div className="trip-card-actions">
              <button type="button" className="btn btn-ghost" onClick={() => void onExport(t.id)}>
                导出
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => onRename(t.id, t.title)}>
                重命名
              </button>
              <button type="button" className="btn btn-ghost btn-danger" onClick={() => onDelete(t.id, t.title)}>
                删除
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

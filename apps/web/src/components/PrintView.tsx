// 打印/长图共用的线性排版视图（全文，不含地图与概览候选池）——常驻离屏渲染
import type { Trip } from '@tripweaver/shared';
import { dayColor } from '../lib/colors';
import { DATA_SOURCE_LABEL } from '../lib/poi';

function timeRange(start: string, end: string): string {
  if (!start && !end) return '';
  return `${start || '--:--'} ~ ${end || '--:--'}`;
}

export function PrintView({ trip }: { trip: Trip }) {
  // 数据来源标注（依 meta.dataSources；旧行程无该字段则不显示）
  const sources = trip.meta.dataSources ?? [];
  return (
    <div className="pv">
      <header className="pv-head">
        <h1>{trip.title}</h1>
        <p className="pv-sub">
          {trip.destination} · {trip.days.length} 天 · {trip.partySize} 人
          {trip.startDate ? ` · ${trip.startDate} 出发` : ''}
        </p>
        {sources.length > 0 && <p className="pv-tag">🧭 行程参考了{sources.map((s) => DATA_SOURCE_LABEL[s]).join('与')}</p>}
      </header>

      {trip.days.map((day) => (
        <section key={day.id} className="pv-day">
          <h2 style={{ borderLeftColor: dayColor(day.dayIndex) }}>
            第 {day.dayIndex} 天{day.title ? ` · ${day.title}` : ''}
          </h2>
          {day.activities.length === 0 && <p className="pv-empty">（本日暂无安排）</p>}
          {day.activities.map((a) => (
            <div key={a.id} className="pv-activity">
              <div className="pv-activity-line">
                <span className="pv-time">{timeRange(a.startTime, a.endTime)}</span>
                <strong className="pv-name">{a.name}</strong>
                <span className="pv-cat">{a.category}</span>
              </div>
              {a.description && <p className="pv-desc">{a.description}</p>}
              {a.sourceNotes.length > 0 && (
                <p className="pv-notes">
                  来源：
                  {a.sourceNotes.map((n) => (
                    <span key={n.url}>🔗 {n.title || n.url} </span>
                  ))}
                </p>
              )}
            </div>
          ))}
        </section>
      ))}

      {trip.meta.reviewNotes.length > 0 && (
        <section className="pv-review">
          <h2>小贴士</h2>
          {trip.meta.reviewNotes.map((n, i) => (
            <p key={i}>· {n}</p>
          ))}
        </section>
      )}

      <footer className="pv-foot">由 织程 TripWeaver 生成</footer>
    </div>
  );
}

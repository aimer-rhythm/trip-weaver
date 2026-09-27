// 范围日历（09-26，交互参考 Yuntu InputPage.CustomCalendarRange）：
// 点第一次定出发日，悬停预览区间，点第二次定返回日；跨度超过 maxDays 时自动收短到上限。
// 纯受控组件：值由父组件持有，这里只负责网格渲染与两次点击的区间语义。
// months 控制并列月数（首页日期浮层用 2 个月并排，其它调用方默认 1）；
// footSlot 用于替换底栏内容（首页把「已选摘要 + 收起」交给调用方渲染）。
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];

function toISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseDate(iso: string): Date {
  const [y = 1970, m = 1, d = 1] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** 周一开头的 35 格月历 */
function generateMonthGrid(year: number, month: number): Date[] {
  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7;
  const gridStart = new Date(year, month, 1 - offset);
  return Array.from(
    { length: 35 },
    (_, i) => new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i),
  );
}

interface Props {
  startDate: string;   // "2026-11-05"
  endDate: string;
  maxDays: number;
  onRangeChange: (start: string, end: string) => void;
  months?: number;
  footSlot?: ReactNode;
}

export function RangeCalendar({ startDate, endDate, maxDays, onRangeChange, months = 1, footSlot }: Props) {
  const [viewDate, setViewDate] = useState(() => parseDate(startDate));
  const [pendingStart, setPendingStart] = useState<string | null>(null);
  const [hoverIso, setHoverIso] = useState<string | null>(null);

  const today = useMemo(() => startOfDay(new Date()), []);
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const viewMonths = useMemo(
    () => Array.from({ length: months }, (_, i) => new Date(year, month + i, 1)),
    [year, month, months],
  );

  const handleDayClick = (iso: string) => {
    if (!pendingStart) {
      setPendingStart(iso);
      return;
    }
    if (iso <= pendingStart) {
      // 点回起点之前：重定起点，继续选
      setPendingStart(iso);
      setHoverIso(null);
      return;
    }
    const days = Math.round((parseDate(iso).getTime() - parseDate(pendingStart).getTime()) / 86_400_000) + 1;
    const clampedEnd = new Date(parseDate(pendingStart));
    clampedEnd.setDate(clampedEnd.getDate() + Math.min(days, maxDays) - 1);
    onRangeChange(pendingStart, toISO(clampedEnd));
    setPendingStart(null);
    setHoverIso(null);
  };

  const effectiveStart = pendingStart ?? startDate;
  const effectiveEnd = pendingStart
    ? hoverIso && hoverIso >= pendingStart
      ? hoverIso
      : pendingStart
    : endDate;

  const shiftMonth = (delta: number) => setViewDate(new Date(year, month + delta, 1));

  return (
    <div className="range-calendar">
      <div className="range-calendar-months">
        {viewMonths.map((monthDate, index) => {
          const mYear = monthDate.getFullYear();
          const mMonth = monthDate.getMonth();
          const grid = generateMonthGrid(mYear, mMonth);
          return (
            <div className="range-calendar-month" key={`${mYear}-${mMonth}`}>
              <div className="range-calendar-head">
                {index === 0 && (
                  <button
                    type="button"
                    className="range-calendar-arrow is-prev"
                    aria-label="上一月"
                    onClick={() => shiftMonth(-1)}
                  >
                    ‹
                  </button>
                )}
                <span className="range-calendar-title">
                  {mYear}年{mMonth + 1}月
                </span>
                {index === months - 1 && (
                  <button
                    type="button"
                    className="range-calendar-arrow is-next"
                    aria-label="下一月"
                    onClick={() => shiftMonth(1)}
                  >
                    ›
                  </button>
                )}
              </div>

              <div className="range-calendar-weekdays">
                {WEEKDAYS.map((w) => (
                  <span key={w}>{w}</span>
                ))}
              </div>

              <div className="range-calendar-grid">
                {grid.map((d) => {
                  const iso = toISO(d);
                  const isCurrentMonth = d.getMonth() === mMonth;
                  const isPast = d < today;
                  const isStart = iso === effectiveStart;
                  const isEnd = iso === effectiveEnd;
                  const inRange = iso >= effectiveStart && iso <= effectiveEnd;
                  const className = [
                    'range-calendar-day',
                    isCurrentMonth ? '' : 'is-outside',
                    isPast ? 'is-past' : '',
                    inRange ? 'is-in-range' : '',
                    isStart ? 'is-start' : '',
                    isEnd ? 'is-end' : '',
                  ]
                    .filter(Boolean)
                    .join(' ');
                  return (
                    <button
                      key={iso}
                      type="button"
                      aria-label={iso}
                      disabled={isPast}
                      className={className}
                      onClick={() => handleDayClick(iso)}
                      onMouseEnter={() => {
                        if (pendingStart && iso >= pendingStart) setHoverIso(iso);
                      }}
                    >
                      {d.getDate()}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {footSlot ?? (
        <div className="range-calendar-foot muted">
          {pendingStart ? `再点返回日期（最多 ${maxDays} 天）` : `已选：${startDate} ~ ${endDate}`}
        </div>
      )}
    </div>
  );
}

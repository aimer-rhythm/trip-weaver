// 调研候选卡片：生成页实时候选（compact）与编辑器概览（完整）共用
// 封面来源：canonical_places.payload.coverImage（上游导出的 webp，走 /media 同源相对路径）
// 与维基降级的热链 http(s) URL；加载失败/缺图回落类目占位图
import { useState } from 'react';
import type { ResearchPoi } from '@tripweaver/shared';
import { POI_CATEGORY_ICON, POI_CATEGORY_LABEL, RESERVATION_LABEL } from '../lib/poi';

// 预约徽章与封面图导出复用：活动卡片内嵌候选信息（概览并入行程）沿用同一渲染与兜底逻辑
export function ReservationBadge({ poi }: { poi: ResearchPoi }) {
  return (
    <span
      className={`rsv-badge rounded-full [padding:1px_8px] [font-size:0.72rem] whitespace-nowrap ${poi.reservation === 'required' ? "rsv-required [background:var(--color-rsv-required-background-12)] [color:var(--color-rsv-required-color-13)] font-semibold" : poi.reservation === 'none' ? "rsv-none [background:var(--color-rsv-none-background-14)] [color:var(--color-rsv-none-color-15)]" : "rsv-unknown [background:var(--color-rsv-unknown-background-16)] [color:var(--color-muted)]"}`}
      title={poi.reservation === 'required' && poi.reservationNote ? poi.reservationNote : undefined}
    >
      {RESERVATION_LABEL[poi.reservation]}
    </span>
  );
}

export function PoiCover({ poi, onCoverError }: { poi: ResearchPoi; onCoverError?: (url: string) => void }) {
  const [failed, setFailed] = useState(false);
  if (!poi.coverUrl || failed) {
    return (
      <span className={"poi-cover [width:72px] [height:72px] [border-radius:8px] [object-fit:cover] shrink-0 poi-cover-fallback inline-flex items-center justify-center [font-size:1.6rem] [background:var(--color-poi-cover-fallback-background-11)]"} aria-hidden="true">
        {POI_CATEGORY_ICON[poi.category]}
      </span>
    );
  }
  return (
    <img
      className={"poi-cover [width:72px] [height:72px] [border-radius:8px] [object-fit:cover] shrink-0"}
      src={poi.coverUrl}
      alt={poi.name}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => {
        setFailed(true);
        if (poi.coverUrl) onCoverError?.(poi.coverUrl);
      }}
    />
  );
}

export function PoiCard({ poi, compact = false }: { poi: ResearchPoi; compact?: boolean }) {
  if (compact) {
    // 紧凑卡（生成时间线）：小图 / 名称 / 类目徽章 / 预约徽章
    return (
      <div className={"poi-card flex [border:1px_solid_var(--color-border)] [border-radius:10px] [background:var(--color-activity-card-background-6)] min-w-0 poi-card-compact [padding:8px] [gap:8px] items-center [&_.poi-cover]:[width:44px] [&_.poi-cover]:[height:44px] [&_.poi-cover-fallback]:[font-size:1.2rem] [&_.poi-name]:[font-size:0.86rem] [&_.poi-name]:whitespace-nowrap [&_.poi-body]:[gap:3px]"}>
        <PoiCover poi={poi} />
        <div className={"poi-body min-w-0 flex-1 flex flex-col [gap:4px]"}>
          <span className={"poi-name font-semibold [font-size:0.92rem] overflow-hidden [text-overflow:ellipsis]"}>{poi.name}</span>
          <span className={"poi-badges flex [gap:6px] items-center flex-wrap"}>
            <span className={"poi-cat [font-size:0.72rem] [color:var(--color-primary-dark)] [background:var(--color-quota-chip-background-2)] rounded-full [padding:1px_8px] whitespace-nowrap"}>{POI_CATEGORY_LABEL[poi.category]}</span>
            <ReservationBadge poi={poi} />
          </span>
        </div>
      </div>
    );
  }
  return (
    <div className={"poi-card flex [gap:10px] [border:1px_solid_var(--color-border)] [border-radius:10px] [padding:10px] [background:var(--color-activity-card-background-6)] min-w-0"}>
      <PoiCover poi={poi} />
      <div className={"poi-body min-w-0 flex-1 flex flex-col [gap:4px]"}>
        <div className={"poi-line1 flex items-center [gap:8px] flex-wrap"}>
          <span className={"poi-name font-semibold [font-size:0.92rem] overflow-hidden [text-overflow:ellipsis]"}>{poi.name}</span>
          <span className={"poi-cat [font-size:0.72rem] [color:var(--color-primary-dark)] [background:var(--color-quota-chip-background-2)] rounded-full [padding:1px_8px] whitespace-nowrap"}>{POI_CATEGORY_LABEL[poi.category]}</span>
          <ReservationBadge poi={poi} />
        </div>
        {poi.intro && <p className={"poi-intro m-0 [font-size:0.82rem] [color:var(--color-muted)] [display:-webkit-box] [-webkit-line-clamp:2] [-webkit-box-orient:vertical] overflow-hidden"}>{poi.intro}</p>}
        {poi.reservation === 'required' && poi.reservationNote && <p className={"poi-rsv-note m-0 [font-size:0.78rem] [color:var(--color-tag-warn-color-8)]"}>📌 {poi.reservationNote}</p>}
        {poi.sourceLinks.length > 0 && (
          <p className={"poi-links m-0 flex [gap:6px] flex-wrap"}>
            {poi.sourceLinks.slice(0, 3).map((s) => (
              <a key={s.url} className={"tag [border-radius:4px] [padding:1px_6px] [font-size:0.72rem] tag-source [background:var(--color-quota-chip-background-2)] [color:var(--color-tag-source-color-5)]"} href={s.url} target="_blank" rel="noopener noreferrer">
                🔗 {s.title || '来源'}
              </a>
            ))}
          </p>
        )}
      </div>
    </div>
  );
}

/** 该封面是否来自 Pexels（API 条款：用到就要署名 + 链接回 Pexels） */
export function isPexelsCover(url?: string): boolean {
  return Boolean(url && url.includes('images.pexels.com'));
}

/**
 * Pexels API 条款要求使用其图片的页面展示指向 Pexels 的显眼链接。
 * 列表里没有 Pexels 图时返回 null —— 不产生任何占位。
 */
export function PexelsCredit({ pois }: { pois: readonly Pick<ResearchPoi, 'coverUrl'>[] }) {
  if (!pois.some((p) => isPexelsCover(p.coverUrl))) return null;
  return (
    <p className={"pexels-credit [grid-column:1_/_-1] [margin:6px_0_0] [font-size:0.72rem] [color:var(--color-muted)] [&_a]:[color:inherit]"}>
      <a href="https://www.pexels.com" target="_blank" rel="noopener noreferrer">
        Photos provided by Pexels
      </a>
    </p>
  );
}

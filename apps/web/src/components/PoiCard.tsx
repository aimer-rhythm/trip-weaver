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
      className={`rsv-badge rsv-${poi.reservation}`}
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
      <span className="poi-cover poi-cover-fallback" aria-hidden="true">
        {POI_CATEGORY_ICON[poi.category]}
      </span>
    );
  }
  return (
    <img
      className="poi-cover"
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
      <div className="poi-card poi-card-compact">
        <PoiCover poi={poi} />
        <div className="poi-body">
          <span className="poi-name">{poi.name}</span>
          <span className="poi-badges">
            <span className="poi-cat">{POI_CATEGORY_LABEL[poi.category]}</span>
            <ReservationBadge poi={poi} />
          </span>
        </div>
      </div>
    );
  }
  return (
    <div className="poi-card">
      <PoiCover poi={poi} />
      <div className="poi-body">
        <div className="poi-line1">
          <span className="poi-name">{poi.name}</span>
          <span className="poi-cat">{POI_CATEGORY_LABEL[poi.category]}</span>
          <ReservationBadge poi={poi} />
        </div>
        {poi.intro && <p className="poi-intro">{poi.intro}</p>}
        {poi.reservation === 'required' && poi.reservationNote && <p className="poi-rsv-note">📌 {poi.reservationNote}</p>}
        {poi.sourceLinks.length > 0 && (
          <p className="poi-links">
            {poi.sourceLinks.slice(0, 3).map((s) => (
              <a key={s.url} className="tag tag-source" href={s.url} target="_blank" rel="noopener noreferrer">
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
    <p className="pexels-credit">
      <a href="https://www.pexels.com" target="_blank" rel="noopener noreferrer">
        Photos provided by Pexels
      </a>
    </p>
  );
}

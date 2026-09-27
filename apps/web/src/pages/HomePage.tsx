// 首页（09-26 改版）：SVG 中国地图 + macOS 磨砂玻璃渐进式胶囊，布局按 UI 稿：
// 左上文案、右侧中国地图、中部日期浮层（由 HomeCapsule 固定定位）、底部全宽玻璃胶囊通栏。
// 只列知识库已覆盖城市——未覆盖城市不提供生成入口（产品边界，见 09-26 任务 PRD）；
// 已覆盖但无国内坐标的海外城市不在地图打点，但仍可从胶囊「目的地」面板选中。
import { useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCoveredCities } from '../api/hooks';
import { ChinaMap, type MapCityDot } from '../components/home/ChinaMap';
import { HomeCapsule, type HomeTripDraft } from '../components/home/HomeCapsule';
import { CITY_GEO, projectToSvg } from '../lib/chinaMap';

/** 首页主标题：逐字入场动画按字符拆分渲染，所以放在常量里 */
const HEADLINE = '想去哪座城市？';

export function HomePage() {
  const covered = useCoveredCities();
  const navigate = useNavigate();
  const [selected, setSelected] = useState<string | null>(null);

  const cities = useMemo(() => covered.data?.cities ?? [], [covered.data]);

  const mapCities = useMemo(
    () =>
      cities.flatMap((name) => {
        const geo = CITY_GEO[name];
        return geo ? [{ name, ...projectToSvg(geo.lng, geo.lat) }] : [];
      }),
    [cities],
  );

  // 未覆盖城市只作背景点缀（有坐标才算），保证地图上「哪里能点」一眼可辨
  const contextCities = useMemo<MapCityDot[]>(
    () =>
      Object.entries(CITY_GEO)
        .filter(([name]) => !cities.includes(name))
        .map(([name, geo]) => ({ name, ...projectToSvg(geo.lng, geo.lat) })),
    [cities],
  );

  const start = (draft: HomeTripDraft) => {
    if (!selected) return;
    const params = new URLSearchParams({ city: selected, start: draft.startDate, end: draft.endDate });
    if (draft.pace) params.set('pace', draft.pace);
    if (draft.partySize !== 2) params.set('partySize', String(draft.partySize));
    if (draft.preferences.length > 0) params.set('preferences', draft.preferences.join(','));
    if (draft.transportMode) params.set('transport', draft.transportMode);
    // 首页已经收集完必填项：带着 autostart 过去，新建页不再让用户点第二次「开始生成」
    params.set('autostart', '1');
    navigate(`/trips/new?${params.toString()}`);
  };

  const notice = covered.isPending
    ? '城市列表加载中…'
    : covered.isError
      ? '城市列表加载失败，请刷新重试。'
      : covered.data && cities.length === 0
        ? '暂时没有可规划的城市，请稍后再来。'
        : null;

  return (
    <div className="home-page-root relative flex flex-1 flex-col overflow-hidden">
      {/* 文案区：字号跟 --ui 标尺，位置用百分比对齐胶囊左边界；不拦截地图手势 */}
      <div className="pointer-events-none relative z-10 px-8 pt-10 lg:absolute lg:top-[9%] lg:left-[6.3%] lg:px-0 lg:pt-0">
        <h1 className="m-0 leading-tight font-medium text-ink">
          {Array.from(HEADLINE).map((char, index) => (
            <span key={`${char}-${index}`} className="home-hero-char" style={{ '--char-i': index } as CSSProperties}>
              {char}
            </span>
          ))}
        </h1>
        <p className="home-hero-sub mt-[calc(14*var(--ui))] mb-0 text-[length:calc(19*var(--ui))] text-ink-muted">
          让每一次出发，都有专属的旅行方案
        </p>
      </div>

      {/* 地图：热区与画布都是整屏，地图位置靠内部视图变换控制（参考 Yuntu 首页） */}
      <ChinaMap cities={mapCities} contextCities={contextCities} selected={selected} onSelect={setSelected} />

      {/* 底部玻璃胶囊通栏 */}
      <div className="relative z-20 mt-auto px-6 pb-8 lg:absolute lg:right-[14.5%] lg:bottom-[calc(48*var(--ui))] lg:left-[15.5%] lg:mt-0 lg:px-0 lg:pb-0">
        {notice ? (
          <p className="rounded-full border border-white/70 bg-white/72 px-5 py-3 text-center text-[0.9rem] text-ink-soft backdrop-blur-2xl">
            {notice}
          </p>
        ) : (
          <HomeCapsule city={selected} cities={cities} onSelectCity={setSelected} onStart={start} />
        )}
      </div>
    </div>
  );
}







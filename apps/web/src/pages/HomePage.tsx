// 首页（09-26 改版）：SVG 中国地图 + macOS 磨砂玻璃渐进式胶囊，布局按 UI 稿：
// 桌面保留地图与底部胶囊；手机首屏规划，地图移入全屏目的地选择。
// 只列知识库已覆盖城市——未覆盖城市不提供生成入口（产品边界，见 09-26 任务 PRD）；
// 已覆盖但无国内坐标的海外城市不在地图打点，但仍可从胶囊「目的地」面板选中。
import { useLoginDialog } from '../components/LoginDialogProvider';
import { useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useCoveredCities, useUsage, useMe } from '../api/hooks';
import { useActiveGeneration } from '../components/GenerationProvider';
import { ChinaMap, type MapCityDot } from '../components/home/ChinaMap';
import { HomeCapsule, type HomeTripDraft } from '../components/home/HomeCapsule';
import { CITY_GEO, projectToSvg } from '../lib/chinaMap';
import { DestinationPicker } from '../components/home/DestinationPicker';
import { DestinationShowcase } from '../components/home/DestinationShowcase';

/** 首页主标题：逐字入场动画按字符拆分渲染，所以放在常量里 */
const HEADLINE = '想去哪座城市？';

export function HomePage() {
  const covered = useCoveredCities();
  const navigate = useNavigate();
  const generation = useActiveGeneration();
  const me = useMe();
  const openLogin = useLoginDialog();
  const usage = useUsage(Boolean(me.data));
  const [selected, setSelected] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const pickerOpen = searchParams.get('choose') === 'destination';
  const openCityPicker = () => {
    if (pickerOpen) return;
    setSearchParams(previous => {
      const next = new URLSearchParams(previous);
      next.set('choose', 'destination');
      return next;
    }, { state: { homeDestinationPicker: true } });
  };
  const closeCityPicker = () => {
    const state: unknown = location.state;
    // 只有从首页压入的选择页才后退；直接访问查询参数时留在首页。
    if (state && typeof state === 'object' && 'homeDestinationPicker' in state && state.homeDestinationPicker === true) navigate(-1);
    else setSearchParams(previous => {
      const next = new URLSearchParams(previous);
      next.delete('choose');
      return next;
    }, { replace: true });
  };

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
    if (!me.isSuccess) return;
    if (!selected || !cities.includes(selected) || !draft.pace) return;
    const params = new URLSearchParams({ city: selected, start: draft.startDate, end: draft.endDate });
    if (draft.pace) params.set('pace', draft.pace);
    if (draft.partySize !== 2) params.set('partySize', String(draft.partySize));
    if (draft.preferences.length > 0) params.set('preferences', draft.preferences.join(','));
    if (draft.transportMode) params.set('transport', draft.transportMode);
    if (draft.extraNotes) params.set('extraNotes', draft.extraNotes);
    // 首页已经收集完必填项：带着 autostart 过去，新建页不再让用户点第二次「开始生成」
    params.set('autostart', '1');
    const destination = `/trips/new?${params.toString()}`;
    if (!me.data) { openLogin(destination); return; }
    navigate(destination);
  };

  const notice = me.isError
    ? '登录状态暂不可用，请刷新重试。'
    : covered.isPending
    ? '城市列表加载中…'
    : covered.isError
      ? '城市列表加载失败，请刷新重试。'
      : covered.data && cities.length === 0
        ? '暂时没有可规划的城市，请稍后再来。'
        : null;

  return (
    <div className={"home-page-root [--ui:max(0.75px,_min(0.0599vw,_0.106vh))] [--rc-gap:calc(6_*_var(--ui))] [--rc-month-gap:calc(12_*_var(--ui))] [--rc-head-height:calc(30_*_var(--ui))] [--rc-head-pad-left:calc(26_*_var(--ui))] [--rc-title-size:calc(16_*_var(--ui))] [--rc-arrow-width:calc(20_*_var(--ui))] [--rc-arrow-size:calc(21_*_var(--ui))] [--rc-weekday-size:calc(13_*_var(--ui))] [--rc-day-height:calc(34_*_var(--ui))] [--rc-day-size:calc(16_*_var(--ui))] [&_h1]:[font-size:calc(46_*_var(--ui))] lg:[&_h2]:[font-size:calc(16_*_var(--ui))] [&_h2]:m-0 [&_.range-calendar-day.is-start]:[background:var(--color-brand)] [&_.range-calendar-day.is-end]:[background:var(--color-brand)] relative flex flex-1 flex-col overflow-hidden"}>
      {/* 文案区：字号跟 --ui 标尺，位置用百分比对齐胶囊左边界；不拦截地图手势 */}
      <div className="pointer-events-none relative z-10 px-5 pt-4 max-lg:mx-auto max-lg:box-border max-lg:w-full max-lg:max-w-xl max-lg:[&_h1]:text-[clamp(28px,7.6vw,36px)] max-lg:[&_h1]:font-bold lg:absolute lg:top-[9%] lg:left-[6.3%] lg:px-0 lg:pt-0">
        <h1 className="m-0 leading-tight font-medium text-ink">
          {Array.from(HEADLINE).map((char, index) => (
            <span key={`${char}-${index}`} className={"home-hero-char inline-block [animation:home-hero-char-in_0.85s_cubic-bezier(0.22,_1,_0.36,_1)_both] [animation-delay:calc(var(--char-i,_0)_*_55ms)] [@media_(prefers-reduced-motion:_reduce)]:[animation-name:home-hero-char-fade] [@media_(prefers-reduced-motion:_reduce)]:[animation-duration:0.4s]"} style={{ '--char-i': index } as CSSProperties}>
              {char}
            </span>
          ))}
        </h1>
        <p className={"home-hero-sub [animation:home-hero-rise_0.7s_ease-out_0.5s_both] [@media_(prefers-reduced-motion:_reduce)]:[animation:none] mt-[calc(14*var(--ui))] mb-0 text-[length:calc(19*var(--ui))] text-ink-muted max-lg:text-base"}>
          让每一次出发，都有专属的旅行方案
        </p>
      </div>

      {/* 桌面地图热区覆盖内容区域，手机在目的地选择页复用地图。 */}
      <div className="hidden lg:contents"><ChinaMap cities={mapCities} contextCities={contextCities} selected={selected} onSelect={setSelected} /></div>

      {/* 底部玻璃胶囊通栏 */}
      <div className="relative z-20 mt-5 px-5 pb-4 max-lg:mx-auto max-lg:box-border max-lg:w-full max-lg:max-w-xl max-lg:[--ui:1px] lg:absolute lg:right-[14.5%] lg:bottom-[calc(48*var(--ui))] lg:left-[15.5%] lg:mt-0 lg:px-0 lg:pb-0">
        {notice ? (
          <p className="rounded-full border border-white/70 bg-white/72 px-5 py-3 text-center text-[0.9rem] text-ink-soft backdrop-blur-2xl">
            {notice}
          </p>
        ) : (
          <HomeCapsule city={selected} cities={cities} onSelectCity={setSelected} onStart={start} onOpenCity={openCityPicker} cityPickerOpen={pickerOpen}
            onOpenGeneration={generation.running && generation.jobId ? () => navigate(`/generations/${encodeURIComponent(generation.jobId!)}`) : undefined} />
        )}
        {usage.data && <p className="mb-0 mt-3 text-center text-xs text-ink-muted" title="每日生成次数将在次日零点重置">今日可生成 {usage.data.remaining}/{usage.data.dailyLimit} 次</p>}
      </div>
      {!notice && <div className="mx-auto box-border w-full max-w-xl px-5 pb-6 lg:hidden"><DestinationShowcase cities={cities} selected={selected} onSelect={setSelected} onMore={openCityPicker} /></div>}
      {pickerOpen && <DestinationPicker cities={cities} mapCities={mapCities} contextCities={contextCities} selected={selected} notice={notice} onClose={closeCityPicker} onConfirm={city => { setSelected(city); closeCityPicker(); }} />}
    </div>
  );
}







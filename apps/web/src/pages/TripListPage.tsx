import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTrips } from '../api/hooks';

const dateFormatter = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });

function coverTone(destination: string): number {
  if (destination.includes('北京')) return 0;
  if (destination.includes('杭州')) return 4;
  if (destination.includes('成都')) return 3;
  if (destination.includes('上海') || destination.includes('大理')) return 2;
  return Array.from(destination).reduce((sum, character) => sum + (character.codePointAt(0) ?? 0), 0) % 4;
}

function CoverDrawing({ destination }: { destination: string }) {
  return <svg className="collection-drawing" viewBox="0 0 180 140" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M27 15C3 46 12 65 25 79S11 106 31 119" strokeDasharray="3 5" opacity=".65" />
    <path d="M26 9c-8 0-6 9 0 14 6-5 8-14 0-14Z" /><circle cx="26" cy="14" r="1.5" />
    {destination.includes('成都') ? <g><circle cx="68" cy="46" r="12" /><circle cx="119" cy="46" r="12" /><ellipse cx="94" cy="77" rx="36" ry="33" /><ellipse cx="79" cy="72" rx="8" ry="11" transform="rotate(30 79 72)" /><ellipse cx="108" cy="72" rx="8" ry="11" transform="rotate(-30 108 72)" /><path d="m89 86 5 4 5-4ZM94 90v5m-8 0q8 8 16 0M65 101q-22 23-4 27h65q17-15-4-28M142 127l7-64m-6 42 16-15m-13-3-10-14m10 6 13-14" /><circle cx="80" cy="72" r="2" /><circle cx="108" cy="72" r="2" /></g>
    : destination.includes('上海') ? <g><path d="M49 123V79m-8 44 8-27 8 27M49 30v27m-9 14 9-17 9 17-9 16ZM70 124V65l17-8v67m9 0V38l17-12v98m-11-79 5-8v77m14 10V75l19-9v58M72 76h11m-11 12h11m-11 12h11m42-16h12m-12 12h12m-12 12h12M32 128h121" /><ellipse cx="49" cy="92" rx="7" ry="4" /></g>
    : destination.includes('大理') ? <g><path d="m31 87 25-34 12 13 26-40 23 30 10-12 31 42M56 53l4 20 8-7m26-40-3 29 10-9 16 10M29 96h126M41 105h37m32 0h39M62 121h82M94 81v29l-18-3Zm3 5 13 21H97m-26 6h43l-6 6H79ZM29 129h50m39 0h35" /></g>
    : destination.includes('北京') || destination.includes('杭州') ? <g><path d="M44 119h104l7 7H37ZM52 112h88v7H52ZM59 83h74v29H59ZM53 83q28-8 43-20 15 12 43 20ZM61 66q24-7 35-19 11 12 35 19ZM69 48q20-5 27-20 7 15 27 20ZM78 48v10m36-10v10M69 66v9m54-9v9M96 20v8M68 89v23m14-23v23m14-23v23m14-23v23m14-23v23M35 132h123" /><path d="M65 80h62M72 63h49M81 45h31" opacity=".65" /></g>
    : <g><path d="m32 110 35-57 22 31 23-45 44 71ZM59 66l8 12 8-12M102 60l10 14 11-13M30 120h129m-108 9h42m18 0h30" /><circle cx="51" cy="32" r="10" /></g>}
  </svg>;
}

export function TripListPage() {
  const trips = useTrips();
  const [params, setParams] = useSearchParams();
  const query = params.get('q') ?? '';
  const city = params.get('city') ?? '';
  const requestedSort = params.get('sort');
  const sort = requestedSort === 'created' || requestedSort === 'name' ? requestedSort : 'updated';

  const destinations = useMemo(
    () => [...new Set((trips.data ?? []).map((trip) => trip.destination))].sort((a, b) => a.localeCompare(b, 'zh-CN')),
    [trips.data],
  );
  const visibleTrips = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase();
    return (trips.data ?? [])
      .filter((trip) => (!city || trip.destination === city) && (!keyword || `${trip.title} ${trip.destination}`.toLocaleLowerCase().includes(keyword)))
      .sort((a, b) => {
        if (sort === 'name') return a.title.localeCompare(b.title, 'zh-CN');
        const difference = sort === 'created' ? b.createdAt - a.createdAt : b.updatedAt - a.updatedAt;
        return difference || a.title.localeCompare(b.title, 'zh-CN');
      });
  }, [trips.data, query, city, sort]);

  const updateFilter = (key: string, value: string) => {
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      if (value) next.set(key, value);
      else next.delete(key);
      return next;
    }, { replace: true });
  };
  const clearFilters = () => {
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      next.delete('q');
      next.delete('city');
      return next;
    }, { replace: true });
  };
  const hasFilters = Boolean(query || city);

  return (
    <div className="trip-collection">
      <header className="collection-heading">
        <div>
          <h1>我的行程</h1>
          <p>把想去的远方，收进一本本旅行手册。
            {!trips.isPending && !trips.isError && <span className="collection-count">共 {trips.data?.length ?? 0} 本旅行手册</span>}
          </p>
        </div>
      </header>

      <form className="collection-toolbar" role="search" aria-label="查找行程" onSubmit={(event) => event.preventDefault()}>
        <label className="collection-search">
          <span className="collection-sr-only">搜索行程</span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" strokeLinecap="round" /></svg>
          <input type="search" value={query} onChange={(event) => updateFilter('q', event.target.value)} placeholder="搜索行程名称或目的地" maxLength={100} />
        </label>
        <label className="collection-select"><span>目的地</span>
          <select aria-label="目的地" value={city} onChange={(event) => updateFilter('city', event.target.value)}>
            <option value="">全部目的地</option>
            {city && !destinations.includes(city) && <option value={city}>{city}</option>}
            {destinations.map((destination) => <option key={destination} value={destination}>{destination}</option>)}
          </select>
        </label>
        <label className="collection-select"><span>排序</span>
          <select aria-label="排序" value={sort} onChange={(event) => updateFilter('sort', event.target.value)}>
            <option value="updated">最近更新</option>
            <option value="created">最近创建</option>
            <option value="name">行程名称</option>
          </select>
        </label>
      </form>

      <div className={`collection-result-line${!hasFilters && !trips.isPending && !trips.isError ? ' collection-result-line-idle' : ''}`}>
        <p role="status">{trips.isPending ? '正在取来你的旅行手册…' : trips.isError ? '暂时无法读取行程' : hasFilters ? `找到 ${visibleTrips.length} 份行程` : '所有行程'}</p>
        {hasFilters && <button type="button" onClick={clearFilters}>清除筛选</button>}
      </div>

      {trips.isPending && <div className="collection-grid" aria-hidden="true">{[0, 1, 2].map((item) => <div className="collection-skeleton" key={item}><div /><span /><span /></div>)}</div>}
      {trips.isError && <div className="collection-empty" role="alert"><h2>行程暂时没有加载出来</h2><p>请检查网络连接，再试一次。</p><button type="button" className="collection-retry" disabled={trips.isFetching} onClick={() => void trips.refetch()}>{trips.isFetching ? '正在重试…' : '重新加载'}</button></div>}
      {!trips.isPending && !trips.isError && visibleTrips.length === 0 && <div className="collection-empty">
        <span className="collection-empty-mark" aria-hidden="true">旅</span>
        <h2>{trips.data?.length ? '还没有找到这份旅程' : '你的旅行手册，等待第一段故事'}</h2>
        <p>{trips.data?.length ? '换个关键词或目的地试试，也可以清除筛选查看全部行程。' : '从顶部「织程」返回首页，规划完成的行程会收在这里。'}</p>
      </div>}

      {!trips.isPending && visibleTrips.length > 0 && <div className="collection-grid" aria-label="行程列表">
        {visibleTrips.map((trip) => (
          <Link key={trip.id} to={`/trips/${trip.id}`} className="collection-card" data-tone={coverTone(trip.destination)} aria-label={`查看行程：${trip.title}`}>
            <div className="collection-cover">
              <span className="collection-destination">{trip.destination}</span>
              <CoverDrawing destination={trip.destination} />
              <span className="collection-duration">{trip.daysCount} 天</span>
            </div>
            <div className="collection-card-body">
              <h2>{trip.title}</h2>
              <div className="collection-card-meta"><span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M12 22S3 13 3 9a9 9 0 0 1 18 0c0 4-9 13-9 13Z" /><circle cx="12" cy="9" r="3" /></svg>{trip.destination}</span><span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M7 2v6m10-6v6M3 11h18m-14 4h3m4 0h3" /></svg>{trip.activityCount} 个活动</span></div>
              <div className="collection-card-foot">
                <time dateTime={new Date(trip.updatedAt).toISOString()}>更新于 {dateFormatter.format(trip.updatedAt)}</time>
                <span className="collection-open">翻开行程 <span aria-hidden="true">→</span></span>
              </div>
            </div>
          </Link>
        ))}
      </div>}
    </div>
  );
}

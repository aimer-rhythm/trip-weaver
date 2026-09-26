// 首页（09-26）：已覆盖城市选择，选中后进入结构化表单（/trips/new?city=…）。
// 只列知识库已覆盖城市——未覆盖城市不提供生成入口（产品边界，见任务 PRD）。
import { Link } from 'react-router-dom';
import { useCoveredCities } from '../api/hooks';

export function HomePage() {
  const covered = useCoveredCities();

  return (
    <div className="page home-page">
      <div className="page-head">
        <h1>想去哪座城市？</h1>
        <div className="page-head-actions">
          <Link to="/trips" className="btn btn-ghost">
            我的行程
          </Link>
        </div>
      </div>

      {covered.isPending && <p className="muted">加载中…</p>}
      {covered.isError && <p className="form-error">城市列表加载失败，请刷新重试。</p>}
      {covered.data && covered.data.cities.length === 0 && (
        <p className="muted">暂时没有可规划的城市，请稍后再来。</p>
      )}

      <div className="city-grid">
        {covered.data?.cities.map((city) => (
          <Link key={city} to={`/trips/new?city=${encodeURIComponent(city)}`} className="city-card">
            <span className="city-card-name">{city}</span>
            <span className="city-card-cta muted">开始规划 →</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

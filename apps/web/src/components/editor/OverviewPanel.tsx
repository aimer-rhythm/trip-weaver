// 行程概览：调研候选池按 景点/美食/住宿 分组展示（只读；旧行程无 overview 字段时入口整体不渲染）
import { useMemo } from 'react';
import { POI_CATEGORIES } from '@tripweaver/shared';
import { DATA_SOURCE_LABEL, POI_CATEGORY_ICON, POI_CATEGORY_LABEL } from '../../lib/poi';
import { useEditorStore } from '../../store/editorStore';
import { PoiCard } from '../PoiCard';

export function OverviewPanel() {
  const trip = useEditorStore((s) => s.trip);
  const overview = trip?.overview;

  const groups = useMemo(
    () =>
      POI_CATEGORIES.map((category) => ({
        category,
        pois: (overview ?? []).filter((p) => p.category === category),
      })).filter((g) => g.pois.length > 0),
    [overview],
  );

  if (!trip || !overview?.length) return null;

  // meta.dataSources 标注实际所用源；空/缺失 = 纯模型知识调研（旧行程不会走到这里）
  const sources = trip.meta.dataSources ?? [];
  const sourceText = sources.length ? sources.map((s) => DATA_SOURCE_LABEL[s]).join(' + ') : '模型知识';

  return (
    <div className="overview-panel">
      <p className="overview-note muted">
        数据来源：{sourceText}｜预约信息以官方为准，出行前请核实
      </p>
      {groups.map((g) => (
        <section key={g.category} className="overview-group">
          <h3>
            {POI_CATEGORY_ICON[g.category]} {POI_CATEGORY_LABEL[g.category]}
            <span className="muted">（{g.pois.length}）</span>
          </h3>
          <div className="overview-grid">
            {g.pois.map((p) => (
              <PoiCard key={p.id} poi={p} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

// 备选抽屉：概览候选池中未被任何活动命中的 POI，折叠展示（取代原独立 OverviewPanel 区块）
// 旧行程无 overview / 候选全部命中 → 整体不渲染，无占位噪音
import { useMemo } from 'react';
import { POI_CATEGORIES, type ResearchPoi } from '@tripweaver/shared';
import { DATA_SOURCE_LABEL, POI_CATEGORY_ICON, POI_CATEGORY_LABEL } from '../../lib/poi';
import { useEditorStore } from '../../store/editorStore';
import { PoiCard, PexelsCredit } from '../PoiCard';

export function CandidateDrawer({ pois, expanded = false }: { pois: ResearchPoi[]; expanded?: boolean }) {
  const trip = useEditorStore((s) => s.trip);

  const groups = useMemo(
    () =>
      POI_CATEGORIES.map((category) => ({
        category,
        pois: pois.filter((p) => p.category === category),
      })).filter((g) => g.pois.length > 0),
    [pois],
  );

  if (!trip || pois.length === 0) return null;

  // meta.dataSources 标注实际所用源；空/缺失 = 纯模型知识调研
  const sources = trip.meta.dataSources ?? [];
  const sourceText = sources.length ? sources.map((s) => DATA_SOURCE_LABEL[s]).join(' + ') : '模型知识';

  return (
    <details className={"candidate-drawer [background:var(--color-card)] [border:1px_dashed_var(--color-border)] [border-radius:12px] [padding:10px_14px] [margin-top:12px] [&_summary]:cursor-pointer [&_summary]:font-semibold [&_summary]:[font-size:0.92rem] [&_summary_.muted]:[font-weight:400] [&_summary_.muted]:[margin-left:6px] [&_.overview-note]:[margin:10px_0_0] [&_.overview-group]:[margin-top:10px]"} open={expanded || undefined}>
      <summary>
        备选（{pois.length}）<span className={"muted [color:var(--color-muted)] [font-size:0.88rem]"}>未编入行程的调研候选</span>
      </summary>
      <p className={"overview-note m-0 muted [color:var(--color-muted)] [font-size:0.88rem]"}>数据来源：{sourceText}｜预约信息以官方为准，出行前请核实</p>
      <PexelsCredit pois={pois} />
      {groups.map((g) => (
        <section key={g.category} className={"overview-group [background:var(--color-card)] [border:1px_solid_var(--color-border)] [border-radius:12px] [padding:12px_14px] [&_h3]:[margin:0_0_10px] [&_h3]:[font-size:0.92rem]"}>
          <h3>
            {POI_CATEGORY_ICON[g.category]} {POI_CATEGORY_LABEL[g.category]}
            <span className={"muted [color:var(--color-muted)] [font-size:0.88rem]"}>（{g.pois.length}）</span>
          </h3>
          <div className={"overview-grid grid [grid-template-columns:repeat(auto-fill,_minmax(280px,_1fr))] [gap:10px]"}>
            {g.pois.map((p) => (
              <PoiCard key={p.id} poi={p} />
            ))}
          </div>
        </section>
      ))}
    </details>
  );
}

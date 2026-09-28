import { EditorIcon } from './EditorIcon';

export function MapControls({ onZoomIn, onZoomOut, onReset }: { onZoomIn: () => void; onZoomOut: () => void; onReset: () => void }) {
  return <div className="editor-map-controls" role="group" aria-label="地图视野" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
    <button type="button" aria-label="放大地图" title="放大" onClick={onZoomIn}>＋</button>
    <button type="button" aria-label="缩小地图" title="缩小" onClick={onZoomOut}>−</button>
    <button type="button" aria-label="默认视图" title="默认视图" onClick={onReset}><EditorIcon name="reset" /></button>
  </div>;
}

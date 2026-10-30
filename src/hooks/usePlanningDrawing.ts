import * as Cesium from 'cesium';
import { ref, shallowRef } from 'vue';
import { planningPolygon } from '@/utils/planningGeometry';
import type { useSpatialAnalysis } from './useSpatialAnalysis';

/** Explicit finish avoids double-click adding a duplicate final vertex or moving the camera. */
export function usePlanningDrawing(analysis: ReturnType<typeof useSpatialAnalysis>) {
  const positions = shallowRef<Cesium.Cartesian3[]>([]);
  const drawing = ref(false);
  let draft: Cesium.Entity[] = [];
  function removeDraft() { draft.forEach(analysis.remove); draft = []; }
  function preview() {
    removeDraft();
    positions.value.forEach((position, i) => draft.push(analysis.add({ position,
      point: { pixelSize: 8, color: Cesium.Color.YELLOW, heightReference: Cesium.HeightReference.CLAMP_TO_GROUND },
      label: { text: String(i + 1), pixelOffset: new Cesium.Cartesian2(0, -18), font: '12px sans-serif' },
    })));
    if (positions.value.length > 1) draft.push(analysis.add({ polyline: { positions: positions.value,
      clampToGround: true, width: 3, material: Cesium.Color.YELLOW } }));
  }
  function cancel() {
    analysis.picking.value = false; drawing.value = false;
    removeDraft(); positions.value = [];
  }
  function start() {
    if (!analysis.ready.value) return;
    cancel(); analysis.cancel(); drawing.value = true;
    analysis.statusText.value = '依次点击至少 3 个顶点，再点击完成绘制；可撤销或取消本次绘制';
    analysis.pick(position => {
      if (positions.value.some(p => Cesium.Cartesian3.distance(p, position) < 1)) {
        analysis.statusText.value = '顶点与已有点距离不足 1 米，请选择其他位置'; return;
      }
      if (positions.value.length >= 50) { analysis.statusText.value = '最多支持 50 个顶点，请完成绘制'; return; }
      positions.value = [...positions.value, position]; preview();
      analysis.statusText.value = `已添加 ${positions.value.length} 个顶点，点击完成绘制结束`;
    });
  }
  function undo() { positions.value = positions.value.slice(0, -1); preview(); }
  function finish() {
    if (!drawing.value) return;
    try {
      const polygon = planningPolygon(positions.value);
      cancel(); return polygon;
    } catch (error) {
      analysis.statusText.value = error instanceof Error ? error.message : '多边形无效，请调整顶点';
    }
  }
  return { positions, drawing, start, undo, cancel, finish };
}

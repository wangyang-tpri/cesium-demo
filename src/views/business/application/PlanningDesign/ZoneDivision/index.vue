<script setup lang="ts">
import * as Cesium from 'cesium';
import { computed, provide, ref, shallowRef } from 'vue';
import SplitViewer from '@/components/base/SplitViewer.vue';
import { useSpatialAnalysis } from '@/hooks/useSpatialAnalysis';
import { usePlanningDrawing } from '@/hooks/usePlanningDrawing';
import { useCodeExplain } from '@/hooks/useCodeExplain';
import type { PlanningPolygon } from '@/utils/planningGeometry';

const containerRef = ref<HTMLDivElement | null>(null);
provide('splitViewerContainerRef', containerRef);
const activeFeature = ref('draw');
const analysis = useSpatialAnalysis(containerRef, '绘制多边形区域，使用完成绘制按钮结束。', false);
const { viewer, ready, statusText, terrainNote } = analysis;
terrainNote.value = '面积为局部水平投影近似值，周长按 WGS84 测地线计算；单区域半径限 25km';
const draft = usePlanningDrawing(analysis);
const { drawing, positions } = draft;
interface Zone { id: number; color: string; geometry: PlanningPolygon; entities: Cesium.Entity[] }
const zones = shallowRef<Zone[]>([]);
let counter = 0;
const colors = ['#18a058', '#2080f0', '#f0a020', '#d03050', '#0fc6c2', '#7c3aed'];
const totalArea = computed(() => zones.value.reduce((sum, zone) => sum + zone.geometry.area, 0));

function finishDrawing() {
  const geometry = draft.finish();
  if (!geometry) return;
  const id = ++counter;
  const color = colors[(id - 1) % colors.length];
  const shape = analysis.add({ position: geometry.anchor,
    polygon: { hierarchy: new Cesium.PolygonHierarchy(geometry.positions),
      material: Cesium.Color.fromCssColorString(color).withAlpha(0.35),
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND },
    label: { text: '区域' + id, font: '13px sans-serif', heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      disableDepthTestDistance: Number.POSITIVE_INFINITY },
  });
  const border = analysis.add({ polyline: { positions: [...geometry.positions, geometry.positions[0]],
    width: 2, clampToGround: true, material: Cesium.Color.fromCssColorString(color) } });
  zones.value = [...zones.value, { id, color, geometry, entities: [shape, border] }];
  statusText.value = '区域' + id + ' 已完成：面积 ' + (geometry.area / 10000).toFixed(2) + ' 公顷，周长 ' + (geometry.perimeter / 1000).toFixed(3) + 'km';
}
function cancelDrawing() { draft.cancel(); statusText.value = '已取消本次绘制，已保存区域保留'; }
function removeZone(id: number) {
  const zone = zones.value.find(z => z.id === id);
  zone?.entities.forEach(analysis.remove);
  zones.value = zones.value.filter(z => z.id !== id);
  statusText.value = '已删除区域' + id;
}
function flyToZone(id: number) {
  const zone = zones.value.find(z => z.id === id);
  if (!zone || !viewer.value) return;
  const sphere = Cesium.BoundingSphere.fromPoints(zone.geometry.positions);
  viewer.value.camera.flyToBoundingSphere(sphere, {
    offset: new Cesium.HeadingPitchRange(0, -Math.PI / 3, Math.max(sphere.radius * 3, 500)),
  });
}
function applyClear() {
  draft.cancel(); analysis.clear(); zones.value = []; counter = 0;
  statusText.value = '已清除所有区域与草稿';
}
const { code, explanation } = useCodeExplain({ draw: () => `// 显式完成绘制，校验重复点、共线点、自交及面积
const polygon = planningPolygon(worldPositions)
// 水平投影面积 + 椭球测地线周长
const area = polygon.area
const perimeter = polygon.perimeter
// 区域内部标签采用三角剖分后的内点，避免凹多边形标签落在外部
viewer.entities.add({ position: polygon.anchor,
  polygon: { hierarchy: polygon.positions, heightReference: HeightReference.CLAMP_TO_GROUND } })` }, {
  draw: () => `【交互】支持多个区域，绘制时可撤销顶点、取消草稿，完成后可独立定位或删除。
【校验】拒绝自交、重复顶点、共线顶点和面积小于 1㎡ 的区域。使用按钮完成，避免双击产生重复末点。
【统计】面积为局部水平投影近似值，不是坡面面积。周长采用 WGS84 测地线。
【重叠】各区域独立保留，总面积为各区域面积之和，重叠部分会重复计入；不自动进行拓扑分割。`,
}, activeFeature);
</script>

<template>
  <div class="flex h-full flex-col gap-3 p-4">
    <div class="flex flex-wrap items-center gap-2">
      <n-button size="small" type="success" :disabled="!ready" @click="draft.start">开始绘制</n-button>
      <n-button size="small" type="primary" :disabled="!drawing || positions.length < 3" @click="finishDrawing">完成绘制</n-button>
      <n-button size="small" :disabled="!drawing || !positions.length" @click="draft.undo">撤销顶点</n-button>
      <n-button size="small" :disabled="!drawing" @click="cancelDrawing">取消本次</n-button>
      <n-button size="small" quaternary @click="applyClear">清除全部</n-button>
    </div>
    <SplitViewer title="区域划分" :code="code" :explanation="explanation" storage-key="zone-division-split">
      <template #scene-overlay>
        <div class="absolute left-3 top-3 z-10 max-w-[80%] rounded bg-black/70 px-3 py-2 text-xs text-white">
          <div>{{ statusText }}</div><div class="mt-1 text-white/70">{{ terrainNote }}</div>
        </div>
      </template>
      <template #bottom-panel>
        <div class="shrink-0 border-t bg-gray-50 p-3 text-xs">
          <div class="mb-2 font-semibold">共 {{ zones.length }} 个区域 · 面积之和 {{ (totalArea / 10000).toFixed(2) }} 公顷</div>
          <div class="max-h-56 space-y-2 overflow-auto">
            <div v-for="zone in zones" :key="zone.id" class="flex items-center gap-2 rounded border bg-white p-2">
              <span class="h-3 w-3 shrink-0 rounded" :style="{ backgroundColor: zone.color }"></span>
              <div class="flex-1">区域{{ zone.id }} · {{ zone.geometry.positions.length }} 顶点<br />{{ (zone.geometry.area / 10000).toFixed(2) }} 公顷 · {{ (zone.geometry.perimeter / 1000).toFixed(3) }}km</div>
              <n-button size="tiny" @click="flyToZone(zone.id)">定位</n-button>
              <n-button size="tiny" type="error" quaternary @click="removeZone(zone.id)">删除</n-button>
            </div>
            <div v-if="!zones.length">暂无已保存区域。</div>
          </div>
        </div>
      </template>
    </SplitViewer>
  </div>
</template>

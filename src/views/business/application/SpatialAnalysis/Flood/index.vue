<script setup lang="ts">
import * as Cesium from 'cesium';
import { provide, ref, watch } from 'vue';
import SplitViewer from '@/components/base/SplitViewer.vue';
import { useCodeExplain } from '@/hooks/useCodeExplain';
import { useSpatialAnalysis } from '@/hooks/useSpatialAnalysis';
import { clipFloodTriangle, localPoint, polygonArea, sampleHeights, type FloodVertex } from '@/utils/spatialAnalysis';

const containerRef = ref<HTMLDivElement | null>(null);
provide('splitViewerContainerRef', containerRef);
const activeFeature = ref('analyze');
const analysis = useSpatialAnalysis(containerRef, '设置区域中心，采样完成后调节水位查看淹没范围。');
const { viewer, statusText, ready, busy, terrainNote } = analysis;
const waterLevel = ref(400);
const waterMin = ref(0);
const waterMax = ref(1000);
const areaSize = ref(3000);
const hasArea = ref(false);
const hasCenter = ref(false);
const GRID = 30;
let center: Cesium.Cartesian3 | undefined;
let boundary: Cesium.Entity | undefined;
let water: Cesium.Primitive | undefined;
let footprint: Cesium.GroundPrimitive | undefined;
let cache: { center: Cesium.Cartesian3; size: number; vertices: FloodVertex[] } | undefined;

function clearWater() {
  analysis.removePrimitive(water); water = undefined;
  analysis.removePrimitive(footprint); footprint = undefined;
}
function applyClear() {
  analysis.clear(); center = undefined; boundary = undefined; water = undefined; footprint = undefined;
  cache = undefined; hasArea.value = false; hasCenter.value = false;
  statusText.value = '已清除，可重新设置分析区域';
}
function renderFlood() {
  if (!cache || !Number.isFinite(waterLevel.value)) return;
  clearWater();
  const level = waterLevel.value;
  const instances: Cesium.GeometryInstance[] = [];
  const groundInstances: Cesium.GeometryInstance[] = [];
  let floodedArea = 0;
  for (let i = 0; i < GRID; i++) {
    for (let j = 0; j < GRID; j++) {
      const index = i * (GRID + 1) + j;
      const corners = [cache.vertices[index], cache.vertices[index + 1],
        cache.vertices[index + GRID + 2], cache.vertices[index + GRID + 1]];
      for (const triangle of [[corners[0], corners[1], corners[2]], [corners[0], corners[2], corners[3]]]) {
        const clipped = clipFloodTriangle(triangle, level);
        const area = polygonArea(clipped);
        if (clipped.length < 3 || area < 0.001) continue;
        floodedArea += area;
        const positions = clipped.map(p => {
          const c = localPoint(cache!.center, p.x, p.y);
          return Cesium.Cartesian3.fromRadians(c.longitude, c.latitude, level);
        });
        instances.push(new Cesium.GeometryInstance({
          geometry: Cesium.PolygonGeometry.fromPositions({ positions, height: level,
            vertexFormat: Cesium.PerInstanceColorAppearance.FLAT_VERTEX_FORMAT }),
          attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(Cesium.Color.DEEPSKYBLUE.withAlpha(0.6)) },
        }));
        // Keep the footprint visible when rendered terrain is coarser than samples.
        groundInstances.push(new Cesium.GeometryInstance({
          geometry: Cesium.PolygonGeometry.fromPositions({ positions,
            vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT }),
          attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(Cesium.Color.CYAN.withAlpha(0.5)) },
        }));
      }
    }
  }
  if (instances.length) {
    footprint = new Cesium.GroundPrimitive({ geometryInstances: groundInstances,
      classificationType: Cesium.ClassificationType.TERRAIN, allowPicking: false });
    analysis.addPrimitive(footprint);
    water = new Cesium.Primitive({ geometryInstances: instances, allowPicking: false,
      appearance: new Cesium.PerInstanceColorAppearance({ flat: true, translucent: true, closed: false }) });
    analysis.addPrimitive(water);
  }
  statusText.value = '水位 ' + level.toFixed(1) + 'm：淹没面积约 ' + (floodedArea / 10000).toFixed(2) +
    ' 公顷（' + (floodedArea / (cache.size * cache.size) * 100).toFixed(1) +
    '%），网格间距 ' + (cache.size / GRID).toFixed(0) + 'm';
}
function sampleArea() {
  if (!center || !ready.value) return;
  const size = areaSize.value;
  analysis.cancel(); clearWater(); analysis.remove(boundary); boundary = undefined;
  cache = undefined; hasArea.value = false;
  if (!Number.isFinite(size) || size < 1000 || size > 10000) {
    statusText.value = '请输入 1000–10000 米的区域边长'; return;
  }
  const origin = Cesium.Cartesian3.clone(center);
  void analysis.run(async valid => {
    statusText.value = '正在采样区域地形，完成后可实时调节水位…';
    const xy: { x: number; y: number }[] = [];
    const positions: Cesium.Cartographic[] = [];
    for (let i = 0; i <= GRID; i++) {
      for (let j = 0; j <= GRID; j++) {
        const x = (j / GRID - 0.5) * size;
        const y = (i / GRID - 0.5) * size;
        xy.push({ x, y }); positions.push(localPoint(origin, x, y));
      }
    }
    const ground = await sampleHeights(viewer.value!.terrainProvider, positions);
    if (!valid()) return;
    cache = { center: origin, size, vertices: xy.map((p, i) => ({ ...p, height: ground[i].height })) };
    const heights = ground.map(p => p.height);
    const low = Math.min(...heights);
    const high = Math.max(...heights);
    waterMin.value = Math.floor(low - 20);
    waterMax.value = Math.ceil(Math.max(high + 20, low + 40));
    waterLevel.value = Math.round(low + Math.max(high - low, 10) * 0.4);
    hasArea.value = true;
    const edge = [ground[0], ground[GRID], ground[ground.length - 1], ground[GRID * (GRID + 1)], ground[0]];
    boundary = analysis.add({ polyline: { positions: edge.map(p => Cesium.Cartographic.toCartesian(p)),
      width: 2, clampToGround: true, material: new Cesium.PolylineDashMaterialProperty({ color: Cesium.Color.WHITE }) } });
    renderFlood();
    return undefined;
  });
}
function applySetArea() {
  if (!ready.value) return;
  applyClear(); statusText.value = '请点击分析区域中心';
  analysis.pick(position => {
    center = position; hasCenter.value = true; analysis.picking.value = false;
    analysis.add({ position, point: { pixelSize: 11, color: Cesium.Color.CYAN },
      label: { text: '区域中心', font: '13px sans-serif', pixelOffset: new Cesium.Cartesian2(0, -22) } });
    sampleArea();
  });
}
watch(waterLevel, renderFlood);
watch(areaSize, () => { if (center) sampleArea(); });
const { code, explanation } = useCodeExplain({ analyze: () => `// 用本地 ENU 米制坐标构建区域，转换到 WGS84 经纬度
const position = localPoint(center, eastMeters, northMeters)
// 区域地形仅在中心或边长改变时重新采样
const terrain = await sampleHeights(provider, grid)
// 每格拆成两个三角形，按水位裁切，保留部分淹没的单元
const polygon = clipFloodTriangle(triangle, waterLevel)
const area = polygonArea(polygon)
// 仅在低于水位的区域显示水面，PolygonGeometry.height = waterLevel` }, {
  analyze: () => `【原理】以区域中心的 ENU 米制坐标生成 30×30 网格，采样 31×31 个地形点。
每格分成两个三角形，在线性高程面上按水位裁切，累计裁切后的水平投影面积。
青色贴地着色表示淹没范围，蓝色水位面表示实际水位高度，远景时仍能辨认淹没区。
【交互】水位范围根据区域高程自动设置。拖动水位直接使用缓存，改变边长重新采样。
【高程】水位与地形均采用 WGS84 椭球高，不等同于当地海拔基准。
【范围】静态水位情景：低洼孤立区域也会计入，未模拟水力连通、堤坝、流速或水量。面积受网格精度限制。`,
}, activeFeature);
</script>

<template>
  <div class="flex h-full flex-col gap-3 p-4">
    <div class="flex flex-wrap items-center gap-2">
      <n-button size="small" type="primary" :disabled="!ready" @click="applySetArea">设置区域</n-button>
      <n-button size="small" :loading="busy" :disabled="!ready || busy || !hasCenter" @click="sampleArea">重新采样</n-button>
      <n-button size="small" quaternary @click="applyClear">清除</n-button>
      <span class="text-xs">水位·椭球高(m)</span>
      <n-slider v-model:value="waterLevel" :min="waterMin" :max="waterMax" :step="1"
        :disabled="!hasArea || busy" style="width: 180px" />
      <span class="text-sm font-mono">{{ waterLevel }}m</span>
      <span class="text-xs">区域边长(m)</span>
      <n-input-number v-model:value="areaSize" :min="1000" :max="10000" :step="500" size="small" style="width: 110px" />
    </div>
    <SplitViewer title="淹没分析" :code="code" :explanation="explanation" storage-key="flood-split">
      <template #scene-overlay>
        <div class="absolute left-3 top-3 z-10 max-w-[80%] rounded bg-black/70 px-3 py-2 text-xs text-white">
          <div>{{ statusText }}</div><div class="mt-1 text-white/70">{{ terrainNote }}</div>
        </div>
      </template>
    </SplitViewer>
  </div>
</template>

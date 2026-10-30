<script setup lang="ts">
import * as Cesium from 'cesium';
import { provide, ref, shallowRef, watch } from 'vue';
import SplitViewer from '@/components/base/SplitViewer.vue';
import { useSpatialAnalysis } from '@/hooks/useSpatialAnalysis';
import { usePlanningDrawing } from '@/hooks/usePlanningDrawing';
import { useCodeExplain } from '@/hooks/useCodeExplain';
import { earthworkMesh, integrateEarthwork, type PlanningPolygon } from '@/utils/planningGeometry';
import { polygonArea, sampleHeights, type FloodVertex } from '@/utils/spatialAnalysis';

const containerRef = ref<HTMLDivElement | null>(null);
provide('splitViewerContainerRef', containerRef);
const activeFeature = ref('analyze');
const analysis = useSpatialAnalysis(containerRef, '绘制设计范围，完成后设置设计高程并计算土方。');
const { viewer, statusText, ready, busy, terrainNote } = analysis;
const draft = usePlanningDrawing(analysis);
const { drawing, positions } = draft;
const geometry = shallowRef<PlanningPolygon | null>(null);
const designElevation = ref<number | null>(null);
const gridDensity = ref<number | null>(15);
let result: Cesium.GroundPrimitive | undefined;
let plane: Cesium.Entity | undefined;
let cache: { polygon: PlanningPolygon; mesh: ReturnType<typeof earthworkMesh>; terrain: FloodVertex[]; mean: number } | undefined;
interface Stats {
  cut: number; fill: number; balance: number; area: number; mean: number; level: number;
  cells: number; cutCells: number; fillCells: number;
}
const stats = ref<Stats | null>(null);

function clearResult() {
  analysis.removePrimitive(result); result = undefined;
  analysis.remove(plane); plane = undefined; stats.value = null;
}
function applyClear() {
  draft.cancel(); analysis.clear(); geometry.value = null; cache = undefined;
  result = undefined; plane = undefined; stats.value = null;
  statusText.value = '已清除设计范围与结果';
}
function applyDraw() {
  if (!ready.value) return;
  applyClear(); draft.start();
}
function finishDrawing() {
  const polygon = draft.finish();
  if (!polygon) return;
  geometry.value = polygon;
  analysis.add({ position: polygon.anchor,
    label: { text: '设计范围', font: '13px sans-serif', heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      disableDepthTestDistance: Number.POSITIVE_INFINITY },
    polyline: { positions: [...polygon.positions, polygon.positions[0]], width: 3,
      clampToGround: true, material: Cesium.Color.YELLOW },
  });
  statusText.value = '设计范围已完成：' + (polygon.area / 10000).toFixed(2) + ' 公顷，可计算土方；设计高程留空时采用采样平均高程';
}
function cancelDrawing() { draft.cancel(); statusText.value = '已取消本次绘制'; }

function renderResult() {
  if (!cache) return;
  const data = cache;
  const level = designElevation.value ?? data.mean;
  clearResult();
  if (!Number.isFinite(level) || level < -1000 || level > 10000) {
    statusText.value = '请输入 -1000–10000m 范围内的设计椭球高'; return;
  }
  let cut = 0; let fill = 0; let area = 0;
  const cells = new Set<number>(); const cutCells = new Set<number>(); const fillCells = new Set<number>();
  const instances: Cesium.GeometryInstance[] = [];
  for (const triangle of data.mesh.triangles) {
    const vertices = triangle.indices.map(index => data.terrain[index]);
    const volumes = integrateEarthwork(vertices, level);
    cut += volumes.cutVolume; fill += volumes.fillVolume;
    area += polygonArea(vertices); cells.add(triangle.cell);
    if (volumes.cutVolume > 1e-8) cutCells.add(triangle.cell);
    if (volumes.fillVolume > 1e-8) fillCells.add(triangle.cell);
    for (const [polygon, color] of [[volumes.cut, Cesium.Color.RED], [volumes.fill, Cesium.Color.DODGERBLUE]] as const) {
      if (polygon.length < 3 || polygonArea(polygon) < 1e-6) continue;
      instances.push(new Cesium.GeometryInstance({
        geometry: Cesium.PolygonGeometry.fromPositions({ positions: polygon.map(p => data.polygon.toWorld(p)),
          vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT }),
        attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(color.withAlpha(0.45)) },
      }));
    }
  }
  if (instances.length) {
    result = new Cesium.GroundPrimitive({ geometryInstances: instances, allowPicking: false,
      classificationType: Cesium.ClassificationType.TERRAIN });
    analysis.addPrimitive(result);
  }
  plane = analysis.add({ polygon: { hierarchy: new Cesium.PolygonHierarchy(data.polygon.positions),
    height: level, material: Cesium.Color.YELLOW.withAlpha(0.12) } });
  stats.value = { cut, fill, balance: cut - fill, area, mean: data.mean, level,
    cells: cells.size, cutCells: cutCells.size, fillCells: fillCells.size };
  statusText.value = '土方计算完成：挖方 ' + cut.toFixed(1) + 'm³，填方 ' + fill.toFixed(1) +
    'm³；红色挖方、蓝色填方，黄色为设计高程面';
}
function calculateEarthwork() {
  const polygon = geometry.value;
  const density = gridDensity.value;
  if (!polygon) return;
  if (density === null || !Number.isInteger(density) || density < 5 || density > 30) {
    statusText.value = '网格密度须为 5–30 的整数'; return;
  }
  if (designElevation.value !== null && (!Number.isFinite(designElevation.value) || designElevation.value < -1000 || designElevation.value > 10000)) {
    statusText.value = '请输入有效的设计椭球高，或留空使用平均高程'; return;
  }
  clearResult();
  void analysis.run(async valid => {
    if (!cache) {
      statusText.value = '正在裁切边界网格并批量采样地形…';
      const mesh = earthworkMesh(polygon.vertices, polygon.indices, density);
      if (!mesh.triangles.length) throw new Error('设计范围内没有有效网格');
      const ground = await sampleHeights(viewer.value!.terrainProvider, mesh.samples.map(polygon.toCartographic));
      if (!valid()) return;
      const terrain = mesh.samples.map((p, i) => ({ ...p, height: ground[i].height }));
      let weightedHeight = 0; let area = 0;
      mesh.triangles.forEach(triangle => {
        const points = triangle.indices.map(index => terrain[index]);
        const a = polygonArea(points); area += a;
        weightedHeight += a * points.reduce((sum, p) => sum + p.height, 0) / 3;
      });
      cache = { polygon, mesh, terrain, mean: weightedHeight / area };
    }
    if (!valid()) return;
    renderResult();
    return undefined;
  });
}
watch(gridDensity, () => {
  analysis.cancel(); clearResult(); cache = undefined;
  if (geometry.value) statusText.value = '网格密度已改变，旧结果已清除，请重新计算';
});
watch(designElevation, () => {
  if (busy.value) return;
  if (cache) renderResult();
  else clearResult();
});
const { code, explanation } = useCodeExplain({ analyze: () => `// 先三角剖分设计区域，再将各网格与边界裁切
const mesh = earthworkMesh(polygon.vertices, polygon.indices, density)
const heights = await sampleHeights(provider, mesh.samples.map(polygon.toCartographic))
// 三角形内高程线性变化，分别裁切挖方与填方部分再积分
const result = integrateEarthwork(triangle, designElevation)
// 体积 = Σ(子三角形面积 × 三个顶点高差的平均值)
// 网格跨越挖填分界时，两部分分别计量，不相互抵消` }, {
  analyze: () => `【算法】局部米制网格与设计多边形精确裁切，凹多边形和边界碎片均参与计算，避免按网格节点重复计面积。
在每个地形三角形内线性插值，按设计高程裁开后分别积分挖方和填方。
【交互】绘制支持撤销和取消；设计高程改变后使用缓存重算，网格密度改变后需重新采样。清除或重画会使旧请求失效。
【高程】设计面与地形采用 WGS84 椭球高。留空时使用面积加权平均高程，作为几何挖填平衡的参考。
【精度】结果是采样地形的几何估算，不计土壤松胀、压实、边坡及地下构筑物。网格越密通常越接近实际，非工程测量结算。`,
}, activeFeature);
</script>

<template>
  <div class="flex h-full flex-col gap-3 p-4">
    <div class="flex flex-wrap items-center gap-2">
      <n-button size="small" type="success" :disabled="!ready" @click="applyDraw">开始绘制</n-button>
      <n-button size="small" type="primary" :disabled="!drawing || positions.length < 3" @click="finishDrawing">完成绘制</n-button>
      <n-button size="small" :disabled="!drawing || !positions.length" @click="draft.undo">撤销顶点</n-button>
      <n-button size="small" :disabled="!drawing" @click="cancelDrawing">取消本次</n-button>
      <n-button size="small" type="primary" :disabled="!ready || !geometry || busy" :loading="busy" @click="calculateEarthwork">计算土方</n-button>
      <n-button size="small" quaternary @click="applyClear">清除</n-button>
    </div>
    <SplitViewer title="土方计算" :code="code" :explanation="explanation" storage-key="earthwork-split">
      <template #scene-overlay>
        <div class="absolute left-3 top-3 z-10 max-w-[80%] rounded bg-black/70 px-3 py-2 text-xs text-white">
          <div>{{ statusText }}</div><div class="mt-1 text-white/70">{{ terrainNote }}</div>
        </div>
      </template>
      <template #bottom-panel>
        <div class="max-h-[48vh] shrink-0 space-y-3 overflow-auto border-t bg-gray-50 p-3 text-xs">
          <div class="flex flex-wrap items-center gap-2">
            <span>设计椭球高(m)</span><n-input-number v-model:value="designElevation" :min="-1000" :max="10000" :precision="2" :disabled="busy" size="small" placeholder="自动均高" style="width: 120px" />
            <span>网格密度</span><n-input-number v-model:value="gridDensity" :min="5" :max="30" :precision="0" size="small" style="width: 80px" />
          </div>
          <div v-if="stats" class="space-y-2">
            <b>土方计算结果 · {{ designElevation === null ? '自动均高' : '设计高程' }} {{ stats.level.toFixed(2) }}m</b>
            <div class="grid grid-cols-2 gap-2">
              <div class="rounded bg-red-50 p-2 text-red-700">挖方量<br /><strong>{{ stats.cut.toFixed(1) }}m³</strong></div>
              <div class="rounded bg-blue-50 p-2 text-blue-700">填方量<br /><strong>{{ stats.fill.toFixed(1) }}m³</strong></div>
              <div class="rounded bg-white p-2">挖方−填方<br /><strong>{{ stats.balance.toFixed(1) }}m³</strong></div>
              <div class="rounded bg-white p-2">计量面积<br /><strong>{{ stats.area.toFixed(1) }}㎡</strong></div>
            </div>
            <div>{{ Math.abs(stats.balance) < 1 ? '几何挖填基本平衡' : stats.balance > 0 ? '余方，需考虑外运' : '缺方，需考虑取土' }}</div>
            <div>原地形平均高程 {{ stats.mean.toFixed(2) }}m；{{ stats.cells }} 个有效网格。</div>
            <div>挖方涉及 {{ stats.cutCells }} 格，填方涉及 {{ stats.fillCells }} 格；同一网格可能同时含挖填。</div>
          </div>
          <div v-else>完成设计范围后计算土方；设计高程留空时自动采用地形均高。</div>
        </div>
      </template>
    </SplitViewer>
  </div>
</template>

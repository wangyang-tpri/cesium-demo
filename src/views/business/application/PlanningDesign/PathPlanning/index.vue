<script setup lang="ts">
import * as Cesium from 'cesium';
import { computed, provide, ref, shallowRef } from 'vue';
import SplitViewer from '@/components/base/SplitViewer.vue';
import { useSpatialAnalysis } from '@/hooks/useSpatialAnalysis';
import { useCodeExplain } from '@/hooks/useCodeExplain';
import { routeDistance } from '@/utils/planningGeometry';

const containerRef = ref<HTMLDivElement | null>(null);
provide('splitViewerContainerRef', containerRef);
const activeFeature = ref('analyze');
const analysis = useSpatialAnalysis(containerRef, '添加至少两个航点，再计算按顺序连接的规划路线。', false);
const { viewer, ready, picking, statusText, terrainNote } = analysis;
terrainNote.value = '航点顺序连线；距离按 WGS84 椭球测地线计算，不是道路导航或 A* 寻路';
interface Waypoint { id: number; position: Cesium.Cartesian3; longitude: number; latitude: number }
const waypoints = shallowRef<Waypoint[]>([]);
let counter = 0;
const markers: Cesium.Entity[] = [];
let path: Cesium.Entity | undefined;
const stats = ref<{ distance: number; segments: number } | null>(null);
const walkSpeed = ref<number | null>(5);
const carSpeed = ref<number | null>(40);
function formatTime(distance: number, speed: number | null) {
  if (speed === null || !Number.isFinite(speed) || speed <= 0 || speed > 300) return '速度无效';
  const minutes = distance / 1000 / speed * 60;
  if (minutes < 1) return '小于1分钟';
  const rounded = Math.ceil(minutes);
  return rounded >= 60 ? Math.floor(rounded / 60) + '小时' + rounded % 60 + '分钟' : rounded + '分钟';
}
const walkTime = computed(() => stats.value ? formatTime(stats.value.distance, walkSpeed.value) : '—');
const carTime = computed(() => stats.value ? formatTime(stats.value.distance, carSpeed.value) : '—');
function invalidate() { analysis.remove(path); path = undefined; stats.value = null; }
function applyStart() {
  if (!ready.value) return;
  analysis.pick(position => {
    const last = waypoints.value.at(-1);
    if (last && Cesium.Cartesian3.distance(last.position, position) < 1) {
      statusText.value = '相邻航点需至少相距 1 米'; return;
    }
    if (waypoints.value.length >= 100) { statusText.value = '最多支持 100 个航点'; return; }
    invalidate();
    const carto = Cesium.Cartographic.fromCartesian(position);
    waypoints.value = [...waypoints.value, { id: ++counter, position,
      longitude: Cesium.Math.toDegrees(carto.longitude), latitude: Cesium.Math.toDegrees(carto.latitude) }];
    markers.push(analysis.add({ position,
      point: { pixelSize: 10, color: Cesium.Color.LIME, heightReference: Cesium.HeightReference.CLAMP_TO_GROUND },
      label: { text: '航点' + waypoints.value.length, font: '12px sans-serif',
        pixelOffset: new Cesium.Cartesian2(0, -22), heightReference: Cesium.HeightReference.CLAMP_TO_GROUND },
    }));
    statusText.value = '已添加 ' + waypoints.value.length + ' 个航点，继续添加或计算路径';
  });
  statusText.value = '正在添加航点；已有航点保留，按点击顺序连接';
}
function applyCalculate() {
  if (!ready.value || waypoints.value.length < 2) return;
  try {
    const positions = waypoints.value.map(p => p.position);
    const distance = routeDistance(positions);
    invalidate();
    picking.value = false;
    path = analysis.add({ polyline: { positions, width: 4, clampToGround: true, material: Cesium.Color.LIME } });
    stats.value = { distance, segments: positions.length - 1 };
    statusText.value = '规划连线完成：' + stats.value.segments + ' 段，共 ' + (distance / 1000).toFixed(3) + 'km；参考时间按下方速度计算';
  } catch (error) {
    statusText.value = '路径计算失败：' + (error instanceof Error ? error.message : '请调整航点');
  }
}
function applyUndo() {
  if (!waypoints.value.length) return;
  invalidate(); analysis.remove(markers.pop());
  waypoints.value = waypoints.value.slice(0, -1);
  statusText.value = '已撤销航点，旧路径和统计已清除，请重新计算';
}
function stopPicking() { picking.value = false; statusText.value = '已停止添加航点'; }
function locate() {
  if (!viewer.value || !waypoints.value.length) return;
  const sphere = Cesium.BoundingSphere.fromPoints(waypoints.value.map(p => p.position));
  viewer.value.camera.flyToBoundingSphere(sphere, { offset: new Cesium.HeadingPitchRange(0, -Math.PI / 3, Math.max(sphere.radius * 3, 2000)) });
}
function applyClear() {
  analysis.clear(); waypoints.value = []; markers.length = 0; counter = 0; path = undefined; stats.value = null;
  statusText.value = '已清除航点与路径';
}
const { code, explanation } = useCodeExplain({ analyze: () => `// 航点按输入顺序连接，逐段使用 WGS84 测地线长度
const total = positions.slice(1).reduce((sum, p, i) => sum +
  new EllipsoidGeodesic(Cartographic.fromCartesian(positions[i]),
    Cartographic.fromCartesian(p)).surfaceDistance, 0)
// 参考时间（公里 / 公里每小时）
const minutes = total / 1000 / speed * 60
// 新增、撤销航点时立即移除旧路径并清空统计` }, {
  analyze: () => `【功能】按航点顺序生成贴地规划连线，支持继续添加、停止添加、撤销、定位和清除。
【距离】使用椭球测地线距离，避免把穿过地球内部的弦长作为地表距离；不计坡面起伏。
【时间】按用户输入速度估算，不考虑道路、交通规则、拥堵和障碍。
【范围】这里是航点连线规划，没有道路网络和障碍数据，不提供 A* 避障或道路最短路径。`,
}, activeFeature);
</script>

<template>
  <div class="flex h-full flex-col gap-3 p-4">
    <div class="flex flex-wrap items-center gap-2">
      <n-button size="small" type="success" :disabled="!ready" @click="applyStart">{{ picking ? '继续添加中' : '添加航点' }}</n-button>
      <n-button size="small" :disabled="!picking" @click="stopPicking">停止添加</n-button>
      <n-button size="small" type="primary" :disabled="!ready || waypoints.length < 2" @click="applyCalculate">计算路径</n-button>
      <n-button size="small" :disabled="!waypoints.length" @click="applyUndo">撤销航点</n-button>
      <n-button size="small" :disabled="!waypoints.length" @click="locate">定位路线</n-button>
      <n-button size="small" quaternary @click="applyClear">清除</n-button>
    </div>
    <SplitViewer title="路径规划" :code="code" :explanation="explanation" storage-key="path-planning-split">
      <template #scene-overlay>
        <div class="absolute left-3 top-3 z-10 max-w-[80%] rounded bg-black/70 px-3 py-2 text-xs text-white">
          <div>{{ statusText }}</div><div class="mt-1 text-white/70">{{ terrainNote }}</div>
        </div>
      </template>
      <template #bottom-panel>
        <div class="shrink-0 border-t bg-gray-50 p-3 text-xs">
          <div class="mb-2 flex flex-wrap items-center gap-2">
            <span>步行(km/h)</span><n-input-number v-model:value="walkSpeed" :min="0.1" :max="300" size="small" style="width: 85px" />
            <span>驾车(km/h)</span><n-input-number v-model:value="carSpeed" :min="0.1" :max="300" size="small" style="width: 85px" />
          </div>
          <div v-if="stats">总距离 {{ (stats.distance / 1000).toFixed(3) }}km · {{ stats.segments }} 段<br />步行参考 {{ walkTime }} · 驾车参考 {{ carTime }}</div>
          <div v-else>添加或撤销航点后请重新计算路径。</div>
          <div class="mt-2 max-h-28 overflow-auto">
            <div v-for="(wp, index) in waypoints" :key="wp.id" class="py-1">航点{{ index + 1 }}：{{ wp.longitude.toFixed(6) }}°，{{ wp.latitude.toFixed(6) }}°</div>
          </div>
        </div>
      </template>
    </SplitViewer>
  </div>
</template>

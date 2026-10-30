<script setup lang="ts">
import * as Cesium from 'cesium';
import { provide, ref, watch } from 'vue';
import SplitViewer from '@/components/base/SplitViewer.vue';
import { useCodeExplain } from '@/hooks/useCodeExplain';
import { useSpatialAnalysis } from '@/hooks/useSpatialAnalysis';
import { localPoint, sampleHeights, visibilityAlongRay } from '@/utils/spatialAnalysis';

const containerRef = ref<HTMLDivElement | null>(null);
provide('splitViewerContainerRef', containerRef);
const activeFeature = ref('analyze');
const analysis = useSpatialAnalysis(containerRef, '设置观察点，然后计算地形可视域。');
const { viewer, statusText, ready, busy, terrainNote } = analysis;
const observerHeight = ref(50);
const maxDistance = ref(3000);
const rayCount = ref(60);
const hasObserver = ref(false);
let observer: Cesium.Cartesian3 | undefined;
let marker: Cesium.Entity | undefined;
let result: Cesium.GroundPrimitive | undefined;
const STEPS = 60;

function clearResult() { analysis.removePrimitive(result); result = undefined; }
function applyClear() {
  analysis.clear(); observer = undefined; marker = undefined; result = undefined;
  hasObserver.value = false; statusText.value = '已清除，可重新设置观察点';
}
function applySetObserver() {
  if (!ready.value) return;
  applyClear();
  statusText.value = '请在地面点击观察点';
  analysis.pick(position => {
    observer = position; hasObserver.value = true; analysis.picking.value = false;
    marker = analysis.add({ position, point: { pixelSize: 12, color: Cesium.Color.YELLOW },
      label: { text: '观察点', font: '13px sans-serif', pixelOffset: new Cesium.Cartesian2(0, -24) } });
    statusText.value = '观察点已设置，点击计算可视域';
  });
}
function applyCalculate() {
  if (!observer) return;
  const height = observerHeight.value;
  const radius = maxDistance.value;
  const count = rayCount.value;
  if (!Number.isFinite(height) || height < 1 || height > 500 ||
      !Number.isFinite(radius) || radius < 500 || radius > 10000 ||
      !Number.isInteger(count) || count < 12 || count > 120) {
    statusText.value = '请输入有效参数：高度 1–500m，视距 500–10000m，射线数为 12–120 的整数'; return;
  }
  const center = Cesium.Cartesian3.clone(observer);
  clearResult();
  void analysis.run(async valid => {
    statusText.value = '正在批量采样地形并计算各方向地平线…';
    const positions = [Cesium.Cartographic.fromCartesian(center)];
    for (let i = 0; i < count; i++) {
      const angle = i / count * Cesium.Math.TWO_PI;
      for (let j = 1; j <= STEPS; j++) {
        const distance = radius * j / STEPS;
        positions.push(localPoint(center, Math.sin(angle) * distance, Math.cos(angle) * distance));
      }
    }
    const ground = await sampleHeights(viewer.value!.terrainProvider, positions);
    if (!valid()) return;
    const eye = Cesium.Cartesian3.fromRadians(ground[0].longitude, ground[0].latitude, ground[0].height + height);
    if (marker) marker.position = new Cesium.ConstantPositionProperty(eye);
    const instances: Cesium.GeometryInstance[] = [];
    let visibleArea = 0;
    const halfAngle = Math.PI / count;
    const at = (angle: number, distance: number) => Cesium.Cartographic.toCartesian(
      localPoint(center, Math.sin(angle) * distance, Math.cos(angle) * distance),
    );
    for (let i = 0; i < count; i++) {
      const visible = visibilityAlongRay(eye, ground.slice(1 + i * STEPS, 1 + (i + 1) * STEPS));
      const angle = i / count * Cesium.Math.TWO_PI;
      for (let j = 0; j < STEPS; j++) {
        const near = radius * j / STEPS;
        const far = radius * (j + 1) / STEPS;
        const corners = j === 0
          ? [center, at(angle - halfAngle, far), at(angle + halfAngle, far)]
          : [at(angle - halfAngle, near), at(angle - halfAngle, far),
            at(angle + halfAngle, far), at(angle + halfAngle, near)];
        if (visible[j]) visibleArea += (far * far - near * near) * Math.PI / count;
        instances.push(new Cesium.GeometryInstance({
          geometry: Cesium.PolygonGeometry.fromPositions({ positions: corners,
            vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT }),
          attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(
            (visible[j] ? Cesium.Color.LIME : Cesium.Color.RED).withAlpha(0.35),
          ) },
        }));
      }
    }
    result = new Cesium.GroundPrimitive({ geometryInstances: instances,
      classificationType: Cesium.ClassificationType.TERRAIN, allowPicking: false });
    analysis.addPrimitive(result);
    return '采样可视域完成：绿色可见，红色遮挡；可见面积约 ' +
      (visibleArea / (Math.PI * radius * radius) * 100).toFixed(1) +
      '%；径向间隔 ' + (radius / STEPS).toFixed(0) + 'm，角度间隔 ' + (360 / count).toFixed(1) + '°';
  });
}
watch([observerHeight, maxDistance, rayCount], () => {
  analysis.cancel(); clearResult();
  if (marker && observer) {
    const p = Cesium.Cartographic.fromCartesian(observer);
    marker.position = new Cesium.ConstantPositionProperty(Cesium.Cartesian3.fromRadians(
      p.longitude, p.latitude, p.height + (Number.isFinite(observerHeight.value) ? observerHeight.value : 0),
    ));
  }
  if (observer) statusText.value = '参数已修改，请重新计算可视域';
});
const { code, explanation } = useCodeExplain({ analyze: () => `// 批量获取观察点及径向地面高程
const ground = await sampleHeights(terrainProvider, positions)
// 每条射线逐点计算地面目标相对于观察者的仰角
const visible = visibilityAlongRay(eye, rayTerrain)
// 仰角超过此前最大仰角才可见；山脊后更高地形可能再次可见
// 用 GroundPrimitive 合批显示绿色/红色采样扇区，而不是填满边界多边形` }, {
  analyze: () => `【原理】比较地面目标的仰角与此前最大仰角，包含地球曲率，保留山脊后的不可见区及重新可见区。
【显示】绿色为采样可见区域，红色为遮挡区域，百分比为扇区面积加权的近似值。
【精度】每方向 60 个距离样点，方位数量可调；扇区内共享中心射线的判定，非逐像素精确结果。
【范围】仅包含地形，无建筑物和植被；观察高度为离地高度。修改参数后需重新计算。`,
}, activeFeature);
</script>

<template>
  <div class="flex h-full flex-col gap-3 p-4">
    <div class="flex flex-wrap items-center gap-2">
      <n-button size="small" type="primary" :disabled="!ready" @click="applySetObserver">设置观察点</n-button>
      <n-button size="small" type="success" :loading="busy" :disabled="!ready || busy || !hasObserver" @click="applyCalculate">计算可视域</n-button>
      <n-button size="small" quaternary @click="applyClear">清除</n-button>
      <span class="text-xs">离地高度(m)</span>
      <n-input-number v-model:value="observerHeight" :min="1" :max="500" :step="10" size="small" style="width: 95px" />
      <span class="text-xs">视距(m)</span>
      <n-input-number v-model:value="maxDistance" :min="500" :max="10000" :step="500" size="small" style="width: 110px" />
      <span class="text-xs">射线数</span>
      <n-input-number v-model:value="rayCount" :min="12" :max="120" :step="12" :precision="0" size="small" style="width: 90px" />
    </div>
    <SplitViewer title="可视域分析" :code="code" :explanation="explanation" storage-key="viewshed-split">
      <template #scene-overlay>
        <div class="absolute left-3 top-3 z-10 max-w-[80%] rounded bg-black/70 px-3 py-2 text-xs text-white">
          <div>{{ statusText }}</div><div class="mt-1 text-white/70">{{ terrainNote }}</div>
        </div>
      </template>
    </SplitViewer>
  </div>
</template>

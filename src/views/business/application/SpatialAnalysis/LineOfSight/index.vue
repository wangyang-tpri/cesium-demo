<script setup lang="ts">
import * as Cesium from 'cesium';
import { provide, ref } from 'vue';
import SplitViewer from '@/components/base/SplitViewer.vue';
import { useCodeExplain } from '@/hooks/useCodeExplain';
import { useSpatialAnalysis } from '@/hooks/useSpatialAnalysis';
import { firstObstruction, sampleHeights, sightSamples } from '@/utils/spatialAnalysis';

const containerRef = ref<HTMLDivElement | null>(null);
provide('splitViewerContainerRef', containerRef);
const activeFeature = ref('analyze');
const analysis = useSpatialAnalysis(containerRef, '点击开始分析，依次选择观察点和目标点。');
const { viewer, statusText, busy, ready, terrainNote } = analysis;
const observerHeight = ref(2);
const targetHeight = ref(2);
let observer: Cesium.Cartesian3 | undefined;
let observerMarker: Cesium.Entity | undefined;
let targetMarker: Cesium.Entity | undefined;

function marker(position: Cesium.Cartesian3, text: string, color: Cesium.Color) {
  return analysis.add({ position,
    point: { pixelSize: 10, color, outlineColor: Cesium.Color.WHITE, outlineWidth: 2 },
    label: { text, font: '13px sans-serif', pixelOffset: new Cesium.Cartesian2(0, -22),
      fillColor: color, style: Cesium.LabelStyle.FILL_AND_OUTLINE, outlineWidth: 2 },
  });
}
function applyAnalyze() {
  if (!ready.value) return;
  analysis.clear();
  observer = undefined;
  statusText.value = '请点击观察点，再点击目标点';
  analysis.pick(position => {
    if (!observer) {
      observer = position;
      observerMarker = marker(position, '观察点', Cesium.Color.LIME);
      statusText.value = '观察点已设置，请点击目标点';
      return;
    }
    if (Cesium.Cartesian3.distance(observer, position) < 1) {
      statusText.value = '两点距离至少需要 1 米，请重新点击目标点'; return;
    }
    if (![observerHeight.value, targetHeight.value].every(h => Number.isFinite(h) && h >= 0 && h <= 500)) {
      statusText.value = '请输入 0–500 米的离地高度'; return;
    }
    targetMarker = marker(position, '目标点', Cesium.Color.RED);
    const endpoints = [observer, position].map(p => Cesium.Cartographic.fromCartesian(p));
    const heights = [observerHeight.value, targetHeight.value];
    void analysis.run(async valid => {
      statusText.value = '正在采样地形，计算空间直线遮挡…';
      const terrain = viewer.value!.terrainProvider;
      const ground = await sampleHeights(terrain, endpoints);
      if (!valid()) return;
      const elevated = ground.map((p, i) => Cesium.Cartesian3.fromRadians(p.longitude, p.latitude, p.height + heights[i]));
      const line = sightSamples(elevated[0], elevated[1]);
      const sampled = await sampleHeights(terrain, line);
      if (!valid()) return;
      const block = firstObstruction(line, sampled);
      const split = block < 0 ? elevated[1] : Cesium.Cartographic.toCartesian(line[block]);
      const draw = (positions: Cesium.Cartesian3[], color: Cesium.Color) => analysis.add({
        polyline: { positions, width: 4, arcType: Cesium.ArcType.NONE,
          material: color, depthFailMaterial: color.withAlpha(0.65) },
      });
      draw([elevated[0], split], Cesium.Color.LIME);
      if (block >= 0) {
        draw([split, elevated[1]], Cesium.Color.RED);
        marker(split, '首个遮挡位置（采样近似）', Cesium.Color.YELLOW);
      }
      analysis.remove(observerMarker); analysis.remove(targetMarker);
      observerMarker = marker(elevated[0], '观察点离地 ' + heights[0] + 'm', Cesium.Color.LIME);
      targetMarker = marker(elevated[1], '目标点离地 ' + heights[1] + 'm', Cesium.Color.RED);
      return block < 0
        ? '采样通视：' + line.length + ' 个采样位置未发现地形遮挡'
        : '不通视：距观察点约 ' + Cesium.Cartesian3.distance(elevated[0], split).toFixed(0) + 'm 首次遮挡；绿色为遮挡前，红色为遮挡后';
    });
  });
}
function applyClear() {
  analysis.clear(); observer = undefined;
  statusText.value = '已清除，可重新选择两点';
}
const { code, explanation } = useCodeExplain({ analyze: () => `// 端点先采样地形，再叠加离地高度
const elevated = ground.map((p, i) => Cartesian3.fromRadians(p.longitude, p.latitude, p.height + heights[i]))
// 在 ECEF 空间直线上采样：自然包含地球曲率
const line = sightSamples(elevated[0], elevated[1])
const groundSamples = await sampleHeights(terrain, line)
const firstHit = firstObstruction(line, groundSamples)
// ArcType.NONE：显示真实空间直线；首次遮挡之后全部为红色` }, {
  analyze: () => `【原理】将地形采样高度与空间直线的椭球高逐点比较，包含地球曲率。
观察点和目标点的离地高度分别设置。首次遮挡后的整段视线均不可直达。
【范围】仅分析地形，不计算建筑物、植被。257 个采样点可能遗漏窄障碍，结果为采样近似。
【交互】清除或重新开始会使旧计算失效；地形失败会明确提示。修改离地高度后需重新开始分析。`,
}, activeFeature);
</script>

<template>
  <div class="flex h-full flex-col gap-3 p-4">
    <div class="flex flex-wrap items-center gap-2">
      <n-button size="small" type="primary" :disabled="!ready" @click="applyAnalyze">开始分析</n-button>
      <n-button size="small" quaternary @click="applyClear">清除</n-button>
      <span class="text-xs">观察点离地(m)</span>
      <n-input-number v-model:value="observerHeight" :min="0" :max="500" :disabled="busy" size="small" style="width: 100px" />
      <span class="text-xs">目标点离地(m)</span>
      <n-input-number v-model:value="targetHeight" :min="0" :max="500" :disabled="busy" size="small" style="width: 100px" />
    </div>
    <SplitViewer title="通视分析" :code="code" :explanation="explanation" storage-key="los-split">
      <template #scene-overlay>
        <div class="absolute left-3 top-3 z-10 max-w-[80%] rounded bg-black/70 px-3 py-2 text-xs text-white">
          <div>{{ statusText }}</div><div class="mt-1 text-white/70">{{ terrainNote }}</div>
        </div>
      </template>
    </SplitViewer>
  </div>
</template>

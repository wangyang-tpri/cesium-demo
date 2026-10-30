<script setup lang="ts">
import * as Cesium from 'cesium';
import { provide, ref, watch } from 'vue';
import SplitViewer from '@/components/base/SplitViewer.vue';
import { useCodeExplain } from '@/hooks/useCodeExplain';
import { useSpatialAnalysis } from '@/hooks/useSpatialAnalysis';

const containerRef = ref<HTMLDivElement | null>(null);
provide('splitViewerContainerRef', containerRef);
const activeFeature = ref('point');
const mode = ref<'point' | 'line'>('point');
const bufferRadius = ref(500);
const analysis = useSpatialAnalysis(containerRef, '选择点或线模式，开始绘制后生成缓冲区。', false);
const { statusText, ready, terrainNote } = analysis;
const pointCount = ref(0);
let points: Cesium.Cartesian3[] = [];
let buffers: Cesium.Entity[] = [];
let line: Cesium.Entity | undefined;
let generated = false;

function applyClear() {
  analysis.clear(); points = []; pointCount.value = 0; buffers = []; line = undefined; generated = false;
  statusText.value = '已清除，点击开始绘制添加要素';
}
function setMode(value: 'point' | 'line') { applyClear(); mode.value = value; activeFeature.value = value; }
function applyStart() {
  if (!ready.value) return;
  applyClear();
  statusText.value = mode.value === 'point' ? '点击添加点，之后生成缓冲区' : '点击添加折线顶点，至少两个点，之后生成缓冲区';
  analysis.pick(position => {
    if (points.some(p => Cesium.Cartesian3.distance(p, position) < 1)) {
      statusText.value = '与已有点距离不足 1 米，请选择其他位置'; return;
    }
    if (points.length >= 100) { statusText.value = '最多支持 100 个点，请生成缓冲区'; return; }
    points.push(position); pointCount.value = points.length;
    analysis.add({ position, point: { pixelSize: 9, color: Cesium.Color.ORANGE } });
    if (mode.value === 'line' && points.length > 1) {
      analysis.remove(line);
      line = analysis.add({ polyline: { positions: [...points], width: 3,
        clampToGround: true, material: Cesium.Color.DODGERBLUE } });
    }
    statusText.value = '已添加 ' + points.length + ' 个点，点击生成缓冲区完成';
  });
}
function applyGenerate() {
  const radius = bufferRadius.value;
  if (!ready.value || !points.length || (mode.value === 'line' && points.length < 2)) return;
  if (!Number.isFinite(radius) || radius < 10 || radius > 5000) {
    statusText.value = '请输入 10–5000 米的有效半径'; return;
  }
  analysis.picking.value = false;
  buffers.forEach(analysis.remove); buffers = [];
  if (mode.value === 'point') {
    for (const position of points) buffers.push(analysis.add({ position,
      ellipse: { semiMajorAxis: radius, semiMinorAxis: radius,
        material: Cesium.Color.ORANGE.withAlpha(0.35),
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND },
    }));
  } else {
    buffers.push(analysis.add({ corridor: { positions: [...points], width: radius * 2,
      cornerType: Cesium.CornerType.ROUNDED, material: Cesium.Color.DODGERBLUE.withAlpha(0.35),
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND } }));
  }
  generated = true;
  statusText.value = mode.value === 'point'
    ? '已生成 ' + points.length + ' 个点缓冲区，半径 ' + radius + 'm；修改半径可实时更新'
    : '已生成 ' + (points.length - 1) + ' 段线的圆角缓冲区，半径 ' + radius + 'm，总宽 ' + radius * 2 + 'm';
}
watch(bufferRadius, () => { if (generated) applyGenerate(); });
const { code, explanation } = useCodeExplain({
  point: () => `viewer.entities.add({ position, ellipse: {
  semiMajorAxis: radius, semiMinorAxis: radius,
  heightReference: HeightReference.CLAMP_TO_GROUND,
  material: Color.ORANGE.withAlpha(0.35)
} })`,
  line: () => `viewer.entities.add({ corridor: {
  positions: linePoints, width: radius * 2,
  cornerType: CornerType.ROUNDED,
  heightReference: HeightReference.CLAMP_TO_GROUND,
  material: Color.DODGERBLUE.withAlpha(0.35)
} })`,
}, {
  point: () => '【原理】以每个点为中心，在 WGS84 椭球上生成半径为指定米数的圆形区域。支持多个点和生成后修改半径。重叠区域保持独立显示，不做几何合并或面积统计。',
  line: () => '【原理】沿折线生成两侧等距走廊，总宽度为半径的两倍，采用圆角拐点和圆形端部。重复点会被拒绝；重新生成会替换旧结果。缓冲距离为椭球面近似距离，不是坡面距离。复杂自交线路建议分段分析。',
}, activeFeature);
</script>

<template>
  <div class="flex h-full flex-col gap-3 p-4">
    <div class="flex flex-wrap items-center gap-2">
      <n-button size="small" :type="mode === 'point' ? 'primary' : 'default'" @click="setMode('point')">点缓冲区</n-button>
      <n-button size="small" :type="mode === 'line' ? 'primary' : 'default'" @click="setMode('line')">线缓冲区</n-button>
      <n-button size="small" type="success" :disabled="!ready" @click="applyStart">开始绘制</n-button>
      <n-button size="small" :disabled="!ready || pointCount < (mode === 'line' ? 2 : 1)" @click="applyGenerate">生成缓冲区</n-button>
      <n-button size="small" quaternary @click="applyClear">清除</n-button>
      <span class="text-xs">半径(m)</span>
      <n-input-number v-model:value="bufferRadius" :min="10" :max="5000" :step="100" size="small" style="width: 110px" />
    </div>
    <SplitViewer title="缓冲区分析" :code="code" :explanation="explanation" storage-key="buffer-split">
      <template #scene-overlay>
        <div class="absolute left-3 top-3 z-10 max-w-[80%] rounded bg-black/70 px-3 py-2 text-xs text-white">
          <div>{{ statusText }}</div><div class="mt-1 text-white/70">{{ terrainNote }}</div>
        </div>
      </template>
    </SplitViewer>
  </div>
</template>

<script setup lang="ts">
import * as Cesium from 'cesium';
import * as echarts from 'echarts';
import { onBeforeUnmount, provide, ref, watch } from 'vue';
import SplitViewer from '@/components/base/SplitViewer.vue';
import { useCodeExplain } from '@/hooks/useCodeExplain';
import { useSpatialAnalysis } from '@/hooks/useSpatialAnalysis';
import { buildProfile, sampleHeights } from '@/utils/spatialAnalysis';

const containerRef = ref<HTMLDivElement | null>(null);
provide('splitViewerContainerRef', containerRef);
const activeFeature = ref('analyze');
const analysis = useSpatialAnalysis(containerRef, '点击开始绘制，添加至少两个点，再点击完成。');
const { viewer, statusText, ready, busy, terrainNote } = analysis;
const pointCount = ref(0);
const chartRef = ref<HTMLDivElement | null>(null);
let chart: echarts.ECharts | undefined;
let resizeObserver: ResizeObserver | undefined;
let points: Cesium.Cartesian3[] = [];
let line: Cesium.Entity | undefined;
let hoverPoint: Cesium.Entity | undefined;
let profile: Cesium.Cartographic[] = [];
let chartData: number[][] = [];

function updateChart() {
  chart?.setOption({
    title: { text: '地形高程剖面', left: 'center', textStyle: { fontSize: 14 } },
    tooltip: { trigger: 'axis', valueFormatter: (value: unknown) => Number(value).toFixed(1) },
    grid: { left: 65, right: 25, top: 40, bottom: 45 },
    xAxis: { type: 'value', name: '距离(m)', nameLocation: 'middle', nameGap: 25, min: 0 },
    yAxis: { type: 'value', name: '椭球高(m)', scale: true },
    series: [{ type: 'line', smooth: false, symbol: 'none', data: chartData,
      lineStyle: { color: '#2080f0' }, areaStyle: { color: 'rgba(32,128,240,0.15)' } }],
  });
}
watch(chartRef, element => {
  resizeObserver?.disconnect(); chart?.dispose(); chart = undefined;
  if (!element) return;
  chart = echarts.init(element);
  updateChart();
  chart.on('updateAxisPointer', (event: unknown) => {
    const data = event as { axesInfo?: { seriesDataIndices?: { dataIndex: number }[] }[] };
    const index = data.axesInfo?.[0]?.seriesDataIndices?.[0]?.dataIndex;
    if (index === undefined || !profile[index]) return;
    const position = Cesium.Cartographic.toCartesian(profile[index]);
    if (hoverPoint) hoverPoint.position = new Cesium.ConstantPositionProperty(position);
    else hoverPoint = analysis.add({ position, point: { pixelSize: 11, color: Cesium.Color.YELLOW,
      disableDepthTestDistance: Number.POSITIVE_INFINITY } });
  });
  resizeObserver = new ResizeObserver(() => chart?.resize());
  resizeObserver.observe(element);
}, { flush: 'post' });

function applyClear() {
  analysis.clear(); points = []; pointCount.value = 0; line = hoverPoint = undefined;
  profile = []; chartData = []; updateChart();
  statusText.value = '已清除，可重新绘制剖面线';
}
function applyAnalyze() {
  if (!ready.value) return;
  applyClear();
  statusText.value = '点击添加剖面线顶点，至少两个点；完成后生成剖面';
  analysis.pick(position => {
    const last = points[points.length - 1];
    if (last && Cesium.Cartesian3.distance(last, position) < 1) {
      statusText.value = '相邻顶点需至少相距 1 米'; return;
    }
    if (points.length >= 50) { statusText.value = '最多支持 50 个顶点，请点击完成'; return; }
    points.push(position); pointCount.value = points.length;
    analysis.add({ position, point: { pixelSize: 8, color: Cesium.Color.DODGERBLUE,
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND } });
    analysis.remove(line);
    if (points.length > 1) line = analysis.add({ polyline: { positions: [...points], width: 3,
      clampToGround: true, material: Cesium.Color.DODGERBLUE } });
    statusText.value = '已添加 ' + points.length + ' 个顶点，可继续添加或点击完成';
  });
}
function applyFinish() {
  if (points.length < 2) return;
  const snapshot = [...points];
  void analysis.run(async valid => {
    statusText.value = '正在按地表距离采样地形…';
    const path = buildProfile(snapshot);
    const sampled = await sampleHeights(viewer.value!.terrainProvider, path.positions);
    if (!valid()) return;
    profile = sampled;
    chartData = path.distances.map((distance, i) => [distance, sampled[i].height]);
    updateChart();
    analysis.remove(line);
    line = analysis.add({ polyline: { positions: sampled.map(p => Cesium.Cartographic.toCartesian(p)),
      width: 4, clampToGround: true, material: Cesium.Color.DODGERBLUE } });
    const heights = sampled.map(p => p.height);
    const average = chartData.slice(1).reduce((sum, p, i) => sum +
      (p[1] + chartData[i][1]) * 0.5 * (p[0] - chartData[i][0]), 0) / path.total;
    return '剖面完成：' + (path.total / 1000).toFixed(2) + 'km，' + sampled.length + ' 个样点；最低 ' +
      Math.min(...heights).toFixed(1) + 'm，最高 ' + Math.max(...heights).toFixed(1) +
      'm，平均 ' + average.toFixed(1) + 'm。悬停图表定位样点。';
  });
}
onBeforeUnmount(() => { resizeObserver?.disconnect(); chart?.dispose(); });
const { code, explanation } = useCodeExplain({ analyze: () => `// 按椭球测地线插值，累计地表距离
const path = buildProfile(points)
const sampled = await sampleHeights(viewer.terrainProvider, path.positions)
const data = path.distances.map((distance, i) => [distance, sampled[i].height])
chart.setOption({ series: [{ type: 'line', smooth: false, data }] })
// 通过 updateAxisPointer 将图表样点定位到三维地图` }, {
  analyze: () => `【原理】沿每段测地线约每 100 米采样，长路线自动降低密度，约 2000 个间隔。
横轴为沿线累计地表距离，纵轴为地形椭球高。关闭曲线平滑，避免图表产生不存在的高程极值。
【交互】支持折线、图表悬停定位、重画和清除。图表随容器尺寸调整。
【范围】只包含地形；窄地物可能在样点之间遗漏。计算失败可点击完成重试。`,
}, activeFeature);
</script>

<template>
  <div class="flex h-full flex-col gap-3 p-4">
    <div class="flex flex-wrap items-center gap-2">
      <n-button size="small" type="primary" :disabled="!ready" @click="applyAnalyze">开始绘制</n-button>
      <n-button size="small" type="success" :loading="busy" :disabled="!ready || busy || pointCount < 2" @click="applyFinish">完成</n-button>
      <n-button size="small" quaternary @click="applyClear">清除</n-button>
    </div>
    <SplitViewer title="剖面分析" :code="code" :explanation="explanation" storage-key="profile-split">
      <template #scene-overlay>
        <div class="absolute left-3 top-3 z-10 max-w-[80%] rounded bg-black/70 px-3 py-2 text-xs text-white">
          <div>{{ statusText }}</div><div class="mt-1 text-white/70">{{ terrainNote }}</div>
        </div>
      </template>
      <template #bottom-panel><div ref="chartRef" class="h-56 w-full shrink-0 border-t border-gray-200"></div></template>
    </SplitViewer>
  </div>
</template>

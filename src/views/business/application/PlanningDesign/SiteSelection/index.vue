<script setup lang="ts">
import * as Cesium from 'cesium';
import { computed, provide, ref, watch } from 'vue';
import SplitViewer from '@/components/base/SplitViewer.vue';
import { useSpatialAnalysis } from '@/hooks/useSpatialAnalysis';
import { useCodeExplain } from '@/hooks/useCodeExplain';
import { weightedScore } from '@/utils/planningGeometry';

const containerRef = ref<HTMLDivElement | null>(null);
provide('splitViewerContainerRef', containerRef);
const activeFeature = ref('analyze');
const analysis = useSpatialAnalysis(containerRef, '添加候选点，并根据调查资料填写各因子评分。', false);
const { viewer, ready, picking, statusText, terrainNote } = analysis;
terrainNote.value = '人工多因子评价；不自动读取道路、设施、环境或人口数据，不生成随机评分';
const factors = ref([
  { key: 'terrain', name: '地形适宜性', weight: 20 as number | null },
  { key: 'traffic', name: '交通便利性', weight: 20 as number | null },
  { key: 'infra', name: '基础设施', weight: 20 as number | null },
  { key: 'environment', name: '环境质量', weight: 20 as number | null },
  { key: 'population', name: '人口适宜性', weight: 20 as number | null },
]);
interface Candidate {
  id: number; name: string; position: Cesium.Cartesian3; longitude: number; latitude: number;
  scores: Record<string, number | null>;
}
const candidates = ref<Candidate[]>([]);
const selectedId = ref<number | null>(null);
const selectedSite = computed(() => candidates.value.find(s => s.id === selectedId.value));
const siteOptions = computed(() => candidates.value.map(s => ({ label: s.name, value: s.id })));
const totalWeight = computed(() => factors.value.reduce((sum, f) => sum + (f.weight ?? 0), 0));
const weightsValid = computed(() => totalWeight.value > 0 && factors.value.every(f =>
  f.weight !== null && Number.isFinite(f.weight) && f.weight >= 0 && f.weight <= 100));
let counter = 0;
const markers = new Map<number, Cesium.Entity>();
const scoreFor = (site: Candidate) => weightedScore(factors.value.map(f => site.scores[f.key]), factors.value.map(f => f.weight));
const rankedCandidates = computed(() => {
  const sorted = candidates.value.map(site => ({ ...site, totalScore: scoreFor(site), rank: null as number | null }))
    .sort((a, b) => (b.totalScore ?? -1) - (a.totalScore ?? -1) || a.id - b.id);
  let rank = 0;
  sorted.forEach((site, i) => {
    if (site.totalScore === null) return;
    if (i === 0 || Math.abs(site.totalScore - sorted[i - 1].totalScore!) > 1e-8) rank = i + 1;
    site.rank = rank;
  });
  return sorted;
});
function grade(score: number | null) {
  if (score === null) return weightsValid.value ? '待评分' : '权重无效';
  return score >= 80 ? '优秀' : score >= 60 ? '良好' : score >= 40 ? '一般' : '较差';
}
function color(score: number | null) {
  return score === null ? '#888888' : score >= 80 ? '#18a058' : score >= 60 ? '#2080f0' : score >= 40 ? '#f0a020' : '#d03050';
}
function updateMarkers() {
  for (const site of candidates.value) {
    const entity = markers.get(site.id);
    const score = scoreFor(site);
    if (entity?.point) entity.point.color = new Cesium.ConstantProperty(Cesium.Color.fromCssColorString(color(score)));
    if (entity?.label) entity.label.text = new Cesium.ConstantProperty(site.name + '\n' + (score === null ? grade(score) : score.toFixed(1) + '分'));
  }
}
watch([candidates, factors], updateMarkers, { deep: true });
function applyAdd() {
  if (!ready.value) return;
  analysis.pick(position => {
    if (candidates.value.some(s => Cesium.Cartesian3.distance(s.position, position) < 1)) {
      statusText.value = '已有候选点位于该位置，请编辑原候选点'; return;
    }
    if (candidates.value.length >= 50) { statusText.value = '最多支持 50 个候选点'; return; }
    const carto = Cesium.Cartographic.fromCartesian(position);
    const site: Candidate = { id: ++counter, name: '候选点' + counter, position,
      longitude: Cesium.Math.toDegrees(carto.longitude), latitude: Cesium.Math.toDegrees(carto.latitude),
      scores: Object.fromEntries(factors.value.map(f => [f.key, null])) };
    candidates.value.push(site); selectedId.value = site.id;
    markers.set(site.id, analysis.add({ position,
      point: { pixelSize: 13, color: Cesium.Color.GRAY, heightReference: Cesium.HeightReference.CLAMP_TO_GROUND },
      label: { text: site.name + '\n待评分', font: '12px sans-serif', pixelOffset: new Cesium.Cartesian2(0, -27),
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Number.POSITIVE_INFINITY },
    }));
    statusText.value = site.name + ' 已添加，请在右侧录入各因子评分；可继续添加候选点';
  });
  statusText.value = '点击添加候选点，评分依据需由调查资料提供';
}
function stopPicking() { picking.value = false; statusText.value = '已停止添加，可编辑评分和权重'; }
function removeSite(id: number) {
  analysis.remove(markers.get(id)); markers.delete(id);
  candidates.value = candidates.value.filter(s => s.id !== id);
  if (selectedId.value === id) selectedId.value = candidates.value[0]?.id ?? null;
  statusText.value = '已删除候选点，排名已更新';
}
function flyToSite(id: number) {
  const site = candidates.value.find(s => s.id === id);
  if (!site || !viewer.value) return;
  viewer.value.camera.flyToBoundingSphere(new Cesium.BoundingSphere(site.position, 1), {
    offset: new Cesium.HeadingPitchRange(0, -Math.PI / 3, 3000),
  });
}
function applyClear() {
  analysis.clear(); candidates.value = []; selectedId.value = null; markers.clear(); counter = 0;
  statusText.value = '已清除所有候选点，当前权重保留';
}
function resetWeights() { factors.value.forEach(f => { f.weight = 20; }); }
const { code, explanation } = useCodeExplain({ analyze: () => `// 原始评分由用户根据调查资料录入，未填数据为 null
const total = weightedScore(scores, weights)
// total = Σ(score × weight) / Σ(weight)
// 有效权重之和必须大于 0；非零权重的因子都必须有 0–100 分
// 空评分、无效权重不参与排名；同分采用并列排名
entity.point.color = new ConstantProperty(scoreColor)
entity.label.text = new ConstantProperty(labelText)` }, {
  analyze: () => `【模型】五个因子的人工加权评价，分数统一为越高越适宜。人口因子须先按项目需求转化为适宜性评分，非人口数量。
【评分】每因子 0–100 分；权重为 0 的因子可不评分。未完成有效评分时不生成总分、等级或排名。
【权重】按权重总和自动归一化，无须恰好为 100；全零、空值或非法权重会使结果无效。
【排名】优秀≥80、良好≥60、一般≥40、较差<40；同分并列。权重或评分改变后，地图和排名同步更新。
【范围】这里演示评价模型，不自动采集真实地理因子数据。结果依赖输入资料和项目评价标准。`,
}, activeFeature);
</script>

<template>
  <div class="flex h-full flex-col gap-3 p-4">
    <div class="flex flex-wrap items-center gap-2">
      <n-button size="small" type="success" :disabled="!ready" @click="applyAdd">添加候选点</n-button>
      <n-button size="small" :disabled="!picking" @click="stopPicking">停止添加</n-button>
      <n-button size="small" quaternary @click="applyClear">清除全部</n-button>
    </div>
    <SplitViewer title="选址分析" :code="code" :explanation="explanation" storage-key="site-selection-split">
      <template #scene-overlay>
        <div class="absolute left-3 top-3 z-10 max-w-[80%] rounded bg-black/70 px-3 py-2 text-xs text-white">
          <div>{{ statusText }}</div><div class="mt-1 text-white/70">{{ terrainNote }}</div>
        </div>
      </template>
      <template #bottom-panel>
        <div class="max-h-[52vh] shrink-0 space-y-3 overflow-auto border-t bg-gray-50 p-3 text-xs">
          <div class="flex items-center justify-between"><b>因子权重（自动归一化）</b><n-button size="tiny" @click="resetWeights">重置权重</n-button></div>
          <div class="grid grid-cols-2 gap-2">
            <label v-for="factor in factors" :key="factor.key">{{ factor.name }}
              <n-input-number v-model:value="factor.weight" :min="0" :max="100" size="small" />
            </label>
          </div>
          <div :class="weightsValid ? 'text-gray-500' : 'text-red-600'">权重总和 {{ totalWeight }}；{{ weightsValid ? '有效权重已归一化' : '请填写有效权重，至少一项大于零' }}</div>
          <n-select v-model:value="selectedId" :options="siteOptions" placeholder="选择候选点录入评分" size="small" />
          <div v-if="selectedSite" class="grid grid-cols-2 gap-2">
            <label v-for="factor in factors" :key="factor.key">{{ factor.name }}评分
              <n-input-number v-model:value="selectedSite.scores[factor.key]" :min="0" :max="100" :step="1" size="small" placeholder="0–100分" />
            </label>
          </div>
          <div class="font-semibold">候选点排名 · {{ candidates.length }} 个</div>
          <div v-for="site in rankedCandidates" :key="site.id" class="rounded border bg-white p-2">
            <div class="flex flex-wrap items-center gap-2">
              <span :style="{ color: color(site.totalScore) }">{{ site.rank === null ? '—' : '第' + site.rank + '名' }} {{ site.name }} · {{ site.totalScore === null ? grade(null) : site.totalScore.toFixed(1) + '分 · ' + grade(site.totalScore) }}</span>
              <n-button size="tiny" @click="selectedId = site.id">评分</n-button>
              <n-button size="tiny" @click="flyToSite(site.id)">定位</n-button>
              <n-button size="tiny" quaternary type="error" @click="removeSite(site.id)">删除</n-button>
            </div>
            <div class="mt-1 text-gray-500">{{ site.longitude.toFixed(5) }}°，{{ site.latitude.toFixed(5) }}°</div>
          </div>
          <div v-if="!candidates.length">暂无候选点；点击地图添加后录入调查评分。</div>
        </div>
      </template>
    </SplitViewer>
  </div>
</template>

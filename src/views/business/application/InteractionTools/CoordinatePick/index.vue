<script setup lang="ts">
import * as Cesium from 'cesium';
import { onBeforeUnmount, provide, ref, shallowRef, watch } from 'vue';
import SplitViewer from '@/components/base/SplitViewer.vue';
import { useSpatialAnalysis } from '@/hooks/useSpatialAnalysis';
import { useCodeExplain } from '@/hooks/useCodeExplain';
import type { PickMode, PickSource } from '@/utils/mapInteraction';

const containerRef = ref<HTMLDivElement | null>(null);
provide('splitViewerContainerRef', containerRef);
const activeFeature = ref('pick');
const analysis = useSpatialAnalysis(containerRef, '开始拾取后点击地图，可选择地表或场景表面坐标。');
const { viewer, ready, picking, statusText, terrainNote } = analysis;
const pickMode = ref<PickMode>('ground');
const modeOptions = [{ label: '地表坐标', value: 'ground' }, { label: '场景表面坐标', value: 'scene' }];
const sourceNames: Record<PickSource, string> = { terrain: '渲染地形', ellipsoid: '零高程椭球', scene: '场景深度表面' };
interface PickRecord { id: number; longitude: number; latitude: number; height: number;
  screenX: number; screenY: number; cartesian: Cesium.Cartesian3; source: PickSource; entity: Cesium.Entity }
const pickRecords = shallowRef<PickRecord[]>([]);
let counter = 0;
let copyGeneration = 0;
let disposed = false;
const showCopy = ref(false);
const copyText = ref('');
function startPicking() {
  if (!ready.value) return;
  viewer.value?.camera.cancelFlight();
  analysis.pick((position, pixel, source) => {
    if (pickRecords.value.length >= 200) { statusText.value = '最多保留 200 条记录，请删除部分记录或清除后继续'; return; }
    const carto = Cesium.Cartographic.fromCartesian(position);
    const id = ++counter;
    const entity = analysis.add({ position,
      point: { pixelSize: 10, color: Cesium.Color.RED, outlineColor: Cesium.Color.WHITE, outlineWidth: 2 },
      label: { text: '#' + id, font: '12px sans-serif', pixelOffset: new Cesium.Cartesian2(0, -22),
        fillColor: Cesium.Color.WHITE, outlineColor: Cesium.Color.BLACK, outlineWidth: 2, style: Cesium.LabelStyle.FILL_AND_OUTLINE },
    });
    const record = { id, longitude: Cesium.Math.toDegrees(carto.longitude), latitude: Cesium.Math.toDegrees(carto.latitude),
      height: carto.height, screenX: pixel.x, screenY: pixel.y, cartesian: position, source, entity };
    pickRecords.value = [record, ...pickRecords.value];
    statusText.value = '已拾取 #' + id + '：' + record.longitude.toFixed(6) + '°，' + record.latitude.toFixed(6) +
      '°，椭球高 ' + record.height.toFixed(2) + 'm（' + sourceNames[source] + '）';
  }, { mode: pickMode.value });
  statusText.value = '拾取已开启，点击地面位置获取坐标';
}
function applyPick() {
  if (picking.value) { picking.value = false; statusText.value = '已停止拾取，记录保留'; }
  else startPicking();
}
watch(pickMode, () => { if (picking.value) startPicking(); });
function applyClear() {
  copyGeneration++; analysis.clear(); viewer.value?.camera.cancelFlight();
  pickRecords.value = []; counter = 0; showCopy.value = false;
  statusText.value = '已清除所有拾取记录，拾取已停止';
}
function removeRecord(record: PickRecord) {
  analysis.remove(record.entity); pickRecords.value = pickRecords.value.filter(r => r.id !== record.id);
  statusText.value = '已删除记录 #' + record.id;
}
async function copyRecord(record: PickRecord) {
  const generation = ++copyGeneration;
  const valid = () => !disposed && generation === copyGeneration && pickRecords.value.some(r => r.id === record.id);
  const text = record.longitude.toFixed(6) + ', ' + record.latitude.toFixed(6) + ', ' + record.height.toFixed(2);
  try {
    if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
    await navigator.clipboard.writeText(text);
    if (valid()) statusText.value = '已复制 #' + record.id + ' 坐标：' + text;
  } catch {
    if (!valid()) return;
    copyText.value = text; showCopy.value = true;
    statusText.value = '浏览器未允许自动复制，请在弹窗中选择并手动复制坐标';
  }
}
function flyToRecord(record: PickRecord) {
  const v = viewer.value;
  if (!v) return;
  picking.value = false;
  v.camera.flyToBoundingSphere(new Cesium.BoundingSphere(record.cartesian, 1), {
    offset: new Cesium.HeadingPitchRange(0, -Math.PI / 3, 1000), duration: 1.2,
  });
  statusText.value = '定位记录 #' + record.id + '，拾取已暂停';
}
onBeforeUnmount(() => { disposed = true; copyGeneration++; });
const { code, explanation } = useCodeExplain({ pick: () => `// 地表模式优先使用射线拾取已渲染地形
const ray = viewer.camera.getPickRay(pixel)
const ground = viewer.scene.globe.pick(ray, viewer.scene)
// 场景模式仅在支持深度拾取时使用 pickPosition，忽略工具自己的标记
// 深度不可用则回退地表；仅椭球演示允许 pickEllipsoid
// 定位使用真实 Cartesian3 包围球，而不是伪造 Entity
viewer.camera.flyToBoundingSphere(new BoundingSphere(position, 1))` }, {
  pick: () => `【坐标】经纬度为 WGS84，输出高度为椭球高，不等同于当地海拔。高程来自当前渲染精度，不能替代测量。
【模式】地表坐标拾取地形；场景表面模式可拾取模型的深度表面，深度不可用时回退地表。每条记录明确显示来源。
【屏幕坐标】相对于地图画布左上角的 CSS 像素；ECEF 为地心地固直角坐标，单位米。
【交互】支持启停、复制、定位、单条删除和清除；复制受限时提供手动复制，最多保留 200 条记录。`,
}, activeFeature);
</script>

<template>
  <div class="flex h-full flex-col gap-3 p-4">
    <div class="flex flex-wrap items-center gap-2">
      <n-button size="small" :type="picking ? 'warning' : 'success'" :disabled="!ready" @click="applyPick">{{ picking ? '停止拾取' : '开始拾取' }}</n-button>
      <n-select v-model:value="pickMode" :options="modeOptions" size="small" style="width: 170px" />
      <n-button size="small" quaternary @click="applyClear">清除</n-button>
    </div>
    <SplitViewer title="坐标拾取" :code="code" :explanation="explanation" storage-key="coordinate-pick-split">
      <template #scene-overlay>
        <div class="absolute left-3 top-3 z-10 max-w-[80%] rounded bg-black/70 px-3 py-2 text-xs text-white">
          <div>{{ statusText }}</div><div class="mt-1 text-white/70">{{ terrainNote }}</div>
        </div>
      </template>
      <template #bottom-panel>
        <div class="max-h-[42vh] shrink-0 overflow-auto border-t bg-gray-50 p-3 text-xs">
          <b>拾取记录 · {{ pickRecords.length }} 条</b>
          <div v-for="record in pickRecords" :key="record.id" class="mt-2 space-y-1 rounded border bg-white p-2">
            <div class="flex flex-wrap items-center gap-2">
              <b>#{{ record.id }} · {{ sourceNames[record.source] }}</b>
              <n-button size="tiny" @click="copyRecord(record)">复制</n-button>
              <n-button size="tiny" @click="flyToRecord(record)">定位</n-button>
              <n-button size="tiny" type="error" quaternary @click="removeRecord(record)">删除</n-button>
            </div>
            <div>{{ record.longitude.toFixed(6) }}°，{{ record.latitude.toFixed(6) }}°；椭球高 {{ record.height.toFixed(2) }}m</div>
            <div>画布像素 ({{ record.screenX.toFixed(0) }}, {{ record.screenY.toFixed(0) }})</div>
            <div class="break-all text-gray-500">ECEF(m)：{{ record.cartesian.x.toFixed(2) }}, {{ record.cartesian.y.toFixed(2) }}, {{ record.cartesian.z.toFixed(2) }}</div>
          </div>
          <div v-if="!pickRecords.length" class="py-2">暂无记录，开始拾取后点击地图。</div>
        </div>
      </template>
    </SplitViewer>
    <n-modal v-model:show="showCopy" preset="dialog" title="手动复制坐标" :show-icon="false" positive-text="关闭">
      <n-input :value="copyText" readonly type="textarea" />
    </n-modal>
  </div>
</template>

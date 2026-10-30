<script setup lang="ts">
import { provide, ref } from 'vue';
import SplitViewer from '@/components/base/SplitViewer.vue';
import { useCesiumViewer } from '@/hooks/useCesiumViewer';
import { useLayerControls } from '@/hooks/useLayerControls';
import { useCodeExplain } from '@/hooks/useCodeExplain';

const containerRef = ref<HTMLDivElement | null>(null);
provide('splitViewerContainerRef', containerRef);
const { viewer } = useCesiumViewer(containerRef, {
  baseLayer: 'none', camera: { position: [108.94, 34.2, 30000], pitch: -55 },
  ui: { sceneModePicker: false, selectionIndicator: false, infoBox: false },
});
const controls = useLayerControls(viewer);
const { ready, currentBaseLayer, layerOpacity, labelsVisible, terrainRequested, terrainLoading,
  statusText, imageryWarning, layerInfo } = controls;
const baseLayers = [{ key: 'img', label: '影像底图' }, { key: 'vec', label: '街道底图' }, { key: 'ter', label: '晕渲底图' }] as const;
const activeFeature = ref('layers');
const { code, explanation } = useCodeExplain({ layers: () => `// 底图与注记成对创建，使用 WebMercator WMTS
const layers = createTiandituLayers(type) // img+cia / vec+cva / ter+cta
// 只替换工具管理的两层，保留其他业务叠加图层
layers.forEach(layer => layer.alpha = opacity)
layers[1].show = labelsVisible
// 三维地形异步请求带递增版本号
const version = ++generation
const terrain = await createWorldTerrainAsync()
if (version === generation && !disposed) viewer.terrainProvider = terrain
// 关闭、恢复默认或离开页面时递增版本号，使旧请求失效` }, {
  layers: () => `【底图】影像、街道、地形晕渲均带对应中文地名注记，可独立显示或隐藏注记。
【区别】晕渲底图是一张表现起伏的图像，三维地形才会改变地球表面的高程，两者可独立组合。
【不透明度】100%为完全显示，0%为隐藏底图；只影响本工具的底图和注记，不影响业务叠加层。
【异步】加载中可取消地形；关闭、恢复默认和离开页面后，旧请求不会重新开启地形。
【默认】恢复影像与注记、不透明度100%、三维地形关闭。服务失败会提示，可重新选择底图或开启地形重试。`,
}, activeFeature);
</script>

<template>
  <div class="flex h-full flex-col gap-3 p-4">
    <div class="flex flex-wrap items-center gap-2">
      <n-button v-for="layer in baseLayers" :key="layer.key" size="small" :disabled="!ready"
        :type="currentBaseLayer === layer.key ? 'primary' : 'default'" @click="controls.switchBaseLayer(layer.key)">{{ layer.label }}</n-button>
      <n-button size="small" :disabled="!ready" :type="terrainRequested ? 'warning' : 'default'" @click="controls.toggleTerrain">
        {{ terrainLoading ? '取消地形加载' : terrainRequested ? '关闭地形' : '开启地形' }}
      </n-button>
      <n-button size="small" quaternary :disabled="!ready" @click="controls.reset">恢复默认</n-button>
    </div>
    <div class="flex flex-wrap items-center gap-3 rounded border bg-gray-50 p-2 text-xs">
      <span>底图不透明度</span>
      <n-slider v-model:value="layerOpacity" :min="0" :max="1" :step="0.05" :disabled="!ready" style="width: 190px" />
      <span>{{ Math.round(layerOpacity * 100) }}%</span>
      <span>地名注记</span><n-switch v-model:value="labelsVisible" :disabled="!ready" size="small" />
    </div>
    <SplitViewer title="图层切换" :code="code" :explanation="explanation" storage-key="layer-switch-split">
      <template #scene-overlay>
        <div class="absolute left-3 top-3 z-10 max-w-[80%] rounded bg-black/70 px-3 py-2 text-xs text-white">
          <div>{{ statusText }}</div>
          <div class="mt-1 text-white/70">晕渲底图与三维地形独立控制。</div>
          <div v-if="imageryWarning" class="mt-1 text-yellow-300">{{ imageryWarning }}</div>
        </div>
      </template>
      <template #bottom-panel>
        <div class="shrink-0 space-y-2 border-t bg-gray-50 p-3 text-xs">
          <b>当前图层配置</b>
          <div>底图：{{ layerInfo.baseLayer }}</div>
          <div>地名注记：{{ labelsVisible ? '显示' : '隐藏' }}</div>
          <div>三维地形：{{ layerInfo.terrain }}</div>
          <div>底图不透明度：{{ layerInfo.opacity }}</div>
        </div>
      </template>
    </SplitViewer>
  </div>
</template>

import * as Cesium from 'cesium';
import { computed, onBeforeUnmount, ref, watch, type Ref } from 'vue';
import { createTiandituLayers } from '@/utils/tianditu';

export function useLayerControls(viewer: Ref<Cesium.Viewer | null>) {
  const currentBaseLayer = ref<'img' | 'vec' | 'ter'>('img');
  const layerOpacity = ref(1);
  const labelsVisible = ref(true);
  const terrainEnabled = ref(false);
  const terrainRequested = ref(false);
  const terrainLoading = ref(false);
  const statusText = ref('选择底图类型，调整不透明度和三维地形');
  const imageryWarning = ref('');
  const names = { img: '天地图影像', vec: '天地图街道', ter: '天地图晕渲' };
  const ready = computed(() => !!viewer.value);
  const layerInfo = computed(() => ({ baseLayer: names[currentBaseLayer.value],
    opacity: Math.round(layerOpacity.value * 100) + '%',
    terrain: terrainLoading.value ? '正在加载' : terrainEnabled.value ? '已开启' : '已关闭' }));
  let owned: Cesium.ImageryLayer[] = [];
  let unsubscribe: (() => void)[] = [];
  let generation = 0;
  let disposed = false;

  function applyAppearance() {
    if (!Number.isFinite(layerOpacity.value) || layerOpacity.value < 0 || layerOpacity.value > 1) return;
    owned.forEach(layer => { layer.alpha = layerOpacity.value; });
    if (owned[1]) owned[1].show = labelsVisible.value;
  }
  function switchBaseLayer(type: 'img' | 'vec' | 'ter') {
    const v = viewer.value;
    if (!v || disposed) return;
    let next: Cesium.ImageryLayer[] = [];
    try {
      next = createTiandituLayers(type);
      next.forEach((layer, index) => {
        layer.alpha = layerOpacity.value;
        if (index === 1) layer.show = labelsVisible.value;
        v.imageryLayers.add(layer, index);
      });
    } catch {
      next.forEach(layer => {
        if (v.imageryLayers.contains(layer)) v.imageryLayers.remove(layer, true);
        else if (!layer.isDestroyed()) layer.destroy();
      });
      statusText.value = '底图配置失败，已保留原底图'; return;
    }
    unsubscribe.forEach(remove => remove()); unsubscribe = [];
    owned.forEach(layer => v.imageryLayers.remove(layer, true));
    owned = next;
    imageryWarning.value = '';
    owned.forEach(layer => unsubscribe.push(layer.imageryProvider.errorEvent.addEventListener(() => {
      if (!disposed) imageryWarning.value = '部分底图瓦片加载失败，请检查网络或天地图访问令牌；可重新选择底图重试';
    })));
    currentBaseLayer.value = type;
    statusText.value = '已切换底图配置为' + names[type] + '（含地名注记），正在请求瓦片';
  }
  async function setTerrain(enabled: boolean) {
    const v = viewer.value;
    if (!v || disposed) return;
    if (enabled && terrainRequested.value && (terrainLoading.value || terrainEnabled.value)) return;
    const id = ++generation;
    terrainRequested.value = enabled;
    if (!enabled) {
      terrainLoading.value = false; terrainEnabled.value = false;
      v.terrainProvider = new Cesium.EllipsoidTerrainProvider();
      statusText.value = '三维地形已关闭，使用椭球面'; return;
    }
    terrainLoading.value = true;
    statusText.value = '正在加载三维地形，可再次点击取消';
    const valid = () => !disposed && generation === id && viewer.value === v && !v.isDestroyed();
    try {
      const terrain = await Cesium.createWorldTerrainAsync();
      if (!valid()) return;
      v.terrainProvider = terrain; terrainEnabled.value = true;
      statusText.value = '三维地形已开启，瓦片将随视角加载';
    } catch {
      if (!valid()) return;
      terrainRequested.value = false; terrainEnabled.value = false;
      v.terrainProvider = new Cesium.EllipsoidTerrainProvider();
      statusText.value = '三维地形加载失败，请检查网络和 Cesium Ion token 后重试';
    } finally {
      if (valid()) terrainLoading.value = false;
    }
  }
  function toggleTerrain() { void setTerrain(!terrainRequested.value); }
  function reset() {
    void setTerrain(false);
    layerOpacity.value = 1; labelsVisible.value = true;
    switchBaseLayer('img'); applyAppearance();
    statusText.value = '已恢复默认：影像与注记、无三维地形、不透明度100%';
  }
  watch([layerOpacity, labelsVisible], applyAppearance);
  watch(viewer, v => { if (v && !disposed) switchBaseLayer('img'); }, { immediate: true });
  onBeforeUnmount(() => {
    disposed = true; generation++; terrainLoading.value = false;
    unsubscribe.forEach(remove => remove()); unsubscribe = [];
    const v = viewer.value;
    if (v && !v.isDestroyed()) owned.forEach(layer => v.imageryLayers.remove(layer, true));
    owned = [];
  });
  return { ready, currentBaseLayer, layerOpacity, labelsVisible, terrainEnabled, terrainRequested,
    terrainLoading, statusText, imageryWarning, layerInfo, switchBaseLayer, toggleTerrain, setTerrain, reset };
}

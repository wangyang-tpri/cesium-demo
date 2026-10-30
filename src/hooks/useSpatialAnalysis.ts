import * as Cesium from 'cesium';
import { computed, onBeforeUnmount, ref, watch, type Ref } from 'vue';
import { useCesiumViewer } from './useCesiumViewer';
import { pickMapPosition, type PickMode, type PickSource } from '@/utils/mapInteraction';

export function useSpatialAnalysis(container: Ref<HTMLDivElement | null>, initialStatus: string, terrain = true) {
  const statusText = ref(initialStatus);
  const busy = ref(false);
  const picking = ref(false);
  const terrainLoading = ref(terrain);
  const terrainNote = ref(terrain ? '正在加载地形…' : '缓冲距离按 WGS84 椭球面计算');
  let disposed = false;
  let generation = 0;
  let handler: Cesium.ScreenSpaceEventHandler | undefined;
  const entities = new Set<Cesium.Entity>();
  const primitives = new Set<Cesium.Primitive | Cesium.GroundPrimitive>();
  const { viewer } = useCesiumViewer(container, {
    baseLayer: 'tianditu-img',
    camera: { position: [108.94, 34.2, 30000], pitch: -55 },
    ui: { sceneModePicker: false, selectionIndicator: false, infoBox: false },
    terrainProvider: terrain ? async () => {
      try {
        const provider = await Cesium.createWorldTerrainAsync();
        if (!disposed) terrainNote.value = '地形采样分析（不包含建筑物、植被）；高程基准为 WGS84 椭球';
        return provider;
      } catch {
        if (!disposed) terrainNote.value = '真实地形加载失败，当前为零高程椭球演示；请配置可用的 Cesium Ion token 后重新进入';
        return new Cesium.EllipsoidTerrainProvider();
      } finally {
        if (!disposed) terrainLoading.value = false;
      }
    } : undefined,
  });
  const ready = computed(() => !!viewer.value && !terrainLoading.value);

  watch(viewer, v => {
    if (!v) return;
    v.scene.globe.depthTestAgainstTerrain = true;
    // Analysis tools own map clicks; double-click must not start entity tracking.
    v.screenSpaceEventHandler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
  });

  function add(options: Cesium.Entity.ConstructorOptions) {
    const entity = viewer.value!.entities.add(options);
    entities.add(entity);
    return entity;
  }
  function remove(entity: Cesium.Entity | undefined) {
    if (!entity) return;
    viewer.value?.entities.remove(entity);
    entities.delete(entity);
  }
  function addPrimitive(primitive: Cesium.Primitive | Cesium.GroundPrimitive) {
    viewer.value!.scene.primitives.add(primitive);
    primitives.add(primitive);
    return primitive;
  }
  function removePrimitive(primitive: Cesium.Primitive | Cesium.GroundPrimitive | undefined) {
    if (!primitive) return;
    viewer.value?.scene.primitives.remove(primitive);
    primitives.delete(primitive);
  }
  function cancel() { generation++; busy.value = false; picking.value = false; }
  function clear() {
    cancel();
    [...entities].forEach(remove);
    [...primitives].forEach(removePrimitive);
  }
  function pick(callback: (position: Cesium.Cartesian3, pixel: Cesium.Cartesian2, source: PickSource) => void,
    options: { mode?: PickMode; beforePick?: (pixel: Cesium.Cartesian2) => boolean;
      onMove?: (position: Cesium.Cartesian3) => void } = {}) {
    if (!ready.value) return;
    handler?.destroy();
    handler = new Cesium.ScreenSpaceEventHandler(viewer.value!.scene.canvas);
    picking.value = true;
    handler.setInputAction((event: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
      const v = viewer.value;
      if (!v || busy.value || options.beforePick?.(event.position) || !picking.value) return;
      const result = pickMapPosition(v, event.position, options.mode, new Set([...entities].map(entity => entity.id)));
      if (result) callback(result.position, Cesium.Cartesian2.clone(event.position), result.source);
      else statusText.value = '未拾取到地表，请点击地图中的地面位置';
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
    if (options.onMove) handler.setInputAction((event: Cesium.ScreenSpaceEventHandler.MotionEvent) => {
      const v = viewer.value;
      if (!v || !picking.value || busy.value) return;
      const result = pickMapPosition(v, event.endPosition);
      if (result) options.onMove?.(result.position);
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
  }
  async function run(task: (valid: () => boolean) => Promise<string | undefined>) {
    if (!ready.value || busy.value) return;
    const id = ++generation;
    const valid = () => !disposed && id === generation && !!viewer.value;
    busy.value = true;
    picking.value = false;
    try {
      const message = await task(valid);
      if (valid() && message) statusText.value = message;
    } catch (error) {
      if (valid()) statusText.value = `分析失败：${error instanceof Error ? error.message : '地形请求失败，请重试'}`;
    } finally {
      if (valid()) busy.value = false;
    }
  }
  onBeforeUnmount(() => {
    disposed = true;
    cancel();
    handler?.destroy();
    entities.clear();
    primitives.clear();
  });
  return { viewer, statusText, busy, picking, ready, terrainNote, add, remove, addPrimitive, removePrimitive, clear, cancel, pick, run };
}

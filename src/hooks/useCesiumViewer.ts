import * as Cesium from 'cesium';
import { onBeforeUnmount, onMounted, provide, shallowRef, watch, type Ref } from 'vue';
import { createTiandituVecLayers, createTiandituImgLayers } from '@/utils/tianditu';
import { setCurrentViewer } from '@/utils/currentViewer';

export interface UseCesiumViewerOptions {
  /** 影像底图：'tianditu-vec'(默认, 天地图街道) | 'tianditu-img'(天地图影像) | 'esri' | 'osm' | 'none'（无底图） | 自定义 ImageryLayer */
  baseLayer?: 'tianditu-vec' | 'tianditu-img' | 'esri' | 'osm' | 'none' | Cesium.ImageryLayer;
  /** 是否使用 Cesium World Terrain 全球地形（需 Ion token，默认 false 使用椭球面） */
  terrain?: boolean;
  /** 初始地形或准备函数：在创建 Viewer 前完成，避免地图显示后切换地形导致瓦片重建 */
  terrainProvider?: Cesium.TerrainProvider | (() => Cesium.TerrainProvider | Promise<Cesium.TerrainProvider>);
  /** 初始相机：经纬度(度) + 高度(米)，以及朝向 heading/pitch/roll(度) */
  camera?: {
    position?: [number, number, number];
    heading?: number;
    pitch?: number;
    roll?: number;
  };
  /** UI 控件开关（默认全部关闭，按页面需要开启） */
  ui?: {
    animation?: boolean;
    timeline?: boolean;
    baseLayerPicker?: boolean;
    geocoder?: boolean;
    homeButton?: boolean;
    sceneModePicker?: boolean;
    navigationHelpButton?: boolean;
    fullscreenButton?: boolean;
    infoBox?: boolean;
    selectionIndicator?: boolean;
  };
  /** 时钟配置；不传则使用 Viewer 默认时钟（禁用动画控件） */
  clock?: {
    start: Cesium.JulianDate;
    stop: Cesium.JulianDate;
    currentTime?: Cesium.JulianDate;
    multiplier?: number;
    shouldAnimate?: boolean;
    range?: Cesium.ClockRange;
  } | false;
  /** 每帧回调（在 clock.onTick 中触发），time 为当前模拟时间 */
  onTick?: (viewer: Cesium.Viewer, time: Cesium.JulianDate) => void;
  /** 组件卸载时的附加清理 */
  onDispose?: () => void;
}

const DEFAULT_CAMERA = {
  position: [104.0, 35.0, 8000000] as [number, number, number],
  heading: 0,
  pitch: -60,
  roll: 0,
};

/**
 * Cesium Viewer 生命周期统一封装：
 * 创建三维地球（Viewer）、影像底图、地形、初始相机视角、
 * 每帧回调（clock.onTick）、容器尺寸同步、组件卸载销毁。
 *
 * 用法：
 * const { viewer } = useCesiumViewer(containerRef, {
 *   baseLayer: 'tianditu-img',
 *   terrain: true,
 *   camera: { position: [108.9, 34.2, 2000], pitch: -45 },
 *   onTick: (v, time) => { ... },
 *   onDispose: () => { ... },
 * })
 */
export function useCesiumViewer(
  containerRef: Ref<HTMLDivElement | null>,
  options: UseCesiumViewerOptions = {}
) {
  const viewer = shallowRef<Cesium.Viewer | null>(null);
  const initializing = shallowRef(false);
  const initializationError = shallowRef<string | null>(null);
  provide('cesiumViewerInitializing', initializing);
  provide('cesiumViewerInitializationError', initializationError);

  let resizeObserver: ResizeObserver | null = null;
  let tickRemove: (() => void) | null = null;
  let disposed = false;
  let lastWidth = 0;
  let lastHeight = 0;

  const ui = options.ui ?? {};
  const camera = { ...DEFAULT_CAMERA, ...options.camera };

  function buildBaseLayers(): Cesium.ImageryLayer[] {
    const baseLayer = options.baseLayer ?? 'tianditu-vec';
    if (baseLayer === 'none') return [];
    if (baseLayer instanceof Cesium.ImageryLayer) return [baseLayer];

    if (baseLayer === 'tianditu-vec') {
      // 天地图矢量街道（底图 + 注记两层）
      return createTiandituVecLayers();
    }
    if (baseLayer === 'tianditu-img') {
      // 天地图影像（底图 + 注记两层）
      return createTiandituImgLayers();
    }
    if (baseLayer === 'osm') {
      // OpenStreetMap 标准瓦片：{z}/{x}/{y}
      const provider = new Cesium.UrlTemplateImageryProvider({
        url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
        credit: '© OpenStreetMap contributors',
        maximumLevel: 19,
      });
      return [new Cesium.ImageryLayer(provider)];
    }
    // Esri World Imagery 全球影像（无需 token，{z}/{y}/{x} 注意顺序）
    const provider = new Cesium.UrlTemplateImageryProvider({
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      credit: 'Imagery © Esri, Maxar, Earthstar Geographics',
      maximumLevel: 19,
    });
    return [new Cesium.ImageryLayer(provider)];
  }

  async function init() {
    // onMounted、容器 watch 和 ResizeObserver 可能在异步准备期间同时触发。
    if (viewer.value || initializing.value || disposed) return;
    const initialContainer = containerRef.value;
    if (!initialContainer || initialContainer.clientWidth === 0 || initialContainer.clientHeight === 0) return;
    initializing.value = true;
    initializationError.value = null;
    let created: Cesium.Viewer | null = null;
    try {
      let terrainProvider: Cesium.TerrainProvider | undefined;
      if (typeof options.terrainProvider === 'function') terrainProvider = await options.terrainProvider();
      else if (options.terrainProvider) terrainProvider = options.terrainProvider;
      else if (options.terrain) terrainProvider = await Cesium.createWorldTerrainAsync();
      // 地形请求完成时页面可能已离开，或者容器已经改变。
      if (disposed || viewer.value) return;
      const container = containerRef.value;
      if (!container || container.clientWidth === 0 || container.clientHeight === 0) return;

      const v = new Cesium.Viewer(container, {
        baseLayer: false, // 手动添加底图（支持天地图等多层底图）
        baseLayerPicker: ui.baseLayerPicker ?? false,
        geocoder: ui.geocoder ?? false,
        homeButton: ui.homeButton ?? true,
        sceneModePicker: ui.sceneModePicker ?? true,
        navigationHelpButton: ui.navigationHelpButton ?? true,
        fullscreenButton: ui.fullscreenButton ?? false,
        infoBox: ui.infoBox ?? false,
        selectionIndicator: ui.selectionIndicator ?? true,
        animation: ui.animation ?? false,
        timeline: ui.timeline ?? false,
        shouldAnimate: options.clock ? (options.clock.shouldAnimate ?? false) : false,
        ...(terrainProvider ? { terrainProvider } : {}),
      });
      created = v;

      // 手动添加底图（支持多层，如天地图底图+注记）
      const baseLayers = buildBaseLayers();
      for (const layer of baseLayers) {
        v.imageryLayers.add(layer);
      }

      // 初始相机视角
      v.camera.setView({
        destination: Cesium.Cartesian3.fromDegrees(...camera.position),
        orientation: {
          heading: Cesium.Math.toRadians(camera.heading ?? 0),
          pitch: Cesium.Math.toRadians(camera.pitch ?? -60),
          roll: Cesium.Math.toRadians(camera.roll ?? 0),
        },
      });

      // 时钟配置（若提供）—— 只设置显式传入的参数，避免把 startTime 等设为 undefined
      if (options.clock) {
        if (options.clock.start) v.clock.startTime = options.clock.start;
        if (options.clock.stop) v.clock.stopTime = options.clock.stop;
        if (options.clock.currentTime) v.clock.currentTime = options.clock.currentTime;
        else if (options.clock.start) v.clock.currentTime = options.clock.start;
        if (options.clock.multiplier) v.clock.multiplier = options.clock.multiplier;
        if (options.clock.range) v.clock.clockRange = options.clock.range;
      }

      // 每帧回调
      if (options.onTick) {
        const listener = (clock: Cesium.Clock) => {
          if (viewer.value) options.onTick?.(viewer.value, clock.currentTime);
        };
        v.clock.onTick.addEventListener(listener);
        tickRemove = () => v.clock.onTick.removeEventListener(listener);
      }

      lastWidth = container.clientWidth;
      lastHeight = container.clientHeight;
      // 只发布已经完成地形、底图、相机和时钟配置的实例。
      viewer.value = v;
      setCurrentViewer(v);
    } catch (error) {
      tickRemove?.(); tickRemove = null;
      if (created && !created.isDestroyed()) created.destroy();
      if (!disposed) {
        viewer.value = null;
        setCurrentViewer(null);
        initializationError.value = error instanceof Error ? error.message : String(error);
      }
    } finally {
      initializing.value = false;
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    initializing.value = false;
    resizeObserver?.disconnect();
    resizeObserver = null;
    tickRemove?.();
    tickRemove = null;
    // 清除全局当前 viewer
    setCurrentViewer(null);
    viewer.value?.destroy();
    viewer.value = null;
    options.onDispose?.();
  }

  // 容器 ref 可能在子组件挂载后才就绪（如 SplitViewer 封装场景），
  // 用 watch 监听变化，容器就绪后自动初始化
  watch(containerRef, (el) => {
    resizeObserver?.disconnect();
    resizeObserver = null;
    if (!el || disposed) return;
    // 容器就绪后立即尝试初始化
    if (!viewer.value) void init();
    // 统一监听容器尺寸变化：
    // 1. 如果 init 时容器尺寸为 0 导致跳过，后续尺寸变为非零时重新触发 init
    // 2. viewer 已创建时，调用 viewer.resize() 同步渲染尺寸
    if (!resizeObserver) {
      resizeObserver = new ResizeObserver(() => {
        if (disposed || containerRef.value !== el) return;
        if (!viewer.value && el.clientWidth > 0 && el.clientHeight > 0) {
          void init();
        } else if (viewer.value && el.clientWidth > 0 && el.clientHeight > 0 &&
          (el.clientWidth !== lastWidth || el.clientHeight !== lastHeight)) {
          lastWidth = el.clientWidth;
          lastHeight = el.clientHeight;
          viewer.value.resize();
        }
      });
      resizeObserver.observe(el);
    }
  });

  onMounted(init);
  onBeforeUnmount(dispose);

  return { viewer, init, dispose, initializing, initializationError };
}

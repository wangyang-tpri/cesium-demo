<script setup lang="ts">
import * as Cesium from "cesium";
import { ref, provide, watch } from "vue";
import { useCesiumViewer } from "@/hooks/useCesiumViewer";
import { useCodeExplain } from "@/hooks/useCodeExplain";
import SplitViewer from "@/components/base/SplitViewer.vue";

const containerRef = ref<HTMLDivElement | null>(null);
provide("splitViewerContainerRef", containerRef);
const activeFeature = ref("start");
const statusText = ref(
  "相机沿路径飞行漫游（SampledPositionProperty + clock 驱动）。"
);

/* ============ 常量定义 ============ */

const startTime = Cesium.JulianDate.fromIso8601("2026-01-01T00:00:00Z");
/** 一圈总时长（模拟秒）—— 配合 multiplier=4，实际飞行一圈约 30 秒 */
const TOTAL_SEC = 120;
const stopTime = Cesium.JulianDate.addSeconds(
  startTime,
  TOTAL_SEC,
  new Cesium.JulianDate()
);

/** 初始视角：路径中心 + 足够高度 */
const INITIAL_CAMERA = {
  position: [108.94, 33.88, 90000] as [number, number, number],
  heading: 0,
  pitch: -60,
};

/** 路径关键点（绕西安城区一圈，高度 900m） */
const WAYPOINTS: [number, number, number][] = [
  [108.88, 34.3, 900],
  [108.92, 34.335, 900],
  [108.94, 34.365, 900],
  [108.97, 34.36, 900],
  [109.0, 34.335, 900],
  [108.99, 34.3, 900],
  [108.94, 34.285, 900],
  [108.88, 34.3, 900],
];

const points = WAYPOINTS.map((w) => Cesium.Cartesian3.fromDegrees(...w));

/** SampledPositionProperty：时间驱动的位置属性（Cesium 推荐做法） */
const positionProperty = new Cesium.SampledPositionProperty();
positionProperty.setInterpolationOptions({
  interpolationDegree: 2,
  interpolationAlgorithm: Cesium.HermitePolynomialApproximation,
});
WAYPOINTS.forEach((w, i) => {
  const time = Cesium.JulianDate.addSeconds(
    startTime,
    i * (TOTAL_SEC / (WAYPOINTS.length - 1)),
    new Cesium.JulianDate()
  );
  positionProperty.addSample(time, Cesium.Cartesian3.fromDegrees(...w));
});

/* ============ 状态变量 ============ */

const running = ref(false);
const started = ref(false);
let pathLine: Cesium.Entity | null = null;
let aircraft: Cesium.Entity | null = null;
const speedLevel = ref(1);

/** 相机是否正在 flyTo（flyTo 过程中不 setView） */
let cameraFlying = false;

/** 启用/禁用用户相机输入（鼠标）—— 漫游时禁用，暂停/重置时恢复 */
function setCameraInputEnabled(v: Cesium.Viewer, enabled: boolean) {
  const controller = v.scene.screenSpaceCameraController;
  controller.enableTranslate = enabled; // 平移
  controller.enableZoom = enabled; // 缩放
  controller.enableRotate = enabled; // 旋转
  controller.enableTilt = enabled; // 倾斜
  controller.enableLook = enabled; // 环视
}

/* ============ 工具函数 ============ */

function localToEnu(
  origin: Cesium.Cartesian3,
  target: Cesium.Cartesian3
): Cesium.Cartesian3 {
  const m = Cesium.Transforms.eastNorthUpToFixedFrame(origin);
  const inv = Cesium.Matrix4.inverseTransformation(m, new Cesium.Matrix4());
  return Cesium.Matrix4.multiplyByPoint(inv, target, new Cesium.Cartesian3());
}

/** 获取当前路径位置和朝向 */
function getPathPose(time: Cesium.JulianDate) {
  const pos = positionProperty.getValue(time, new Cesium.Cartesian3());
  if (!pos) return null;
  const nextTime = Cesium.JulianDate.addSeconds(
    time,
    1,
    new Cesium.JulianDate()
  );
  if (Cesium.JulianDate.greaterThan(nextTime, stopTime)) {
    Cesium.JulianDate.addSeconds(
      startTime,
      Cesium.JulianDate.secondsDifference(nextTime, stopTime),
      nextTime
    );
  }
  const next = positionProperty.getValue(nextTime, new Cesium.Cartesian3());
  if (!next) return null;
  const enu = localToEnu(pos, next);
  const heading = Math.atan2(enu.x, enu.y);
  const pitch = Cesium.Math.toRadians(-8);
  return { pos, heading, pitch };
}

/** 相机 flyTo 到当前路径位置（平滑过渡，而非瞬间 setView） */
function flyToPath(v: Cesium.Viewer, time: Cesium.JulianDate, duration = 1.5) {
  const pose = getPathPose(time);
  if (!pose) return;
  // 先取消旧动画，避免旧 cancel 回调覆盖新动画状态。
  v.camera.cancelFlight();
  v.clock.shouldAnimate = false;
  running.value = true;
  cameraFlying = true;
  setCameraInputEnabled(v, false);
  v.camera.flyTo({
    destination: pose.pos,
    orientation: { heading: pose.heading, pitch: pose.pitch, roll: 0 },
    duration,
    complete: () => {
      cameraFlying = false;
      v.clock.shouldAnimate = running.value;
      statusText.value = `正在漫游 · ${speedLevel.value}x（暂停后可自由浏览）`;
    },
    cancel: () => {
      cameraFlying = false;
      running.value = false;
      v.clock.shouldAnimate = false;
      setCameraInputEnabled(v, true);
      statusText.value = "漫游已暂停";
    },
  });
}

/* ============ Viewer 初始化 ============ */

const { viewer } = useCesiumViewer(containerRef, {
  baseLayer: "tianditu-img",
  // 漫游采用三维相机；避免首页和场景切换控件抢占相机。
  ui: { homeButton: false, sceneModePicker: false, selectionIndicator: false },
  camera: { position: INITIAL_CAMERA.position, pitch: INITIAL_CAMERA.pitch },
  clock: {
    start: startTime,
    stop: stopTime,
    currentTime: startTime,
    multiplier: 4,
    shouldAnimate: false,
    range: Cesium.ClockRange.LOOP_STOP,
  },
  onTick: (v, time) => {
    if (!running.value) return;

    // 相机正在 flyTo 时，不强制 setView
    if (cameraFlying) return;

    // 正常跟随：setView 到路径位置
    const pose = getPathPose(time);
    if (!pose) return;
    v.camera.setView({
      destination: pose.pos,
      orientation: { heading: pose.heading, pitch: pose.pitch, roll: 0 },
    });
  },
});

/* ============ 业务函数 ============ */

function ensureVisuals() {
  const v = viewer.value;
  if (!v) return;
  if (!pathLine) {
    pathLine = v.entities.add({
      polyline: {
        positions: points,
        width: 3,
        material: new Cesium.PolylineGlowMaterialProperty({
          glowPower: 0.3,
          color: Cesium.Color.fromCssColorString("#00d2ff"),
        }),
      },
    });
  }
  if (!aircraft) {
    aircraft = v.entities.add({
      position: positionProperty,
      billboard: {
        image: Cesium.buildModuleUrl("Assets/Textures/maki/airport.png"),
        scale: 1.2,
        color: Cesium.Color.YELLOW,
      },
    });
  }
}

function applyStart() {
  activeFeature.value = "start";
  ensureVisuals();
  const v = viewer.value;
  if (!v) return;
  started.value = true;
  v.clock.currentTime = Cesium.JulianDate.clone(startTime);
  // 漫游开始：禁用用户鼠标和键盘操作，避免干扰相机跟随
  setCameraInputEnabled(v, false);
  // 相机从当前位置 flyTo 到路径起点（明显的飞行动画，2秒）
  flyToPath(v, startTime, 2);
  statusText.value = "正在进入路线，抵达起点后开始漫游…";
}

function applyPause() {
  activeFeature.value = "start";
  const v = viewer.value;
  if (!v || !started.value) return;
  if (running.value) {
    running.value = false;
    v.clock.shouldAnimate = false;
    v.camera.cancelFlight();
    cameraFlying = false;
    // 暂停：恢复用户鼠标和键盘操作
    setCameraInputEnabled(v, true);
    statusText.value = "⏸ 漫游暂停（用户操作已恢复）";
  } else {
    // 继续：禁用用户鼠标和键盘操作
    setCameraInputEnabled(v, false);
    // 继续时 flyTo 回路径当前位置
    flyToPath(v, v.clock.currentTime);
    statusText.value = "正在返回路线，抵达后继续漫游…";
  }
}

function applySpeed() {
  activeFeature.value = "start";
  const v = viewer.value;
  if (!v) return;
  speedLevel.value = speedLevel.value >= 4 ? 1 : speedLevel.value + 1;
  v.clock.multiplier = speedLevel.value * 4;
  statusText.value = `速度 ${speedLevel.value}x · ${running.value ? (cameraFlying ? "正在进入路线" : "正在漫游") : (started.value ? "已暂停" : "待开始")}`;
}

function applyReset() {
  activeFeature.value = "start";
  running.value = false;
  const v = viewer.value;
  if (!v) return;
  v.camera.cancelFlight();
  started.value = false;
  speedLevel.value = 1;
  v.clock.multiplier = 4;
  v.clock.shouldAnimate = false;
  v.clock.currentTime = Cesium.JulianDate.clone(startTime);
  // 重置：恢复用户鼠标和键盘操作
  setCameraInputEnabled(v, true);
  cameraFlying = true;
  v.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(...INITIAL_CAMERA.position),
    orientation: {
      heading: INITIAL_CAMERA.heading,
      pitch: Cesium.Math.toRadians(INITIAL_CAMERA.pitch),
      roll: 0,
    },
    duration: 1.5,
    complete: () => {
      cameraFlying = false;
    },
    cancel: () => {
      cameraFlying = false;
    },
  });
  statusText.value = "已重置视角、路线进度和速度，可重新开始漫游";
}

// viewer 就绪后添加路径线和飞行器
watch(viewer, (v) => {
  if (v) ensureVisuals();
});

/* ============ 代码讲解 ============ */

const codeMap: Record<string, () => string> = {
  start: () => `// ① 构建 SampledPositionProperty（时间驱动的位置属性）
const positionProperty = new Cesium.SampledPositionProperty()
positionProperty.setInterpolationOptions({
  interpolationDegree: 2,
  interpolationAlgorithm: Cesium.HermitePolynomialApproximation,
})
waypoints.forEach((w, i) => {
  const time = Cesium.JulianDate.addSeconds(start, i * interval, new Cesium.JulianDate())
  positionProperty.addSample(time, Cesium.Cartesian3.fromDegrees(...w))
})

// ② 每帧：当前时间位置 + 朝向 + 相机跟随
viewer.clock.onTick.addEventListener((clock) => {
  const time = clock.currentTime
  const pos = positionProperty.getValue(time, new Cesium.Cartesian3())
  const nextTime = Cesium.JulianDate.addSeconds(time, 1, new Cesium.JulianDate())
  if (Cesium.JulianDate.greaterThan(nextTime, stopTime)) {
    Cesium.JulianDate.addSeconds(startTime,
      Cesium.JulianDate.secondsDifference(nextTime, stopTime), nextTime)
  }
  const next = positionProperty.getValue(nextTime, new Cesium.Cartesian3())

  // 计算朝向：把前进方向投影到本地 ENU
  const enu = localToEnu(pos, next)
  const heading = Math.atan2(enu.x, enu.y)

  viewer.camera.setView({
    destination: pos,
    orientation: { heading, pitch: Cesium.Math.toRadians(-8), roll: 0 },
  })
})`,
};

const explainMap: Record<string, () => string> = {
  start: () => `【原理】飞行漫游 = 时间驱动位置属性 + 每帧相机跟随：
1. SampledPositionProperty：对途经点按时间采样，内部 Hermite 插值
   （循环终点的前瞻采样回绕到起点）
2. clock 时间推进（可倍速/暂停/循环），positionProperty.getValue(time) 取位置
3. 朝向 = 当前位置指向下一点的方向在"东-北-上"局部系的投影
   （Math.atan2(east, north) 即相对正北的 heading）
4. camera.setView 每帧写入相机状态

【交互】漫游时禁用鼠标相机操作；点击暂停后可自由浏览，继续时平滑返回路线。
进入路线期间冻结时钟，抵达后开始计时；调速不会自动解除暂停。
重置同时恢复初始视角、路线起点及 1x 速度。
【要点】配合 clock.multiplier 实现变速；可扩展为第一人称/第三人称视角。`,
};

const { code, explanation } = useCodeExplain(
  codeMap,
  explainMap,
  activeFeature
);
</script>

<template>
  <div class="flex h-full flex-col gap-3 p-4">
    <div class="flex flex-wrap items-center gap-2">
      <n-button
        size="small"
        :type="activeFeature === 'start' ? 'primary' : 'default'"
        @click="applyStart"
        :disabled="!viewer"
        >开始漫游</n-button
      >
      <n-button
        size="small"
        :type="activeFeature === 'start' ? 'primary' : 'default'"
        @click="applyPause"
        :disabled="!viewer || !started"
        >{{ running ? "暂停" : "继续" }}</n-button
      >
      <n-button
        size="small"
        :type="activeFeature === 'start' ? 'primary' : 'default'"
        @click="applySpeed"
        :disabled="!viewer"
        >速度 {{ speedLevel }}x</n-button
      >
      <n-button size="small" quaternary :disabled="!viewer" @click="applyReset">重置漫游</n-button>
    </div>

    <SplitViewer
      :title="activeFeature"
      :code="code"
      :explanation="explanation"
      :default-split-size="70"
      storage-key="flight-split"
    >
      <template #scene-overlay>
        <div
          class="absolute left-3 top-3 z-10 rounded bg-black/60 px-3 py-1.5 text-xs text-white"
        >
          {{ statusText }}
        </div>
      </template>
    </SplitViewer>
  </div>
</template>

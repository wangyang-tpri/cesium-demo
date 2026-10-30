<script setup lang="ts">
import { inject, onBeforeUnmount, onMounted, ref, type ComponentPublicInstance, type Ref } from "vue";
import CodePanel from "./CodePanel.vue";
import { onCameraChange, estimateZoomLevel, formatHeight } from "@/utils/currentViewer";

const props = withDefaults(
  defineProps<{
    /** CodePanel 标题 */
    title: string;
    /** 代码 HTML（由 useCodeExplain 提供） */
    code: string;
    /** 原理讲解文本 */
    explanation: string;
    /** 默认左侧面板百分比，默认 70 */
    defaultSplitSize?: number;
    /** localStorage key，传入则持久化分割位置 */
    storageKey?: string;
  }>(),
  {
    defaultSplitSize: 70,
    storageKey: undefined,
  }
);

const emit = defineEmits<{
  /** 分割位置变化时触发，父组件可用于调用 viewer.resize() */
  (e: "split-change"): void;
}>();

// 通过 inject 获取父组件 provide 的 containerRef
const containerRef = inject<Ref<HTMLDivElement | null>>(
  "splitViewerContainerRef"
);
const viewerInitializing = inject<Ref<boolean>>('cesiumViewerInitializing', ref(false));
const viewerInitializationError = inject<Ref<string | null>>('cesiumViewerInitializationError', ref(null));

// 用函数 ref 方式更新父组件传入的 containerRef
// Vue 3.5+ 函数 ref 签名：(ref: Element | ComponentPublicInstance | null, refs: Record) => void
function setContainerRef(el: Element | ComponentPublicInstance | null) {
  if (containerRef) containerRef.value = el instanceof Element ? el as HTMLDivElement : null;
}

// 从 localStorage 读取或使用默认值
const splitSize = ref<number>(props.defaultSplitSize);

// 实时缩放层级和相机高度
const zoomLevel = ref<number>(0);
const cameraHeight = ref<string>('0 m');

let removeCameraListener: (() => void) | null = null;

onMounted(() => {
  // 注册相机变化监听器，实时更新缩放层级
  removeCameraListener = onCameraChange((viewer) => {
    const height = viewer.camera.positionCartographic.height;
    cameraHeight.value = formatHeight(height);
    zoomLevel.value = estimateZoomLevel(height);
  });
});

onBeforeUnmount(() => {
  removeCameraListener?.();
  removeCameraListener = null;
});
</script>

<template>
  <div class="min-h-0 flex-1">
    <n-split
      direction="horizontal"
      :default-size="splitSize + '%'"
      :min="0.7"
      :max="0.85"
    >
      <template #1>
        <div
          class="relative h-full w-full overflow-hidden rounded-lg border border-gray-200 shadow-sm"
        >
          <div :ref="setContainerRef" class="h-full w-full"></div>
          <div v-if="viewerInitializing || viewerInitializationError"
            class="absolute inset-0 z-30 flex items-center justify-center bg-gray-900 text-sm text-white"
            role="status" aria-live="polite">
            {{ viewerInitializationError ? '地图初始化失败，请重新进入页面重试' : '正在准备地图与地形…' }}
          </div>
          <!-- 左侧场景覆盖层 slot：状态文本、工具栏、图例等 -->
          <slot name="scene-overlay"></slot>
          <!-- 右下角：实时缩放层级和相机高度 -->
          <div class="absolute bottom-3 right-3 z-10 flex items-center gap-2 rounded bg-black/60 px-3 py-1.5 text-xs text-white">
            <span class="font-mono">Zoom {{ zoomLevel }}</span>
            <span class="text-white/40">|</span>
            <span class="font-mono">H {{ cameraHeight }}</span>
          </div>
        </div>
      </template>
      <template #2>
        <div class="flex h-full flex-col pl-3">
          <div class="min-h-0 flex-1">
            <CodePanel :title="title" :code="code" :explanation="explanation" />
          </div>
          <!-- 右侧面板底部插槽：可放置 ECharts 图表、统计信息等额外内容 -->
          <slot name="bottom-panel"></slot>
        </div>
      </template>
    </n-split>
  </div>
</template>

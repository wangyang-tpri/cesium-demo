<script setup lang="ts">
import * as Cesium from "cesium";
import { onMounted, ref, provide } from "vue";
import { useCesiumViewer } from "@/hooks/useCesiumViewer";
import { useCodeExplain } from "@/hooks/useCodeExplain";
import SplitViewer from "@/components/base/SplitViewer.vue";

const containerRef = ref<HTMLDivElement | null>(null);
provide("splitViewerContainerRef", containerRef);
const activeFeature = ref("load");
const statusText = ref(
  "3D Tiles：流式加载海量三维模型（示例为带要素属性的彩色盒子）。"
);

const { viewer } = useCesiumViewer(containerRef, {
  baseLayer: "tianditu-img",
  camera: { position: [108.94, 34.34, 3000000], pitch: -60 },
});

// 分割条拖拽时通知 viewer 重新计算渲染尺寸
function onSplitChange() {
  viewer.value?.resize();
}

// 公开示例数据（jsdelivr CDN，国内可达）
const SAMPLE_TILESET =
  "https://cdn.jsdelivr.net/gh/CesiumGS/3d-tiles-samples@main/glTF/EXT_mesh_features/FeatureIdAttribute/tileset.json";

let tileset: Cesium.Cesium3DTileset | null = null;
let osmBuildings: Cesium.Cesium3DTileset | null = null;
/** 移除场景中所有 tileset */
function removeTilesets() {
  const v = viewer.value;
  if (!v) return;
  if (tileset) {
    v.scene.primitives.remove(tileset);
    tileset = null;
  }
  if (osmBuildings) {
    v.scene.primitives.remove(osmBuildings);
    osmBuildings = null;
  }
}

async function applyLoad() {
  activeFeature.value = "load";
  removeTilesets();
  const v = viewer.value;
  if (!v) return;
  statusText.value = "正在加载 3D Tiles 数据…";
  try {
    tileset = await Cesium.Cesium3DTileset.fromUrl(SAMPLE_TILESET);
    v.scene.primitives.add(tileset);
    v.camera.flyToBoundingSphere(tileset.boundingSphere, { duration: 2 });
    // 1.145：tilesLoaded 为布尔（当前视锥所需瓦片是否就绪），不再是计数
    statusText.value = tileset.tilesLoaded
      ? "加载完成：视锥所需瓦片已就绪（含要素属性）"
      : "加载完成：瓦片流式加载中（随视角继续调度，含要素属性）";
  } catch (e) {
    console.error(e);
    statusText.value = "加载失败：网络不可达，请检查 CDN 连接";
  }
}

async function applyOsm() {
  activeFeature.value = "osm";
  removeTilesets();
  const v = viewer.value;
  if (!v) return;
  statusText.value = "正在加载 Cesium OSM Buildings（全球建筑白膜）…";
  try {
    osmBuildings = await Cesium.createOsmBuildingsAsync();
    v.scene.primitives.add(osmBuildings);
    v.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(108.94, 34.34, 18000),
      duration: 2,
    });
    statusText.value =
      "OSM Buildings 已加载：放大查看建筑细节，点击建筑可查属性";
  } catch (e) {
    console.error(e);
    statusText.value = "加载失败：请检查网络 / Ion token";
  }
}

/** 样式化：按要素属性上色 */
function applyStyle() {
  activeFeature.value = "style";
  const target = tileset ?? osmBuildings;
  if (!target) {
    statusText.value = "请先加载数据（示例盒子或 OSM Buildings）";
    return;
  }
  if (target === osmBuildings) {
    // OSM Buildings：按 height 属性分级设色
    target.style = new Cesium.Cesium3DTileStyle({
      color: {
        conditions: [
          ["${height} >= 100", "color('#e74c3c')"],
          ["${height} >= 50", "color('#f39c12')"],
          ["${height} >= 20", "color('#f1c40f')"],
          ["true", "color('#27ae60')"],
        ],
      },
    });
    statusText.value =
      "已应用样式：OSM 建筑按高度分级（红>100m / 橙>50m / 黄>20m / 绿）";
  } else {
    // 示例数据：按要素编号交替染色
    target.style = new Cesium.Cesium3DTileStyle({
      color: "(featureId % 2 === 0) ? color('red') : color('cyan')",
    });
    statusText.value = "已应用样式：按要素编号交替红/青色（Cesium3DTileStyle）";
  }
}

/** 恢复默认样式 */
function applyResetStyle() {
  activeFeature.value = "style";
  const target = tileset ?? osmBuildings;
  if (!target) return;
  target.style = undefined;
  statusText.value = "已恢复默认样式";
}

/** 点击要素查属性 */
function applyAttributes() {
  activeFeature.value = "attributes";
  statusText.value = "属性查询已开启：点击模型上的要素查看属性";
}

function applyBounding() {
  activeFeature.value = "bounding";
  const target = tileset ?? osmBuildings;
  const v = viewer.value;
  if (!target || !v) {
    statusText.value = "请先加载数据";
    return;
  }
  v.camera.flyToBoundingSphere(target.boundingSphere, { duration: 2 });
  statusText.value = `包围球：半径 ${(
    target.boundingSphere.radius / 1000
  ).toFixed(1)} km`;
}

onMounted(() => {
  const v = viewer.value;
  if (!v) return;
  // 点击要素 → 打印属性
  const handler = new Cesium.ScreenSpaceEventHandler(v.scene.canvas);
  handler.setInputAction(
    (e: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
      const picked = v.scene.pick(e.position);
      if (picked && picked instanceof Cesium.Cesium3DTileFeature) {
        // 1.145：getPropertyNames() 已更名 getPropertyIds()
        const names = picked.getPropertyIds();
        const kv = names
          .map((n) => `${n}: ${String(picked.getProperty(n))}`)
          .join("  ");
        statusText.value = `要素属性 [${names.length} 项]：${kv.slice(0, 200)}`;
      }
    },
    Cesium.ScreenSpaceEventType.LEFT_CLICK
  );
});

const codeMap: Record<string, () => string> = {
  load: () => `// ① 加载 3D Tiles
const tileset =
  await Cesium.Cesium3DTileset.fromUrl(
    'https://.../tileset.json')
viewer.scene.primitives.add(tileset)

// 自动取景
viewer.camera.flyToBoundingSphere(
  tileset.boundingSphere, { duration: 2 })

// 常用配置
const tileset = await Cesium.Cesium3DTileset.fromUrl(url, {
  maximumScreenSpaceError: 16,  // 屏幕误差阈值（LOD 切换灵敏度）
  maximumMemoryUsage: 512,      // 显存上限(MB)
  show: true,
})`,

  osm: () => `// ② Cesium OSM Buildings：全球建筑白膜（Ion 公开资产）
const buildings =
  await Cesium.createOsmBuildingsAsync()
viewer.scene.primitives.add(buildings)
// 建筑具有 height/name 等属性，可样式化与查询`,

  style: () => `// ③ 样式化：Cesium3DTileStyle 表达式
tileset.style = new Cesium.Cesium3DTileStyle({
  color: "(featureId % 2 === 0)
          ? color('red') : color('cyan')",
})

// 按属性条件分级（OSM Buildings 用高度）：
tileset.style = new Cesium.Cesium3DTileStyle({
  color: {
    conditions: [
      ['\${height} >= 100', "color('#e74c3c')"],
      ['\${height} >= 50',  "color('#f39c12')"],
      ['\${height} >= 20',  "color('#f1c40f')"],
      ['true',              "color('#27ae60')"],
    ],
  },
})`,

  attributes: () => `// ④ 点击要素查询属性
const handler = new Cesium.ScreenSpaceEventHandler(
  viewer.scene.canvas)
handler.setInputAction((e) => {
  const picked = viewer.scene.pick(e.position)
  if (picked instanceof Cesium.Cesium3DTileFeature) {
    picked.getPropertyNames()          // 属性名列表
    picked.getProperty('height')       // 取属性值
    picked.setProperty('x', 1)         // 写属性
  }
}, Cesium.ScreenSpaceEventType.LEFT_CLICK)`,

  bounding: () => `// ⑤ 包围球取景
tileset.boundingSphere        // BoundingSphere
viewer.camera.flyToBoundingSphere(
  tileset.boundingSphere, { duration: 2 })
// tilesLoaded / root / totalMemoryUsageInBytes 等
// 均为调度与调试的关键状态`,
};

const explainMap: Record<string, () => string> = {
  load: () => `【原理】3D Tiles 是 Cesium 的流式三维数据标准（OGC 规范）：
tileset.json 定义瓦片树（LOD 金字塔），每帧根据相机视锥
动态加载/卸载瓦片，实现“亿级三角面”场景流畅浏览。

【流程】fromUrl 解析 tileset.json → 创建 Cesium3DTileset →
加入 scene.primitives → 引擎按视距/屏幕误差自动调度。

【要点】maximumScreenSpaceError 越小加载越精细（越卡）；
本示例数据含要素属性（featureId），适合体验样式化。`,

  osm: () => `【原理】Cesium OSM Buildings 是 Cesium 官方公开的全球建筑数据集
（约数亿栋），由 OpenStreetMap 足迹 + 高度属性程序化生成，
通过 3D Tiles 流式加载，是“全球白膜”效果的标准实现。

【要点】依赖 Ion（内置默认 token 可访问）；
建筑带 height/name 属性，支撑样式化与属性查询。`,

  style: () => `【原理】Cesium3DTileStyle 用类 CSS 表达式对每个要素求值：
• featureId / batchId：要素编号
• \${height} 等：要素属性插值
• color() / conditions / meta 等语法构成完整样式语言

【要点】样式不修改数据，GPU 端即时生效（无重载成本），
是实现“分级设色”“单体高亮”的官方方案。`,

  attributes: () => `【原理】3D Tiles 要素（Cesium3DTileFeature）携带业务属性，
pick 后可直接读取。属性查询是“点击查楼/查要素”的基础。

【要点】点云/实例化（Instanced3DTileContent）等也有对应要素类；
属性也可在 style 中直接引用（\${属性名}）。`,

  bounding: () => `【原理】tileset.boundingSphere 是全部瓦片的最小包围球，
引擎也用它做视锥剔除与调度优先级判断。

【要点】tilesLoaded / root / statistics 等字段用于监控加载进度；
subtree 等 API 用于精细控制 LOD 调度。`,
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
        :type="activeFeature === 'load' ? 'primary' : 'default'"
        @click="applyLoad"
        >加载示例数据</n-button
      >
      <n-button
        size="small"
        :type="activeFeature === 'osm' ? 'primary' : 'default'"
        @click="applyOsm"
        >加载 OSM 全球建筑</n-button
      >
      <n-button
        size="small"
        :type="activeFeature === 'style' ? 'primary' : 'default'"
        @click="applyStyle"
        >分级设色</n-button
      >
      <n-button
        size="small"
        :type="activeFeature === 'style' ? 'primary' : 'default'"
        @click="applyResetStyle"
        >恢复样式</n-button
      >
      <n-button
        size="small"
        :type="activeFeature === 'attributes' ? 'primary' : 'default'"
        @click="applyAttributes"
        >属性查询（点击要素）</n-button
      >
      <n-button
        size="small"
        :type="activeFeature === 'bounding' ? 'primary' : 'default'"
        @click="applyBounding"
        >包围球取景</n-button
      >
    </div>

    <SplitViewer
      :title="activeFeature"
      :code="code"
      :explanation="explanation"
      :default-split-size="70"
      storage-key="tileset-split"
      @split-change="onSplitChange"
    >
      <template #scene-overlay>
        <div
          class="absolute left-3 top-3 z-10 max-w-[70%] rounded bg-black/60 px-3 py-1.5 text-xs text-white"
        >
          {{ statusText }}
        </div>
      </template>
    </SplitViewer>
  </div>
</template>

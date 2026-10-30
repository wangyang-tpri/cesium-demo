<script setup lang="ts">
import * as Cesium from 'cesium';
import { provide, ref, shallowRef } from 'vue';
import SplitViewer from '@/components/base/SplitViewer.vue';
import { useSpatialAnalysis } from '@/hooks/useSpatialAnalysis';
import { useCodeExplain } from '@/hooks/useCodeExplain';
import { planningPolygon, routeDistance } from '@/utils/planningGeometry';
import { drawingRectangle, surfaceRadius } from '@/utils/mapInteraction';

const containerRef = ref<HTMLDivElement | null>(null);
provide('splitViewerContainerRef', containerRef);
type DrawType = 'point' | 'line' | 'polygon' | 'circle' | 'rectangle';
const activeFeature = ref<DrawType>('point');
const analysis = useSpatialAnalysis(containerRef, '选择图元类型开始绘制；折线和面使用完成绘制按钮结束。');
const { viewer, ready, picking, statusText, terrainNote } = analysis;
const drawTypes: { key: DrawType; label: string }[] = [
  { key: 'point', label: '点' }, { key: 'line', label: '线' }, { key: 'polygon', label: '面' },
  { key: 'circle', label: '圆' }, { key: 'rectangle', label: '矩形' },
];
interface DrawItem { id: number; name: string; detail: string; entities: Cesium.Entity[]; sphere: Cesium.BoundingSphere }
const drawItems = shallowRef<DrawItem[]>([]);
const currentPositions = shallowRef<Cesium.Cartesian3[]>([]);
let counter = 0;
let hover: Cesium.Cartesian3 | undefined;
let previewRadius = 0;
let previewRectangle: Cesium.Rectangle | undefined;
let preview: Cesium.Entity | undefined;
let markers: Cesium.Entity[] = [];
function resetDraft() {
  markers.forEach(analysis.remove); markers = [];
  currentPositions.value = []; hover = undefined; previewRadius = 0; previewRectangle = undefined;
}
function stopDrawing() {
  picking.value = false; resetDraft(); analysis.remove(preview); preview = undefined;
  statusText.value = '已停止绘制，已完成图元保留';
}
function updateHover(position: Cesium.Cartesian3) {
  if (!currentPositions.value.length) return;
  hover = position;
  try {
    if (activeFeature.value === 'circle') previewRadius = surfaceRadius(currentPositions.value[0], position);
    if (activeFeature.value === 'rectangle') previewRectangle = drawingRectangle(currentPositions.value[0], position);
  } catch { previewRadius = 0; previewRectangle = undefined; }
}
function createPreview(type: DrawType) {
  if (type === 'line' || type === 'polygon') {
    preview = analysis.add({ polyline: { width: 2, clampToGround: true, material: Cesium.Color.YELLOW,
      positions: new Cesium.CallbackProperty(() => {
        const points = [...currentPositions.value];
        if (hover && points.length && Cesium.Cartesian3.distance(points[points.length - 1], hover) > 0.1) points.push(hover);
        if (type === 'polygon' && points.length >= 3) points.push(points[0]);
        return points.length >= 2 ? points : undefined;
      }, false) } });
  } else if (type === 'circle') {
    preview = analysis.add({
      position: new Cesium.CallbackPositionProperty(() => currentPositions.value[0], false),
      ellipse: { show: new Cesium.CallbackProperty(() => !!currentPositions.value.length && previewRadius >= 1, false),
        semiMajorAxis: new Cesium.CallbackProperty(() => Math.max(previewRadius, 1), false),
        semiMinorAxis: new Cesium.CallbackProperty(() => Math.max(previewRadius, 1), false),
        material: Cesium.Color.YELLOW.withAlpha(0.3), heightReference: Cesium.HeightReference.CLAMP_TO_GROUND },
    });
  } else if (type === 'rectangle') {
    preview = analysis.add({ rectangle: {
      show: new Cesium.CallbackProperty(() => !!previewRectangle, false),
      coordinates: new Cesium.CallbackProperty(() => previewRectangle, false),
      material: Cesium.Color.YELLOW.withAlpha(0.3), heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
    } });
  }
}
function commit(type: DrawType, points: Cesium.Cartesian3[]) {
  if (drawItems.value.length >= 200) { statusText.value = '最多保留 200 个图元，请删除或清除后继续'; return; }
  const created: Cesium.Entity[] = [];
  const add = (options: Cesium.Entity.ConstructorOptions) => { const entity = analysis.add(options); created.push(entity); };
  const id = counter + 1;
  let name = ''; let detail = '';
  let sphere = Cesium.BoundingSphere.fromPoints(points);
  try {
    if (type === 'point') {
      name = '点' + id;
      add({ position: points[0], point: { pixelSize: 11, color: Cesium.Color.RED,
        outlineColor: Cesium.Color.WHITE, outlineWidth: 2, heightReference: Cesium.HeightReference.CLAMP_TO_GROUND } });
    } else if (type === 'line') {
      if (points.length < 2) throw new Error('折线至少需要两个顶点');
      detail = (routeDistance(points) / 1000).toFixed(3) + 'km';
      name = '折线' + id;
      add({ polyline: { positions: [...points], width: 4, clampToGround: true, material: Cesium.Color.DODGERBLUE } });
    } else if (type === 'polygon') {
      const polygon = planningPolygon(points);
      name = '多边形' + id; detail = (polygon.area / 10000).toFixed(2) + '公顷';
      add({ polygon: { hierarchy: new Cesium.PolygonHierarchy(polygon.positions),
        material: Cesium.Color.DODGERBLUE.withAlpha(0.35), heightReference: Cesium.HeightReference.CLAMP_TO_GROUND } });
      add({ polyline: { positions: [...polygon.positions, polygon.positions[0]], width: 2,
        clampToGround: true, material: Cesium.Color.DODGERBLUE } });
    } else if (type === 'circle') {
      const radius = surfaceRadius(points[0], points[1]);
      name = '圆' + id; detail = '半径 ' + radius.toFixed(1) + 'm';
      sphere = new Cesium.BoundingSphere(points[0], radius);
      add({ position: points[0], ellipse: { semiMajorAxis: radius, semiMinorAxis: radius,
        material: Cesium.Color.LIME.withAlpha(0.35), heightReference: Cesium.HeightReference.CLAMP_TO_GROUND } });
    } else {
      const rectangle = drawingRectangle(points[0], points[1]);
      name = '矩形' + id;
      const height = (Cesium.Cartographic.fromCartesian(points[0]).height + Cesium.Cartographic.fromCartesian(points[1]).height) / 2;
      const corners = [[rectangle.west, rectangle.south], [rectangle.east, rectangle.south],
        [rectangle.east, rectangle.north], [rectangle.west, rectangle.north]]
        .map(([lon, lat]) => Cesium.Cartesian3.fromRadians(lon, lat, height));
      sphere = Cesium.BoundingSphere.fromPoints(corners);
      add({ rectangle: { coordinates: rectangle, material: Cesium.Color.ORANGE.withAlpha(0.35),
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND } });
      add({ polyline: { positions: [...corners, corners[0]], width: 2, clampToGround: true, material: Cesium.Color.ORANGE } });
    }
    counter = id;
    drawItems.value = [...drawItems.value, { id, name, detail, entities: created, sphere }];
    resetDraft();
    statusText.value = '已绘制' + name + (detail ? '（' + detail + '）' : '') + '，可继续绘制';
  } catch (error) {
    created.forEach(analysis.remove);
    statusText.value = error instanceof Error ? error.message : '图元无效，请调整顶点';
  }
}
function selectDrawType(type: DrawType) {
  if (!ready.value) return;
  stopDrawing(); activeFeature.value = type;
  createPreview(type);
  analysis.pick(position => {
    if (type === 'point') { commit(type, [position]); return; }
    if (currentPositions.value.length && Cesium.Cartesian3.distance(currentPositions.value.at(-1)!, position) < 1) {
      statusText.value = '相邻顶点至少相距 1 米'; return;
    }
    if ((type === 'circle' || type === 'rectangle') && currentPositions.value.length === 1) {
      commit(type, [currentPositions.value[0], position]); return;
    }
    if (currentPositions.value.length >= 50) { statusText.value = '最多支持 50 个顶点，请完成绘制'; return; }
    currentPositions.value = [...currentPositions.value, position]; hover = undefined;
    markers.push(analysis.add({ position, point: { pixelSize: 8, color: Cesium.Color.YELLOW,
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND } }));
    statusText.value = type === 'circle' ? '圆心已设置，移动预览后点击边缘完成' :
      type === 'rectangle' ? '第一角点已设置，移动预览后点击对角点完成' :
      '已添加 ' + currentPositions.value.length + ' 个顶点，点击完成绘制结束';
  }, { onMove: updateHover });
  statusText.value = type === 'point' ? '点击添加点；停止绘制后点击不再添加' :
    type === 'circle' ? '先点击圆心，再点击边缘确定半径' :
    type === 'rectangle' ? '依次点击矩形的两个对角点' : '依次点击顶点，再使用完成绘制按钮结束';
}
function finishShape() {
  if (!picking.value || !['line', 'polygon'].includes(activeFeature.value)) return;
  commit(activeFeature.value, [...currentPositions.value]);
}
function undoVertex() {
  analysis.remove(markers.pop()); currentPositions.value = currentPositions.value.slice(0, -1);
  hover = undefined; previewRadius = 0; previewRectangle = undefined;
  statusText.value = '已撤销顶点，剩余 ' + currentPositions.value.length + ' 个';
}
function applyClear() {
  stopDrawing(); analysis.clear(); drawItems.value = []; counter = 0;
  statusText.value = '已清除所有图元和草稿，绘制已停止';
}
function removeItem(item: DrawItem) {
  item.entities.forEach(analysis.remove); drawItems.value = drawItems.value.filter(other => other.id !== item.id);
  statusText.value = '已删除' + item.name;
}
function flyToItem(item: DrawItem) {
  stopDrawing();
  viewer.value?.camera.flyToBoundingSphere(item.sphere, {
    offset: new Cesium.HeadingPitchRange(0, -Math.PI / 3, Math.max(item.sphere.radius * 3, 1000)), duration: 1.2,
  });
}
const drawExplanation = () => `【交互】支持点、折线、多边形、圆和经纬度矩形。折线和多边形使用完成按钮；圆和矩形通过两次点击完成。支持移动预览、撤销草稿顶点、停止、单项定位和删除。
【校验】拒绝零长度、零半径、自交和退化图形。多边形局部半径上限25km；圆半径1m–25km；矩形边长1m–50km。
【显示】全部贴合地表。长度为椭球测地线距离，面积为局部水平投影近似值，不是坡面测量。
【清理】切换类型仅取消草稿，保留已完成图元；停止或清除后地图点击不会继续添加。最多保留200个图元。`;
const { code, explanation } = useCodeExplain({
  point: () => 'viewer.entities.add({ position, point: { pixelSize: 11, heightReference: HeightReference.CLAMP_TO_GROUND } })',
  line: () => 'viewer.entities.add({ polyline: { positions: [...vertices], clampToGround: true } })',
  polygon: () => 'const polygon = planningPolygon(vertices) // 校验重复、自交、退化多边形后再保存',
  circle: () => 'const radius = surfaceRadius(center, edge) // 椭球测地线半径，拒绝零半径',
  rectangle: () => 'const rectangle = drawingRectangle(firstCorner, oppositeCorner) // 自动处理跨180°经线',
}, { point: drawExplanation, line: drawExplanation, polygon: drawExplanation, circle: drawExplanation, rectangle: drawExplanation }, activeFeature);
</script>

<template>
  <div class="flex h-full flex-col gap-3 p-4">
    <div class="flex flex-wrap items-center gap-2">
      <n-button v-for="type in drawTypes" :key="type.key" size="small" :type="picking && activeFeature === type.key ? 'primary' : 'default'"
        :disabled="!ready" @click="selectDrawType(type.key)">{{ type.label }}</n-button>
      <n-button size="small" type="success" :disabled="!picking || !['line', 'polygon'].includes(activeFeature) || currentPositions.length < (activeFeature === 'line' ? 2 : 3)" @click="finishShape">完成绘制</n-button>
      <n-button size="small" :disabled="!picking || !currentPositions.length" @click="undoVertex">撤销顶点</n-button>
      <n-button size="small" :disabled="!picking" @click="stopDrawing">停止绘制</n-button>
      <n-button size="small" quaternary @click="applyClear">清除</n-button>
    </div>
    <SplitViewer title="图元绘制" :code="code" :explanation="explanation" storage-key="primitive-draw-split">
      <template #scene-overlay>
        <div class="absolute left-3 top-3 z-10 max-w-[80%] rounded bg-black/70 px-3 py-2 text-xs text-white">
          <div>{{ statusText }}</div><div class="mt-1 text-white/70">{{ terrainNote }}</div>
        </div>
      </template>
      <template #bottom-panel>
        <div class="max-h-[40vh] shrink-0 overflow-auto border-t bg-gray-50 p-3 text-xs">
          <b>已完成图元 · {{ drawItems.length }} 个</b>
          <div v-for="item in drawItems" :key="item.id" class="mt-2 flex flex-wrap items-center gap-2 rounded border bg-white p-2">
            <span class="flex-1">{{ item.name }} {{ item.detail }}</span>
            <n-button size="tiny" @click="flyToItem(item)">定位</n-button>
            <n-button size="tiny" quaternary type="error" @click="removeItem(item)">删除</n-button>
          </div>
        </div>
      </template>
    </SplitViewer>
  </div>
</template>

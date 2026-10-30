<script setup lang="ts">
import * as Cesium from 'cesium';
import { provide, ref, shallowRef } from 'vue';
import SplitViewer from '@/components/base/SplitViewer.vue';
import { useSpatialAnalysis } from '@/hooks/useSpatialAnalysis';
import { useCodeExplain } from '@/hooks/useCodeExplain';
import { annotationStyle, pickedEntityId, type AnnotationStyle } from '@/utils/mapInteraction';

const containerRef = ref<HTMLDivElement | null>(null);
provide('splitViewerContainerRef', containerRef);
type AnnotationType = 'text' | 'icon' | 'point-label';
const activeFeature = ref<AnnotationType>('text');
const analysis = useSpatialAnalysis(containerRef, '选择类型后点击添加；可通过地图或列表编辑已有标注。');
const { viewer, ready, picking, statusText, terrainNote } = analysis;
const annoTypes: { key: AnnotationType; label: string }[] = [
  { key: 'text', label: '文字标注' }, { key: 'icon', label: '图标标注' }, { key: 'point-label', label: '点+标签' },
];
interface AnnotationItem { id: number; type: AnnotationType; style: AnnotationStyle; position: Cesium.Cartesian3; entity: Cesium.Entity }
const annotationItems = shallowRef<AnnotationItem[]>([]);
let counter = 0;
const annotationText = ref('新建标注');
const fontSize = ref<number | null>(16);
const fontColor = ref('#ffffff');
const bgColor = ref('#1890ff');
const iconEmoji = ref('📍');
const showEditModal = ref(false);
const editingId = ref<number | null>(null);
const editForm = ref({ text: '', fontSize: 16 as number | null, color: '#ffffff', background: '#1890ff' });

function labelOptions(type: AnnotationType, style: AnnotationStyle): Cesium.LabelGraphics.ConstructorOptions {
  return { text: style.text, font: style.fontSize + 'px sans-serif',
    fillColor: Cesium.Color.fromCssColorString(style.color),
    showBackground: type !== 'icon',
    backgroundColor: Cesium.Color.fromCssColorString(style.background),
    pixelOffset: type === 'point-label' ? new Cesium.Cartesian2(0, -24) : Cesium.Cartesian2.ZERO,
    verticalOrigin: Cesium.VerticalOrigin.CENTER, style: Cesium.LabelStyle.FILL,
    heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
    distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 200000),
    disableDepthTestDistance: Number.POSITIVE_INFINITY,
  };
}
function selectType(type: AnnotationType) {
  if (!ready.value) return;
  activeFeature.value = type;
  analysis.pick(position => {
    if (annotationItems.value.length >= 200) { statusText.value = '最多保留 200 个标注，请删除或清除后继续'; return; }
    try {
      const style = annotationStyle({ text: type === 'icon' ? iconEmoji.value : annotationText.value,
        fontSize: fontSize.value, color: fontColor.value, background: bgColor.value });
      const entity = analysis.add({ position, label: labelOptions(type, style),
        ...(type === 'point-label' ? { point: { pixelSize: 10, color: Cesium.Color.RED,
          outlineColor: Cesium.Color.WHITE, outlineWidth: 2, heightReference: Cesium.HeightReference.CLAMP_TO_GROUND } } : {}),
      });
      const id = ++counter;
      annotationItems.value = [...annotationItems.value, { id, type, style, position, entity }];
      statusText.value = '已添加标注 #' + id + '：' + style.text;
    } catch (error) { statusText.value = error instanceof Error ? error.message : '标注样式无效'; }
  }, { beforePick: pixel => {
    if (showEditModal.value) return true;
    const id = pickedEntityId(viewer.value?.scene.pick(pixel));
    const item = annotationItems.value.find(annotation => annotation.entity.id === id);
    if (!item) return false;
    openEditModal(item); return true;
  } });
  statusText.value = '已开启' + annoTypes.find(t => t.key === type)!.label + '添加，点击已有标注可编辑';
}
function stopAdding() { picking.value = false; statusText.value = '已停止添加，可通过地图或列表编辑已有标注'; }
function openEditModal(item: AnnotationItem) {
  picking.value = false; editingId.value = item.id;
  editForm.value = { ...item.style }; showEditModal.value = true;
  statusText.value = '正在编辑标注 #' + item.id + '，添加已暂停';
}
function cancelEdit() { showEditModal.value = false; editingId.value = null; }
function onEditClosed() { if (!showEditModal.value) editingId.value = null; }
function saveEdit() {
  const item = annotationItems.value.find(annotation => annotation.id === editingId.value);
  if (!item) { cancelEdit(); statusText.value = '该标注已被删除'; return false; }
  try {
    const style = annotationStyle(editForm.value);
    item.entity.label = new Cesium.LabelGraphics(labelOptions(item.type, style));
    annotationItems.value = annotationItems.value.map(annotation => annotation.id === item.id ? { ...annotation, style } : annotation);
    cancelEdit(); statusText.value = '已更新标注 #' + item.id + ' 的内容和样式';
  } catch (error) {
    statusText.value = error instanceof Error ? error.message : '标注样式无效';
    return false;
  }
}
function removeItem(item: AnnotationItem) {
  if (editingId.value === item.id) cancelEdit();
  analysis.remove(item.entity);
  annotationItems.value = annotationItems.value.filter(annotation => annotation.id !== item.id);
  statusText.value = '已删除标注 #' + item.id;
}
function flyToItem(item: AnnotationItem) {
  picking.value = false;
  viewer.value?.camera.flyToBoundingSphere(new Cesium.BoundingSphere(item.position, 1), {
    offset: new Cesium.HeadingPitchRange(0, -Math.PI / 3, 1500), duration: 1.2,
  });
  statusText.value = '定位标注 #' + item.id + '，添加已暂停';
}
function applyClear() {
  cancelEdit(); analysis.clear(); viewer.value?.camera.cancelFlight(); annotationItems.value = []; counter = 0;
  statusText.value = '已清除所有标注，添加已停止';
}
const annotationCode = () => `// 使用同一套屏幕事件，避免浏览器原生 click 将拖动误判为添加
const id = pickedEntityId(viewer.scene.pick(pixel))
const item = items.find(item => item.entity.id === id)
if (item) openEditModal(item)
else addAnnotation(groundPosition)
// 数据与地图统一使用实际内容，图标类型保存 emoji 本身
item.entity.label = new LabelGraphics(labelOptions(type, editedStyle))`;
const annotationExplanation = () => `【类型】文字标注、emoji图标、点与标签组合，全部贴地显示。
【样式】顶部设置只影响新标注。已有标注通过地图点击或列表编辑按钮修改内容、字号和颜色。
【一致性】图标保存实际emoji；列表、地图与编辑框共享同一份样式。空内容、过长内容、无效字号和颜色会被拒绝。
【操作】停止添加后仍可编辑已有标注；定位会暂停添加；清除会同时关闭编辑框。切换页面销毁事件处理器，最多200个标注。
【图标】使用系统字体中的emoji，不需要下载外部图标；显示外观随系统字体而异。`;
const { code, explanation } = useCodeExplain({ text: annotationCode, icon: annotationCode, 'point-label': annotationCode },
  { text: annotationExplanation, icon: annotationExplanation, 'point-label': annotationExplanation }, activeFeature);
</script>

<template>
  <div class="flex h-full flex-col gap-3 p-4">
    <div class="flex flex-wrap items-center gap-2">
      <n-button v-for="type in annoTypes" :key="type.key" size="small" :disabled="!ready"
        :type="picking && activeFeature === type.key ? 'primary' : 'default'" @click="selectType(type.key)">{{ type.label }}</n-button>
      <n-button size="small" :disabled="!picking" @click="stopAdding">停止添加</n-button>
      <n-button size="small" quaternary @click="applyClear">清除</n-button>
    </div>
    <div class="flex flex-wrap items-center gap-2 rounded border bg-gray-50 p-2 text-xs">
      <span>{{ activeFeature === 'icon' ? '图标' : '文字' }}</span>
      <n-input v-if="activeFeature === 'icon'" v-model:value="iconEmoji" placeholder="图标或emoji" size="small" style="width: 125px" />
      <n-input v-else v-model:value="annotationText" placeholder="新标注文字" size="small" style="width: 150px" />
      <span>字号</span><n-input-number v-model:value="fontSize" :min="10" :max="48" size="small" style="width: 95px" />
      <span>字色</span><n-color-picker v-model:value="fontColor" :modes="['hex']" size="small" style="width: 100px" />
      <span>背景</span><n-color-picker v-model:value="bgColor" :modes="['hex']" size="small" style="width: 100px" />
      <span class="text-gray-500">此处设置仅用于新标注</span>
    </div>
    <SplitViewer title="标注工具" :code="code" :explanation="explanation" storage-key="annotation-split">
      <template #scene-overlay>
        <div class="absolute left-3 top-3 z-10 max-w-[80%] rounded bg-black/70 px-3 py-2 text-xs text-white">
          <div>{{ statusText }}</div><div class="mt-1 text-white/70">{{ terrainNote }}</div>
        </div>
      </template>
      <template #bottom-panel>
        <div class="max-h-[40vh] shrink-0 overflow-auto border-t bg-gray-50 p-3 text-xs">
          <b>标注列表 · {{ annotationItems.length }} 个</b>
          <div v-for="item in annotationItems" :key="item.id" class="mt-2 flex flex-wrap items-center gap-2 rounded border bg-white p-2">
            <span class="flex-1 break-all">#{{ item.id }} {{ item.style.text }}</span>
            <n-button size="tiny" @click="openEditModal(item)">编辑</n-button>
            <n-button size="tiny" @click="flyToItem(item)">定位</n-button>
            <n-button size="tiny" type="error" quaternary @click="removeItem(item)">删除</n-button>
          </div>
        </div>
      </template>
    </SplitViewer>
    <n-modal v-model:show="showEditModal" preset="dialog" title="编辑标注内容和样式" :show-icon="false"
      positive-text="保存" negative-text="取消" @positive-click="saveEdit" @negative-click="cancelEdit" @after-leave="onEditClosed">
      <div class="space-y-3 py-2">
        <n-input v-model:value="editForm.text" placeholder="标注内容" :maxlength="240" />
        <div class="flex items-center gap-2"><span>字号</span><n-input-number v-model:value="editForm.fontSize" :min="10" :max="48" size="small" /></div>
        <div class="flex items-center gap-2"><span>字色</span><n-color-picker v-model:value="editForm.color" :modes="['hex']" size="small" /></div>
        <div class="flex items-center gap-2"><span>背景</span><n-color-picker v-model:value="editForm.background" :modes="['hex']" size="small" /></div>
        <div class="text-xs text-gray-500">内容须为1–120个字符。图标标注编辑实际emoji内容。</div>
      </div>
    </n-modal>
  </div>
</template>

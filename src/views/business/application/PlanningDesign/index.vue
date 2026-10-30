<script setup lang="ts">
import { useRouter, useRoute } from 'vue-router';
import { computed } from 'vue';
import {
  NavigateOutline as PathIcon,
  GridOutline as ZoneIcon,
  LocationOutline as SiteIcon,
  CubeOutline as EarthworkIcon,
} from '@vicons/ionicons5';
import { h } from 'vue';
import { NIcon } from 'naive-ui';

const router = useRouter();
const route = useRoute();

const isIndexPage = computed(() => route.name === 'planning-design');

const features = [
  {
    key: 'path-planning',
    title: '路径规划',
    desc: '按航点顺序生成规划连线，计算椭球面距离和指定速度下的参考时间',
    icon: PathIcon,
    color: '#18a058',
  },
  {
    key: 'zone-division',
    title: '区域划分',
    desc: '多边形绘制划分区域，自动编号与面积统计，多区域对比展示',
    icon: ZoneIcon,
    color: '#2080f0',
  },
  {
    key: 'site-selection',
    title: '选址分析',
    desc: '人工录入调查评分，按可调因子权重计算综合得分与适宜性排名',
    icon: SiteIcon,
    color: '#f0a020',
  },
  {
    key: 'earthwork',
    title: '土方计算',
    desc: '设计面与原地形高程对比，网格法计算挖填方量，土方平衡分析',
    icon: EarthworkIcon,
    color: '#d03050',
  },
];

function goTo(key: string) {
  router.push({ name: key });
}
</script>

<template>
  <router-view v-if="!isIndexPage" />

  <div v-else class="h-full overflow-auto p-6">
    <div class="mb-6">
      <h1 class="text-2xl font-bold text-gray-800">规划设计类</h1>
      <p class="mt-2 text-sm text-gray-500">
        基于 Cesium 空间计算、地形分析和几何算法实现的规划设计辅助功能集合
      </p>
    </div>

    <div class="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      <div
        v-for="item in features"
        :key="item.key"
        class="group cursor-pointer rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition-all hover:-translate-y-1 hover:shadow-lg"
        @click="goTo(item.key)"
      >
        <div class="flex items-center gap-3">
          <div
            class="flex h-12 w-12 items-center justify-center rounded-lg"
            :style="{ backgroundColor: item.color + '15' }"
          >
            <n-icon :size="24" :color="item.color">
              <component :is="item.icon" />
            </n-icon>
          </div>
          <h3 class="text-lg font-semibold text-gray-800 group-hover:text-blue-600">
            {{ item.title }}
          </h3>
        </div>
        <p class="mt-3 text-sm leading-relaxed text-gray-500">
          {{ item.desc }}
        </p>
        <div class="mt-4 flex items-center text-sm font-medium text-blue-500 opacity-0 transition-opacity group-hover:opacity-100">
          点击进入 →
        </div>
      </div>
    </div>
  </div>
</template>

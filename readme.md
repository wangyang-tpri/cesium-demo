# Cesium 核心 API 与应用示例

基于 **Vue 3 + TypeScript + Vite + CesiumJS** 的三维地图教学项目，使用 Naive UI、UnoCSS 构建界面，使用 ECharts 展示分析曲线。

项目包含 **38 个功能页面**，按「基础 / 进阶 / 应用」组织。页面提供可交互的三维场景、操作面板，以及示例代码与原理讲解，适合学习 Cesium API 和空间分析的实现方式。

## 快速开始

建议使用 **Node.js 24 LTS** 和 npm，并在支持 WebGL 的现代浏览器中访问。

```bash
npm install
npm run dev
```

### 常用命令

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 启动开发服务 |
| `npm run type-check` | 检查 TypeScript 与 Vue 类型 |
| `npm run build` | 类型检查通过后生成生产构建 |
| `npm run build-only` | 仅生成生产构建，不执行类型检查 |
| `npm run preview` | 本地预览 `dist/` 构建产物 |
| `node --test` | 运行自动化回归测试 |

## 功能总览

### 基础（10 页）

| 页面 | 主要内容 |
| --- | --- |
| Viewer 入门 | Viewer 创建、UI 控件、光照、大气与星空 |
| 相机 Camera | setView、flyTo、lookAt、flyToBoundingSphere、状态读取 |
| 影像与地形 | 影像源切换、图层叠加与透明度、Cesium World Terrain |
| 实体 Entity | Point、Label、Billboard、Polyline、Polygon、Wall、Box、Ellipsoid、Corridor |
| 坐标系与转换 | 经纬度、Cartesian3、Cartographic、屏幕坐标转换与距离计算 |
| 材质 Material | Color、Stripe、Checkerboard、Grid、Image、Glow、Arrow、Dash |
| 事件与拾取 | ScreenSpaceEventHandler、scene.pick、深度拾取、双击飞行 |
| 时钟与时间轴 | Clock、动画控件、倍速、CallbackProperty 动态实体 |
| 图元 Primitive | GeometryInstance 批量渲染、Entity 与 Primitive 对比 |
| 标注与广告牌 | Label 样式、Billboard、PinBuilder、集合批量管理 |

### 进阶（8 页）

| 页面 | 主要内容 |
| --- | --- |
| 3D Tiles 加载 | Cesium3DTileset、Cesium OSM Buildings、样式化与属性查询 |
| glTF 模型 | Model.fromGltfAsync、Entity.model、动画、节点与矩阵变换 |
| 粒子系统 | ParticleSystem：火焰、喷泉、降雨与降雪 |
| 后期处理 | PostProcessStage：模糊、描边、夜视、黑白与自定义效果 |
| 深度拾取 | scene.pick、pickPosition、pickEllipsoid、drillPick |
| 空间数据加载 | GeoJSON、KML、CZML 与时间动态数据 |
| 动态效果 | CallbackProperty：流动光点、扩散波纹、动态箭头与扫描圈 |
| 自定义着色器 | CustomShader：变色、渐变、顶点波动与剖面裁剪 |

### 应用：场景应用（3 页）

| 页面 | 主要内容 |
| --- | --- |
| 飞行漫游 | SampledPositionProperty 与 Clock 驱动飞行，支持开始、暂停、继续、倍速、循环与重置 |
| 三维量测 | 距离累加、局部切平面投影面积计算 |
| 轨迹模拟 | 位置采样、VelocityOrientationProperty、时间轴联动 |

### 应用：空间分析类（5 页）

| 页面 | 主要内容 |
| --- | --- |
| 通视分析 | 沿视线采样地形，对比三维直线高度，标出可视段、遮挡段与首个遮挡位置 |
| 剖面分析 | 沿测地线采样地形，展示高程曲线、统计信息与图表悬停定位 |
| 缓冲区分析 | 点、线缓冲区绘制与半径调整 |
| 可视域分析 | 径向地形采样与地平线角度判断，显示可视、不可视区域及面积统计 |
| 淹没分析 | 局部地形网格采样，按水位裁切网格，展示淹没范围与面积 |

### 应用：规划设计类（4 页）

| 页面 | 主要内容 |
| --- | --- |
| 路径规划 | 按途经点顺序连接测地线路径，支持追加、撤销与路线统计 |
| 区域划分 | 多边形绘制、几何校验、面积与周长统计、定位与删除 |
| 选址分析 | 录入候选点因子评分，调整权重并归一化，计算综合评分与排名 |
| 土方计算 | 对区域进行网格采样与边界裁切，按设计高程分别计算挖方和填方 |

### 应用：交互工具类（4 页）

| 页面 | 主要内容 |
| --- | --- |
| 坐标拾取 | 地面或场景拾取，展示经纬度、椭球高、ECEF 与屏幕坐标，支持复制、定位与记录管理 |
| 图元绘制 | 点、折线、多边形、圆与矩形，支持预览、撤销、完成、定位与删除 |
| 标注工具 | 多类型标注，支持文字、字号、颜色编辑与地图点选编辑 |
| 图层切换 | 天地图影像、矢量与地形晕渲底图，独立注记、不透明度、真实地形开关与重置 |

### 应用：行业应用类（4 页）

| 页面 | 示例场景 |
| --- | --- |
| 智慧城市 | 城市三维可视化 |
| 水利监测 | 水利设施与监测展示 |
| 电力巡检 | 电力设施与巡检展示 |
| 应急指挥 | 应急场景与指挥展示 |

行业页面用于演示交互和可视化，接入实际业务时需替换示例数据与服务。


## 地图资源与配置

### 底图与访问令牌

默认底图为天地图矢量及注记，部分页面使用影像底图。统一配置位于 `src/utils/tianditu.ts`，部署时将 `TIANDITU_TK` 替换为自己的天地图访问令牌。公共 Viewer 封装也支持 Esri、OpenStreetMap、自定义影像图层或无底图模式。

Cesium World Terrain、OSM Buildings 等资源通过 Cesium ion 加载。当前未设置自有 ion 令牌，使用 CesiumJS 内置的默认评估令牌。需要自有令牌时，在 `src/main.ts` 创建应用前配置：

```ts
import * as Cesium from 'cesium';

Cesium.Ion.defaultAccessToken = '你的 Cesium ion 访问令牌';
```

在线影像、地形与部分模型依赖外部服务。出现空白底图或资源加载失败时，应检查网络、令牌权限与资源请求结果。天地图的「地形」底图是二维晕渲影像，三维地形由独立的地形提供器控制。

### Cesium 静态资源与部署

`vite.config.ts` 通过 `vite-plugin-static-copy` 将 Cesium 的 `Workers`、`ThirdParty`、`Assets`、`Widgets` 复制到 `dist/cesium/`，并注入 `CESIUM_BASE_URL = '/cesium/'`。`src/main.ts` 同时设置开发模式所需的全局资源路径，并引入 Cesium 控件样式。

构建后通过 HTTP 服务部署完整的 `dist/` 目录，确保 `/cesium/` 下的资源可访问。当前配置按站点根目录部署；若部署到子目录，需要同步调整 Vite 的 `base`、构建时和开发时的 Cesium 资源路径。Hash 路由无需为每个页面配置服务端路由回退。

## 项目结构

```text
├── router/index.ts                     # Hash 路由与页面层级
├── vite.config.ts                      # Vue、UnoCSS 与 Cesium 静态资源配置
└── src/
    ├── main.ts                         # 应用入口与 Cesium 资源路径
    ├── App.vue                         # 主布局
    ├── components/base/
    │   ├── SplitViewer.vue             # 地图、加载状态与教学面板布局
    │   └── CodePanel.vue               # 代码与原理讲解
    ├── hooks/
    │   ├── useCesiumViewer.ts          # 地形准备、Viewer 生命周期与尺寸同步
    │   ├── useSpatialAnalysis.ts       # 拾取、分析任务取消与图形资源管理
    │   ├── usePlanningDrawing.ts       # 规划绘制、撤销与完成操作
    │   ├── useLayerControls.ts         # 底图、注记、不透明度与地形切换
    │   └── useCodeExplain.ts           # 教学面板联动
    ├── utils/
    │   ├── tianditu.ts                 # 天地图 WMTS 图层与令牌
    │   ├── mapInteraction.ts           # 坐标拾取、绘制几何与标注校验
    │   ├── spatialAnalysis.ts          # 地形采样与空间分析辅助方法
    │   └── planningGeometry.ts         # 多边形校验、三角剖分与土方积分
    └── views/
        ├── base/NavBar/                # 菜单导航
        └── business/
            ├── basics/                # 基础：10 页
            ├── forward/               # 进阶：8 页
            └── application/
                ├── Flight/            # 飞行漫游
                ├── Measure/           # 三维量测
                ├── Trajectory/        # 轨迹模拟
                ├── SceneApplication/  # 场景应用分组容器
                ├── SpatialAnalysis/   # 空间分析：5 页
                ├── PlanningDesign/    # 规划设计：4 页
                ├── InteractionTools/  # 交互工具：4 页
                └── IndustryApplication/ # 行业应用：4 页
```

## 技术栈

以下为 `package.json` 中的主要依赖版本范围：

- CesiumJS `^1.145.0`
- Vue `^3.5.42`、Vue Router `^5.3.1`、Pinia `^4.0.3`
- Naive UI `^2.45.3`、UnoCSS `^66.10.0`
- ECharts `^6.1.0`、Vue ECharts `^8.3.0`
- Vite `^8.2.2`、TypeScript `~6.0.0`

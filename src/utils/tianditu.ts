import * as Cesium from 'cesium';

/** 天地图 token */
export const TIANDITU_TK = '0535f2c5cd7ce3bca910dec94c28e054';

/** 天地图子域名（负载均衡） */
const TIANDITU_SUBDOMAINS = ['0', '1', '2', '3', '4', '5', '6', '7'];

/**
 * 构建天地图 WMTS 影像 Provider
 * @param layer 图层类型：vec/img/ter 底图，以及 cva/cia/cta 对应注记
 * @returns WebMapTileServiceImageryProvider
 */
function createTiandituProvider(layer: 'vec' | 'img' | 'ter' | 'cva' | 'cia' | 'cta') {
  return new Cesium.WebMapTileServiceImageryProvider({
    url: `https://t{s}.tianditu.gov.cn/${layer}_w/wmts?service=wmts&request=GetTile&version=1.0.0&LAYER=${layer}&tileMatrixSet=w&TileMatrix={TileMatrix}&TileRow={TileRow}&TileCol={TileCol}&style=default&format=tiles&tk=${TIANDITU_TK}`,
    subdomains: TIANDITU_SUBDOMAINS,
    layer,
    style: 'default',
    format: 'tiles',
    tileMatrixSetID: 'w',
    tilingScheme: new Cesium.WebMercatorTilingScheme(),
    minimumLevel: 1,
    maximumLevel: layer === 'ter' || layer === 'cta' ? 14 : 18,
    credit: '© 天地图',
  });
}

export function createTiandituLayers(type: 'img' | 'vec' | 'ter'): Cesium.ImageryLayer[] {
  const labels = { img: 'cia', vec: 'cva', ter: 'cta' } as const;
  return [new Cesium.ImageryLayer(createTiandituProvider(type)), new Cesium.ImageryLayer(createTiandituProvider(labels[type]))];
}

/**
 * 天地图矢量街道底图（含注记）
 * 底图 + 注记两层叠加
 */
export function createTiandituVecLayers(): Cesium.ImageryLayer[] {
  const base = new Cesium.ImageryLayer(createTiandituProvider('vec'));
  const label = new Cesium.ImageryLayer(createTiandituProvider('cva'));
  return [base, label];
}

/**
 * 天地图影像底图（含注记）
 * 底图 + 注记两层叠加
 */
export function createTiandituImgLayers(): Cesium.ImageryLayer[] {
  const base = new Cesium.ImageryLayer(createTiandituProvider('img'));
  const label = new Cesium.ImageryLayer(createTiandituProvider('cia'));
  return [base, label];
}

/**
 * 天地图矢量街道 Provider（单层，用于叠加等场景）
 */
export function createTiandituVecProvider() {
  return createTiandituProvider('vec');
}

/**
 * 天地图影像 Provider（单层，用于叠加等场景）
 */
export function createTiandituImgProvider() {
  return createTiandituProvider('img');
}

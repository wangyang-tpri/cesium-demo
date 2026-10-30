import * as Cesium from 'cesium';

export type PickSource = 'scene' | 'terrain' | 'ellipsoid';
export type PickMode = 'ground' | 'scene';

export function pickedEntityId(picked: unknown): string | undefined {
  if (!picked || typeof picked !== 'object' || !('id' in picked)) return;
  const id: unknown = picked.id;
  if (typeof id === 'string') return id;
  if (id && typeof id === 'object' && 'id' in id && typeof id.id === 'string') return id.id;
}

/** Depth picking is optional; drawing and tool-owned labels must not block ground picks. */
export function pickMapPosition(viewer: Cesium.Viewer, pixel: Cesium.Cartesian2,
  mode: PickMode = 'ground', ignored = new Set<string>()) {
  const { scene, camera } = viewer;
  if (mode === 'scene' && scene.pickPositionSupported) {
    try {
      const id = pickedEntityId(scene.pick(pixel));
      if (!id || !ignored.has(id)) {
        const position = scene.pickPosition(pixel);
        if (position) return { position: Cesium.Cartesian3.clone(position), source: 'scene' as PickSource };
      }
    } catch { /* A missing depth buffer must not break the ground fallback. */ }
  }
  const ray = camera.getPickRay(pixel);
  const ground = ray && scene.globe.pick(ray, scene);
  const ellipsoid = viewer.terrainProvider instanceof Cesium.EllipsoidTerrainProvider;
  if (ground) return { position: Cesium.Cartesian3.clone(ground), source: (ellipsoid ? 'ellipsoid' : 'terrain') as PickSource };
  // A real terrain provider must never silently fall back to a zero-height surface.
  const position = ellipsoid ? camera.pickEllipsoid(pixel, scene.globe.ellipsoid) : undefined;
  if (position) return { position: Cesium.Cartesian3.clone(position), source: 'ellipsoid' as PickSource };
}

export function surfaceRadius(center: Cesium.Cartesian3, edge: Cesium.Cartesian3) {
  const radius = new Cesium.EllipsoidGeodesic(Cesium.Cartographic.fromCartesian(center), Cesium.Cartographic.fromCartesian(edge)).surfaceDistance;
  if (!Number.isFinite(radius) || radius < 1 || radius > 25000) throw new Error('圆半径须在 1 米到 25 公里之间');
  return radius;
}

export function drawingRectangle(a: Cesium.Cartesian3, b: Cesium.Cartesian3) {
  const rectangle = Cesium.Rectangle.fromCartographicArray([Cesium.Cartographic.fromCartesian(a), Cesium.Cartographic.fromCartesian(b)]);
  const horizontal = new Cesium.EllipsoidGeodesic(new Cesium.Cartographic(rectangle.west, rectangle.south),
    new Cesium.Cartographic(rectangle.east, rectangle.south)).surfaceDistance;
  const vertical = new Cesium.EllipsoidGeodesic(new Cesium.Cartographic(rectangle.west, rectangle.south),
    new Cesium.Cartographic(rectangle.west, rectangle.north)).surfaceDistance;
  if (![horizontal, vertical].every(value => Number.isFinite(value) && value >= 1 && value <= 50000)) {
    throw new Error('矩形两边长度须在 1 米到 50 公里之间');
  }
  return rectangle;
}

export interface AnnotationStyle { text: string; fontSize: number; color: string; background: string }
export function annotationStyle(input: { text: string; fontSize: number | null; color: string; background: string }): AnnotationStyle {
  const text = input.text.trim();
  if (!text || Array.from(text).length > 120) throw new Error('标注内容须为 1–120 个字符');
  if (input.fontSize === null || !Number.isFinite(input.fontSize) || input.fontSize < 10 || input.fontSize > 48) {
    throw new Error('字号须在 10–48 之间');
  }
  if (!Cesium.Color.fromCssColorString(input.color) || !Cesium.Color.fromCssColorString(input.background)) {
    throw new Error('请选择有效的文字色和背景色');
  }
  return { ...input, text, fontSize: input.fontSize };
}

import * as Cesium from 'cesium';

/** Never substitute missing terrain data with zero: it creates false results. */
export async function sampleHeights(provider: Cesium.TerrainProvider, positions: Cesium.Cartographic[]) {
  const copies = positions.map(p => Cesium.Cartographic.clone(p));
  if (provider instanceof Cesium.EllipsoidTerrainProvider) {
    copies.forEach(p => { p.height = 0; });
    return copies;
  }
  const result = provider.availability
    ? await Cesium.sampleTerrainMostDetailed(provider, copies)
    : await Cesium.sampleTerrain(provider, 12, copies);
  if (result.some(p => !Number.isFinite(p.height))) {
    throw new Error('部分位置没有地形高程，请缩小范围或更换区域重试');
  }
  return result;
}

export function localPoint(center: Cesium.Cartesian3, east: number, north: number) {
  return Cesium.Cartographic.fromCartesian(Cesium.Matrix4.multiplyByPoint(
    Cesium.Transforms.eastNorthUpToFixedFrame(center),
    new Cesium.Cartesian3(east, north, 0), new Cesium.Cartesian3(),
  ));
}

export function buildProfile(points: Cesium.Cartesian3[], spacing = 100) {
  const positions: Cesium.Cartographic[] = [];
  const distances: number[] = [];
  const segments = points.slice(1).map((p, i) => new Cesium.EllipsoidGeodesic(
    Cesium.Cartographic.fromCartesian(points[i]), Cesium.Cartographic.fromCartesian(p),
  ));
  const total = segments.reduce((sum, segment) => sum + segment.surfaceDistance, 0);
  const step = Math.max(spacing, total / 2000);
  let cumulative = 0;
  for (const segment of segments) {
    const count = Math.max(1, Math.ceil(segment.surfaceDistance / step));
    for (let i = 0; i < count; i++) {
      positions.push(segment.interpolateUsingFraction(i / count));
      distances.push(cumulative + segment.surfaceDistance * i / count);
    }
    cumulative += segment.surfaceDistance;
  }
  positions.push(Cesium.Cartographic.fromCartesian(points[points.length - 1]));
  distances.push(cumulative);
  return { positions, distances, total };
}

export function sightSamples(observer: Cesium.Cartesian3, target: Cesium.Cartesian3, count = 256) {
  return Array.from({ length: count + 1 }, (_, i) => Cesium.Cartographic.fromCartesian(
    Cesium.Cartesian3.lerp(observer, target, i / count, new Cesium.Cartesian3()),
  ));
}

export function firstObstruction(line: Cesium.Cartographic[], ground: Cesium.Cartographic[], tolerance = 0.1) {
  // Ignore endpoints, which are explicitly raised above the terrain.
  return line.findIndex((p, i) => i > 0 && i < line.length - 1 && ground[i].height > p.height + tolerance);
}

/** Terrain targets can become visible again beyond a ridge: retain the horizon. */
export function visibilityAlongRay(observer: Cesium.Cartesian3, terrain: Cesium.Cartographic[]) {
  const inverse = Cesium.Matrix4.inverseTransformation(
    Cesium.Transforms.eastNorthUpToFixedFrame(observer), new Cesium.Matrix4(),
  );
  let horizon = -Infinity;
  return terrain.map(p => {
    const local = Cesium.Matrix4.multiplyByPoint(inverse, Cesium.Cartographic.toCartesian(p), new Cesium.Cartesian3());
    const angle = Math.atan2(local.z, Math.hypot(local.x, local.y));
    const visible = angle >= horizon - 1e-7;
    horizon = Math.max(horizon, angle);
    return visible;
  });
}

export interface FloodVertex { x: number; y: number; height: number }

/** Clip a terrain triangle to the water elevation, retaining partial cells. */
export function clipFloodTriangle(vertices: FloodVertex[], level: number): FloodVertex[] {
  const output: FloodVertex[] = [];
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i];
    const b = vertices[(i + 1) % vertices.length];
    const insideA = a.height < level;
    const insideB = b.height < level;
    if (insideA) output.push(a);
    if (insideA !== insideB) {
      const t = (level - a.height) / (b.height - a.height);
      output.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, height: level });
    }
  }
  return output;
}

export function polygonArea(vertices: { x: number; y: number }[]) {
  return Math.abs(vertices.reduce((sum, a, i) => {
    const b = vertices[(i + 1) % vertices.length];
    return sum + a.x * b.y - b.x * a.y;
  }, 0)) / 2;
}

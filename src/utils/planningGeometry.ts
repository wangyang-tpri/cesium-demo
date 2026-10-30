import * as Cesium from 'cesium';
import { clipFloodTriangle, polygonArea, type FloodVertex } from './spatialAnalysis';

export interface XY { x: number; y: number }
const cross = (a: XY, b: XY, c: XY) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
const near = (a: XY, b: XY) => Math.hypot(a.x - b.x, a.y - b.y) < 0.01;

function intersects(a: XY, b: XY, c: XY, d: XY) {
  const on = (p: XY, q: XY, r: XY) => Math.abs(cross(p, q, r)) < 1e-6 &&
    r.x >= Math.min(p.x, q.x) - 1e-6 && r.x <= Math.max(p.x, q.x) + 1e-6 &&
    r.y >= Math.min(p.y, q.y) - 1e-6 && r.y <= Math.max(p.y, q.y) + 1e-6;
  return (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) ||
    on(a, b, c) || on(a, b, d) || on(c, d, a) || on(c, d, b);
}

export function validateRing(vertices: XY[]) {
  if (vertices.length < 3) throw new Error('至少需要 3 个顶点');
  for (let i = 0; i < vertices.length; i++) {
    if (!Number.isFinite(vertices[i].x) || !Number.isFinite(vertices[i].y)) throw new Error('顶点坐标无效');
    for (let j = i + 1; j < vertices.length; j++) {
      if (near(vertices[i], vertices[j])) throw new Error('多边形存在重复顶点，请撤销后重绘');
    }
  }
  for (let i = 0; i < vertices.length; i++) {
    for (let j = i + 1; j < vertices.length; j++) {
      if (j === i + 1 || (i === 0 && j === vertices.length - 1)) continue;
      if (intersects(vertices[i], vertices[(i + 1) % vertices.length], vertices[j], vertices[(j + 1) % vertices.length])) {
        throw new Error('多边形边界自交或相互接触，请撤销交叉顶点');
      }
    }
    if (Math.abs(cross(vertices[(i + vertices.length - 1) % vertices.length], vertices[i], vertices[(i + 1) % vertices.length])) < 1e-6) {
      throw new Error('存在共线顶点，请撤销后调整位置');
    }
  }
  if (polygonArea(vertices) < 1) throw new Error('区域面积须至少为 1 平方米');
}

export function routeDistance(positions: Cesium.Cartesian3[]) {
  return positions.slice(1).reduce((sum, position, i) => sum + new Cesium.EllipsoidGeodesic(
    Cesium.Cartographic.fromCartesian(positions[i]), Cesium.Cartographic.fromCartesian(position),
  ).surfaceDistance, 0);
}

/** Ear clipping for validated simple rings; Cesium's internal PolygonPipeline has no public types. */
export function triangulateRing(vertices: XY[]): number[] {
  const signedArea = vertices.reduce((sum, p, i) => {
    const next = vertices[(i + 1) % vertices.length];
    return sum + p.x * next.y - next.x * p.y;
  }, 0);
  const orientation = signedArea > 0 ? 1 : -1;
  const remaining = vertices.map((_, i) => i);
  const triangles: number[] = [];
  while (remaining.length > 3) {
    let clipped = false;
    for (let i = 0; i < remaining.length; i++) {
      const a = remaining[(i + remaining.length - 1) % remaining.length];
      const b = remaining[i]; const c = remaining[(i + 1) % remaining.length];
      if (orientation * cross(vertices[a], vertices[b], vertices[c]) <= 1e-8) continue;
      const occupied = remaining.some(index => index !== a && index !== b && index !== c &&
        orientation * cross(vertices[a], vertices[b], vertices[index]) >= -1e-8 &&
        orientation * cross(vertices[b], vertices[c], vertices[index]) >= -1e-8 &&
        orientation * cross(vertices[c], vertices[a], vertices[index]) >= -1e-8);
      if (occupied) continue;
      triangles.push(a, b, c); remaining.splice(i, 1); clipped = true; break;
    }
    if (!clipped) throw new Error('区域无法完成三角剖分，请调整顶点');
  }
  if (remaining.length === 3) triangles.push(...remaining);
  return triangles;
}

export function planningPolygon(world: Cesium.Cartesian3[]) {
  if (world.length < 3) throw new Error('至少需要 3 个顶点');
  // Discard picked heights: design areas use a common horizontal reference.
  const positions = world.map(p => {
    const c = Cesium.Cartographic.fromCartesian(p);
    return Cesium.Cartesian3.fromRadians(c.longitude, c.latitude, 0);
  });
  const mean = positions.reduce((sum, p) => Cesium.Cartesian3.add(sum, p, sum), new Cesium.Cartesian3());
  Cesium.Cartesian3.divideByScalar(mean, positions.length, mean);
  const origin = Cesium.Ellipsoid.WGS84.scaleToGeodeticSurface(mean);
  if (!origin) throw new Error('区域跨度过大，请缩小范围');
  const frame = Cesium.Transforms.eastNorthUpToFixedFrame(origin);
  const inverse = Cesium.Matrix4.inverseTransformation(frame, new Cesium.Matrix4());
  const vertices = positions.map(p => {
    const local = Cesium.Matrix4.multiplyByPoint(inverse, p, new Cesium.Cartesian3());
    if (Cesium.Cartesian3.distance(p, origin) > 25000) throw new Error('局部规划区域半径不能超过 25 公里');
    return { x: local.x, y: local.y };
  });
  validateRing(vertices);
  const indices = triangulateRing(vertices);
  if (!indices.length) throw new Error('区域无法形成有效多边形');
  const toCartographic = (p: XY) => Cesium.Cartographic.fromCartesian(Cesium.Matrix4.multiplyByPoint(
    frame, new Cesium.Cartesian3(p.x, p.y, 0), new Cesium.Cartesian3(),
  ));
  const toWorld = (p: XY, height = 0) => {
    const c = toCartographic(p);
    return Cesium.Cartesian3.fromRadians(c.longitude, c.latitude, height);
  };
  // A triangle centroid stays inside concave polygons; the average of vertices may not.
  let anchor = vertices[0];
  let largest = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const triangle = indices.slice(i, i + 3).map(index => vertices[index]);
    const area = polygonArea(triangle);
    if (area > largest) {
      largest = area;
      anchor = { x: triangle.reduce((s, p) => s + p.x, 0) / 3, y: triangle.reduce((s, p) => s + p.y, 0) / 3 };
    }
  }
  return { positions, vertices, indices, toCartographic, toWorld, anchor: toWorld(anchor),
    area: polygonArea(vertices), perimeter: routeDistance([...positions, positions[0]]) };
}

export type PlanningPolygon = ReturnType<typeof planningPolygon>;

function clipRectangle(input: XY[], minX: number, minY: number, maxX: number, maxY: number) {
  let output = input;
  for (const [axis, boundary, sign] of [
    ['x', minX, 1], ['x', maxX, -1], ['y', minY, 1], ['y', maxY, -1],
  ] as const) {
    const previous = output; output = [];
    for (let i = 0; i < previous.length; i++) {
      const a = previous[i]; const b = previous[(i + 1) % previous.length];
      const insideA = sign * (a[axis] - boundary) >= -1e-8;
      const insideB = sign * (b[axis] - boundary) >= -1e-8;
      if (insideA) output.push(a);
      if (insideA !== insideB) {
        const t = (boundary - a[axis]) / (b[axis] - a[axis]);
        output.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      }
    }
  }
  return output.filter((p, i, all) => !near(p, all[(i + all.length - 1) % all.length]));
}

/** Clip every boundary cell, including concave regions; never count grid nodes as full cells. */
export function earthworkMesh(vertices: XY[], indices: number[], density: number) {
  if (!Number.isInteger(density) || density < 5 || density > 30) throw new Error('网格密度须为 5–30 的整数');
  const minX = Math.min(...vertices.map(p => p.x)); const maxX = Math.max(...vertices.map(p => p.x));
  const minY = Math.min(...vertices.map(p => p.y)); const maxY = Math.max(...vertices.map(p => p.y));
  const width = (maxX - minX) / density; const height = (maxY - minY) / density;
  const samples: XY[] = [];
  const sampleIndices = new Map<string, number>();
  const triangles: { indices: [number, number, number]; cell: number }[] = [];
  const sample = (p: XY) => {
    const key = p.x.toFixed(6) + ',' + p.y.toFixed(6);
    let index = sampleIndices.get(key);
    if (index === undefined) { index = samples.length; samples.push(p); sampleIndices.set(key, index); }
    return index;
  };
  for (let row = 0; row < density; row++) {
    for (let column = 0; column < density; column++) {
      for (let i = 0; i < indices.length; i += 3) {
        const clipped = clipRectangle(indices.slice(i, i + 3).map(index => vertices[index]),
          minX + column * width, minY + row * height, minX + (column + 1) * width, minY + (row + 1) * height);
        if (clipped.length < 3 || polygonArea(clipped) < 1e-6) continue;
        for (let j = 1; j < clipped.length - 1; j++) {
          const triangle = [clipped[0], clipped[j], clipped[j + 1]];
          if (polygonArea(triangle) > 1e-6) triangles.push({ indices: triangle.map(sample) as [number, number, number], cell: row * density + column });
        }
      }
    }
  }
  return { samples, triangles };
}

export function integrateEarthwork(vertices: FloodVertex[], design: number) {
  const cut = clipFloodTriangle(vertices.map(p => ({ ...p, height: -p.height })), -design).map(p => ({ ...p, height: -p.height }));
  const fill = clipFloodTriangle(vertices, design);
  const volume = (polygon: FloodVertex[], sign: number) => {
    let total = 0;
    for (let i = 1; i < polygon.length - 1; i++) {
      const triangle = [polygon[0], polygon[i], polygon[i + 1]];
      total += polygonArea(triangle) * triangle.reduce((sum, p) => sum + sign * (p.height - design), 0) / 3;
    }
    return Math.max(0, total);
  };
  return { cut, fill, cutVolume: volume(cut, 1), fillVolume: volume(fill, -1) };
}

export function weightedScore(scores: (number | null)[], weights: (number | null)[]) {
  if (scores.length !== weights.length || weights.some(w => w === null || !Number.isFinite(w) || w < 0 || w > 100)) return null;
  const total = weights.reduce<number>((sum, w) => sum + w!, 0);
  if (total <= 0 || scores.some((score, i) => weights[i]! > 0 && (score === null || !Number.isFinite(score) || score < 0 || score > 100))) return null;
  return scores.reduce<number>((sum, score, i) => sum + (weights[i]! > 0 ? score! * weights[i]! : 0), 0) / total;
}

import type { Fragment, Point } from './types';

export type MeshPoint = { source: Point; target: Point };
export type Triangle = [number, number, number];

// Центроид полигона кешируется по ссылке на массив: перетаскивание фрагмента
// сохраняет ссылку на полигон, поэтому O(n) считается один раз, а не на каждую точку за кадр.
const polygonCentroids = new WeakMap<Point[], Point>();

export const cloneFragments = (items: Fragment[]) => items.map((item) => ({
  ...item, polygon: item.polygon.map((p) => ({ ...p })),
  pairs: item.pairs.map((pair) => ({ source: { ...pair.source }, target: { ...pair.target } })),
}));

export const centroid = (poly: Point[]) => poly.reduce((v, p) => ({ x: v.x + p.x / poly.length, y: v.y + p.y / poly.length }), { x: 0, y: 0 });

export const cachedCentroid = (poly: Point[]) => {
  const cached = polygonCentroids.get(poly);
  if (cached) return cached;
  const center = centroid(poly);
  polygonCentroids.set(poly, center);
  return center;
};

export const expandPolygon = (points: Point[], by: number) => {
  const center = centroid(points);
  return points.map((point) => {
    const dx = point.x - center.x; const dy = point.y - center.y;
    const length = Math.hypot(dx, dy) || 1;
    return { x: point.x + (dx / length) * by, y: point.y + (dy / length) * by };
  });
};

export const sourceBBox = (points: Point[], padding: number, imageWidth: number, imageHeight: number) => {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  points.forEach((point) => {
    minX = Math.min(minX, point.x); minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x); maxY = Math.max(maxY, point.y);
  });
  const sx = Math.max(0, Math.floor(minX - padding));
  const sy = Math.max(0, Math.floor(minY - padding));
  const sw = Math.min(imageWidth, Math.ceil(maxX + padding)) - sx;
  const sh = Math.min(imageHeight, Math.ceil(maxY + padding)) - sy;
  return { sx, sy, sw: Math.max(0, sw), sh: Math.max(0, sh) };
};

export const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

export const pointInside = (point: Point, poly: Point[]) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]; const b = poly[j];
    if ((a.y > point.y) !== (b.y > point.y) && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
};

export const pointOnOrNearPolygon = (point: Point, poly: Point[], tolerance: number) => {
  if (pointInside(point, poly)) return true;
  return poly.some((a, index) => {
    const b = poly[(index + 1) % poly.length];
    const dx = b.x - a.x; const dy = b.y - a.y;
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared)) : 0;
    return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy)) <= tolerance;
  });
};

export const transformedPoint = (point: Point, fragment: Fragment) => {
  const center = cachedCentroid(fragment.polygon); const angle = fragment.rotation * Math.PI / 180;
  const x = point.x - center.x; const y = point.y - center.y;
  return { x: center.x + fragment.dx + x * Math.cos(angle) - y * Math.sin(angle), y: center.y + fragment.dy + x * Math.sin(angle) + y * Math.cos(angle) };
};

export const inverseFragmentPoint = (point: Point, fragment: Fragment) => {
  const center = cachedCentroid(fragment.polygon); const angle = -fragment.rotation * Math.PI / 180;
  const x = point.x - center.x - fragment.dx; const y = point.y - center.y - fragment.dy;
  return { x: center.x + x * Math.cos(angle) - y * Math.sin(angle), y: center.y + x * Math.sin(angle) + y * Math.cos(angle) };
};

export const circumcircle = (a: Point, b: Point, c: Point) => {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) < 1e-9) return { x: 0, y: 0, r2: -1 };
  const aa = a.x * a.x + a.y * a.y; const bb = b.x * b.x + b.y * b.y; const cc = c.x * c.x + c.y * c.y;
  const x = (aa * (b.y - c.y) + bb * (c.y - a.y) + cc * (a.y - b.y)) / d;
  const y = (aa * (c.x - b.x) + bb * (a.x - c.x) + cc * (b.x - a.x)) / d;
  return { x, y, r2: (x - a.x) ** 2 + (y - a.y) ** 2 };
};

export const triangulate = (points: Point[]): Triangle[] => {
  if (points.length < 3) return [];
  const xs = points.map((p) => p.x); const ys = points.map((p) => p.y);
  const minX = Math.min(...xs); const minY = Math.min(...ys); const maxX = Math.max(...xs); const maxY = Math.max(...ys);
  const delta = Math.max(maxX - minX, maxY - minY) * 10 + 1;
  const all = [...points, { x: minX - delta, y: minY - delta }, { x: minX + (maxX - minX) / 2, y: maxY + delta }, { x: maxX + delta, y: minY - delta }];
  const n = points.length; let triangles: Triangle[] = [[n, n + 1, n + 2]];
  for (let index = 0; index < n; index++) {
    const bad = triangles.filter((tri) => {
      const circle = circumcircle(all[tri[0]], all[tri[1]], all[tri[2]]);
      return circle.r2 >= 0 && (all[index].x - circle.x) ** 2 + (all[index].y - circle.y) ** 2 <= circle.r2 + 1e-6;
    });
    const edges: [number, number][] = [];
    bad.forEach((tri) => [[tri[0], tri[1]], [tri[1], tri[2]], [tri[2], tri[0]]].forEach((edge) => {
      const reverse = edges.findIndex((candidate) => candidate[0] === edge[1] && candidate[1] === edge[0]);
      if (reverse >= 0) edges.splice(reverse, 1); else edges.push(edge as [number, number]);
    }));
    triangles = triangles.filter((tri) => !bad.includes(tri));
    edges.forEach((edge) => triangles.push([edge[0], edge[1], index]));
  }
  return triangles.filter((tri) => tri.every((index) => index < n));
};

export const applyAffineTriangle = (ctx: CanvasRenderingContext2D, src: Point[], dst: Point[]) => {
  const [a, b, c] = src; const [u, v, w] = dst;
  const det = a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y);
  if (Math.abs(det) < 0.0001) return false;
  const m11 = (u.x * (b.y - c.y) + v.x * (c.y - a.y) + w.x * (a.y - b.y)) / det;
  const m12 = (u.y * (b.y - c.y) + v.y * (c.y - a.y) + w.y * (a.y - b.y)) / det;
  const m21 = (u.x * (c.x - b.x) + v.x * (a.x - c.x) + w.x * (b.x - a.x)) / det;
  const m22 = (u.y * (c.x - b.x) + v.y * (a.x - c.x) + w.y * (b.x - a.x)) / det;
  const dx = (u.x * (b.x * c.y - c.x * b.y) + v.x * (c.x * a.y - a.x * c.y) + w.x * (a.x * b.y - b.x * a.y)) / det;
  const dy = (u.y * (b.x * c.y - c.x * b.y) + v.y * (c.x * a.y - a.x * c.y) + w.y * (a.x * b.y - b.x * a.y)) / det;
  ctx.transform(m11, m12, m21, m22, dx, dy);
  return true;
};

import { describe, expect, it } from 'vitest';
import {
  applyAffineTriangle, cloneFragments, distance, inverseFragmentPoint,
  pointInside, pointOnOrNearPolygon, transformedPoint, triangulate,
} from './geometry';
import type { Fragment, Point } from './types';

const square = (): Point[] => [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];

const makeFragment = (overrides: Partial<Fragment> = {}): Fragment => ({
  id: 1, polygon: square(), dx: 0, dy: 0, rotation: 0, pairs: [], visible: true, ...overrides,
});

const triangleArea = (t: Point[]) =>
  Math.abs((t[1].x - t[0].x) * (t[2].y - t[0].y) - (t[2].x - t[0].x) * (t[1].y - t[0].y)) / 2;

const captureTransform = () => {
  const matrix = [1, 0, 0, 1, 0, 0];
  const ctx = {
    transform(a: number, b: number, c: number, d: number, e: number, f: number) {
      const [a0, b0, c0, d0, e0, f0] = matrix;
      matrix[0] = a0 * a + c0 * b; matrix[1] = b0 * a + d0 * b;
      matrix[2] = a0 * c + c0 * d; matrix[3] = b0 * c + d0 * d;
      matrix[4] = a0 * e + c0 * f + e0; matrix[5] = b0 * e + d0 * f + f0;
    },
  } as unknown as CanvasRenderingContext2D;
  return { ctx, matrix };
};

describe('applyAffineTriangle', () => {
  it('отображает src в dst для набора треугольников', () => {
    const cases: Point[][][] = [
      [[{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }], [{ x: 20, y: 30 }, { x: 40, y: 30 }, { x: 20, y: 50 }]],
      [[{ x: 1, y: 2 }, { x: 300, y: 4 }, { x: 5, y: 600 }], [{ x: -50, y: 12 }, { x: 80, y: 700 }, { x: 200, y: -30 }]],
      [[{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 25, y: 40 }], [{ x: 9, y: 9 }, { x: 9, y: 109 }, { x: 59, y: 9 }]],
    ];
    cases.forEach(([src, dst]) => {
      const { ctx, matrix } = captureTransform();
      expect(applyAffineTriangle(ctx, src, dst)).toBe(true);
      const [a, b, c, d, e, f] = matrix;
      src.forEach((point, index) => {
        const px = a * point.x + c * point.y + e;
        const py = b * point.x + d * point.y + f;
        expect(Math.hypot(px - dst[index].x, py - dst[index].y)).toBeLessThan(1e-8);
      });
    });
  });

  it('отклоняет вырожденный (коллинеарный) треугольник и не трогает трансформ', () => {
    const { ctx, matrix } = captureTransform();
    const ok = applyAffineTriangle(ctx, [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }], [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }]);
    expect(ok).toBe(false);
    expect(matrix).toEqual([1, 0, 0, 1, 0, 0]);
  });
});

describe('triangulate', () => {
  it('квадрат + центр даёт 4 треугольника', () => {
    const points = [...square(), { x: 50, y: 50 }];
    expect(triangulate(points)).toHaveLength(4);
  });

  it('дубль вершины даёт 2 треугольника без потери площади', () => {
    const points = [...square(), { x: 0, y: 0 }];
    const triangles = triangulate(points);
    expect(triangles).toHaveLength(2);
    const area = triangles.reduce((sum, tri) => sum + triangleArea(tri.map((index) => points[index])), 0);
    expect(area).toBeCloseTo(10000, 6);
  });

  it('точка на ребре покрывает полную площадь (10000 из 10000)', () => {
    const points = [...square(), { x: 50, y: 0 }];
    const triangles = triangulate(points);
    const area = triangles.reduce((sum, tri) => sum + triangleArea(tri.map((index) => points[index])), 0);
    expect(area).toBeCloseTo(10000, 6);
  });

  it('коллинеарные точки не порождают треугольников', () => {
    expect(triangulate([{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }])).toHaveLength(0);
  });
});

describe('pointInside / pointOnOrNearPolygon', () => {
  const poly = square();

  it('внутри', () => {
    expect(pointInside({ x: 5, y: 5 }, poly)).toBe(true);
  });

  it('снаружи', () => {
    expect(pointInside({ x: 150, y: 5 }, poly)).toBe(false);
    expect(pointOnOrNearPolygon({ x: 150, y: 5 }, poly, 1)).toBe(false);
    expect(pointOnOrNearPolygon({ x: 50, y: -20 }, poly, 1)).toBe(false);
  });

  it('на ребре ловится через допуск', () => {
    expect(pointOnOrNearPolygon({ x: 0, y: 5 }, poly, 1)).toBe(true);
    expect(pointOnOrNearPolygon({ x: 5, y: 0 }, poly, 1)).toBe(true);
  });

  it('вырожденный полигон не падает', () => {
    const degenerate = [{ x: 5, y: 5 }, { x: 5, y: 5 }, { x: 5, y: 5 }];
    expect(() => pointInside({ x: 0, y: 0 }, degenerate)).not.toThrow();
    expect(() => pointOnOrNearPolygon({ x: 0, y: 0 }, degenerate, 1)).not.toThrow();
  });
});

describe('transformedPoint / inverseFragmentPoint', () => {
  it('взаимно обратны при произвольных dx, dy, rotation', () => {
    let maxError = 0;
    for (let index = 0; index < 200; index++) {
      const fragment = makeFragment({
        dx: (Math.random() - 0.5) * 500,
        dy: (Math.random() - 0.5) * 500,
        rotation: (Math.random() - 0.5) * 720,
      });
      const point = { x: Math.random() * 2000 - 500, y: Math.random() * 2000 - 500 };
      const restored = inverseFragmentPoint(transformedPoint(point, fragment), fragment);
      maxError = Math.max(maxError, distance(restored, point));
    }
    expect(maxError).toBeLessThan(1e-6);
  });

  it('тождественное преобразование не двигает точку', () => {
    const fragment = makeFragment();
    const point = { x: 30, y: 40 };
    expect(transformedPoint(point, fragment)).toEqual(point);
  });
});

describe('cloneFragments', () => {
  it('глубоко копирует полигоны и пары', () => {
    const fragment = makeFragment({ pairs: [{ source: { x: 1, y: 2 }, target: { x: 3, y: 4 } }] });
    const [clone] = cloneFragments([fragment]);
    expect(clone).toEqual(fragment);
    expect(clone.polygon[0]).not.toBe(fragment.polygon[0]);
    expect(clone.pairs[0].source).not.toBe(fragment.pairs[0].source);
  });
});

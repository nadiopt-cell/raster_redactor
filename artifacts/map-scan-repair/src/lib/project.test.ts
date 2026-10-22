import { beforeEach, describe, expect, it } from 'vitest';
import { clearSession, loadSession, parseProject, saveSession, serializeProject } from './project';
import type { Fragment, Point } from './types';

// Vitest работает в среде node: даём минимальную заглушку Storage, чтобы проверить круг.save→load.
class MemoryStorage implements Storage {
  private store = new Map<string, string>();
  get length() { return this.store.size; }
  clear() { this.store.clear(); }
  getItem(key: string) { return this.store.get(key) ?? null; }
  key(index: number) { return [...this.store.keys()][index] ?? null; }
  removeItem(key: string) { this.store.delete(key); }
  setItem(key: string, value: string) { this.store.set(key, value); }
}

beforeEach(() => {
  (globalThis as unknown as { localStorage: Storage }).localStorage = new MemoryStorage();
});
const fragment = (id: number, dx = 5): Fragment => ({
  id,
  polygon: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 80 }],
  dx, dy: 3, rotation: 12,
  pairs: [{ source: { x: 30, y: 30 }, target: { x: 35, y: 33 } }],
  visible: true,
});

const projectJson = (name: string, width: number, height: number) =>
  JSON.stringify(serializeProject(name, width, height, [fragment(1), fragment(2, -5)], 3));

describe('serializeProject / parseProject', () => {
  it('полный круг: сериализация и разбор возвращают равный проект', () => {
    const project = parseProject(projectJson('скан.jpg', 3000, 2000));
    expect(project).not.toBeNull();
    expect(project?.name).toBe('скан.jpg');
    expect(project?.width).toBe(3000);
    expect(project?.height).toBe(2000);
    expect(project?.fragments).toEqual([fragment(1), fragment(2, -5)]);
    expect(project?.nextId).toBe(3);
  });

  it('nextId не может упасть ниже id существующих фрагментов', () => {
    const project = serializeProject('скан.jpg', 1000, 1000, [fragment(7)], 2);
    expect(project.nextId).toBe(8);
  });

  it('чужой или повреждённый JSON разбирается в null', () => {
    expect(parseProject('{"kind":"чужой"}')).toBeNull();
    expect(parseProject('не json')).toBeNull();
    expect(parseProject('{"kind":"map-scan-repair-project"}')).toBeNull();
  });

  it('фрагмент с кривыми точками отвергается целиком', () => {
    const data = JSON.parse(projectJson('скан.jpg', 3000, 2000));
    data.fragments[0].polygon = [{ x: 0, y: 0 }, { x: 10, y: 10 }];
    expect(parseProject(JSON.stringify(data))).toBeNull();
  });

  it('мусор в координатах (NaN уже потерян, Infinity сериализуется) отвергается', () => {
    const data = JSON.parse(projectJson('скан.jpg', 3000, 2000));
    data.fragments[1].pairs[0].source.x = 'NaN' as unknown as number;
    expect(parseProject(JSON.stringify(data))).toBeNull();
  });
});

describe('сеанс в localStorage', () => {
  it('сохранённый сеанс читается обратно и чистится', () => {
    saveSession('скан.jpg', 3000, 2000, [fragment(1)], 2);
    const session = loadSession('скан.jpg', 3000, 2000);
    expect(session?.fragments).toEqual([fragment(1)]);
    clearSession('скан.jpg', 3000, 2000);
    expect(loadSession('скан.jpg', 3000, 2000)).toBeNull();
  });

  it('по другому размеру того же имени сеанс не находится', () => {
    saveSession('скан.jpg', 3000, 2000, [fragment(1)], 2);
    expect(loadSession('скан.jpg', 3000, 2100)).toBeNull();
  });
});

describe('типы: Point не входит в сериализацию, но нужен для fragment()', () => {
  it('проверка вспомогательной константы', () => {
    const corner: Point = { x: 0, y: 0 };
    expect(corner.x).toBe(0);
  });
});

import { cloneFragments } from './geometry';
import type { Fragment, Point } from './types';

export const PROJECT_MAGIC = 'map-scan-repair-project';
export const PROJECT_FORMAT = 1;

/** Сериализуемый проект: контуры, опорные пары и счётчик id. Изображение в файл не входит —
 *  скан пользователь открывает отдельно, при восстановлении сверяем его по имени и размерам. */
export type ProjectFile = {
  kind: typeof PROJECT_MAGIC;
  format: number;
  name: string;
  width: number;
  height: number;
  nextId: number;
  fragments: Fragment[];
};

export const serializeProject = (
  name: string, width: number, height: number, fragments: Fragment[], nextId: number,
): ProjectFile => ({
  kind: PROJECT_MAGIC,
  format: PROJECT_FORMAT,
  name,
  width,
  height,
  nextId: [nextId, ...fragments.map((fragment) => fragment.id + 1)].reduce((value, candidate) => Math.max(value, candidate), 1),
  fragments: cloneFragments(fragments),
});

const isPoint = (value: unknown): value is Point =>
  !!value && typeof value === 'object'
  && typeof (value as Point).x === 'number' && Number.isFinite((value as Point).x)
  && typeof (value as Point).y === 'number' && Number.isFinite((value as Point).y);

const isFragment = (value: unknown): value is Fragment => {
  const fragment = value as Fragment;
  return !!fragment
    && typeof fragment.id === 'number'
    && Array.isArray(fragment.polygon)
    && fragment.polygon.length >= 3
    && fragment.polygon.every(isPoint)
    && typeof fragment.dx === 'number' && Number.isFinite(fragment.dx)
    && typeof fragment.dy === 'number' && Number.isFinite(fragment.dy)
    && typeof fragment.rotation === 'number' && Number.isFinite(fragment.rotation)
    && Array.isArray(fragment.pairs)
    && fragment.pairs.every((pair) => isPoint(pair.source) && isPoint(pair.target))
    && typeof fragment.visible === 'boolean';
};

export const parseProject = (raw: string): ProjectFile | null => {
  try {
    const data = JSON.parse(raw) as ProjectFile;
    if (data?.kind !== PROJECT_MAGIC || data?.format !== PROJECT_FORMAT) return null;
    if (typeof data.name !== 'string' || typeof data.width !== 'number' || typeof data.height !== 'number') return null;
    if (!Array.isArray(data.fragments) || !data.fragments.every(isFragment)) return null;
    return {
      kind: PROJECT_MAGIC,
      format: PROJECT_FORMAT,
      name: data.name,
      width: data.width,
      height: data.height,
      nextId: typeof data.nextId === 'number' && Number.isFinite(data.nextId) ? data.nextId : 1,
      fragments: cloneFragments(data.fragments),
    };
  } catch { return null; }
};

// --- автосохранение сеанса: ключ по имени и размеру документа, без вложения картинки ---
export const sessionKey = (name: string, width: number, height: number) =>
  `map-scan-repair:session:${name}:${width}x${height}`;

export const saveSession = (
  name: string, width: number, height: number, fragments: Fragment[], nextId: number,
) => {
  try {
    localStorage.setItem(sessionKey(name, width, height), JSON.stringify(serializeProject(name, width, height, fragments, nextId)));
  } catch { /* переполнение или приватный режим — сеанс просто не сохранится */ }
};

export const loadSession = (name: string, width: number, height: number): ProjectFile | null => {
  try {
    const raw = localStorage.getItem(sessionKey(name, width, height));
    return raw ? parseProject(raw) : null;
  } catch { return null; }
};

export const clearSession = (name: string, width: number, height: number) => {
  try { localStorage.removeItem(sessionKey(name, width, height)); } catch { /* хранилище недоступно */ }
};

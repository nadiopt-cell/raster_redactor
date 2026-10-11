export type Point = { x: number; y: number };
export type Pair = { source: Point; target: Point };
export type Fragment = { id: number; polygon: Point[]; dx: number; dy: number; rotation: number; pairs: Pair[]; visible: boolean };
export type DocumentImage = { image: HTMLImageElement; name: string; width: number; height: number };
export type Tool = 'select' | 'lasso' | 'points' | 'pan';
export type HistoryEntry = { fragments: Fragment[]; selectedId: number | null };

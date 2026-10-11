# Редактор сканов карт

Браузерный редактор для реставрации искажённых сканов карт: пользователь обводит повреждённые участки полигональным контуром, сдвигает и поворачивает их, сшивает по опорным точкам (треугольная сетка деформации) и экспортирует исправленный PNG в исходном разрешении. Вся обработка выполняется локально в браузере — скан не покидает устройство.

## Run & Operate

- `pnpm install` — установить зависимости (нужен pnpm 10)
- `pnpm --filter @workspace/map-scan-repair run dev` — фронтенд-девсервер (требует env `PORT` и `BASE_PATH`)
- `pnpm --filter @workspace/map-scan-repair run test` — юнит-тесты геометрии (vitest)
- `pnpm run typecheck` — полный typecheck по всем пакетам
- `PORT=20228 BASE_PATH=/ pnpm --filter @workspace/map-scan-repair run build` — сборка фронтенда в `artifacts/map-scan-repair/dist/public`
- `pnpm --filter @workspace/api-server run dev` — API-сервер (только `/healthz`, порт из env `PORT`)
- `pnpm --filter @workspace/api-spec run codegen` — регенерация API-хуков и Zod-схем из OpenAPI-спеки

## Stack

- pnpm workspaces (catalog), Node.js 24, TypeScript 5.9
- Фронтенд: React 19 + Vite 7 + Tailwind 4, Canvas 2D, pdfjs-dist (рендер PDF в растр)
- Геометрия: собственный Bowyer–Watson triangulate + аффинные треугольники (`src/lib/geometry.ts`, покрыт vitest)
- API: Express 5 + pino, валидация Zod (`@workspace/api-zod`)
- Сборка API: esbuild (esm-бандл)

## Where things live

- `artifacts/map-scan-repair` — основное приложение. `src/App.tsx` — композиция; `src/lib/geometry.ts` — чистая геометрия (не менять без тестов); `src/lib/types.ts` — общие типы; `src/hooks/` — useHistory, useViewport, useDocumentLoader; `src/components/` — панели интерфейса.
- `artifacts/api-server` — бэкенд-заготовка с `/healthz`.
- `lib/api-spec`, `lib/api-zod`, `lib/api-client-react`, `lib/db` — общие пакеты (спека, схемы, клиент, Drizzle).

## Architecture decisions

- Геометрия деформации — свои triangulate/affine-функции без внешних зависимостей: полный контроль над вырожденными случаями и O-сложностью; фиксируются тестами.
- Правки фрагментов хранятся как полигоны в координатах исходного скана; экспорт всегда рендерится в полном разрешении.
- Жёсткое преобразование (dx/dy/rotation) сворачивается в цели вершин сетки; цели опорных пар хранятся в абсолютных координатах листа.
- Лимиты холста (32767 px / 100 Мп) и PDF (36 Мп) проверяются до открытия документа — ошибки выдаются понятным текстом.

## Gotchas

- `vite dev`/`preview` требуют env `PORT` и `BASE_PATH`; для `vite build` достаточно `BASE_PATH`.
- После правок геометрии запускать `pnpm --filter @workspace/map-scan-repair run test`.
- `pnpm-workspace.yaml` использует `minimumReleaseAge` (защита от supply-chain) — свежие пакеты недоступны сутки.

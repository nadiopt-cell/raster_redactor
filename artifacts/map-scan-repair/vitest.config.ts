import path from 'path';
import { defineConfig } from 'vitest/config';

// Изолированный конфиг для тестов: не наследует vite.config.ts,
// который требует PORT/BASE_PATH и подключает плагины Replit.
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});

// Кроссплатформенная preinstall-проверка: монорепозиторий ставится только через pnpm.
// Заменяет прежний `sh -c '...'`, который не работал на Windows без Git Bash.
// Запускается автоматически перед `pnpm install` из корня репозитория.
import { rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Убираем чужие lockfiles, чтобы пакеты не разъехались версиями.
for (const lockfile of ['package-lock.json', 'yarn.lock', 'bun.lockb']) {
  rmSync(join(root, lockfile), { force: true });
}

// npm_config_user_agent выставляет сам npm/pnpm при запуске install-скриптов.
const userAgent = process.env.npm_config_user_agent ?? '';
if (!userAgent.startsWith('pnpm/')) {
  console.error(
    '\nЭтот монорепозиторий управляется pnpm (нужен pnpm 10).\n' +
      'Установите pnpm и повторите установку:\n\n' +
      '  npm install -g pnpm@10\n' +
      '  pnpm install\n',
  );
  process.exit(1);
}

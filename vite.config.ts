import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  build: {
    // three.js alone is ~145 kB gzipped; within the app-page budget.
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      input: {
        host: resolve(import.meta.dirname, 'index.html'),
        player: resolve(import.meta.dirname, 'player.html'),
        admin: resolve(import.meta.dirname, 'admin.html'),
      },
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: [
        'src/engine/**/*.ts', 'src/chat/protocol.ts', 'src/chat/tiktokBridge.ts', 'src/settings/schema.ts',
        'src/admin/protocol.ts', 'src/admin/commands.ts', 'src/admin/statsApi.ts', 'src/ui/admin/draft.ts',
        'src/history/events.ts', 'src/history/tracker.ts', 'src/stats/store.ts', 'src/stats/gifts.ts', 'src/stats/http.ts',
      ],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
  },
});

import { execFileSync } from 'node:child_process';
import { describe, expect, test } from 'vitest';

/**
 * scripts/derby-server.mjs imports these .ts files with plain Node (type stripping, no bundler).
 * Vitest resolves imports more loosely than Node, so check the real loader: a missing ".ts" extension
 * or a runtime import of a browser module would only fail when the server starts.
 */
const SERVER_MODULES = ['src/stats/store.ts', 'src/stats/http.ts', 'src/history/events.ts', 'src/chat/tiktokBridge.ts'];

describe('server modules load in plain Node', () => {
  test.each(SERVER_MODULES)('%s', (path) => {
    const out = execFileSync(process.execPath, [
      '--disable-warning=ExperimentalWarning', '--input-type=module',
      '-e', `const m = await import(${JSON.stringify(`./${path}`)}); console.log(Object.keys(m).length > 0 ? 'ok' : 'empty');`,
    ], { encoding: 'utf8' });
    expect(out.trim()).toBe('ok');
  });
});

import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    include: ['lib/**/__tests__/*.test.ts', 'scripts/__tests__/*.test.ts'],
    environment: 'node',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
      // Every `lib/**/server.ts` opens with `import 'server-only'`, whose
      // package exports map the `react-server` condition to an empty module and
      // everything else to a file that throws. Next's bundler sets that
      // condition; vitest does not, so five suites that import an orchestrator
      // died at collection with "cannot be imported from a Client Component
      // module" and reported "0 test" — a failure shape that reads like an
      // empty file rather than a broken one.
      //
      // Resolved to the package's OWN empty.js rather than a stub of ours, so
      // this stays correct if the package changes. `resolve.conditions` does
      // not work here: vitest processes node-environment modules through a
      // pipeline that does not consult it.
      'server-only': path.resolve(__dirname, 'node_modules/server-only/empty.js'),
    },
  },
});

import { defineConfig } from 'vitest/config';
import path from 'node:path';

/**
 * HYPREP LCMS - test runner.
 *
 * Separate from `vite.config.ts` because the two builds have opposite needs:
 * the app config exists to produce a browser bundle, while this one exists to
 * run Convex functions against `convex-test`'s in-memory backend.
 *
 * `edge-runtime` is the environment because that is what the Convex runtime
 * actually is - a V8 isolate with web APIs and no Node built-ins. Running the
 * backend tests under `node` would let a function pass here and fail on deploy
 * the moment it touched `fs` or `Buffer`, which is precisely the class of
 * mistake a test environment should catch rather than hide.
 *
 * `server.deps.inline` is required by `convex-test`: it loads the function
 * modules through `import.meta.glob`, and they must be transformed by Vite
 * rather than handed to the runtime as external CJS.
 */
export default defineConfig({
  test: {
    environment: 'edge-runtime',
    include: ['convex/**/*.test.ts', 'src/**/*.test.ts'],
    server: { deps: { inline: ['convex-test'] } },
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
      '@shared': path.resolve(import.meta.dirname, './convex/shared'),
    },
  },
});

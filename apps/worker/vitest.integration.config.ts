import { defineConfig } from 'vitest/config'

/**
 * Vitest config for worker integration / E2E tests.
 *
 * Run with:  npx vitest run --config vitest.integration.config.ts
 *
 * These tests start a real WorkflowWorker connected to the test Redis (DB 1)
 * and test database (opscore_test), then verify the full execution chain.
 */
export default defineConfig({
  test: {
    name: 'worker-integration',
    include: ['src/**/*.integration.test.ts'],
    environment: 'node',
    globals: true,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 30000,
    hookTimeout: 30000,
    setupFiles: ['src/test/integration-setup.ts'],
    reporters: ['verbose'],
  },
})

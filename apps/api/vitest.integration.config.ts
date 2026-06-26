import { defineConfig } from 'vitest/config'

/**
 * Vitest config for integration and property-based tests.
 *
 * These tests run against a real PostgreSQL database (opscore_test)
 * and real Redis (DB 1 — isolated from the dev DB 0).
 *
 * Run with:  npx vitest run --config vitest.integration.config.ts
 * Coverage:  npx vitest run --config vitest.integration.config.ts --coverage
 *
 * Kept completely separate from the Jest unit test suite so the two
 * runners never conflict.
 */
export default defineConfig({
  test: {
    name: 'integration',
    include: ['src/**/*.integration.test.ts'],
    environment: 'node',
    globals: true,
    // Run integration tests serially — each suite gets a clean DB state
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    // 30-second timeout per test (real DB + Redis can be slow)
    testTimeout: 30000,
    hookTimeout: 30000,
    // Load the integration env before each test file
    setupFiles: ['src/test/integration-setup.ts'],
    reporters: ['verbose'],
    coverage: {
      provider: 'v8',
      include: ['src/services/**', 'src/lib/**', 'src/routes/**'],
      exclude: ['src/**/__tests__/**', 'src/**/*.test.ts'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 70,
      },
    },
  },
})

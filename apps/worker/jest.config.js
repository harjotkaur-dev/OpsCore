/** @type {import('jest').Config} */
export default {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    // Strip .js extensions so ts-jest can resolve the .ts source files
    '^(\\.{1,2}/.*)\\.js$': '$1',
    // Map monorepo packages
    '^@opscore/database$': '<rootDir>/../../packages/database/src/index.ts',
    '^@opscore/logger$': '<rootDir>/../../packages/logger/src/index.ts',
    '^@opscore/types$': '<rootDir>/../../packages/types/src/index.ts',
    '^@opscore/config$': '<rootDir>/../../packages/config/src/index.ts',
    // Map internal lib modules so jest.unstable_mockModule path resolution works
    '^.*/workers/actionHandlers/../../lib/redis(\\.js)?$': '<rootDir>/src/lib/redis.ts',
    '^.*/lib/redis(\\.js)?$': '<rootDir>/src/lib/redis.ts',
  },
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        useESM: true,
        tsconfig: {
          // Relax some strict settings that cause issues in tests
          exactOptionalPropertyTypes: false,
        },
      },
    ],
  },
  testMatch: ['**/__tests__/**/*.test.ts', '**/*.test.ts'],
  testPathIgnorePatterns: ['node_modules', 'dist'],
}

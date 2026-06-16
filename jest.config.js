/** @type {import('jest').Config} */
module.exports = {
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
  /**
   * Hide `dist/` from Jest's Haste map: tsc emits `dist/package.json`
   * for every package (a side-effect of importing `package.json`
   * from source), and the haste resolver otherwise raises a
   * "duplicate `@keewano/core` package" error when it sees both the
   * source `package.json` and the built copy.
   */
  modulePathIgnorePatterns: ['/dist/'],
  /**
   * Resolve cross-package `@keewano/*` imports to each package's TypeScript
   * source instead of its built `main` (`dist/...`). ts-jest compiles the
   * source on the fly, so the test run never depends on a prior build (and CI
   * doesn't need to carry `dist/` between stages). The workspace directory name
   * matches the scope suffix, e.g. `@keewano/core` -> `packages/core`.
   */
  moduleNameMapper: {
    '^@keewano/(.+)$': '<rootDir>/packages/$1/src/index.ts',
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'json'],
  /**
   * GitLab CI ingests Cobertura XML for coverage; the default
   * `lcov`/`text`/`clover`/`text-summary` set does not produce one
   * and the CI artifact step fails with "no matching files".
   */
  coverageReporters: ['text-summary', 'cobertura', 'text', 'lcov'],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: {
          moduleResolution: 'Node16',
          module: 'Node16',
          target: 'ES2022',
          jsx: 'react-native',
          noUncheckedIndexedAccess: true,
          resolveJsonModule: true,
          esModuleInterop: true,
          isolatedModules: true,
          skipLibCheck: true,
          strict: true,
        },
      },
    ],
  },
  collectCoverageFrom: [
    'packages/*/src/**/*.{ts,tsx}',
    '!packages/*/src/**/index.ts',
    '!packages/*/src/**/*.test.{ts,tsx}',
    '!packages/*/src/**/__tests__/**',
  ],
  testMatch: [
    '**/__tests__/**/*.test.tsx',
    '**/__tests__/**/*.test.ts',
    '**/*.test.tsx',
    '**/*.test.ts',
  ],
  reporters: [
    'default',
    [
      'jest-junit',
      {
        outputName: 'junit.xml',
      },
    ],
  ],
  coverageThreshold: {
    global: {
      statements: 95,
      branches: 90,
      functions: 95,
      lines: 95,
    },
  },
  testEnvironment: 'node',
  passWithNoTests: true,
};

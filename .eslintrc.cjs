module.exports = {
  root: true,
  env: {
    node: true,
    es2020: true,
  },
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 2020, sourceType: 'module' },
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:sonarjs/recommended-legacy',
  ],
  rules: {
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-empty-function': 'off',
  },
  overrides: [
    {
      // .cjs config files use CommonJS - module, require, __dirname etc. - Node globals.
      files: ['*.cjs', '*.config.cjs', '.eslintrc.cjs', 'jest.config.js'],
      parserOptions: { sourceType: 'script' },
    },
    {
      // Test files legitimately use `require` for `jest.isolateModules` +
      // `jest.doMock`-driven module-cache resets. The ESM equivalent
      // (`jest.isolateModulesAsync` + dynamic `import`) needs
      // `--experimental-vm-modules`, an opt-in flag we deliberately do
      // not enable workspace-wide.
      files: ['**/__tests__/**/*.ts', '**/__tests__/**/*.tsx', '**/*.test.ts', '**/*.test.tsx'],
      rules: {
        '@typescript-eslint/no-var-requires': 'off',
        '@typescript-eslint/no-require-imports': 'off',
      },
    },
    {
      // `getSecureRandomBytes` falls back to `Math.random` only when the
      // runtime has no Web Crypto (React Native / Hermes without a
      // polyfill). The bytes back analytics install / session UUIDs,
      // where uniqueness - not cryptographic unpredictability - is the
      // requirement, so a non-crypto RNG is an intentional, documented
      // degradation that keeps the SDK install-and-go.
      files: ['packages/core/src/encoding/random.ts'],
      rules: {
        'sonarjs/pseudo-random': 'off',
      },
    },
  ],
  ignorePatterns: ['dist/', 'node_modules/', 'coverage/'],
};

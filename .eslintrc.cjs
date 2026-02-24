module.exports = {
  root: true,
  ignorePatterns: ['dist/**', 'node_modules/**', 'tmp/**'],
  overrides: [
    {
      files: ['src/**/*.js'],
      env: {
        browser: true,
        es2022: true
      },
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module'
      },
      globals: {
        chrome: 'readonly'
      },
      extends: ['eslint:recommended'],
      rules: {
        'no-console': 'off',
        'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }]
      }
    },
    {
      files: ['tests/**/*.test.mjs'],
      env: {
        node: true,
        es2022: true
      },
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module'
      },
      extends: ['eslint:recommended'],
      rules: {
        'no-console': 'off'
      }
    }
  ]
};

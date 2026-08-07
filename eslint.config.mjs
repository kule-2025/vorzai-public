import tseslint from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';

export default [
  {
    ignores: [
      'node_modules/', 'dist/', 'release/', 'release-build/', 'release-new/',
      'backups/', 'data/', 'logs/', '**/*.js', '**/*.mjs', 'scripts/',
      'server/dist/', '.workbuddy/',
      // 测试文件不在前端 tsconfig 的 project service 覆盖内，且无需 a11y/类型 lint
      'src/__tests__/**',
    ],
  },
  {
    files: ['src/**/*.{ts,tsx}', 'server/src/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
        // B8：启用 typescript-eslint 语言服务，为需要类型信息的规则
        // （如 no-misused-promises）提供 parserServices；按文件自动发现 tsconfig。
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
      'react-hooks': reactHooks,
    },
    rules: {
      'no-console': 'off',
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-constant-condition': ['error', { checkLoops: false }],
      '@typescript-eslint/no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^(_|err|error|e)$',
      }],
      '@typescript-eslint/no-explicit-any': 'off',
      'react-hooks/rules-of-hooks': 'warn',
      'react-hooks/exhaustive-deps': 'off',
      // B8（前端 QE）：捕获 UI 事件处理器中未处理的 Promise 拒绝
      // （如 onClick 直接传 async 函数），属常见前端运行时缺陷。
      '@typescript-eslint/no-misused-promises': 'warn',
    },
  },
  {
    // B8（前端 QE / a11y）：仅对前端 JSX（src）启用无障碍检查，不影响 server。
    // 严重度设为 'warn'——暴露问题但不阻断 lint / 构建；等团队消化后再上 strict。
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'jsx-a11y': jsxA11y },
    rules: {
      'jsx-a11y/alt-text': 'warn',
      'jsx-a11y/aria-props': 'warn',
      'jsx-a11y/aria-role': 'warn',
      'jsx-a11y/aria-unsupported-elements': 'warn',
      'jsx-a11y/img-redundant-alt': 'warn',
      'jsx-a11y/label-has-associated-control': 'warn',
      'jsx-a11y/role-has-required-aria-props': 'warn',
      'jsx-a11y/role-supports-aria-props': 'warn',
      'jsx-a11y/tabindex-no-positive': 'warn',
      'jsx-a11y/anchor-is-valid': 'warn',
      'jsx-a11y/click-events-have-key-events': 'warn',
      'jsx-a11y/no-static-element-interactions': 'warn',
      'jsx-a11y/interactive-supports-focus': 'warn',
      'jsx-a11y/iframe-has-title': 'warn',
      'jsx-a11y/no-autofocus': 'warn',
      'jsx-a11y/heading-has-content': 'warn',
      'jsx-a11y/html-has-lang': 'warn',
    },
  },
];

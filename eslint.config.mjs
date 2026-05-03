import nextConfig from 'eslint-config-next'

const dashboardForbidsPipeline = {
  patterns: [
    {
      group: ['@/lib/versature/*', '@/lib/pipeline/*'],
      message: 'Dashboard code must not import lib/versature or lib/pipeline (architectural rule).',
    },
    {
      group: ['**/lib/versature/*', '**/lib/pipeline/*'],
      message: 'Dashboard code must not import lib/versature or lib/pipeline (architectural rule).',
    },
    {
      group: ['../**/lib/versature/*', '../**/lib/pipeline/*'],
      message: 'Dashboard code must not import lib/versature or lib/pipeline (architectural rule).',
    },
  ],
}

const versatureForbidsWarehouse = {
  patterns: [
    {
      group: ['@/lib/warehouse/*', '**/lib/warehouse/*', '../**/lib/warehouse/*'],
      message: 'Versature client must not know about MotherDuck.',
    },
  ],
}

const config = [
  { ignores: ['.next/**', 'node_modules/**', 'tsconfig.tsbuildinfo'] },
  ...nextConfig,
  {
    files: ['app/**/*.{ts,tsx}', 'components/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', dashboardForbidsPipeline],
    },
  },
  {
    files: ['lib/versature/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', versatureForbidsWarehouse],
    },
  },
  {
    files: ['lib/versature/index.ts', 'lib/pipeline/index.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        { selector: 'ExportAllDeclaration', message: 'No barrel re-exports.' },
      ],
    },
  },
]

export default config

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

const warehouseForbidsPipelineAndVersature = {
  patterns: [
    {
      group: [
        '@/lib/versature/*', '**/lib/versature/*', '../**/lib/versature/*',
        '@/lib/pipeline/*',  '**/lib/pipeline/*',  '../**/lib/pipeline/*',
      ],
      message: 'lib/warehouse is the dashboard reader layer; it must not import lib/versature or lib/pipeline (architectural rule). Closes the indirect path app/** -> lib/warehouse -> lib/versature.',
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
    files: ['lib/warehouse/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', warehouseForbidsPipelineAndVersature],
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

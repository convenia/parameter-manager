// Demo data for VAULT_FAKE_SSM=1. Every secret-looking value is obviously fake.

const env = (entries) => Object.entries(entries).map(([key, value]) => `${key}=${value}`).join('\n')

const appEnv = (stage, extra = {}) =>
  env({
    APP_NAME: 'myapp',
    APP_ENV: stage,
    APP_DEBUG: stage === 'prod' ? 'false' : 'true',
    APP_URL: stage === 'prod' ? 'https://myapp.example.com' : `https://${stage}.myapp.example.com`,
    DB_HOST: `db-${stage}.internal`,
    DB_PORT: '5432',
    DB_DATABASE: 'myapp',
    DB_USERNAME: 'myapp',
    DB_PASSWORD: `${stage}-not-a-real-password`,
    REDIS_HOST: `redis-${stage}.internal`,
    QUEUE_CONNECTION: 'sqs',
    MAIL_FROM_ADDRESS: 'no-reply@myapp.example.com',
    ...extra
  })

// 61 lines of 64 bytes + 60 newlines = 3,964 bytes: close to the 4,096-byte Standard limit.
const bigEnv = () => Array.from({ length: 61 }, (_, i) => `CACHE_KEY_${String(i + 1).padStart(3, '0')}=${'x'.repeat(50)}`).join('\n')

const quotedEnv = [
  '# Values with quotes, comments, and a multiline key',
  'PRIVATE_KEY="-----BEGIN KEY-----\nnot-a-real-key\n-----END KEY-----"',
  "GREETING='hello # not a comment'",
  'export PATH_EXTRA=/opt/bin # inline comment'
].join('\n')

export function seedParameters() {
  const sentry = { SENTRY_DSN: 'https://public@sentry.example.com/1' }
  return [
    { name: '/myapp/dev/env', type: 'SecureString', description: 'Development .env for myapp', versions: [appEnv('dev')] },
    { name: '/myapp/dev/feature-flags', type: 'StringList', versions: ['checkout,new-dashboard,dark-mode,beta-reports'] },
    { name: '/myapp/dev/broken-env', type: 'String', description: 'Has an invalid line and a duplicate key', versions: ['A=1\nthis line is not valid\nA=2'] },
    { name: '/myapp/staging/env', type: 'SecureString', description: 'Staging .env for myapp', versions: [appEnv('staging'), appEnv('staging', { FEATURE_NEW_CHECKOUT: 'true' })] },
    { name: '/myapp/staging/feature-flags', type: 'StringList', versions: ['checkout,new-dashboard'] },
    {
      name: '/myapp/prod/env',
      type: 'SecureString',
      description: 'Production .env for myapp',
      tags: [{ key: 'team', value: 'platform' }, { key: 'environment', value: 'production' }],
      versions: [appEnv('prod'), appEnv('prod', sentry), appEnv('prod', { ...sentry, DB_PASSWORD: 'prod-rotated-not-real' })]
    },
    { name: '/myapp/prod/quoted-env', type: 'SecureString', description: 'Quoted and multiline values', versions: [quotedEnv] },
    { name: '/myapp/prod/big-env', type: 'SecureString', description: 'Close to the 4 KB Standard limit', versions: [bigEnv()] },
    { name: '/myapp/prod/feature-flags', type: 'StringList', versions: ['checkout,new-dashboard,dark-mode'] },
    { name: '/myapp/prod/config.json', type: 'String', description: 'Not .env, so diffs are line by line', versions: ['{\n  "retries": 3,\n  "timeoutMs": 5000\n}', '{\n  "retries": 5,\n  "timeoutMs": 5000\n}'] },
    { name: '/billing/staging/env', type: 'SecureString', versions: [env({ STRIPE_MODE: 'test', STRIPE_KEY: 'sk_test_not_real', INVOICE_PREFIX: 'STG' })] },
    { name: '/billing/prod/env', type: 'SecureString', versions: [env({ STRIPE_MODE: 'live', STRIPE_KEY: 'sk_live_not_real', INVOICE_PREFIX: 'INV' })] },
    { name: '/billing/prod/stripe-webhook-secret', type: 'SecureString', versions: ['whsec_not_a_real_secret'] },
    { name: '/shared/datadog/api-key', type: 'SecureString', versions: ['dd-not-a-real-key'] },
    { name: '/shared/sentry/dsn', type: 'String', versions: ['https://public@sentry.example.com/1'] },
    { name: '/infra/vpc/id', type: 'String', versions: ['vpc-0abc1234def567890'] },
    { name: '/infra/vpc/private-subnets', type: 'StringList', versions: ['subnet-0aaa,subnet-0bbb,subnet-0ccc'] },
    { name: '/reports/prod/env', type: 'SecureString', tier: 'Advanced', description: 'Advanced tier example', versions: [appEnv('prod', { REPORTS_BUCKET: 's3://reports-prod' })] },
    { name: 'legacy-api-token', type: 'SecureString', description: 'Name without a path', versions: ['legacy-not-a-real-token'] }
  ]
}

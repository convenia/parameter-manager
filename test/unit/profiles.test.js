import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { listProfiles, resolveAwsPaths } from '../../src/main/profiles.js'

const fixtures = fileURLToPath(new URL('../fixtures/aws/', import.meta.url))
const paths = { configPath: join(fixtures, 'config'), credentialsPath: join(fixtures, 'credentials') }

describe('listProfiles', () => {
  it('merges profiles from both files, default first', async () => {
    expect(await listProfiles(paths)).toEqual([
      { name: 'default', region: 'sa-east-1', sources: ['config', 'credentials'], sso: false },
      { name: 'prod', region: null, sources: ['credentials'], sso: false },
      { name: 'sso-dev', region: 'us-west-2', sources: ['config'], sso: true },
      { name: 'staging', region: 'us-east-1', sources: ['config'], sso: false }
    ])
  })

  it('never returns credential values', async () => {
    expect(JSON.stringify(await listProfiles(paths))).not.toMatch(/AKIA|secret/)
  })

  it('returns an empty list when the files do not exist', async () => {
    expect(await listProfiles({ configPath: join(fixtures, 'missing-config'), credentialsPath: join(fixtures, 'missing-credentials') })).toEqual([])
  })
})

describe('resolveAwsPaths', () => {
  it('prefers explicit settings, then environment variables, then ~/.aws', () => {
    expect(resolveAwsPaths({ configFile: '/x/config', credentialsFile: '/x/creds' }, {}, '/home/u')).toEqual({ configPath: '/x/config', credentialsPath: '/x/creds' })
    expect(resolveAwsPaths({}, { AWS_CONFIG_FILE: '/env/config', AWS_SHARED_CREDENTIALS_FILE: '/env/creds' }, '/home/u')).toEqual({ configPath: '/env/config', credentialsPath: '/env/creds' })
    expect(resolveAwsPaths({}, {}, '/home/u')).toEqual({ configPath: '/home/u/.aws/config', credentialsPath: '/home/u/.aws/credentials' })
  })
})

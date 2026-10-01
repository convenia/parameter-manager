import { homedir } from 'node:os'
import { join } from 'node:path'
import { loadSharedConfigFiles } from '@smithy/shared-ini-file-loader'

// The loader keys [sso-session x] and [services x] sections as "sso-session.x" / "services.x".
const NON_PROFILE_SECTION = /^(sso-session|services)\./

export function resolveAwsPaths({ configFile = '', credentialsFile = '' } = {}, env = process.env, home = homedir()) {
  return {
    configPath: configFile || env.AWS_CONFIG_FILE || join(home, '.aws', 'config'),
    credentialsPath: credentialsFile || env.AWS_SHARED_CREDENTIALS_FILE || join(home, '.aws', 'credentials')
  }
}

// Only names, regions, and an SSO flag leave this function — never key material.
export async function listProfiles({ configPath, credentialsPath }) {
  const { configFile, credentialsFile } = await loadSharedConfigFiles({ configFilepath: configPath, filepath: credentialsPath, ignoreCache: true })
  const byName = new Map()
  const entry = (name) => {
    if (!byName.has(name)) byName.set(name, { name, region: null, sources: [], sso: false })
    return byName.get(name)
  }

  for (const [name, section] of Object.entries(configFile)) {
    if (NON_PROFILE_SECTION.test(name)) continue
    const profile = entry(name)
    profile.sources.push('config')
    profile.region = section.region ?? null
    profile.sso = Boolean(section.sso_session || section.sso_start_url)
  }
  for (const name of Object.keys(credentialsFile)) entry(name).sources.push('credentials')

  return [...byName.values()].sort((a, b) => {
    if (a.name === 'default') return -1
    if (b.name === 'default') return 1
    return a.name.localeCompare(b.name)
  })
}

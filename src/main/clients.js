import { SsmService, createSsmClient } from './ssm-service.js'

// One SsmService per saved connection, rebuilt when the connection, the AWS file
// settings, or its credentials change. In fake mode everything shares one fake.
export function createClients({ store, fakeService = null, makeService = (options) => new SsmService(createSsmClient(options)) }) {
  const cache = new Map()

  const optionsFor = (connection) => {
    const { awsConfigFile, awsCredentialsFile } = store.getSettings()
    return { profile: connection.profile, region: connection.region, configFile: awsConfigFile, credentialsFile: awsCredentialsFile }
  }

  return {
    forConnection(id) {
      const connection = store.getConnection(id)
      if (fakeService) return fakeService
      if (!cache.has(id)) cache.set(id, makeService(optionsFor(connection)))
      return cache.get(id)
    },
    forDraft(connection) {
      return fakeService ?? makeService(optionsFor(connection))
    },
    invalidate(id) {
      cache.delete(id)
    },
    clear() {
      cache.clear()
    }
  }
}

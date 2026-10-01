// The whole IPC surface. The preload builds window.vault from it and main registers
// one handler per channel, so a channel cannot exist on only one side.
export const API = Object.freeze({
  app: { info: 'app:info' },
  profiles: { list: 'profiles:list' },
  connections: {
    list: 'connections:list',
    save: 'connections:save',
    delete: 'connections:delete',
    test: 'connections:test'
  },
  settings: { get: 'settings:get', save: 'settings:save' },
  ssm: {
    list: 'ssm:list',
    get: 'ssm:get',
    tags: 'ssm:tags',
    history: 'ssm:history',
    put: 'ssm:put',
    delete: 'ssm:delete'
  }
})

export const CHANNELS = Object.freeze(Object.values(API).flatMap((group) => Object.values(group)))

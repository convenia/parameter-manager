// Tab bookkeeping for the workspace; rendering lives in views/workspace.js.
export function createTabModel(initial = []) {
  let tabs = initial.map((tab) => ({ closable: true, ...tab }))
  let activeId = tabs[0]?.id ?? null
  const listeners = new Set()
  const emit = () => {
    for (const fn of [...listeners]) fn()
  }

  return {
    list: () => tabs.slice(),
    get: (id) => tabs.find((t) => t.id === id) ?? null,
    get activeId() {
      return activeId
    },
    open(tab) {
      if (!tabs.some((t) => t.id === tab.id)) tabs = [...tabs, { closable: true, ...tab }]
      activeId = tab.id
      emit()
    },
    activate(id) {
      if (id === activeId || !tabs.some((t) => t.id === id)) return
      activeId = id
      emit()
    },
    update(id, patch) {
      tabs = tabs.map((t) => (t.id === id ? { ...t, ...patch } : t))
      emit()
    },
    close(id) {
      const index = tabs.findIndex((t) => t.id === id)
      if (index === -1 || !tabs[index].closable) return false
      tabs = tabs.filter((t) => t.id !== id)
      if (activeId === id) activeId = (tabs[index] ?? tabs[index - 1] ?? null)?.id ?? null
      emit()
      return true
    },
    subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    }
  }
}

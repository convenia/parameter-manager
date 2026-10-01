// Refuses to unload the page while there are unsaved edits. Electron then fires
// 'will-prevent-unload' in main, which asks the user (see src/main/unload.js).
export function installUnloadGuard(hasUnsavedChanges, target = window) {
  const onBeforeUnload = (event) => {
    if (!hasUnsavedChanges()) return
    event.preventDefault()
    event.returnValue = ''
  }
  target.addEventListener('beforeunload', onBeforeUnload)
  return () => target.removeEventListener('beforeunload', onBeforeUnload)
}

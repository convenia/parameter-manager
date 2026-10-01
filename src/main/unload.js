export const DISCARD_BUTTON = 0

export const UNLOAD_DIALOG = Object.freeze({
  type: 'warning',
  buttons: ['Discard changes and close', 'Keep editing'],
  defaultId: 1,
  cancelId: 1,
  title: 'Unsaved changes',
  message: 'Some parameters have unsaved changes.',
  detail: 'If you close the window now, those edits are lost.'
})

// Handler for webContents 'will-prevent-unload': the renderer refused to close because of
// unsaved edits. Calling preventDefault() here overrides that refusal and lets it close.
export function confirmUnload(event, ask) {
  if (ask(UNLOAD_DIALOG) === DISCARD_BUTTON) event.preventDefault()
}

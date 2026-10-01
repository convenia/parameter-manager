import '../styles/dialogs.css'
import { h } from '../lib/dom.js'
import { field } from '../lib/form.js'
import { openModal } from '../components/modal.js'
import { toast, toastError } from '../components/toast.js'

export async function openSettings({ api, onSaved = () => {} }) {
  let settings
  let paths
  try {
    ;[settings, paths] = await Promise.all([api.settings.get(), api.profiles.list()])
  } catch (err) {
    toastError(err, 'Could not load settings')
    return null
  }

  const draft = { ...settings }
  const themeSelect = h('select', { class: 'input', name: 'theme', onChange: (event) => (draft.theme = event.target.value) }, h('option', { value: 'system' }, 'Match the system'), h('option', { value: 'light' }, 'Light'), h('option', { value: 'dark' }, 'Dark'))
  themeSelect.value = draft.theme
  const checkbox = (key, label, help) =>
    h('label', { class: 'checkbox' }, h('input', { type: 'checkbox', name: key, checked: draft[key], onChange: (event) => (draft[key] = event.target.checked) }), h('span', {}, h('strong', {}, label), h('span', { class: 'field__help' }, help)))
  const pathInput = (key, placeholder) => h('input', { class: 'input mono', name: key, value: draft[key], placeholder, spellcheck: 'false', onInput: (event) => (draft[key] = event.target.value.trim()) })

  const body = h(
    'form',
    {
      class: 'settings-form',
      onSubmit: (event) => {
        event.preventDefault()
        save()
      }
    },
    h('h3', { class: 'settings-form__section' }, 'Appearance'),
    field('Theme', themeSelect),
    h('h3', { class: 'settings-form__section' }, 'Secrets'),
    checkbox('autoDecrypt', 'Decrypt SecureString values when a parameter opens', 'When this is off, encrypted values stay hidden until you click "Decrypt & show".'),
    checkbox('maskValuesInDiff', 'Mask values in diffs and comparisons', 'Values show as •••••••• until you reveal them.'),
    h('h3', { class: 'settings-form__section' }, 'AWS files'),
    field('Config file', pathInput('awsConfigFile', paths.configPath), 'Leave empty to use the AWS default.'),
    field('Credentials file', pathInput('awsCredentialsFile', paths.credentialsPath), 'Leave empty to use the AWS default.')
  )

  const modal = openModal({
    title: 'Settings',
    size: 'md',
    body,
    actions: [
      { id: 'cancel', label: 'Cancel', onClick: (m) => m.close() },
      { id: 'confirm', label: 'Save settings', kind: 'primary', onClick: () => save() }
    ]
  })
  return modal

  async function save() {
    modal.setBusy(true)
    try {
      const saved = await api.settings.save(draft)
      toast({ kind: 'success', message: 'Settings saved.' })
      modal.close()
      onSaved(saved)
    } catch (err) {
      modal.setBusy(false)
      toastError(err, 'Could not save settings')
    }
  }
}

import '../styles/parameter.css'
import { diffEnv } from '@shared/diff.js'
import { formatCount, formatDate, formatNumber } from '@shared/format.js'
import { h } from '../lib/dom.js'
import { planSave } from '../lib/save-plan.js'
import { tierBadge, typeBadge } from '../components/badges.js'
import { renderDiff } from '../components/diff-view.js'
import { createEnvEditor } from '../components/env-editor.js'
import { icon } from '../components/icons.js'
import { choiceDialog, confirmDialog, openModal, typeToConfirm } from '../components/modal.js'
import { toast, toastError } from '../components/toast.js'
import { createHistoryPanel } from './history-panel.js'

export function createParameterTab({ api, connection, meta: initialMeta, getSettings, onChanged = () => {}, onDirtyChange = () => {} }) {
  const canWrite = !connection.readOnly
  let meta = { ...initialMeta }
  let current = null // the last value read from AWS: { value (null while encrypted), version, arn, … }
  let tags = []
  let tagsError = null // shown in the overview: least-privilege profiles often lack ssm:ListTagsForResource
  let editor = null
  let history = null
  let saving = false
  let wasDirty = false
  let destroyed = false

  const badges = h('span', { class: 'param__badges' })
  const version = h('span', { class: 'param__version muted' })
  const dirtyFlag = h('span', { class: 'param__dirty', hidden: true }, 'Unsaved changes')
  const saveButton = h('button', { class: 'btn btn--primary', type: 'button', disabled: true, dataset: { action: 'save' }, onClick: () => save() }, icon('save', 14), 'Save')
  const revertButton = h('button', { class: 'btn btn--default', type: 'button', disabled: true, dataset: { action: 'revert' }, onClick: () => revert() }, icon('undo', 14), 'Revert')
  const deleteButton = h('button', { class: 'btn btn--ghost-danger', type: 'button', dataset: { action: 'delete' }, onClick: () => remove() }, icon('trash', 14), 'Delete')
  const overview = h('dl', { class: 'overview__grid' })
  const valuePanel = h('div', { class: 'param__panel', role: 'tabpanel' }, loading('Loading value…'))
  const historyPanel = h('div', { class: 'param__panel', role: 'tabpanel', hidden: true })
  const subtabs = { value: subtab('value', 'Value', 'file'), history: subtab('history', 'History', 'history') }

  const el = h(
    'section',
    { class: 'param' },
    h(
      'header',
      { class: 'param__header' },
      h('div', { class: 'param__title' }, h('h2', { class: 'mono', title: meta.name }, meta.name), badges, version, dirtyFlag),
      canWrite ? h('div', { class: 'param__actions' }, revertButton, saveButton, deleteButton) : h('span', { class: 'muted' }, 'Read-only connection')
    ),
    h('details', { class: 'overview', open: true }, h('summary', {}, 'Overview'), overview),
    h('nav', { class: 'subtabs', role: 'tablist' }, subtabs.value, subtabs.history),
    valuePanel,
    historyPanel
  )

  renderHeader()
  renderOverview()
  load()

  return {
    el,
    isDirty: () => Boolean(editor?.isDirty()),
    focus: () => editor?.focus(),
    destroy() {
      destroyed = true
      editor?.destroy()
      history?.destroy()
    }
  }

  async function load() {
    const decrypt = meta.type !== 'SecureString' || getSettings().autoDecrypt
    try {
      const [value, tagList] = await Promise.all([
        api.ssm.get(connection.id, meta.name, { decrypt }),
        api.ssm.tags(connection.id, meta.name).catch((err) => {
          tagsError = err
          return []
        })
      ])
      if (destroyed) return
      current = value
      tags = tagList
      // The list entry may be stale; GetParameter is the fresh read of type and version.
      meta = { ...meta, type: value.type, version: value.version, lastModifiedDate: value.lastModifiedDate }
      renderHeader()
      renderOverview()
      renderValue()
    } catch (err) {
      if (!destroyed) showLoadError(err)
    }
  }

  function renderValue() {
    if (current.value === null) {
      valuePanel.replaceChildren(
        h(
          'div',
          { class: 'encrypted' },
          icon('lock', 28),
          h('strong', {}, 'Encrypted value'),
          h('p', {}, 'This SecureString is not decrypted yet, because auto-decrypt is off in Settings.'),
          h('button', { class: 'btn btn--primary', type: 'button', dataset: { action: 'decrypt' }, onClick: () => decrypt() }, icon('eye', 14), 'Decrypt & show')
        )
      )
      return
    }
    if (editor) {
      editor.setValue(current.value)
      editor.setTier(meta.tier)
      return
    }
    editor = createEnvEditor({ value: current.value, tier: meta.tier, readOnly: !canWrite, onChange: (dirty) => setDirty(dirty), onSave: () => save() })
    valuePanel.replaceChildren(editor.el)
  }

  async function decrypt() {
    try {
      current = await api.ssm.get(connection.id, meta.name, { decrypt: true })
      renderValue()
      history?.reload()
    } catch (err) {
      handleError(err, 'Could not decrypt the value')
    }
  }

  function setDirty(dirty) {
    saveButton.disabled = !dirty || saving
    revertButton.disabled = !dirty
    dirtyFlag.hidden = !dirty
    if (dirty !== wasDirty) {
      wasDirty = dirty
      onDirtyChange(dirty)
    }
  }

  async function save() {
    if (!canWrite || !editor || saving) return
    const text = editor.getValue()
    const plan = planSave({ original: current?.value ?? null, text, tier: meta.tier })
    if (plan.blocked) {
      toast({ kind: 'info', message: plan.reason })
      return
    }
    saving = true
    saveButton.disabled = true
    try {
      const choice = await confirmSave(diffEnv(current.value, text), plan)
      if (!choice) return
      const result = await putWithConflictHandling(text, choice.upgrade ? 'Advanced' : meta.tier)
      if (!result) return
      // Main returns the parameter's stored metadata after the write (KMS key, description, …).
      meta = result.meta ? { ...meta, ...result.meta } : { ...meta, tier: result.tier, version: result.version }
      await reloadValue()
      toast({ kind: 'success', message: `Saved ${meta.name} as version ${result.version}.` })
      onChanged({ type: 'saved', name: meta.name, version: result.version, meta: { ...meta } })
    } catch (err) {
      handleError(err, 'Save failed')
    } finally {
      saving = false
      saveButton.disabled = !editor?.isDirty()
    }
  }

  function confirmSave(diff, plan) {
    return new Promise((resolve) => {
      const view = renderDiff(diff, { masked: getSettings().maskValuesInDiff })
      const upgrade = plan.needsUpgrade ? h('input', { type: 'checkbox', name: 'upgrade' }) : null
      const modal = openModal({
        title: `Save ${meta.name}?`,
        size: 'lg',
        body: h(
          'div',
          { class: 'save-dialog' },
          h('p', { class: 'muted' }, `Saving creates version ${current.version + 1} in ${connection.name}.`),
          view.el,
          upgrade
            ? h('label', { class: 'checkbox callout callout--warning' }, upgrade, h('span', {}, h('strong', {}, 'Upgrade to the Advanced tier (charges apply)'), `The value is ${formatNumber(plan.bytes)} bytes, over the 4,096-byte Standard limit. Advanced parameters cannot be downgraded later.`))
            : null
        ),
        onClose: (result) => {
          view.destroy()
          resolve(result ?? null)
        },
        actions: [
          { id: 'cancel', label: 'Cancel', onClick: (m) => m.close(null) },
          { id: 'confirm', label: 'Save new version', kind: 'primary', disabled: Boolean(upgrade), onClick: (m) => m.close({ upgrade: Boolean(upgrade?.checked) }) }
        ]
      })
      upgrade?.addEventListener('change', () => {
        modal.button('confirm').disabled = !upgrade.checked
      })
    })
  }

  async function putWithConflictHandling(text, tier) {
    const input = { name: meta.name, value: text, type: meta.type, tier, keyId: meta.keyId, description: meta.description, dataType: meta.dataType, allowedPattern: meta.allowedPattern, overwrite: true }
    try {
      return await api.ssm.put(connection.id, { ...input, expectedVersion: current.version })
    } catch (err) {
      if (err?.code !== 'VersionConflict') throw err
      const choice = await choiceDialog({
        title: 'This parameter changed',
        message: h('div', {}, h('p', {}, err.message), h('p', { class: 'muted' }, 'Reload discards your edits and loads the latest version. Overwrite replaces it with yours.')),
        choices: [{ id: 'cancel', label: 'Cancel' }, { id: 'reload', label: 'Reload latest' }, { id: 'overwrite', label: 'Overwrite anyway', kind: 'danger' }]
      })
      if (choice === 'reload') {
        await reloadValue()
        toast({ kind: 'info', message: `Loaded version ${current.version}. Your edits were discarded.` })
        return null
      }
      if (choice !== 'overwrite') return null
      return api.ssm.put(connection.id, input)
    }
  }

  async function reloadValue() {
    current = await api.ssm.get(connection.id, meta.name, { decrypt: true })
    meta = { ...meta, version: current.version, lastModifiedDate: current.lastModifiedDate }
    editor?.setValue(current.value)
    editor?.setTier(meta.tier)
    renderHeader()
    renderOverview()
    history?.reload()
  }

  async function revert() {
    if (!editor?.isDirty()) return
    if (!(await confirmDialog({ title: 'Revert changes?', message: 'Your unsaved edits will be lost.', confirmLabel: 'Revert', kind: 'danger' }))) return
    editor.setValue(current.value)
  }

  async function remove() {
    const confirmed = await typeToConfirm({
      title: 'Delete parameter',
      message: `This permanently deletes ${meta.name} and its history (${formatCount(meta.version, 'version')}) from ${connection.name}.`,
      expected: meta.name,
      confirmLabel: 'Delete parameter'
    })
    if (!confirmed) return
    try {
      await api.ssm.delete(connection.id, meta.name)
      toast({ kind: 'success', message: `Deleted ${meta.name}.` })
      onChanged({ type: 'deleted', name: meta.name })
    } catch (err) {
      handleError(err, 'Delete failed')
    }
  }

  function restore(entry) {
    if (!editor) {
      toast({ kind: 'info', message: 'Decrypt the value before restoring a version.' })
      return
    }
    editor.setValue(entry.value, { markClean: false })
    showSubtab('value')
    toast({ kind: 'info', message: `Version ${entry.version} is in the editor. Review it and save to make it current.` })
  }

  function handleError(err, title) {
    toastError(err, title)
    if (err?.code === 'ParameterNotFound') onChanged({ type: 'missing', name: meta.name })
  }

  function showLoadError(err) {
    const retryLoad = () => {
      valuePanel.replaceChildren(loading('Loading value…'))
      load()
    }
    const retry = h('button', { class: 'btn btn--default', type: 'button', onClick: retryLoad }, icon('refresh', 14), 'Try again')
    valuePanel.replaceChildren(h('div', { class: 'empty-state empty-state--error' }, h('strong', {}, 'Could not load this parameter'), h('span', {}, err.message), err.hint ? h('span', { class: 'muted' }, err.hint) : null, retry))
    if (err?.code === 'ParameterNotFound') onChanged({ type: 'missing', name: meta.name })
  }

  function renderHeader() {
    badges.replaceChildren(typeBadge(meta.type), tierBadge(meta.tier))
    version.textContent = `Version ${meta.version}`
  }

  function renderOverview() {
    const item = (label, value, cls) => [h('dt', {}, label), h('dd', { class: cls }, value || h('span', { class: 'muted' }, '—'))]
    const tagList = tagsError
      ? h('span', { class: 'muted tags-unavailable', title: tagsError.message }, 'Unavailable')
      : tags.length
        ? h('span', { class: 'tag-list' }, tags.map((t) => h('span', { class: 'tag' }, h('strong', {}, t.key), t.value ? ` = ${t.value}` : '')))
        : null
    overview.replaceChildren(
      ...item('ARN', current?.arn, 'mono break'),
      ...item('Description', meta.description),
      ...item('Type', meta.type),
      ...item('Tier', meta.tier),
      ...item('Data type', meta.dataType),
      ...item('KMS key', meta.type === 'SecureString' ? meta.keyId : null, 'mono'),
      ...item('Version', String(meta.version)),
      ...item('Last modified', formatDate(meta.lastModifiedDate)),
      ...item('Last modified user', meta.lastModifiedUser, 'mono break'),
      ...item('Tags', tagList)
    )
  }

  function subtab(id, label, iconName) {
    return h('button', { class: ['subtab', id === 'value' && 'is-active'], type: 'button', role: 'tab', dataset: { subtab: id }, onClick: () => showSubtab(id) }, icon(iconName, 14), label)
  }

  function showSubtab(id) {
    for (const [key, button] of Object.entries(subtabs)) button.classList.toggle('is-active', key === id)
    valuePanel.hidden = id !== 'value'
    historyPanel.hidden = id !== 'history'
    if (id === 'history' && !history) {
      history = createHistoryPanel({ api, connection, name: meta.name, canRestore: canWrite, getSettings, getCurrent: () => current, onRestore: restore })
      historyPanel.replaceChildren(history.el)
    }
  }
}

function loading(text) {
  return h('div', { class: 'loading' }, h('span', { class: 'spinner' }), text)
}

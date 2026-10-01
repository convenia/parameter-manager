// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCompareTab } from '../../src/renderer/views/compare.js'

const connections = [{ id: 'c1', name: 'Prod' }, { id: 'c2', name: 'Staging' }]
const type = (input, value) => {
  input.value = value
  input.dispatchEvent(new Event('input'))
}
const choose = (select, value) => {
  select.value = value
  select.dispatchEvent(new Event('change'))
}

function setup(get = vi.fn(async (connId) => ({ value: connId === 'c1' ? 'A=1\nB=1' : 'A=2\nC=3' }))) {
  const api = { ssm: { list: vi.fn(async (id) => [{ name: id === 'c1' ? '/prod/env' : '/stg/env' }]), get } }
  const tab = createCompareTab({ api, connections, getSettings: () => ({ maskValuesInDiff: false }), initial: { a: { connectionId: 'c1', name: '/prod/env' }, b: { connectionId: 'c2', name: '' } } })
  document.body.append(tab.el)
  return { api, tab }
}

afterEach(() => document.body.replaceChildren())

describe('createCompareTab', () => {
  it('fills the pickers and loads parameter names once per connection', async () => {
    const { api, tab } = setup()
    const selects = tab.el.querySelectorAll('select')
    expect([...selects].map((s) => s.value)).toEqual(['c1', 'c2'])
    expect(tab.el.querySelector('input[aria-label="Parameter A"]').value).toBe('/prod/env')
    await vi.waitFor(() => expect(tab.el.querySelectorAll('datalist option')).toHaveLength(2))
    choose(selects[1], 'c1')
    await vi.waitFor(() => expect([...tab.el.querySelectorAll('datalist')[1].options].map((o) => o.value)).toEqual(['/prod/env']))
    expect(api.ssm.list).toHaveBeenCalledTimes(2)
  })

  it('asks for a parameter on both sides', () => {
    const { tab } = setup()
    tab.el.querySelector('[data-action="compare"]').click()
    expect(tab.el.querySelector('.compare__result').textContent).toBe('Pick a parameter on both sides.')
  })

  it('compares decrypted values from two connections', async () => {
    const { api, tab } = setup()
    type(tab.el.querySelector('input[aria-label="Parameter B"]'), '/stg/env')
    tab.el.querySelector('[data-action="compare"]').click()
    await vi.waitFor(() => expect(tab.el.querySelectorAll('.diff-chip')).toHaveLength(4))
    expect(api.ssm.get).toHaveBeenCalledWith('c1', '/prod/env', { decrypt: true })
    expect(api.ssm.get).toHaveBeenCalledWith('c2', '/stg/env', { decrypt: true })
    expect([...tab.el.querySelectorAll('.diff-chip')].map((c) => c.textContent)).toEqual(['1 different', '1 only in A', '1 only in B', '0 equal'])
    expect(tab.el.textContent).toContain('A · /prod/env (Prod)')
  })

  it('shows an error when a value cannot be loaded', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const get = vi.fn(async () => Promise.reject(Object.assign(new Error('/stg/env no longer exists.'), { code: 'ParameterNotFound' })))
    const { tab } = setup(get)
    type(tab.el.querySelector('input[aria-label="Parameter B"]'), '/stg/env')
    tab.el.querySelector('[data-action="compare"]').click()
    await vi.waitFor(() => expect(tab.el.querySelector('.compare__result').textContent).toContain('/stg/env no longer exists.'))
  })
})

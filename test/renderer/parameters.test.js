// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PAGE_SIZE, createParametersTab } from '../../src/renderer/views/parameters.js'

const row = (i, extra = {}) => ({ name: `/app/p${String(i).padStart(4, '0')}`, type: 'String', tier: 'Standard', dataType: 'text', version: 1, lastModifiedDate: '2026-09-01T00:00:00.000Z', lastModifiedUser: 'arn:aws:iam::1:user/leo', description: '', keyId: null, allowedPattern: null, ...extra })
const many = (n) => Array.from({ length: n }, (_, i) => row(i))

function setup({ canWrite = true } = {}) {
  const handlers = { onOpen: vi.fn(), onRefresh: vi.fn(), onCreate: vi.fn(), onClearPrefix: vi.fn() }
  const tab = createParametersTab({ canWrite, ...handlers })
  document.body.append(tab.el)
  return { tab, ...handlers }
}
const names = (tab) => [...tab.el.querySelectorAll('.data-row')].map((tr) => tr.dataset.name)
const count = (tab) => tab.el.querySelector('.parameters__count').textContent
const search = (tab, value) => {
  const input = tab.el.querySelector('input[type="search"]')
  input.value = value
  input.dispatchEvent(new Event('input'))
}
const more = (tab) => tab.el.querySelector('.parameters__footer button')
const header = (tab, label) => [...tab.el.querySelectorAll('th')].find((th) => th.textContent === label)

afterEach(() => document.body.replaceChildren())

describe('createParametersTab', () => {
  it('shows skeleton rows while loading, then the AWS console columns', () => {
    const { tab } = setup()
    expect(tab.el.querySelectorAll('.skeleton-row').length).toBeGreaterThan(0)
    tab.setRows([row(1, { type: 'SecureString', description: 'Main env' })])
    expect([...tab.el.querySelectorAll('th')].map((th) => th.textContent)).toEqual(['Name', 'Tier', 'Type', 'Data type', 'Version', 'Last modified', 'Last modified user', 'Description'])
    const cells = [...tab.el.querySelectorAll('.data-row td')].map((td) => td.textContent)
    expect([cells[0], cells[1], cells[2], cells[3], cells[4], cells[7]]).toEqual(['/app/p0001', 'Standard', 'SecureString', 'text', '1', 'Main env'])
    expect(count(tab)).toBe('1 parameter')
  })

  it('opens a parameter on click and on Enter', () => {
    const { tab, onOpen } = setup()
    const rows = [row(1)]
    tab.setRows(rows)
    const tr = tab.el.querySelector('.data-row')
    tr.click()
    tr.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(onOpen).toHaveBeenCalledTimes(2)
    expect(onOpen).toHaveBeenCalledWith(rows[0])
  })

  it('renders 500 rows at a time with a "Show more" button', () => {
    const { tab } = setup()
    tab.setRows(many(1200))
    expect(tab.el.querySelectorAll('.data-row')).toHaveLength(PAGE_SIZE)
    expect(more(tab).textContent).toBe('Show 500 more (700 remaining)')
    more(tab).click()
    expect(tab.el.querySelectorAll('.data-row')).toHaveLength(1000)
    expect(more(tab).textContent).toBe('Show 200 more (200 remaining)')
    more(tab).click()
    expect(tab.el.querySelectorAll('.data-row')).toHaveLength(1200)
    expect(more(tab)).toBeNull()
  })

  it('searches every row, not only the rendered ones', () => {
    const { tab } = setup()
    tab.setRows(many(1200))
    search(tab, 'p1199')
    expect(names(tab)).toEqual(['/app/p1199'])
    expect(count(tab)).toBe('1 match of 1,200')
  })

  it('sorts by a column header and toggles the direction', () => {
    const { tab } = setup()
    tab.setRows([row(1, { version: 10 }), row(2, { version: 2 }), row(3, { version: 3 })])
    header(tab, 'Version').querySelector('button').click()
    expect(names(tab)).toEqual(['/app/p0002', '/app/p0003', '/app/p0001'])
    header(tab, 'Version').querySelector('button').click()
    expect(names(tab)).toEqual(['/app/p0001', '/app/p0003', '/app/p0002'])
    expect(header(tab, 'Version').getAttribute('aria-sort')).toBe('descending')
  })

  it('filters to a folder and clears it from the chip', () => {
    const { tab, onClearPrefix } = setup()
    tab.setRows([row(1, { name: '/a/x' }), row(2, { name: '/b/y' })])
    tab.setPrefix('/a')
    expect(names(tab)).toEqual(['/a/x'])
    expect(tab.el.querySelector('.prefix-chip').hidden).toBe(false)
    tab.el.querySelector('[data-action="clear-prefix"]').click()
    expect(names(tab)).toEqual(['/a/x', '/b/y'])
    expect(onClearPrefix).toHaveBeenCalled()
  })

  it('shows empty and error states', () => {
    const { tab } = setup()
    tab.setRows([])
    expect(tab.el.textContent).toContain('No parameters in this connection')
    tab.setRows([row(1)])
    search(tab, 'zzz')
    expect(tab.el.textContent).toContain('No parameters match')
    tab.setError({ message: 'Not allowed to list parameters.', hint: 'Check IAM' })
    expect(tab.el.textContent).toContain('Could not load parameters')
    expect(tab.el.textContent).toContain('Check IAM')
  })

  it('hides Create on read-only connections and passes the folder to onCreate', () => {
    expect(setup({ canWrite: false }).tab.el.querySelector('[data-action="create"]')).toBeNull()
    const { tab, onCreate, onRefresh } = setup()
    tab.setPrefix('/a')
    tab.el.querySelector('[data-action="create"]').click()
    tab.el.querySelector('[data-action="refresh"]').click()
    expect(onCreate).toHaveBeenCalledWith('/a')
    expect(onRefresh).toHaveBeenCalled()
  })
})

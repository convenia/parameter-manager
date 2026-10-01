// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { compareEnv, diffEnv } from '@shared/diff.js'
import { renderCompare, renderDiff } from '../../src/renderer/components/diff-view.js'

const MASK = '••••••••'
const rowsOf = (el) => [...el.querySelectorAll('.diff__row')].map((tr) => [tr.dataset.kind, tr.dataset.key, ...[...tr.querySelectorAll('.diff__value')].map((td) => td.textContent)])
const chips = (el) => [...el.querySelectorAll('.diff-chip')].map((c) => c.textContent)

afterEach(() => document.body.replaceChildren())

describe('renderDiff in key mode', () => {
  const diff = diffEnv('A=1\nB=2\nC=3', 'A=1\nB=20\nD=4')

  it('summarizes and lists changed keys with masked values', () => {
    const { el } = renderDiff(diff, { masked: true })
    expect(chips(el)).toEqual(['+1 added', '~1 changed', '−1 removed'])
    expect(el.querySelector('.diff__unchanged').textContent).toBe('1 unchanged')
    expect(rowsOf(el)).toEqual([
      ['added', 'D', '—', MASK],
      ['changed', 'B', MASK, MASK],
      ['removed', 'C', MASK, '—']
    ])
  })

  it('reveals one row, or every row with the toggle', () => {
    const { el } = renderDiff(diff, { masked: true })
    el.querySelector('[aria-label="Reveal B"]').click()
    expect(rowsOf(el)[1]).toEqual(['changed', 'B', '2', '20'])
    expect(rowsOf(el)[0][3]).toBe(MASK)
    el.querySelector('.diff__toggle').click()
    expect(rowsOf(el)).toEqual([
      ['added', 'D', '—', '4'],
      ['changed', 'B', '2', '20'],
      ['removed', 'C', '3', '—']
    ])
    expect(el.querySelector('.diff__toggle').textContent).toBe('Hide values')
  })

  it('shows values directly when masking is off', () => {
    const { el } = renderDiff(diff, { masked: false })
    expect(el.querySelector('.diff__toggle')).toBeNull()
    expect(rowsOf(el)[0]).toEqual(['added', 'D', '—', '4'])
  })

  it('explains comment-only and empty diffs', () => {
    expect(renderDiff(diffEnv('A=1', '# c\nA=1')).el.querySelector('.diff__empty').textContent).toBe('No variable changes — only comments or formatting changed.')
    expect(renderDiff(diffEnv('A=1', 'A=1')).el.querySelector('.diff__empty').textContent).toBe('No changes.')
  })
})

describe('renderDiff in line mode', () => {
  it('hides the line diff behind Reveal while masked, then mounts a MergeView', () => {
    const view = renderDiff(diffEnv('{"a":1}', '{"a":2}'), { masked: true })
    document.body.append(view.el)
    expect(view.el.querySelector('.cm-mergeView')).toBeNull()
    view.el.querySelector('[data-action="reveal-lines"]').click()
    expect(view.el.querySelector('.cm-mergeView')).not.toBeNull()
    view.destroy()
  })

  it('mounts the MergeView immediately when masking is off', () => {
    const view = renderDiff(diffEnv('{"a":1}', '{"a":2}'), { masked: false })
    document.body.append(view.el)
    expect(view.el.querySelector('.cm-mergeView')).not.toBeNull()
    view.destroy()
  })
})

describe('renderCompare', () => {
  const result = compareEnv('A=1\nB=1\nX=s', 'A=2\nC=3\nX=s')

  it('summarizes the buckets and lists differences first, hiding equal keys', () => {
    const { el } = renderCompare(result, { masked: false, labels: ['prod', 'staging'] })
    expect(chips(el)).toEqual(['1 different', '1 only in A', '1 only in B', '1 equal'])
    expect(rowsOf(el)).toEqual([
      ['different', 'A', '1', '2'],
      ['onlyA', 'B', '1', '—'],
      ['onlyB', 'C', '—', '3']
    ])
    expect([...el.querySelectorAll('th')].map((th) => th.textContent)).toContain('A · prod')
  })

  it('shows equal keys on request', () => {
    const { el } = renderCompare(result, { masked: false })
    const box = el.querySelector('input[name="showEqual"]')
    box.checked = true
    box.dispatchEvent(new Event('change'))
    expect(rowsOf(el).at(-1)).toEqual(['equal', 'X', 's', 's'])
  })

  it('masks compare values until revealed', () => {
    const { el } = renderCompare(result, { masked: true })
    expect(rowsOf(el)[0]).toEqual(['different', 'A', MASK, MASK])
  })

  it('explains when a side is not .env', () => {
    const { el } = renderCompare(compareEnv('A=1', '{"x":1}'), { labels: ['left', 'right'] })
    expect(el.textContent).toContain('right is not in .env format.')
  })
})

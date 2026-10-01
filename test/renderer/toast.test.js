// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mountToasts, toast, toastError } from '../../src/renderer/components/toast.js'

beforeEach(() => {
  document.body.replaceChildren()
  mountToasts()
})

describe('toast', () => {
  it('shows title, message, and hint with the kind class', () => {
    toast({ kind: 'success', title: 'Saved', message: 'All good', hint: 'Nothing else to do' })
    const el = document.querySelector('.toasts .toast')
    expect(el.classList.contains('toast--success')).toBe(true)
    expect(el.querySelector('.toast__title').textContent).toBe('Saved')
    expect(el.querySelector('.toast__message').textContent).toBe('All good')
    expect(el.querySelector('.toast__hint').textContent).toBe('Nothing else to do')
  })

  it('removes itself after the timeout, and stays when timeout is 0', () => {
    vi.useFakeTimers()
    toast({ message: 'short', timeout: 1000 })
    toast({ message: 'sticky', timeout: 0 })
    vi.advanceTimersByTime(1000)
    expect([...document.querySelectorAll('.toast__message')].map((t) => t.textContent)).toEqual(['sticky'])
    vi.useRealTimers()
  })

  it('dismisses on the close button', () => {
    toast({ message: 'bye' })
    document.querySelector('.toast__close').click()
    expect(document.querySelector('.toast')).toBeNull()
  })

  it('toastError shows the message and hint and logs the error', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const err = Object.assign(new Error('Not allowed'), { hint: 'Check IAM' })
    toastError(err, 'Save failed')
    const el = document.querySelector('.toast--error')
    expect(el.getAttribute('role')).toBe('alert')
    expect(el.textContent).toContain('Save failed')
    expect(el.textContent).toContain('Not allowed')
    expect(el.textContent).toContain('Check IAM')
    expect(log).toHaveBeenCalledWith(err)
  })
})

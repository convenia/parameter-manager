import { expect, test } from '@playwright/test'
import { connect, launchDemo, openParameter, replaceLine } from './helpers.js'

const tryUnload = (page) =>
  page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    return event.defaultPrevented
  })

test('unsaved edits stop the window from closing until they are reverted', async () => {
  const demo = await launchDemo()
  const { page } = demo
  try {
    await connect(page, 'Demo — all parameters')
    expect(await tryUnload(page)).toBe(false)

    await openParameter(page, '/myapp/dev/env')
    await replaceLine(page, 'APP_DEBUG=', 'APP_DEBUG=false')
    expect(await tryUnload(page)).toBe(true)

    await page.locator('.param:not([hidden]) [data-action="revert"]').click()
    await page.locator('.modal [data-action="confirm"]').click()
    expect(await tryUnload(page)).toBe(false)
  } finally {
    await demo.close()
  }
})

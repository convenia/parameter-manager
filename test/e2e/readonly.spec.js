import { expect, test } from '@playwright/test'
import { connect, launchDemo, openParameter } from './helpers.js'

test('a read-only connection lists only its prefix and offers no write actions', async () => {
  const demo = await launchDemo()
  const { page } = demo
  try {
    await connect(page, 'Demo — production (read-only)')
    await expect(page.locator('.parameters__count')).toHaveText('5 parameters')
    await expect(page.locator('[data-action="create"]')).toHaveCount(0)

    await openParameter(page, '/myapp/prod/env')
    const param = page.locator('.param:not([hidden])')
    await expect(param.locator('[data-action="save"]')).toHaveCount(0)
    await expect(param.locator('[data-action="delete"]')).toHaveCount(0)
    await expect(param.locator('.cm-content')).toHaveAttribute('contenteditable', 'false')
  } finally {
    await demo.close()
  }
})

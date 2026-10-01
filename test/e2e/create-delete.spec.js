import { expect, test } from '@playwright/test'
import { connect, launchDemo } from './helpers.js'

test('create a parameter, then delete it', async () => {
  const demo = await launchDemo()
  const { page } = demo
  try {
    await connect(page, 'Demo — all parameters')
    await page.locator('.sidebar [data-action="create"]').click()

    const modal = page.locator('.modal')
    await modal.locator('input[name="name"]').fill('/e2e/new/env')
    await modal.locator('.cm-content').click()
    await page.keyboard.type('E2E=1')
    await modal.locator('[data-action="confirm"]').click()

    const param = page.locator('.param:not([hidden])')
    await expect(param.locator('h2')).toHaveText('/e2e/new/env')
    await expect(param.locator('.param__version')).toHaveText('Version 1')
    await expect(page.locator('.parameters__count')).toHaveText('20 parameters')

    await param.locator('[data-action="delete"]').click()
    await page.locator('.modal input').fill('/e2e/new/env')
    await page.locator('.modal [data-action="confirm"]').click()

    await expect(page.locator('.tab', { hasText: 'new/env' })).toHaveCount(0)
    await expect(page.locator('.data-row[data-name="/e2e/new/env"]')).toHaveCount(0)
    await expect(page.locator('.parameters__count')).toHaveText('19 parameters')
  } finally {
    await demo.close()
  }
})

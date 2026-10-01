import { expect, test } from '@playwright/test'
import { connect, launchDemo, openParameter, replaceLine } from './helpers.js'

test('edit a .env parameter, review the diff, save, and find the old version in history', async () => {
  const demo = await launchDemo()
  const { page } = demo
  try {
    await connect(page, 'Demo — all parameters')
    await expect(page.locator('.parameters__count')).toHaveText('19 parameters')

    await openParameter(page, '/myapp/staging/env')
    const param = page.locator('.param:not([hidden])')
    await expect(param.locator('.param__version')).toHaveText('Version 2')

    await replaceLine(page, 'APP_DEBUG=', 'APP_DEBUG=false')
    await expect(param.locator('.param__dirty')).toBeVisible()
    await page.keyboard.press('Control+S')

    const modal = page.locator('.modal')
    await expect(modal.locator('.diff__row')).toHaveCount(1)
    await expect(modal.locator('.diff__row')).toHaveAttribute('data-key', 'APP_DEBUG')
    await expect(modal.locator('.diff-chip--changed')).toHaveText('~1 changed')
    await modal.locator('[data-action="confirm"]').click()

    await expect(param.locator('.param__version')).toHaveText('Version 3')
    await expect(page.locator('.toast--success')).toContainText('version 3')
    await expect(param.locator('.param__dirty')).toBeHidden()

    await param.locator('[data-subtab="history"]').click()
    await expect(param.locator('.history__item')).toHaveCount(3)
    await expect(param.locator('.history__item').first()).toContainText('Current')
  } finally {
    await demo.close()
  }
})

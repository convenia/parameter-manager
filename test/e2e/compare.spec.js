import { expect, test } from '@playwright/test'
import { connect, launchDemo, openParameter } from './helpers.js'

test('compare the production and staging .env files', async () => {
  const demo = await launchDemo()
  const { page } = demo
  try {
    await connect(page, 'Demo — all parameters')
    await openParameter(page, '/myapp/prod/env')
    await page.locator('.sidebar [data-action="compare"]').click()

    const compare = page.locator('.compare:not([hidden])')
    await expect(compare.locator('input[aria-label="Parameter A"]')).toHaveValue('/myapp/prod/env')
    await compare.locator('input[aria-label="Parameter B"]').fill('/myapp/staging/env')
    await compare.locator('[data-action="compare"]').click()

    await expect(compare.locator('.diff-chip')).toHaveText(['6 different', '1 only in A', '1 only in B', '6 equal'])
    await compare.locator('.diff__toggle').click()
    await expect(compare.locator('.diff__row[data-key="SENTRY_DSN"]')).toContainText('https://public@sentry.example.com/1')
  } finally {
    await demo.close()
  }
})

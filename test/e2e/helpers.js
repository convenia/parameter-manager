import { _electron as electron } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Every spec gets its own fake backend and an empty userData folder, so no state leaks.
export async function launchDemo() {
  const userData = mkdtempSync(join(tmpdir(), 'vault-e2e-'))
  const app = await electron.launch({ args: ['out/main/index.js'], env: { ...process.env, VAULT_FAKE_SSM: '1', VAULT_USER_DATA: userData } })
  const page = await app.firstWindow()
  await page.locator('.connections-screen').waitFor()
  return {
    app,
    page,
    async close() {
      await app.close()
      rmSync(userData, { recursive: true, force: true })
    }
  }
}

export async function connect(page, name) {
  await page.locator('.connection-item', { hasText: name }).click()
  await page.locator('[data-action="connect"]').click()
  await page.locator('.workspace .data-row').first().waitFor()
}

export async function openParameter(page, name) {
  await page.locator(`.data-row[data-name="${name}"]`).click()
  await page.locator('.param:not([hidden]) .cm-content').waitFor()
}

// Replaces the editor line containing `marker` by typing, the way a person would.
export async function replaceLine(page, marker, text) {
  await page.locator('.param:not([hidden]) .cm-line', { hasText: marker }).first().click()
  await page.keyboard.press('Home')
  await page.keyboard.press('Shift+End')
  await page.keyboard.type(text)
}

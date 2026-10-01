/**
 * The renderer never navigates. In development the only allowed origin is the Vite
 * dev server (full reloads); in production every navigation is blocked.
 * @param {string} url
 * @param {string | undefined} devServerUrl
 */
export function isAllowedNavigation(url, devServerUrl) {
  if (!devServerUrl) return false
  try {
    return new URL(url).origin === new URL(devServerUrl).origin
  } catch {
    return false
  }
}

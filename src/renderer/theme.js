export function resolveTheme(setting, prefersDark) {
  if (setting === 'light' || setting === 'dark') return setting
  return prefersDark ? 'dark' : 'light'
}

// Sets <html data-theme>. For "system" it follows OS changes. Returns a disposer.
export function applyTheme(setting, root = document.documentElement, media = window.matchMedia?.('(prefers-color-scheme: dark)')) {
  const update = () => {
    root.dataset.theme = resolveTheme(setting, Boolean(media?.matches))
  }
  update()
  if (setting !== 'system' || !media) return () => {}
  media.addEventListener('change', update)
  return () => media.removeEventListener('change', update)
}

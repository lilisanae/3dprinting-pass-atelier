export type Theme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'pass-atelier-ui-theme';

export function readTheme(): Theme {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    /* private mode */
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    /* private mode */
  }
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', theme === 'dark' ? '#1a1619' : '#fff8f3');
}

export function nextTheme(theme: Theme): Theme {
  return theme === 'dark' ? 'light' : 'dark';
}

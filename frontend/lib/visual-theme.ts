export type VisualTheme = 'system' | 'light' | 'dark';
export const THEME_KEY = 'ponto:visual-theme';
let fallback: VisualTheme = 'system';
export function validTheme(value: unknown): VisualTheme { return value === 'light' || value === 'dark' ? value : 'system'; }
export function resolveTheme(theme: VisualTheme, systemDark: boolean): 'light' | 'dark' { return theme === 'system' ? (systemDark ? 'dark' : 'light') : theme; }
export function themePreference(): VisualTheme {
  try { return validTheme(localStorage.getItem(THEME_KEY) ?? fallback); } catch { return fallback; }
}
export function setVisualTheme(value: VisualTheme) {
  fallback = validTheme(value);
  try { localStorage.setItem(THEME_KEY, fallback); } catch { /* Preferência continua válida nesta janela. */ }
  window.dispatchEvent(new Event('ponto:theme'));
}
export function themeSnapshot() {
  if (typeof window === 'undefined') return 'system:light';
  const preference = themePreference();
  return preference + ':' + resolveTheme(preference, window.matchMedia('(prefers-color-scheme: dark)').matches);
}
export function subscribeTheme(listener: () => void) {
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  media.addEventListener('change', listener); window.addEventListener('storage', listener); window.addEventListener('ponto:theme', listener);
  return () => { media.removeEventListener('change', listener); window.removeEventListener('storage', listener); window.removeEventListener('ponto:theme', listener); };
}

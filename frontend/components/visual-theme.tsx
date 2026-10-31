'use client';
import { Sun, Moon, Monitor } from 'lucide-react';
import { useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { setVisualTheme, subscribeTheme, themeSnapshot, type VisualTheme } from '@/lib/visual-theme';
export function useVisualTheme() {
  const snapshot = useSyncExternalStore(subscribeTheme, themeSnapshot, () => 'system:light');
  const [preference, resolved] = snapshot.split(':') as [VisualTheme, 'light' | 'dark'];
  return { preference, resolved };
}
export function VisualThemeProvider({ children }: { children: ReactNode }) {
  const { resolved } = useVisualTheme();
  useEffect(() => { document.documentElement.classList.toggle('dark', resolved === 'dark'); document.documentElement.style.colorScheme = resolved; }, [resolved]);
  return children;
}
export function ThemeToggle() {
  const { preference, resolved } = useVisualTheme();
  const dark = resolved === 'dark';
  return <div className="theme-controls" aria-label="Aparência">
    <button type="button" role="switch" aria-label="Tema escuro" aria-checked={dark} className="theme-toggle" title={dark ? 'Mudar para tema claro' : 'Mudar para tema escuro'} onClick={() => setVisualTheme(dark ? 'light' : 'dark')}>
      <Sun size={18} aria-hidden="true" /><Moon size={18} aria-hidden="true" /><span className="theme-toggle-thumb" aria-hidden="true" />
    </button>
    <button type="button" className="theme-system" aria-label="Acompanhar tema do sistema" aria-pressed={preference === 'system'} title="Acompanhar tema do sistema" onClick={() => setVisualTheme('system')}><Monitor size={16} aria-hidden="true" /></button>
  </div>;
}

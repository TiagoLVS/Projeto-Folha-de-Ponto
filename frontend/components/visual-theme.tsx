'use client';
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
export function ThemeSettings() {
  const { preference } = useVisualTheme();
  return <section className="academic-panel theme-settings"><h2>Aparência</h2><p>Escolha o tema deste computador. Em Sistema, a aparência acompanha as mudanças do Windows ou do navegador.</p><fieldset><legend>Tema</legend>{([['system', 'Sistema'], ['light', 'Claro'], ['dark', 'Escuro']] as const).map(([value, label]) => <label key={value}><input type="radio" name="visual-theme" value={value} checked={preference === value} onChange={() => setVisualTheme(value)} />{label}</label>)}</fieldset></section>;
}

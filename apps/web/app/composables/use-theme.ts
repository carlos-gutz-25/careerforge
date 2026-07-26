// Three-state theme control (M8-06, Dusk Console). The choice drives
// `data-theme` on <html>, which pins `color-scheme` (base.css) and thus what
// light-dark() resolves to in tokens.css. 'system' clears the attribute so the
// tokens.css `color-scheme: light dark` follows the OS. Persisted in
// localStorage; SPA-mode (ssr:false) means this is all client-side.

export type ThemeChoice = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'careerforge-theme';
export const THEME_CHOICES: readonly ThemeChoice[] = ['system', 'light', 'dark'];

const LABELS: Record<ThemeChoice, string> = {
  system: 'System',
  light: 'Light',
  dark: 'Dark',
};

function isChoice(value: unknown): value is ThemeChoice {
  return value === 'system' || value === 'light' || value === 'dark';
}

/** Reflect the choice onto <html data-theme>; 'system' removes the override. */
function applyToDocument(choice: ThemeChoice): void {
  if (!import.meta.client) return;
  const root = document.documentElement;
  if (choice === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', choice);
}

export function useTheme() {
  // Shared reactive state across all callers (Nuxt useState).
  const theme = useState<ThemeChoice>('theme', () => 'system');

  function setTheme(choice: ThemeChoice): void {
    theme.value = choice;
    if (import.meta.client) {
      try {
        localStorage.setItem(STORAGE_KEY, choice);
      } catch {
        // localStorage blocked (private mode): the in-memory choice still applies.
      }
      applyToDocument(choice);
    }
  }

  function cycle(): void {
    const index = THEME_CHOICES.indexOf(theme.value);
    // Modulo keeps the index in range; the ?? satisfies noUncheckedIndexedAccess.
    setTheme(THEME_CHOICES[(index + 1) % THEME_CHOICES.length] ?? 'system');
  }

  /** Read the persisted choice and apply it. Call once on client mount. */
  function initTheme(): void {
    if (!import.meta.client) return;
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(STORAGE_KEY);
    } catch {
      stored = null;
    }
    if (isChoice(stored)) theme.value = stored;
    applyToDocument(theme.value);
  }

  const label = computed(() => LABELS[theme.value]);

  return { theme, label, setTheme, cycle, initTheme, THEME_CHOICES };
}

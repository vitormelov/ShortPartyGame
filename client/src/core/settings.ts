/** Player preferences from the Opções screen, kept in this browser. */
export interface Settings {
  volume: number; // 0..10
}

const KEY = 'shortparty.settings';
const DEFAULTS: Settings = { volume: 8 };

export function loadSettings(): Settings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Private mode / blocked storage: the setting just won't stick.
  }
}

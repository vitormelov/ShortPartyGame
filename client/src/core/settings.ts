/** Player preferences from the Opções screen, kept in this browser. */
export interface Settings {
  volume: number; // 0..10
  /** Draw the minigames, events and menus in 3D (Nintendo 64 style); off = the 2D version. */
  visual3d: boolean;
  /** Which 3D cast: the Mario Party 2 test models (local only) or the own low-poly emojis. */
  cast3d: 'n64' | 'own';
}

const KEY = 'shortparty.settings';
const DEFAULTS: Settings = { volume: 8, visual3d: true, cast3d: 'n64' };

let cached: Settings | null = null;

export function loadSettings(): Settings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

/** The current settings without hitting storage every frame (renderers read this). */
export function settings(): Settings {
  return (cached ??= loadSettings());
}

export function saveSettings(s: Settings): void {
  cached = { ...s };
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Private mode / blocked storage: the setting just won't stick.
  }
}

/*
 * The soundtrack, written as tiny scores. Every minigame has its own song in its own genre and key,
 * so a swipe is recognized by ear in half a second. All of them aim for the same thing: fast,
 * driving, catchy, never settled — a hook you can hum after one clip, and a beat that keeps you on edge.
 */

export type Inst =
  | 'lead'
  | 'pluck'
  | 'arp'
  | 'bass'
  | 'pad'
  | 'stab'
  | 'bell'
  | 'acid'
  | 'sub'
  | 'epiano'
  | 'organ'
  | 'accordion'
  | 'whistle'
  | 'brass'
  | 'marimba'
  | 'kick'
  | 'snare'
  | 'clap'
  | 'hat'
  | 'ohat'
  | 'tom'
  | 'tri'
  | 'tick';

export interface NoteEvent {
  inst: Inst;
  midi: number; // ignored by drums
  len: number; // in steps
  vel: number; // 0..1
  /** Only plays once the heat is up (0..1). */
  heat?: number;
}

export interface Track {
  bpm: number;
  /** Loop length in steps (sixteenth notes). */
  length: number;
  /** 0..0.5: how late the off-beat sixteenths land (swing / shuffle). */
  swing: number;
  steps: NoteEvent[][];
}

// ---------- composing helpers ----------

const NOTE: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** 'C#5' -> MIDI number. */
export function midi(name: string): number {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(name);
  if (!m) throw new Error(`bad note ${name}`);
  return NOTE[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + (Number(m[3]) + 1) * 12;
}

const QUALITY: Record<string, number[]> = {
  '': [0, 4, 7],
  m: [0, 3, 7],
  dim: [0, 3, 6],
  '7': [0, 4, 7, 10],
  m7: [0, 3, 7, 10],
  maj7: [0, 4, 7, 11],
  sus: [0, 5, 7],
};

/** 'Am' -> [A4, C5, E5] (as MIDI), rooted at `octave`. */
export function chord(name: string, octave = 4): number[] {
  const m = /^([A-G][#b]?)(.*)$/.exec(name)!;
  const root = midi(`${m[1]}${octave}`);
  return QUALITY[m[2]].map((i) => root + i);
}

/** Problems found while composing (checked by `npm run music:check`). */
export const COMPOSE_ERRORS: string[] = [];

class Composer {
  readonly steps: NoteEvent[][];
  constructor(
    readonly bars: number,
    readonly spb = 16, // steps per bar: 16 = 4/4, 12 = 3/4
  ) {
    this.steps = Array.from({ length: bars * spb }, () => []);
  }

  private push(at: number, ev: NoteEvent): void {
    this.steps[((at % this.steps.length) + this.steps.length) % this.steps.length].push(ev);
  }

  /**
   * One string per bar of space-separated tokens: a note ('E5'), '-' to hold the previous note,
   * '.' for silence; for drums, 'x' is a hit and 'X' an accent. A bar may have `spb` tokens
   * (sixteenths) or `spb / 2` (eighths).
   */
  line(inst: Inst, bars: string[], vel = 0.8, heat?: number, fromBar = 0): this {
    bars.forEach((bar, b) => {
      const toks = bar.trim().split(/\s+/);
      const span = toks.length === this.spb ? 1 : toks.length === this.spb / 2 ? 2 : 0;
      if (!span) {
        COMPOSE_ERRORS.push(`${inst} bar ${fromBar + b}: ${toks.length} tokens`);
        return;
      }
      let last: NoteEvent | null = null;
      toks.forEach((tok, i) => {
        const at = (fromBar + b) * this.spb + i * span;
        if (tok === '-') {
          if (last) last.len += span;
          return;
        }
        last = null;
        if (tok === '.') return;
        const isDrum = tok === 'x' || tok === 'X';
        const ev: NoteEvent = { inst, midi: isDrum ? 0 : midi(tok), len: span, vel: tok === 'X' ? Math.min(1, vel * 1.25) : vel, heat };
        this.push(at, ev);
        last = ev;
      });
    });
    return this;
  }

  /** The same drum bar on every bar. */
  drums(inst: Inst, bar: string, vel = 0.8, heat?: number): this {
    return this.line(inst, Array(this.bars).fill(bar), vel, heat);
  }

  /** Octave-pumping eighths on each bar's root (pop / eurobeat bass). */
  pumpBass(roots: string[], vel = 0.8, inst: Inst = 'bass'): this {
    roots.forEach((r, b) => {
      const lo = midi(r);
      for (let i = 0; i < this.spb; i += 2) this.push(b * this.spb + i, { inst, midi: i % 4 === 0 ? lo : lo + 12, len: 2, vel });
    });
    return this;
  }

  /** Rolling sixteenths on the root, octave jump at the end of the bar (the gallop). */
  rollBass(roots: string[], vel = 0.75, inst: Inst = 'bass'): this {
    roots.forEach((r, b) => {
      const lo = midi(r);
      for (let i = 0; i < this.spb; i++) this.push(b * this.spb + i, { inst, midi: i >= this.spb - 2 ? lo + 12 : lo, len: 1, vel: i % 4 === 0 ? vel : vel * 0.7 });
    });
    return this;
  }

  /** Sixteenth-note arpeggio through each bar's chord ('Am', 'F'...). */
  arp(chords: string[], octave: number, inst: Inst = 'arp', vel = 0.5, heat?: number, shape = [0, 1, 2, 3, 2, 1], every = 1): this {
    chords.forEach((name, b) => {
      const tones = chord(name, octave);
      const up = [...tones.slice(0, 3), tones[0] + 12, tones[1] + 12];
      for (let i = 0; i < this.spb; i += every) this.push(b * this.spb + i, { inst, midi: up[shape[(i / every) % shape.length] % up.length], len: every, vel, heat });
    });
    return this;
  }

  /** Whole-bar chords. */
  pad(chords: string[], octave: number, vel = 0.4, heat?: number, inst: Inst = 'pad'): this {
    chords.forEach((name, b) => chord(name, octave).forEach((n) => this.push(b * this.spb, { inst, midi: n, len: this.spb, vel, heat })));
    return this;
  }

  /** Chord hits on the given steps of every bar. */
  stabs(chords: string[], octave: number, at: number[], vel = 0.5, heat?: number, inst: Inst = 'stab', len = 1): this {
    chords.forEach((name, b) => at.forEach((s) => chord(name, octave).forEach((n) => this.push(b * this.spb + s, { inst, midi: n, len, vel, heat }))));
    return this;
  }

  /** A snare fill over the last beat of the given bar. */
  fill(bar: number, inst: Inst = 'snare'): this {
    for (let i = this.spb - 4; i < this.spb; i++) this.push(bar * this.spb + i, { inst, midi: 0, len: 1, vel: 0.45 + (i - this.spb + 4) * 0.15 });
    return this;
  }

  done(bpm: number, swing = 0): Track {
    return { bpm, length: this.steps.length, swing, steps: this.steps };
  }
}

const twice = <T>(a: T[]): T[] => [...a, ...a];

// Drum bars (16 steps).
const KICK4 = 'X . . . x . . . X . . . x . . .';
const HATS = 'x x x x x x x x x x x x x x x x';
const HAT8 = 'x . x . x . x . x . x . x . x .';
const OFFHAT = '. . x . . . x . . . x . . . x .';
const BACKBEAT = '. . . . x . . . . . . . x . . .';

// ---------- menus ----------

/** SHORT PARTY (theme): vi-IV-I-V, the most addictive progression in pop, over the 4-note jingle. */
function theme(): Track {
  const ch = twice(['Am', 'F', 'C', 'G']);
  return new Composer(8)
    .line('lead', [
      'E5 - - G5 - - D6 - C6 - - - . . A5 C6',
      'C6 - A5 - F5 - A5 - C6 - D6 - C6 - A5 -',
      'E5 - - G5 - - D6 - C6 - - - . . G5 C6',
      'D6 - - - B5 - G5 - B5 - D6 - E6 - D6 -',
      'E6 - - D6 - - C6 - D6 - - - E6 - G6 -',
      'F6 - - E6 - - C6 - A5 - - - C6 - D6 -',
      'E6 - - G5 - - C6 - E6 - D6 - C6 - G5 -',
      'B5 - D6 - G6 - - - F6 - E6 - D6 - B5 -',
    ])
    .pumpBass(['A2', 'F2', 'C2', 'G2', 'A2', 'F2', 'C2', 'G2'])
    .arp(ch, 4, 'arp', 0.32)
    .pad(ch, 4, 0.22)
    .stabs(ch, 4, [3, 6, 11], 0.3, 0.4)
    .drums('kick', KICK4, 0.9)
    .drums('clap', BACKBEAT, 0.7)
    .drums('hat', HATS, 0.35)
    .drums('ohat', OFFHAT, 0.4)
    .fill(3)
    .fill(7)
    .done(150);
}

// ---------- minigames ----------

/** KART RUSH: eurobeat. i-VI-VII-V in D minor, a riff that never sits still, octave bass. */
function kart(): Track {
  const ch = twice(['Dm', 'Bb', 'C', 'A']);
  return new Composer(8)
    .line('lead', [
      'D5 - F5 D5 A5 - G5 F5 E5 - F5 - D5 - A4 -',
      'Bb4 - D5 Bb4 F5 - E5 D5 C5 - D5 - Bb4 - F4 -',
      'C5 - E5 C5 G5 - F5 E5 D5 - E5 - C5 - G4 -',
      'C#5 - E5 C#5 A5 - G5 F5 E5 - D5 - C#5 - E5 -',
      'A5 - - F5 - - D5 - A5 - C6 - A5 - F5 -',
      'Bb5 - - F5 - - D5 - Bb5 - D6 - Bb5 - F5 -',
      'C6 - - G5 - - E5 - C6 - E6 - D6 - C6 -',
      'C#6 - - A5 - - E5 - C#6 - E6 - D6 - C#6 E6',
    ])
    .pumpBass(['D2', 'Bb1', 'C2', 'A1', 'D2', 'Bb1', 'C2', 'A1'], 0.85)
    .stabs(ch, 4, [2, 6, 10, 14], 0.38)
    .arp(ch, 4, 'pluck', 0.28, 0.4, [0, 2, 1, 3])
    .pad(ch, 3, 0.18)
    .drums('kick', KICK4, 0.95)
    .drums('snare', BACKBEAT, 0.6)
    .drums('hat', '. x . x . x . x . x . x . x . x', 0.4)
    .drums('ohat', OFFHAT, 0.45)
    .fill(3)
    .fill(7)
    .done(160);
}

/** BOMB FEED: ska-punk. Upstroke skank on every off-beat, walking bass, brass hook. G major, 170. */
function bomb(): Track {
  const ch = twice(['G', 'Em', 'C', 'D']);
  return new Composer(8)
    .line('brass', [
      'D5 - B4 - D5 - E5 - D5 - B4 - G4 - . .',
      'E5 - - G5 - - E5 - D5 - B4 - . . . .',
      'C5 - E5 - G5 - E5 - C5 - E5 - G5 - A5 -',
      'F#5 - - - A5 - - - D6 - - - . . . .',
      'D6 - B5 - D6 - E6 - D6 - B5 - G5 - . .',
      'E6 - - G6 - - E6 - D6 - B5 - . . G5 A5',
      'B5 - - C6 - - B5 - A5 - G5 - E5 - G5 -',
      'A5 - - - F#5 - - - D5 - - - D6 C6 B5 A5',
    ], 0.7)
    .stabs(ch, 4, [2, 6, 10, 14], 0.45, undefined, 'stab')
    .line('bass', [
      'G2 . B2 . D3 . B2 . G2 . B2 . D3 . E3 .',
      'E2 . G2 . B2 . G2 . E2 . G2 . B2 . D3 .',
      'C2 . E2 . G2 . E2 . C2 . E2 . G2 . A2 .',
      'D2 . F#2 . A2 . F#2 . D2 . F#2 . A2 . C3 .',
      'G2 . B2 . D3 . B2 . G2 . B2 . D3 . E3 .',
      'E2 . G2 . B2 . G2 . E2 . G2 . B2 . D3 .',
      'C2 . E2 . G2 . E2 . C2 . E2 . G2 . A2 .',
      'D2 . F#2 . A2 . F#2 . D2 . D2 . D2 . D2 .',
    ], 0.8)
    .drums('kick', 'X . . . . . . . X . x . . . . .', 0.9)
    .drums('snare', '. . . . X . . . . . . . X . . x', 0.65)
    .drums('hat', HAT8, 0.45)
    .drums('ohat', OFFHAT, 0.3, 0.4)
    .fill(7)
    .done(170);
}

/** METEOR FEED: drum'n'bass with an air-raid siren lead. F minor, 174, chopped breakbeat. */
function meteor(): Track {
  const ch = twice(['Fm', 'Db', 'Ab', 'Eb']);
  return new Composer(8)
    .line('lead', [
      'C6 - - - - - - - Db6 - - - - - C6 -',
      'Ab5 - - - - - - - F5 - - - - - Ab5 -',
      'C6 - - - - - - - Eb6 - - - Db6 - C6 -',
      'Bb5 - - - - - - - G5 - - - Bb5 - C6 -',
    ], 0.6, undefined, 4)
    .rollBass(['F1', 'Db2', 'Ab1', 'Eb2', 'F1', 'Db2', 'Ab1', 'Eb2'], 0.7)
    .arp(ch, 5, 'arp', 0.25, undefined, [0, 2, 1, 2, 0, 3])
    .pad(ch, 4, 0.2)
    .drums('kick', 'X . . . . . . . . . X . . . . .', 0.95)
    .drums('snare', '. . . . X . . x . . . . X . . .', 0.7)
    .drums('hat', HATS, 0.3)
    .drums('ohat', '. . x . . . . . . . x . . . . .', 0.35)
    .fill(3)
    .fill(7)
    .done(174);
}

/** LANTERNA FEED: a music box waltz in D minor with a heartbeat that won't calm down. 3/4. */
function lantern(): Track {
  const c = new Composer(8, 12);
  return c
    .line('bell', [
      'D6 - - - A5 - - - F5 - - -',
      'E5 - - - G5 - - - Bb5 - - -',
      'A5 - - - G#5 - - - A5 - - -',
      'C#6 - - - E6 - - - A5 - - -',
      'D6 - F6 - E6 - D6 - A5 - - -',
      'Bb5 - - - A5 - G5 - F5 - - -',
      'E5 - F5 - G#5 - B5 - D6 - - -',
      'C#6 - - - - - - - . . . .',
    ], 0.6)
    .line('bell', [
      'D4 . . . A4 . . . A4 . . .',
      'G3 . . . Bb4 . . . Bb4 . . .',
      'F3 . . . A4 . . . A4 . . .',
      'A3 . . . G4 . . . G4 . . .',
      'D4 . . . A4 . . . A4 . . .',
      'G3 . . . Bb4 . . . Bb4 . . .',
      'E3 . . . G#4 . . . D5 . . .',
      'A3 . . . C#5 . . . E5 . . .',
    ], 0.35)
    .drums('kick', 'X . x . . . . . . . . .', 0.7)
    .drums('tick', 'x . . x . . x . . x . .', 0.2, 0.3)
    .pad(['Dm', 'Gm', 'Dm', 'A', 'Dm', 'Gm', 'E', 'A'], 3, 0.15, 0.5)
    .done(150);
}

/** LASER GRID: acid techno. A squelching 303 line in A minor, 140, hats that never stop. */
function laser(): Track {
  const acid = [
    'A2 A2 A3 A2 C3 A2 G3 A2 A2 E3 A2 A3 G2 A2 C3 E3',
    'A2 A2 A3 A2 C3 A2 G3 A2 A2 E3 A2 A3 Bb2 A2 G2 E2',
  ];
  return new Composer(8)
    .line('acid', [...acid, ...acid, 'F2 F2 F3 F2 A2 F2 Eb3 F2 F2 C3 F2 F3 Eb2 F2 A2 C3', 'G2 G2 G3 G2 B2 G2 F3 G2 G2 D3 G2 G3 F2 G2 B2 D3', ...acid], 0.8)
    .line('stab', [
      '. . . . . . A4 . . . . . . . C5 .',
      '. . . . . . A4 . . . . . . E5 . .',
    ], 0.4, 0.4)
    .line('lead', [
      '. . . . . . . . . . . . . . . .',
      '. . . . . . . . . . . . . . . .',
      'E5 - - - - - - - D5 - - - C5 - - -',
      'B4 - - - D5 - - - B4 - - - G4 - - -',
    ], 0.55, undefined, 2)
    .drums('kick', KICK4, 1)
    .drums('clap', BACKBEAT, 0.6)
    .drums('hat', HATS, 0.3)
    .drums('ohat', OFFHAT, 0.5)
    .fill(7, 'clap')
    .done(140);
}

/** ELEVADOR SOCIAL: elevator bossa-muzak... played way too fast, while the lava rises. F major 7ths, 150. */
function elevator(): Track {
  const ch = twice(['Fmaj7', 'Dm7', 'Gm7', 'C7']);
  return new Composer(8)
    .line('epiano', [
      'A5 - - C6 - - E6 - D6 - - C6 - - A5 -',
      'F5 - - A5 - - C6 - - - A5 - G5 - F5 -',
      'Bb5 - - D6 - - F6 - E6 - - D6 - - Bb5 -',
      'G5 - - - E5 - - - C5 - - - Bb5 - A5 -',
      'A5 - C6 - E6 - G6 - F6 - E6 - C6 - A5 -',
      'F5 - A5 - C6 - E6 - D6 - C6 - A5 - F5 -',
      'G5 - Bb5 - D6 - F6 - E6 - D6 - Bb5 - G5 -',
      'E5 - - - G5 - - - Bb5 - - - C6 - - -',
    ], 0.6)
    .stabs(ch, 4, [0, 3, 6, 10, 13], 0.3, undefined, 'organ', 2)
    .line('bass', [
      'F2 . . F2 . . C3 . F2 . . A2 . . C3 .',
      'D2 . . D2 . . A2 . D2 . . F2 . . A2 .',
      'G2 . . G2 . . D3 . G2 . . Bb2 . . D3 .',
      'C2 . . C2 . . G2 . C2 . . E2 . . G2 .',
    ].concat([
      'F2 . . F2 . . C3 . F2 . . A2 . . C3 .',
      'D2 . . D2 . . A2 . D2 . . F2 . . A2 .',
      'G2 . . G2 . . D3 . G2 . . Bb2 . . D3 .',
      'C2 . . C2 . . G2 . C2 . C2 . C2 . C2 .',
    ]), 0.75)
    .drums('kick', 'X . . x . . x . X . . x . . x .', 0.6)
    .drums('tick', '. . x . . . x . . . x . . . x .', 0.5)
    .drums('hat', HATS, 0.3, 0.4)
    .drums('tri', 'x . . . . . . . x . . . . . . .', 0.3)
    .done(150, 0.12);
}

/** LASER BEAM: bullet-hell danmaku. C# minor, 180, a piano-ish arpeggio storm and a soaring lead. */
function beam(): Track {
  const ch = twice(['C#m', 'A', 'B', 'G#m']);
  return new Composer(8)
    .arp(ch, 5, 'pluck', 0.35, undefined, [0, 1, 2, 3, 4, 3, 2, 1])
    .line('lead', [
      'G#5 - - - E5 - - - C#6 - - - B5 - G#5 -',
      'A5 - - - C#6 - - - E6 - - - C#6 - - -',
      'F#6 - - - D#6 - - - B5 - - - A5 - G#5 -',
      'G#5 - - - - - - - D#6 - - - B5 - - -',
      'C#6 - B5 - G#5 - E5 - C#6 - E6 - G#6 - - -',
      'E6 - C#6 - A5 - E5 - A5 - C#6 - E6 - - -',
      'D#6 - B5 - F#5 - D#5 - F#5 - B5 - D#6 - F#6 -',
      'G#6 - - - D#6 - - - G#5 - - - . . . .',
    ], 0.7)
    .pumpBass(['C#2', 'A1', 'B1', 'G#1', 'C#2', 'A1', 'B1', 'G#1'], 0.75)
    .drums('kick', 'X . . . x . . x X . . . x . x .', 0.9)
    .drums('snare', BACKBEAT, 0.6)
    .drums('hat', HATS, 0.3)
    .fill(7)
    .done(180);
}

/** MIMIC ME: trap, like every viral dance challenge. 808 slides, triplet hat rolls, C minor, 140 half-time. */
function mimic(): Track {
  return new Composer(4)
    .line('sub', [
      'C2 - - - - - . C2 - - Eb2 - - - G1 -',
      'Ab1 - - - - - . Ab1 - - C2 - - - Bb1 -',
      'C2 - - - - - . C2 - - Eb2 - - - G2 -',
      'F1 - - - - - . F1 - - G1 - - - G1 -',
    ], 0.9)
    .line('bell', [
      'G5 . Eb5 . C5 . G5 . Ab5 . G5 . Eb5 . C5 .',
      'Ab5 . Eb5 . C5 . Ab5 . G5 . Eb5 . C5 . Bb4 .',
      'G5 . Eb5 . C5 . G5 . Ab5 . G5 . Eb5 . G5 .',
      'F5 . D5 . B4 . F5 . G5 . D5 . B4 . G4 .',
    ], 0.4)
    .pad(['Cm', 'Ab', 'Cm', 'G'], 4, 0.18)
    .drums('kick', 'X . . . . . . X . . X . . . . .', 0.95)
    .drums('clap', '. . . . . . . . X . . . . . . .', 0.75)
    .line('hat', [
      'x . x . x . x . x x x x x . x .',
      'x . x . x . x . x . x . x x x x',
      'x . x . x . x . x x x x x . x .',
      'x . x x x . x . x x x x x x x x',
    ], 0.35)
    .done(140);
}

/** TERMOS DE USO: upbeat corporate marimba — the music of a terms-of-service video, way too happy. C major, 128. */
function book(): Track {
  const ch = twice(['C', 'G', 'Am', 'F']);
  return new Composer(8)
    .line('marimba', [
      'C5 E5 G5 E5 C6 - G5 - E5 G5 C6 G5 E5 - D5 -',
      'B4 D5 G5 D5 B5 - G5 - D5 G5 B5 G5 D5 - G4 -',
      'A4 C5 E5 C5 A5 - E5 - C5 E5 A5 E5 C5 - B4 -',
      'A4 C5 F5 C5 A5 - F5 - C5 F5 A5 C6 A5 - G5 -',
    ], 0.55)
    .line('whistle', [
      '. . . . . . . . . . . . . . . .',
      '. . . . . . . . . . . . . . . .',
      '. . . . . . . . . . . . . . . .',
      '. . . . . . . . . . . . . . . .',
      'E6 - - - G6 - - - C6 - - - D6 - E6 -',
      'D6 - - - B5 - - - G5 - - - - - - -',
      'C6 - - - E6 - - - A6 - - - G6 - E6 -',
      'F6 - - - E6 - - - D6 - - - C6 - - -',
    ], 0.5)
    .pumpBass(['C2', 'G1', 'A1', 'F1', 'C2', 'G1', 'A1', 'F1'], 0.6)
    .pad(ch, 4, 0.15, 0.4)
    .drums('kick', KICK4, 0.7)
    .drums('clap', BACKBEAT, 0.6)
    .drums('tick', HAT8, 0.35)
    .done(128);
}

/** BOLHA SOCIAL: bubblegum future bass. Wobbling supersaw chords, bubbly plucks, E major, 150. */
function bubble(): Track {
  const ch = twice(['E', 'B', 'C#m', 'A']);
  return new Composer(8)
    .stabs(ch, 4, [0, 3, 6, 8, 10, 14], 0.45, undefined, 'stab', 2)
    .arp(ch, 5, 'marimba', 0.35, undefined, [0, 2, 4, 2], 2)
    .line('lead', [
      'G#5 - B5 - G#5 - E5 - F#5 - G#5 - - - . .',
      'F#5 - D#5 - B4 - D#5 - F#5 - - - . . . .',
      'E5 - G#5 - C#6 - B5 - G#5 - E5 - . . C#5 -',
      'E5 - - - F#5 - - - G#5 - - - B5 - - -',
    ], 0.6, 0.3, 4)
    .pumpBass(['E2', 'B1', 'C#2', 'A1', 'E2', 'B1', 'C#2', 'A1'], 0.8)
    .drums('kick', 'X . . . . . x . X . . . . . . .', 0.95)
    .drums('snare', BACKBEAT, 0.7)
    .drums('hat', HAT8, 0.35)
    .fill(3)
    .fill(7)
    .done(150);
}

/** CANCELAMENTO: a frantic ice polka. Oom-pah, accordion, G major, 180. */
function penguin(): Track {
  return new Composer(8)
    .line('accordion', [
      'B5 - D6 - B5 - G5 - D5 - G5 - B5 - D6 -',
      'C6 - A5 - F#5 - A5 - D6 - - - . . A5 -',
      'B5 - D6 - B5 - G5 - E6 - D6 - C6 - B5 -',
      'A5 - F#5 - D5 - F#5 - G5 - - - . . . .',
      'D6 - D6 - E6 - D6 - B5 - B5 - C6 - B5 -',
      'A5 - A5 - B5 - A5 - F#5 - F#5 - G5 - A5 -',
      'B5 - D6 - G6 - D6 - E6 - C6 - A5 - F#5 -',
      'G5 - B5 - D6 - - - G5 - - - . . . .',
    ], 0.6)
    .line('bass', [
      'G2 . . . D2 . . . G2 . . . D2 . . .',
      'D2 . . . A1 . . . D2 . . . A1 . . .',
      'G2 . . . D2 . . . C2 . . . G1 . . .',
      'D2 . . . A1 . . . G2 . . . D2 . . .',
      'G2 . . . D2 . . . G2 . . . D2 . . .',
      'D2 . . . A1 . . . D2 . . . A1 . . .',
      'G2 . . . D2 . . . C2 . . . D2 . . .',
      'G2 . . . D2 . . . G2 . . . G2 . . .',
    ], 0.8)
    .stabs(['G', 'D', 'G', 'D', 'G', 'D', 'G', 'G'], 4, [2, 6, 10, 14], 0.4, undefined, 'accordion')
    .drums('kick', 'X . . . X . . . X . . . X . . .', 0.7)
    .drums('snare', '. . x . . . x . . . x . . . x .', 0.4)
    .drums('tri', 'x . . . . . . . . . . . . . . .', 0.3, 0.4)
    .done(180);
}

/** CONTA OS HATERS: game-show thinking music with a clock that never stops ticking. B minor, 120. */
function count(): Track {
  return new Composer(4)
    .drums('tick', 'X . x . X . x . X . x . X . x .', 0.7)
    .line('epiano', [
      'B4 D5 F#5 D5 B4 D5 F#5 D5 B4 D5 F#5 D5 B4 D5 F#5 D5',
      'G4 B4 E5 B4 G4 B4 E5 B4 G4 B4 E5 B4 G4 B4 E5 B4',
      'B4 D5 F#5 D5 B4 D5 F#5 D5 B4 D5 F#5 D5 B4 D5 F#5 D5',
      'A#4 C#5 F#5 C#5 A#4 C#5 F#5 C#5 A#4 C#5 F#5 C#5 A#4 C#5 F#5 C#5',
    ], 0.3)
    .line('pluck', [
      'F#5 - - - . . . . G5 - - - . . . .',
      'F#5 - - - E5 - - - D5 - - - . . . .',
      'F#5 - - - . . . . G5 - - - . . A5 -',
      'A#5 - - - C#6 - - - E6 - - - F#6 - - -',
    ], 0.5)
    .line('bass', ['B1 - - - - - - - B1 - - - - - - -', 'E2 - - - - - - - E2 - - - - - - -', 'B1 - - - - - - - B1 - - - - - - -', 'F#1 - - - - - - - F#2 - - - F#1 - - -'], 0.7)
    .drums('kick', 'X . . . . . . . X . . . . . . .', 0.6, 0.3)
    .done(120);
}

/** CORDA QUENTE: forró acelerado. Zabumba, triangle on every sixteenth, accordion, A mixolydian, 170. */
function rope(): Track {
  return new Composer(8)
    .line('accordion', [
      'E5 - A5 - C#6 - E6 - D6 - C#6 - B5 - A5 -',
      'G5 - - - B5 - - - D6 - - - . . . .',
      'E5 - A5 - C#6 - E6 - F#6 - E6 - D6 - C#6 -',
      'B5 - G5 - E5 - D5 - E5 - - - . . . .',
      'A5 - A5 - G5 - A5 - C#6 - - - A5 - - -',
      'G5 - G5 - F#5 - G5 - B5 - - - G5 - - -',
      'A5 - C#6 - E6 - G6 - F#6 - E6 - D6 - B5 -',
      'A5 - - - E5 - - - A5 - - - . . . .',
    ], 0.65)
    .line('bass', [
      'A1 . . A1 . . E2 . A1 . . A1 . . E2 .',
      'G1 . . G1 . . D2 . G1 . . G1 . . D2 .',
      'A1 . . A1 . . E2 . A1 . . A1 . . E2 .',
      'E2 . . E2 . . B1 . E2 . . E2 . . B1 .',
    ].concat(['A1 . . A1 . . E2 . A1 . . A1 . . E2 .', 'G1 . . G1 . . D2 . G1 . . G1 . . D2 .', 'D2 . . D2 . . A1 . D2 . . D2 . . A1 .', 'A1 . . A1 . . E2 . A1 . A1 . A1 . A1 .']), 0.8)
    .drums('tom', 'X . . x . . X . X . . x . . X .', 0.75)
    .drums('tri', 'X x x x X x x x X x x x X x x x', 0.3)
    .drums('snare', '. . . . x . . . . . . . x . . .', 0.3)
    .done(170);
}

/** FILTRO CERTO: hyperpop. Glitchy chopped vocal-ish lead, super bright, D major, 160. */
function filter(): Track {
  const ch = twice(['D', 'A', 'Bm', 'G']);
  return new Composer(8)
    .line('lead', [
      'F#6 F#6 . F#6 E6 . D6 . A5 - - - B5 . D6 .',
      'E6 E6 . E6 C#6 . A5 . E6 - - - . . . .',
      'F#6 F#6 . F#6 D6 . B5 . D6 - - - F#6 . A6 .',
      'G6 - - - F#6 - - - E6 - - - D6 . E6 .',
    ].concat([
      'A6 . F#6 . D6 . A5 . A6 . F#6 . D6 . E6 .',
      'E6 . C#6 . A5 . E5 . E6 . C#6 . A5 . C#6 .',
      'F#6 . D6 . B5 . F#5 . F#6 . D6 . B5 . D6 .',
      'G6 . D6 . B5 . G5 . G6 - - - - - . .',
    ]), 0.55)
    .arp(ch, 5, 'arp', 0.25, 0.3, [0, 2, 1, 2])
    .pumpBass(['D2', 'A1', 'B1', 'G1', 'D2', 'A1', 'B1', 'G1'], 0.8, 'sub')
    .pad(ch, 4, 0.2)
    .drums('kick', 'X . . . . . X . X . . . . . . .', 1)
    .drums('clap', BACKBEAT, 0.75)
    .drums('hat', HATS, 0.3)
    .drums('snare', '. . . . . . . . . . . . . x x x', 0.4, 0.5)
    .done(160);
}

/** NÃO OLHE: suspense ostinato, two notes a half step apart that keep getting closer. E minor, 140. */
function look(): Track {
  return new Composer(4)
    .line('bass', [
      'E2 - . . F2 - . . E2 - . . F2 - . .',
      'E2 . F2 . E2 . F2 . E2 . F2 . E2 . F2 .',
      'E2 - . . F2 - . . E2 - . . F2 - . .',
      'E2 F2 E2 F2 E2 F2 E2 F2 E2 F2 E2 F2 E2 F2 E2 F2',
    ], 0.85)
    .line('stab', [
      'E4 . . E4 . . E4 . Bb4 . . Bb4 . . Bb4 .',
      'E4 . . E4 . . E4 . B4 . . B4 . . C5 .',
      'E4 . . E4 . . E4 . Bb4 . . Bb4 . . Bb4 .',
      'G4 . G4 . A4 . A4 . Bb4 . Bb4 . B4 . B4 .',
    ], 0.5)
    .line('brass', ['. . . . . . . . . . . . . . . .', '. . . . . . . . . . . . . . . .', 'E5 - - - - - - - Bb5 - - - - - - -', 'B5 - - - - - - - - - - - . . . .'], 0.5, 0.3)
    .drums('tom', 'X . . . . . . . X . . . . . x .', 0.8)
    .drums('snare', '. . . . . . . . . . . . x x x x', 0.4)
    .drums('hat', HAT8, 0.25)
    .done(140);
}

/** PONG DO CANCELAMENTO: arcade bleep-techno, all square waves. G minor, 150. */
function paddle(): Track {
  const ch = twice(['Gm', 'Eb', 'Bb', 'F']);
  return new Composer(8)
    .line('lead', [
      'G5 . G5 . Bb5 . G5 . D6 . C6 . Bb5 . A5 .',
      'G5 . G5 . Bb5 . G5 . Eb6 - - - D6 . C6 .',
      'D6 . D6 . F6 . D6 . Bb5 . C6 . D6 . F6 .',
      'F6 - - - Eb6 - - - D6 - - - C6 - A5 -',
    ], 0.55)
    .arp(ch, 4, 'arp', 0.3, undefined, [0, 1, 2, 3])
    .pumpBass(['G1', 'Eb2', 'Bb1', 'F2', 'G1', 'Eb2', 'Bb1', 'F2'], 0.8)
    .drums('kick', KICK4, 0.9)
    .drums('snare', BACKBEAT, 0.5)
    .drums('tick', HAT8, 0.4)
    .drums('ohat', OFFHAT, 0.3, 0.4)
    .fill(7)
    .done(150);
}

/** ENQUETE: Sunday-night TV game-show fanfare. Brass, big band hits, Bb major, 150. */
function poll(): Track {
  const ch = twice(['Bb', 'Gm', 'Eb', 'F']);
  return new Composer(8)
    .line('brass', [
      'F5 - - Bb5 - - D6 - F6 - - - D6 - - -',
      'D6 - - - Bb5 - - - G5 - - - . . . .',
      'Eb6 - - - D6 - - - C6 - - - Bb5 - - -',
      'C6 - - - - - - - A5 - C6 - F6 - - -',
      'F6 - - D6 - - Bb5 - F6 - - - G6 - - -',
      'G6 - - - F6 - - - D6 - - - Bb5 - - -',
      'Eb6 - - - G6 - - - Bb6 - - - G6 - - -',
      'F6 - - - - - - - F6 - F6 - F6 - - -',
    ], 0.6)
    .stabs(ch, 4, [0, 6, 10], 0.4, undefined, 'brass')
    .pumpBass(['Bb1', 'G1', 'Eb2', 'F1', 'Bb1', 'G1', 'Eb2', 'F1'], 0.75)
    .drums('kick', KICK4, 0.8)
    .drums('snare', '. . . . X . . x . . . . X . x .', 0.55)
    .drums('hat', HATS, 0.25)
    .fill(3)
    .fill(7)
    .done(150, 0.1);
}

/** X1: spaghetti western. Whistle over a galloping bass, D minor, 160. */
function duel(): Track {
  return new Composer(8)
    .line('whistle', [
      'D5 - - - A5 - - - D6 - - - . . C6 -',
      'Bb5 - - - A5 - - - G5 - - - F5 - - -',
      'E5 - - - - - - - G5 - - - A5 - - -',
      'A5 - - - - - - - . . . . . . . .',
      'D6 - - - F6 - - - E6 - D6 - C6 - - -',
      'Bb5 - - - D6 - - - C6 - Bb5 - A5 - - -',
      'G5 - - - Bb5 - - - A5 - G5 - F5 - - -',
      'E5 - - - - - - - D5 - - - - - - -',
    ], 0.7)
    .line('pluck', [
      'D3 . D3 D3 A3 . D3 D3 F3 . D3 D3 A3 . D3 D3',
      'G3 . G3 G3 D4 . G3 G3 Bb3 . G3 G3 D4 . G3 G3',
      'C3 . C3 C3 G3 . C3 C3 E3 . C3 C3 G3 . C3 C3',
      'A2 . A2 A2 E3 . A2 A2 C#3 . A2 A2 E3 . A2 A2',
    ].concat(['D3 . D3 D3 A3 . D3 D3 F3 . D3 D3 A3 . D3 D3', 'G3 . G3 G3 D4 . G3 G3 Bb3 . G3 G3 D4 . G3 G3', 'C3 . C3 C3 G3 . C3 C3 E3 . C3 C3 G3 . C3 C3', 'A2 . A2 A2 E3 . A2 A2 C#3 . A2 A2 E3 . A2 A2']), 0.45)
    .drums('tom', 'X . x x X . x x X . x x X . x x', 0.6)
    .drums('tri', 'x . . . . . . . . . . . . . . .', 0.25, 0.3)
    .drums('snare', '. . . . . . . . . . . . X . . .', 0.4)
    .done(160);
}

/** PATROCINADO: the cheesiest ad jingle. Claps, ukulele-ish plucks, F major, 130. "Compre já!" */
function ad(): Track {
  return new Composer(4)
    .line('lead', [
      'C5 - F5 - A5 - C6 - A5 - - - F5 - G5 -',
      'A5 - - - G5 - - - F5 - - - . . C5 -',
      'D5 - G5 - Bb5 - D6 - C6 - - - Bb5 - A5 -',
      'G5 - - - A5 - - - F5 - - - . . . .',
    ], 0.6)
    .stabs(['F', 'C', 'Bb', 'C'], 4, [2, 6, 10, 14], 0.4, undefined, 'pluck')
    .pumpBass(['F2', 'C2', 'Bb1', 'C2'], 0.7)
    .drums('kick', KICK4, 0.7)
    .drums('clap', BACKBEAT, 0.8)
    .drums('tri', HAT8, 0.2)
    .done(130, 0.15);
}

/** ANÚNCIO: shopping-channel synth pop, a little too excited. A major, 140. */
function adTell(): Track {
  const ch = twice(['A', 'E', 'F#m', 'D']);
  return new Composer(8)
    .line('epiano', [
      'C#6 - - E6 - - A5 - B5 - C#6 - E6 - - -',
      'B5 - - G#5 - - E5 - G#5 - B5 - E6 - - -',
      'A5 - - C#6 - - F#6 - E6 - C#6 - A5 - - -',
      'F#5 - - A5 - - D6 - E6 - - - . . . .',
    ], 0.55)
    .arp(ch, 4, 'arp', 0.25, undefined, [0, 1, 2, 1])
    .pumpBass(['A1', 'E2', 'F#1', 'D2', 'A1', 'E2', 'F#1', 'D2'], 0.75)
    .drums('kick', KICK4, 0.85)
    .drums('clap', BACKBEAT, 0.6)
    .drums('hat', HAT8, 0.35)
    .done(140);
}

/** COMPRA: checkout panic. A cash-register blip pattern that speeds up, E minor, 168. */
function adDo(): Track {
  return new Composer(4)
    .line('arp', [
      'E6 . B5 . E6 . B5 . E6 . B5 . G6 . F#6 .',
      'E6 . B5 . E6 . B5 . E6 . C6 . A5 . B5 .',
      'E6 . B5 . E6 . B5 . E6 . B5 . G6 . A6 .',
      'B6 . A6 . G6 . F#6 . E6 . D#6 . E6 . F#6 .',
    ], 0.45)
    .rollBass(['E2', 'C2', 'E2', 'B1'], 0.7)
    .drums('kick', KICK4, 0.9)
    .drums('snare', BACKBEAT, 0.55)
    .drums('tick', HATS, 0.3)
    .fill(3)
    .done(168);
}

/** FLAME WAR: darksynth in space. Galloping bass, a cold arpeggio, a lead that hangs over it all. */
function tank(): Track {
  const ch = twice(['Em', 'C', 'D', 'B']);
  return new Composer(8)
    .line('pluck', [
      'E5 - G5 - B5 - G5 - E6 - D6 - B5 - G5 -',
      'C5 - E5 - G5 - E5 - C6 - B5 - G5 - E5 -',
      'D5 - F#5 - A5 - F#5 - D6 - C#6 - A5 - F#5 -',
      'B4 - D#5 - F#5 - D#5 - B5 - A5 - F#5 - D#5 -',
    ], 0.45)
    .line('lead', [
      'B5 - - - - - G5 - A5 - B5 - - - E6 -',
      'D6 - - - C6 - - - B5 - G5 - - - E5 -',
      'F#5 - - - A5 - - - D6 - - - C#6 - A5 -',
      'B5 - - - A5 - - - F#5 - - - D#5 - - -',
    ], 0.75, undefined, 4)
    .rollBass(['E2', 'C2', 'D2', 'B1', 'E2', 'C2', 'D2', 'B1'])
    .arp(ch, 4, 'bell', 0.22, 0.4, [0, 1, 2, 3])
    .pad(ch, 4, 0.25)
    .drums('kick', KICK4, 0.95)
    .drums('snare', BACKBEAT, 0.75)
    .drums('hat', HATS, 0.3)
    .fill(7)
    .done(150);
}

export const TRACKS: Record<string, () => Track> = {
  theme,
  kart,
  bomb,
  meteor,
  lantern,
  laser,
  elevator,
  beam,
  mimic,
  book,
  bubble,
  penguin,
  count,
  tank,
  rope,
  filter,
  look,
  paddle,
  poll,
  duel,
  ad,
  memoTell: adTell,
  memoDo: adDo,
};

/** Which song each clip plays. Trend da Dancinha keeps its own beat: its melody comes from the arrows. */
export function trackFor(defId: string): string | null {
  if (defId === 'dance') return null;
  return TRACKS[defId] ? defId : 'theme';
}

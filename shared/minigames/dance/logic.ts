import type { Minigame, MinigameDef } from '../../minigame';
import { Rng } from '../../rng';
import type { BotDifficulty, GameEvent, PlayerId, PlayerInfo, PlayerInput, TickInput } from '../../types';
import { NEUTRAL_INPUT } from '../../types';

/**
 * TREND DA DANCINHA (rhythm game): arrows fall down a shared highway in time with a chiptune;
 * press the matching WASD key as each one hits the line. Misses fill your CRINGE bar; when it
 * maxes out you lose a life. The beat speeds up as the trend goes viral.
 */

/** Lanes: 0 A (left), 1 W (up), 2 S (down), 3 D (right). */
export type Lane = 0 | 1 | 2 | 3;

export interface Note {
  id: number;
  lane: Lane;
  t: number; // song time it reaches the hit line
  pitch: number; // melody step played when it lands
  hitBy: PlayerId[];
  judged: boolean; // passed the window (misses applied)
}

export interface Dancer {
  id: PlayerId;
  character: number;
  status: 'alive' | 'dead' | 'out';
  cringe: number; // 0..1
  combo: number;
  judge: 'hit' | 'miss' | 'wrong' | '';
  judgeT: number;
  lastLane: Lane | -1; // lane of the last hit (for the dance pose)
  ghost: number;
  deathAnim: number;
  prevDx: number;
  prevDy: number;
}

export interface DanceState {
  dancers: Dancer[];
  notes: Note[];
  songT: number;
  bpm: number;
  beat: number; // beats elapsed (fractional)
  genT: number; // chart generated up to this song time
  nextId: number;
  time: number;
}

/** Seconds a note is visible before it reaches the line. */
export const TRAVEL = 1.25;
export const HIT_WIN = 0.13;
const MISS_CRINGE = 0.34;
const WRONG_CRINGE = 0.12;
const CRINGE_DECAY = 0.07; // per second
const BASE_BPM = 104;
const MAX_BPM = 172;
const GHOST_TIME = 1.2;
export const DEATH_ANIM = 0.8;
const TIME_CAP = 50;

const BOT_MISS: Record<BotDifficulty, number> = { easy: 0.09, medium: 0.05, hard: 0.02 };

interface BotMemory {
  pressed: number; // id of the last note it pressed for
  plan: Map<number, number>; // note id -> timing offset (NaN = will miss)
}

class TrendDaDancinha implements Minigame<DanceState> {
  readonly defId = 'dance';
  readonly state: DanceState;
  private events: GameEvent[] = [];
  private rng: Rng;
  private botMem = new Map<PlayerId, BotMemory>();
  private lastLaneT: number[] = [-9, -9, -9, -9];
  private pitch = 0;

  constructor(players: PlayerInfo[], seed: number) {
    this.rng = new Rng(seed);
    this.state = {
      dancers: players.map((p) => ({
        id: p.id,
        character: p.character,
        status: 'alive',
        cringe: 0,
        combo: 0,
        judge: '',
        judgeT: 0,
        lastLane: -1,
        ghost: 0,
        deathAnim: 0,
        prevDx: 0,
        prevDy: 0,
      })),
      notes: [],
      songT: 0,
      bpm: BASE_BPM,
      beat: 0,
      genT: 1.2, // a short intro before the first arrow lands
      nextId: 1,
      time: 0,
    };
  }

  /** Writes the chart a little ahead of the song: notes on beats, more off-beats and chords as it heats up. */
  private generate(heat: number): void {
    const st = this.state;
    const busy = Math.min(1, st.time / 40 + heat * 0.6);
    while (st.genT < st.songT + TRAVEL + 0.6) {
      const spb = 60 / st.bpm;
      if (this.rng.next() < 0.85) this.addNote(st.genT, heat > 0.3 && this.rng.next() < 0.12 + heat * 0.15);
      if (this.rng.next() < 0.15 + busy * 0.45) this.addNote(st.genT + spb / 2, false);
      st.genT += spb;
    }
  }

  private addNote(t: number, chord: boolean): void {
    const st = this.state;
    // Melody walks up and down a pentatonic scale; lanes follow the contour a bit.
    this.pitch = Math.max(0, Math.min(9, this.pitch + this.rng.pick([-2, -1, -1, 1, 1, 2, 0])));
    let lane = this.rng.int(4) as Lane;
    for (let k = 0; k < 4 && t - this.lastLaneT[lane] < 0.24; k++) lane = ((lane + 1) % 4) as Lane;
    if (t - this.lastLaneT[lane] < 0.24) return;
    this.lastLaneT[lane] = t;
    st.notes.push({ id: st.nextId++, lane, t, pitch: this.pitch, hitBy: [], judged: false });
    if (chord) {
      // Second arrow on the other axis, so it can be pressed as a diagonal.
      const other = (lane === 0 || lane === 3 ? this.rng.pick([1, 2]) : this.rng.pick([0, 3])) as Lane;
      if (t - this.lastLaneT[other] >= 0.24) {
        this.lastLaneT[other] = t;
        st.notes.push({ id: st.nextId++, lane: other, t, pitch: this.pitch, hitBy: [], judged: false });
      }
    }
  }

  update(dt: number, inputs: Map<PlayerId, TickInput>, heat: number): void {
    const st = this.state;
    st.time += dt;
    st.bpm = Math.min(MAX_BPM, BASE_BPM + st.time * 1.3 + heat * 30);
    const beatBefore = st.beat;
    st.songT += dt;
    st.beat += (dt * st.bpm) / 60;
    // The backing track: kick on the beat, hat on the off-beat.
    if (Math.floor(st.beat) !== Math.floor(beatBefore)) this.events.push({ type: 'sfx', name: 'kick' });
    else if (Math.floor(st.beat + 0.5) !== Math.floor(beatBefore + 0.5)) this.events.push({ type: 'sfx', name: 'hat' });
    this.generate(heat);

    for (const d of st.dancers) {
      if (d.status === 'dead') d.deathAnim = Math.max(0, d.deathAnim - dt);
      if (d.status !== 'alive') continue;
      d.ghost = Math.max(0, d.ghost - dt);
      d.judgeT = Math.max(0, d.judgeT - dt);
      d.cringe = Math.max(0, d.cringe - CRINGE_DECAY * dt);
      const inp = inputs.get(d.id);
      const dx = inp?.dx ?? 0;
      const dy = inp?.dy ?? 0;
      // Each axis has its own edge, so a diagonal presses both arrows of a chord.
      const presses: Lane[] = [];
      if (dx !== 0 && dx !== d.prevDx) presses.push(dx < 0 ? 0 : 3);
      if (dy !== 0 && dy !== d.prevDy) presses.push(dy < 0 ? 1 : 2);
      d.prevDx = dx;
      d.prevDy = dy;
      for (const lane of presses) this.press(d, lane);
    }

    // Notes that went past the window: the song plays them, and whoever didn't hit them misses.
    for (const n of st.notes) {
      if (n.judged || st.songT < n.t + HIT_WIN) continue;
      n.judged = true;
      for (const d of st.dancers) {
        if (d.status !== 'alive' || d.ghost > 0 || n.hitBy.includes(d.id)) continue;
        this.miss(d, MISS_CRINGE, 'miss');
      }
    }
    // Melody: each note sings as it crosses the line.
    for (const n of st.notes) {
      if (n.t <= st.songT && n.t > st.songT - dt) this.events.push({ type: 'sfx', name: `mel${n.pitch}` });
    }
    st.notes = st.notes.filter((n) => n.t > st.songT - 0.5);
  }

  private press(d: Dancer, lane: Lane): void {
    const st = this.state;
    let best: Note | null = null;
    for (const n of st.notes) {
      if (n.lane !== lane || n.hitBy.includes(d.id) || Math.abs(n.t - st.songT) > HIT_WIN) continue;
      if (!best || n.t < best.t) best = n;
    }
    if (best) {
      best.hitBy.push(d.id);
      d.combo++;
      d.judge = 'hit';
      d.judgeT = 0.35;
      d.lastLane = lane;
      return;
    }
    if (d.ghost <= 0) this.miss(d, WRONG_CRINGE, 'wrong');
  }

  private miss(d: Dancer, amount: number, kind: 'miss' | 'wrong'): void {
    d.combo = 0;
    d.judge = kind;
    d.judgeT = 0.35;
    d.cringe += amount;
    if (d.cringe < 1) return;
    d.status = 'dead';
    d.deathAnim = DEATH_ANIM;
    d.cringe = 1;
    this.events.push({ type: 'death', player: d.id }, { type: 'sfx', name: 'die' });
  }

  onSuspend(): void {}

  onResume(): void {
    for (const d of this.state.dancers) {
      if (d.status !== 'dead') continue;
      d.status = 'alive';
      d.cringe = 0;
      d.combo = 0;
      d.judge = '';
      d.ghost = GHOST_TIME;
      d.deathAnim = 0;
    }
  }

  removePlayer(id: PlayerId): void {
    const d = this.state.dancers.find((d) => d.id === id);
    if (d) d.status = 'out';
  }

  isFinished(): boolean {
    return this.state.time > TIME_CAP;
  }

  drainEvents(): GameEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  botInput(id: PlayerId, difficulty: BotDifficulty): PlayerInput {
    const st = this.state;
    const d = st.dancers.find((d) => d.id === id);
    if (!d || d.status !== 'alive') return NEUTRAL_INPUT;
    let mem = this.botMem.get(id);
    if (!mem) {
      mem = { pressed: 0, plan: new Map() };
      this.botMem.set(id, mem);
    }
    // Faster songs are harder for bots too.
    const missP = BOT_MISS[difficulty] + Math.max(0, st.bpm - BASE_BPM) * 0.0012;
    let dx = 0;
    let dy = 0;
    for (const n of st.notes) {
      if (n.hitBy.includes(id) || n.t - st.songT > HIT_WIN || n.judged) continue;
      let off = mem.plan.get(n.id);
      if (off === undefined) {
        off = this.rng.next() < missP ? NaN : this.rng.range(-0.06, 0.06);
        mem.plan.set(n.id, off);
      }
      if (Number.isNaN(off) || st.songT < n.t + off) continue;
      if (n.lane === 0) dx = -1;
      else if (n.lane === 3) dx = 1;
      else if (n.lane === 1) dy = -1;
      else dy = 1;
    }
    if (mem.plan.size > 64) for (const k of [...mem.plan.keys()].slice(0, 32)) mem.plan.delete(k);
    // Release between taps so every press is a fresh edge.
    if ((dx !== 0 && d.prevDx === dx) || (dy !== 0 && d.prevDy === dy)) return NEUTRAL_INPUT;
    return { dx: dx as -1 | 0 | 1, dy: dy as -1 | 0 | 1, action: false };
  }
}

export const TrendDaDancinhaDef: MinigameDef = {
  id: 'dance',
  name: 'TREND DA DANCINHA',
  handle: '@trend.da.dancinha',
  hint: 'APERTE WASD QUANDO A SETA CHEGAR NA LINHA',
  create: (players, seed) => new TrendDaDancinha(players, seed),
};

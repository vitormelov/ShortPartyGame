import type { Minigame, MinigameDef } from './minigame';
import { AD_DEF, MINIGAMES } from './minigames';
import { MemoDoDef, MemoTellDef, createMemoAd, randomSequence, type MoveSequence } from './minigames/memo/logic';
import { Rng } from './rng';
import type { BotDifficulty, GameEvent, MatchConfig, PlayerId, PlayerInfo, PlayerInput, TickInput } from './types';
import { NEUTRAL_INPUT } from './types';

export type FeedPhase = 'countdown' | 'swipe' | 'preview' | 'play' | 'over';

const COUNTDOWN = 3;
const SWIPE_TIME = 0.35;
const NEW_CLIP_PREVIEW = 1.1;
/** How long the big mid-clip notification covers the screen. */
export const NOTIFICATION_TIME = 1.5;
export const NOTIFICATION_COUNT = 6;
/** A death this soon after a returned clip resumes counts as a "flop" (the cruel return got you). */
const FLOP_WINDOW = 2;
/** How long bots keep holding their pre-freeze input after a return (they "forgot" too). */
const BOT_FORGET: Record<BotDifficulty, number> = { easy: 0.45, medium: 0.3, hard: 0.22 };
/** Heat starts rising after this many seconds and maxes out HEAT_RAMP seconds later. */
const HEAT_START = 120;
const HEAT_RAMP = 180;
/** Fast-forward speeds, like holding the screen on a reel. Weighted toward the milder ones. */
const SPEEDS: ReadonlyArray<readonly [number, number]> = [
  [1.25, 0.45],
  [1.5, 0.35],
  [2, 0.2],
];

export interface PlayerStats {
  deaths: number;
  flops: number;
  fastestFlop: number; // seconds after resume, Infinity if none
  bonusLives: number;
}

export interface FeedPlayer {
  info: PlayerInfo;
  lives: number;
  eliminated: boolean;
  stats: PlayerStats;
}

interface Clip {
  instanceId: number;
  def: MinigameDef;
  game: Minigame;
  lastInputs: Map<PlayerId, PlayerInput>;
  shown: number;
}

export interface ClipView {
  instanceId: number;
  defId: string;
  name: string;
  handle: string;
  hint: string;
  state: unknown;
  isReturn: boolean;
  shown: number;
  /** Playback speed of this clip (1 = normal). */
  speed: number;
}

export interface FeedSnapshot {
  phase: FeedPhase;
  phaseTime: number;
  phaseDuration: number;
  clip: ClipView | null;
  prev: { defId: string; state: unknown } | null;
  clipTime: number;
  clipDuration: number;
  clipCount: number;
  matchTime: number;
  players: FeedPlayer[];
  maxLives: number;
  heat: number;
  /** Seconds left of the mid-clip notification pop-up (0 = none). */
  notification: number;
  notifIndex: number;
  winners: PlayerId[];
  /** Best first: winners, then by elimination order (last eliminated first). */
  ranking: PlayerId[];
}

export class FeedDirector {
  readonly players: FeedPlayer[];
  private rng: Rng;
  private clips: Clip[] = [];
  private current: Clip | null = null;
  private prev: { defId: string; state: unknown } | null = null;
  private nextInstanceId = 1;
  private isReturn = false;
  private speed = 1;
  /** An ANÚNCIO showed a sequence; the next ad must be the COMPRA where it's typed. */
  private pendingMemo: MoveSequence | null = null;
  private notifAt = -1;
  private notifIndex = 0;
  private notification = 0;

  private phase: FeedPhase = 'countdown';
  private phaseTime = 0;
  private phaseDuration = COUNTDOWN;
  private clipTime = 0;
  private clipDuration = 0;
  private clipCount = 0;
  private matchTime = 0;
  private lastCountdown = COUNTDOWN + 1;

  private humanInputs = new Map<PlayerId, PlayerInput>();
  private prevAction = new Map<PlayerId, boolean>();
  private events: GameEvent[] = [];
  private winners: PlayerId[] = [];
  private eliminationOrder: PlayerId[] = [];
  private eliminatedThisTick: PlayerId[] = [];

  constructor(infos: PlayerInfo[], private config: MatchConfig, seed: number) {
    this.rng = new Rng(seed);
    this.players = infos.map((info) => ({
      info,
      lives: config.lives,
      eliminated: false,
      stats: { deaths: 0, flops: 0, fastestFlop: Infinity, bonusLives: 0 },
    }));
    this.current = this.pickNext();
  }

  setInput(id: PlayerId, input: PlayerInput): void {
    this.humanInputs.set(id, input);
  }

  drainEvents(): GameEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  private alive(): FeedPlayer[] {
    return this.players.filter((p) => !p.eliminated);
  }

  private get heat(): number {
    const base = Math.max(0, Math.min(1, (this.matchTime - HEAT_START) / HEAT_RAMP));
    return Math.min(1, base + (this.endgame ? 0.3 : 0));
  }

  private get endgame(): boolean {
    return this.alive().length <= 3;
  }

  tick(dt: number): void {
    this.phaseTime += dt;
    if (this.phase !== 'over') this.matchTime += dt;

    switch (this.phase) {
      case 'countdown': {
        const n = Math.ceil(COUNTDOWN - this.phaseTime);
        if (n < this.lastCountdown && n > 0) {
          this.lastCountdown = n;
          this.events.push({ type: 'countdown', n });
        }
        if (this.phaseTime >= COUNTDOWN) this.startPlay();
        break;
      }
      case 'swipe':
        if (this.phaseTime >= SWIPE_TIME) {
          this.setPhase('preview', this.isReturn ? this.config.returnPreview : NEW_CLIP_PREVIEW);
          this.events.push({ type: 'clipStart', isReturn: this.isReturn, speed: this.speed });
        }
        break;
      case 'preview':
        if (this.phaseTime >= this.phaseDuration) this.startPlay();
        break;
      case 'play':
        this.playTick(dt);
        break;
      case 'over':
        break;
    }
  }

  private setPhase(phase: FeedPhase, duration: number): void {
    this.phase = phase;
    this.phaseTime = 0;
    this.phaseDuration = duration;
  }

  private startPlay(): void {
    const scale = this.endgame ? 0.7 : 1;
    const fixed = this.current?.game.fixedDuration?.();
    this.clipDuration = fixed ?? this.rng.range(this.config.clipMin, this.config.clipMax) * scale;
    this.clipTime = 0;
    this.notification = 0;
    this.notifAt = -1;
    if (!fixed && this.clipDuration >= 3 && this.rng.next() < this.config.notifChance) {
      this.notifAt = this.rng.range(1.2, this.clipDuration - 1.3);
      this.notifIndex = this.rng.int(NOTIFICATION_COUNT);
    }
    this.setPhase('play', this.clipDuration);
  }

  private playTick(dt: number): void {
    const clip = this.current!;
    this.clipTime += dt;
    this.notification = Math.max(0, this.notification - dt);
    if (this.notifAt >= 0 && this.clipTime >= this.notifAt) {
      this.notifAt = -1;
      this.notification = NOTIFICATION_TIME;
      this.events.push({ type: 'notification' });
    }

    const inputs = new Map<PlayerId, TickInput>();
    for (const p of this.alive()) {
      const id = p.info.id;
      let input: PlayerInput;
      if (p.info.isBot) {
        const holding = this.isReturn && this.clipTime < BOT_FORGET[p.info.difficulty];
        input = holding ? (clip.lastInputs.get(id) ?? NEUTRAL_INPUT) : clip.game.botInput(id, p.info.difficulty);
      } else {
        input = this.humanInputs.get(id) ?? NEUTRAL_INPUT;
      }
      clip.lastInputs.set(id, input);
      const pressed = input.action && !this.prevAction.get(id);
      this.prevAction.set(id, input.action);
      inputs.set(id, { ...input, pressed });
    }

    // Fast-forward: advance the minigame faster than real time, in substeps of at most 1/60 s
    // so the physics stays stable. The action press only counts on the first substep.
    const steps = Math.ceil(this.speed);
    const subDt = (dt * this.speed) / steps;
    for (let s = 0; s < steps; s++) {
      if (s === 1) for (const [id, inp] of inputs) inputs.set(id, { ...inp, pressed: false });
      clip.game.update(subDt, inputs, this.heat);
    }
    this.eliminatedThisTick = [];
    for (const e of clip.game.drainEvents()) this.handleEvent(e);
    if (this.eliminatedThisTick.length > 0) this.checkGameOver();

    if (this.phase === 'over') return;
    if (this.clipTime >= this.clipDuration || clip.game.isFinished()) this.endClip();
  }

  private handleEvent(e: GameEvent): void {
    switch (e.type) {
      case 'death': {
        const p = this.players.find((p) => p.info.id === e.player);
        if (!p || p.eliminated) return;
        p.lives--;
        p.stats.deaths++;
        const onReturn = this.isReturn && this.clipTime < FLOP_WINDOW;
        if (onReturn) {
          p.stats.flops++;
          p.stats.fastestFlop = Math.min(p.stats.fastestFlop, this.clipTime);
        }
        this.events.push({ type: 'lifeLost', player: e.player, lives: p.lives, onReturn });
        if (p.lives <= 0) this.eliminate(p);
        return;
      }
      case 'bonusLife': {
        const p = this.players.find((p) => p.info.id === e.player);
        if (!p || p.eliminated) return;
        p.lives = Math.min(this.config.lives, p.lives + 1);
        p.stats.bonusLives++;
        this.events.push(e);
        return;
      }
      default:
        this.events.push(e);
    }
  }

  private eliminate(p: FeedPlayer): void {
    p.eliminated = true;
    this.eliminationOrder.push(p.info.id);
    for (const c of this.clips) c.game.removePlayer(p.info.id);
    this.eliminatedThisTick.push(p.info.id);
    this.events.push({ type: 'eliminated', player: p.info.id });
  }

  private checkGameOver(): void {
    const alive = this.alive();
    if (alive.length > 1) return;
    // If the last players all died in the same tick, they share the win.
    this.winners = alive.length === 1 ? [alive[0].info.id] : [...this.eliminatedThisTick];
    this.setPhase('over', Infinity);
    this.events.push({ type: 'gameOver', winners: this.winners });
  }

  private endClip(): void {
    const clip = this.current!;
    clip.game.onSuspend();
    this.notification = 0;
    this.prev = { defId: clip.def.id, state: clip.game.state };
    // Ads never come back, even if cut a tick before their scripted end.
    if (clip.game.isFinished() || clip.def.feedEvent) this.clips = this.clips.filter((c) => c !== clip);
    this.current = this.pickNext();
    this.setPhase('swipe', SWIPE_TIME);
    this.events.push({ type: 'swipe' });
  }

  private pickNext(): Clip {
    const current = this.current;
    const returnable = this.clips.filter((c) => c !== current && !c.game.isFinished());
    const activeDefs = new Set(this.clips.map((c) => c.def.id));
    const fresh = MINIGAMES.filter((d) => !activeDefs.has(d.id) && d.id !== current?.def.id);
    const chance = Math.min(0.9, this.config.returnChance + (this.endgame ? 0.25 : 0));

    let clip: Clip;
    const adAllowed = this.clipCount >= 3 && !current?.def.feedEvent;
    if (adAllowed && this.rng.next() < this.config.adChance) {
      clip = this.newAd();
      this.isReturn = false;
    } else if (returnable.length > 0 && (fresh.length === 0 || this.rng.next() < chance)) {
      clip = this.rng.pick(returnable);
      this.isReturn = true;
      clip.game.onResume();
    } else {
      const defs = fresh.length > 0 ? fresh : MINIGAMES.filter((d) => d.id !== current?.def.id);
      clip = this.newClip(this.rng.pick(defs.length > 0 ? defs : MINIGAMES));
      this.isReturn = false;
    }
    clip.shown++;
    this.speed = this.clipCount === 0 || clip.def.feedEvent ? 1 : this.rollSpeed();
    this.clipCount++;
    return clip;
  }

  /** ANÚNCIO and COMPRA always alternate; without a pending sequence it's PATROCINADO or a new ANÚNCIO. */
  private newAd(): Clip {
    const seed = (this.rng.next() * 0xffffffff) >>> 0;
    const infos = this.alive().map((p) => p.info);
    if (this.pendingMemo) {
      const game = createMemoAd(infos, seed, 'do', this.pendingMemo);
      this.pendingMemo = null;
      return this.newClip(MemoDoDef, game);
    }
    if (this.rng.next() < 0.5) return this.newClip(AD_DEF);
    this.pendingMemo = randomSequence(this.rng);
    return this.newClip(MemoTellDef, createMemoAd(infos, seed, 'tell', this.pendingMemo));
  }

  private newClip(def: MinigameDef, game?: Minigame): Clip {
    const clip: Clip = {
      instanceId: this.nextInstanceId++,
      def,
      game: game ?? def.create(this.alive().map((p) => p.info), (this.rng.next() * 0xffffffff) >>> 0),
      lastInputs: new Map(),
      shown: 0,
    };
    this.clips.push(clip);
    return clip;
  }

  private rollSpeed(): number {
    const chance = Math.min(0.9, this.config.speedChance + (this.config.speedChance > 0 ? this.heat * 0.2 : 0));
    if (this.rng.next() >= chance) return 1;
    let r = this.rng.next();
    for (const [speed, weight] of SPEEDS) {
      if (r < weight) return speed;
      r -= weight;
    }
    return SPEEDS[SPEEDS.length - 1][0];
  }

  snapshot(): FeedSnapshot {
    const c = this.current;
    const ranking = [...this.winners, ...[...this.eliminationOrder].reverse().filter((id) => !this.winners.includes(id))];
    return {
      phase: this.phase,
      phaseTime: this.phaseTime,
      phaseDuration: this.phaseDuration,
      clip: c
        ? {
            instanceId: c.instanceId,
            defId: c.def.id,
            name: c.def.name,
            handle: c.def.handle,
            hint: c.def.hint,
            state: c.game.state,
            isReturn: this.isReturn,
            shown: c.shown,
            speed: this.speed,
          }
        : null,
      prev: this.prev,
      clipTime: this.clipTime,
      clipDuration: this.clipDuration,
      clipCount: this.clipCount,
      matchTime: this.matchTime,
      players: this.players,
      maxLives: this.config.lives,
      heat: this.heat,
      notification: this.notification,
      notifIndex: this.notifIndex,
      winners: this.winners,
      ranking,
    };
  }
}

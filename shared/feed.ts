import type { Minigame, MinigameDef } from './minigame';
import { AD_DEF, MINIGAMES } from './minigames';
import { MemoDoDef, MemoTellDef, createMemoAd, randomSequence, type MoveSequence } from './minigames/memo/logic';
import { PollDef, createPoll, type PollKind } from './minigames/poll/logic';
import { DuelDef, createDuel } from './minigames/duel/logic';
import { ASSIST_WINDOW, CHARGE_EVERY, COMMENT_COST, COMMENT_LIFE, HATER_MENU, MAX_CHARGE, MAX_COMMENTS, type HaterComment, type HaterPanel } from './haters';
import { Rng } from './rng';
import type { BotDifficulty, GameEvent, MatchConfig, PlayerId, PlayerInfo, PlayerInput, TickInput } from './types';
import { NEUTRAL_INPUT } from './types';

export type FeedPhase = 'countdown' | 'swipe' | 'preview' | 'play' | 'over';

const COUNTDOWN = 3;
const SWIPE_TIME = 0.35;
const NEW_CLIP_PREVIEW = 1.1;
/** The spotlight poll keeps its winner in the spotlight for this many minigame clips. */
const SPOTLIGHT_CLIPS = 2;
/** Lives can go a bit above the starting amount through gifts and won bets. */
const EXTRA_LIVES = 2;
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
  /** Hater mode: deaths of players right after this player's comment targeted them. */
  assists: number;
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
  /** Player in the spotlight during this clip (-1 = none). */
  spotlight: PlayerId;
  /** A death bet is waiting for the next life lost. */
  betActive: boolean;
  /** Players holding a shield (won by betting right on an X1): it absorbs their next life lost. */
  shields: PlayerId[];
  tutorials: boolean;
  /** Hater-mode comments currently on screen. */
  comments: HaterComment[];
  /** Hater panels of eliminated players (their selected comment, target and charge). */
  haters: HaterPanel[];
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
  /** Minigames started recently; they don't get picked again as a fresh clip for a while. */
  private recentDefs: string[] = [];
  private isReturn = false;
  private speed = 1;
  /** An ANÚNCIO showed a sequence; the next ad must be the COMPRA where it's typed. */
  private pendingMemo: MoveSequence | null = null;
  private notifAt = -1;
  private notifIndex = 0;
  private notification = 0;
  private spotlight: { player: PlayerId; clips: number } | null = null;
  private spotlightOn = false;
  /** [voter, candidate] pairs of the open death bet. */
  private pendingBet: Array<[PlayerId, PlayerId]> | null = null;
  private haters = new Map<PlayerId, HaterPanel>();
  private shields = new Set<PlayerId>();
  private comments: HaterComment[] = [];
  private nextCommentId = 1;
  private botHateTimer = new Map<PlayerId, number>();

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
      stats: { deaths: 0, flops: 0, fastestFlop: Infinity, bonusLives: 0, assists: 0 },
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
          // Without tutorials a new clip gets the same short glance as a return.
          const preview = this.isReturn || !this.config.tutorials ? this.config.returnPreview : NEW_CLIP_PREVIEW;
          this.setPhase('preview', preview);
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
    this.spotlightOn = !!this.spotlight && !this.current?.def.feedEvent;
    if (!fixed && this.clipDuration >= 3 && this.rng.next() < this.config.notifChance) {
      this.notifAt = this.rng.range(1.2, this.clipDuration - 1.3);
      this.notifIndex = this.rng.int(NOTIFICATION_COUNT);
    }
    this.setPhase('play', this.clipDuration);
  }

  private playTick(dt: number): void {
    const clip = this.current!;
    this.clipTime += dt;
    this.haterTick(dt);
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
        if (this.shields.delete(e.player)) {
          this.events.push({ type: 'shieldUsed', player: e.player });
          return;
        }
        p.lives--;
        p.stats.deaths++;
        const onReturn = this.isReturn && this.clipTime < FLOP_WINDOW;
        if (onReturn) {
          p.stats.flops++;
          p.stats.fastestFlop = Math.min(p.stats.fastestFlop, this.clipTime);
        }
        this.events.push({ type: 'lifeLost', player: e.player, lives: p.lives, onReturn });
        this.creditAssists(e.player);
        if (this.pendingBet) this.resolveBet(e.player);
        if (p.lives <= 0) this.eliminate(p);
        return;
      }
      case 'duelResult':
        for (const id of e.torcida) this.shields.add(id);
        this.events.push(e);
        return;
      case 'pollResult': {
        if (e.kind === 'gift') {
          for (const id of e.winners) this.giveLife(id);
        } else if (e.kind === 'spotlight' && e.winners.length) {
          this.spotlight = { player: this.rng.pick(e.winners), clips: SPOTLIGHT_CLIPS };
        } else if (e.kind === 'bet' && e.votes.length) {
          this.pendingBet = e.votes;
        }
        this.events.push(e);
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

  // ---------- MODO HATER ----------

  private haterTick(dt: number): void {
    for (const c of this.comments) c.age += dt;
    this.comments = this.comments.filter((c) => c.age < c.life);
    const alive = this.alive();
    for (const h of this.haters.values()) {
      h.charge = Math.min(MAX_CHARGE, h.charge + dt / CHARGE_EVERY);
      const p = this.players.find((p) => p.info.id === h.id)!;
      if (h.target >= alive.length) h.target = -1;
      if (p.info.isBot) {
        this.botHate(h, dt, alive);
        continue;
      }
      const inp = this.humanInputs.get(h.id) ?? NEUTRAL_INPUT;
      const dir = inp.dx !== 0 && inp.dy === 0 ? (inp.dx > 0 ? 1 : 3) : inp.dy !== 0 && inp.dx === 0 ? (inp.dy > 0 ? 2 : 0) : -1;
      if (dir !== -1 && dir !== h.dir) {
        const n = HATER_MENU.length;
        if (dir === 0) h.menu = (h.menu + n - 1) % n;
        else if (dir === 2) h.menu = (h.menu + 1) % n;
        else {
          // targets: -1 (everyone), 0..alive-1
          const m = alive.length + 1;
          h.target = ((h.target + 1 + (dir === 1 ? 1 : -1) + m) % m) - 1;
        }
      }
      h.dir = dir;
      const pressed = inp.action && !this.prevAction.get(h.id);
      this.prevAction.set(h.id, inp.action);
      if (pressed) this.postComment(h, alive);
    }
  }

  private botHate(h: HaterPanel, dt: number, alive: FeedPlayer[]): void {
    const t = (this.botHateTimer.get(h.id) ?? this.rng.range(1, 3)) - dt;
    if (t > 0) {
      this.botHateTimer.set(h.id, t);
      return;
    }
    this.botHateTimer.set(h.id, this.rng.range(2.5, 5.5));
    h.menu = this.rng.int(HATER_MENU.length);
    // Bots love to pick on whoever is winning.
    const leader = alive.reduce((a, b) => (b.lives > a.lives ? b : a), alive[0]);
    h.target = alive.length && this.rng.next() < 0.6 ? alive.indexOf(leader) : this.rng.int(alive.length + 1) - 1;
    this.postComment(h, alive);
  }

  private postComment(h: HaterPanel, alive: FeedPlayer[]): void {
    const opt = HATER_MENU[h.menu];
    const cost = COMMENT_COST[opt.kind];
    if (h.charge < cost || alive.length === 0) return;
    h.charge -= cost;
    let target = h.target >= 0 ? alive[h.target].info.id : -1;
    // A tagged comment needs someone to tag.
    if (opt.kind === 'tag' && target === -1) target = this.rng.pick(alive).info.id;
    const author = this.players.find((p) => p.info.id === h.id)!;
    this.comments.push({
      id: this.nextCommentId++,
      kind: opt.kind,
      text: opt.text,
      dir: opt.dir ?? 0,
      author: h.id,
      authorCharacter: author.info.character,
      target,
      age: 0,
      life: COMMENT_LIFE[opt.kind],
      x: this.rng.range(40, 300),
      y: this.rng.range(40, 150),
    });
    if (this.comments.length > MAX_COMMENTS) this.comments.shift();
    this.events.push({ type: 'sfx', name: opt.kind === 'fake' ? 'laserFlip' : 'menu' });
  }

  /** A death right after a tag or a fake tip aimed at that player is an assist for the hater. */
  private creditAssists(dead: PlayerId): void {
    const credited = new Set<PlayerId>();
    for (const c of this.comments) {
      if (c.kind === 'common' || c.age > ASSIST_WINDOW) continue;
      if (c.target !== dead && !(c.kind === 'fake' && c.target === -1)) continue;
      if (credited.has(c.author)) continue;
      credited.add(c.author);
      const p = this.players.find((p) => p.info.id === c.author);
      if (p) p.stats.assists++;
    }
  }

  private giveLife(id: PlayerId): void {
    const p = this.players.find((p) => p.info.id === id);
    if (!p || p.eliminated) return;
    p.lives = Math.min(this.config.lives + EXTRA_LIVES, p.lives + 1);
    p.stats.bonusLives++;
  }

  /** The first life lost after a death bet settles it: everyone who bet on that player gets +1. */
  private resolveBet(dead: PlayerId): void {
    const winners = this.pendingBet!.filter(([, candidate]) => candidate === dead).map(([voter]) => voter);
    this.pendingBet = null;
    for (const id of winners) this.giveLife(id);
    this.events.push({ type: 'betResolved', dead, winners });
  }

  private eliminate(p: FeedPlayer): void {
    if (this.spotlight?.player === p.info.id) this.spotlight = null;
    p.eliminated = true;
    this.shields.delete(p.info.id);
    this.eliminationOrder.push(p.info.id);
    for (const c of this.clips) c.game.removePlayer(p.info.id);
    this.eliminatedThisTick.push(p.info.id);
    this.haters.set(p.info.id, { id: p.info.id, charge: 1, menu: 0, target: -1, dir: -1 });
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
    if (this.spotlightOn && this.spotlight && --this.spotlight.clips <= 0) this.spotlight = null;
    this.spotlightOn = false;
    this.comments = []; // comments belong to the clip they were posted on
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
    // Recently started games wait a few clips before being picked fresh again (one-round games like
    // Conta os Haters finish every time and would otherwise keep popping up).
    const fresh = MINIGAMES.filter((d) => !activeDefs.has(d.id) && d.id !== current?.def.id && !this.recentDefs.includes(d.id));
    const chance = Math.min(0.9, this.config.returnChance + (this.endgame ? 0.25 : 0));

    let clip: Clip;
    const only = this.config.onlyGame ? MINIGAMES.find((d) => d.id === this.config.onlyGame) : undefined;
    const adAllowed = !only && this.clipCount >= 3 && !current?.def.feedEvent;
    if (only) {
      // Single-game test mode: keep swiping back into the same game (cruel returns included).
      const live = this.clips.find((c) => c.def === only && !c.game.isFinished());
      if (live) {
        clip = live;
        this.isReturn = true;
        clip.game.onResume();
      } else {
        clip = this.newClip(only);
        this.isReturn = false;
      }
    } else if (adAllowed && this.rng.next() < this.config.adChance) {
      clip = this.newAd();
      this.isReturn = false;
    } else if (adAllowed && this.alive().length >= 3 && this.rng.next() < this.config.pollChance) {
      clip = this.newPoll();
      this.isReturn = false;
    } else if (adAllowed && this.alive().length >= 2 && this.rng.next() < this.config.duelChance) {
      const lives = new Map(this.alive().map((p) => [p.info.id, p.lives] as [PlayerId, number]));
      clip = this.newClip(DuelDef, createDuel(this.alive().map((p) => p.info), (this.rng.next() * 0xffffffff) >>> 0, lives));
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

  private newPoll(): Clip {
    const kinds: PollKind[] = this.pendingBet ? ['gift', 'spotlight'] : ['gift', 'spotlight', 'bet'];
    const kind = this.rng.pick(kinds);
    const lives = new Map(this.alive().map((p) => [p.info.id, p.lives] as [PlayerId, number]));
    const game = createPoll(this.alive().map((p) => p.info), (this.rng.next() * 0xffffffff) >>> 0, kind, lives);
    return this.newClip(PollDef, game);
  }

  private newClip(def: MinigameDef, game?: Minigame): Clip {
    if (!def.feedEvent) {
      this.recentDefs.push(def.id);
      if (this.recentDefs.length > 5) this.recentDefs.shift();
    }
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
      spotlight: this.spotlightOn && this.spotlight ? this.spotlight.player : -1,
      betActive: !!this.pendingBet,
      shields: [...this.shields],
      tutorials: this.config.tutorials,
      comments: this.comments,
      haters: [...this.haters.values()],
      winners: this.winners,
      ranking,
    };
  }
}

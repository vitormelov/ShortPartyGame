import { angleDiff, type Minigame, type MinigameDef } from '../../minigame';
import type { BotDifficulty, GameEvent, PlayerId, PlayerInfo, PlayerInput, TickInput } from '../../types';
import { NEUTRAL_INPUT } from '../../types';
import { LAPS, TRACK_HALF_W, TRACK_LENGTH, pointOnTrack, projectOnTrack } from './track';

export type KartStatus = 'race' | 'falling' | 'dead' | 'done' | 'out';

export interface Kart {
  id: PlayerId;
  character: number;
  x: number;
  y: number;
  angle: number;
  speed: number;
  s: number;
  lap: number;
  status: KartStatus;
  fall: number; // remaining fall animation time
  ghost: number; // post-respawn invulnerability
  drifting: boolean;
  steer: number;
  place: number;
}

export interface KartState {
  karts: Kart[];
  time: number;
  finishCount: number;
  done: boolean;
}

const MAX_SPEED = 82;
const DRIFT_SPEED = 66;
const BRAKE_SPEED = 30;
const TURN = 2.6;
const DRIFT_TURN = 4.1;
const KART_R = 3.5;
const FALL_TIME = 0.6;
const GHOST_TIME = 1.2;
const TIME_CAP = 80;

const LOOKAHEAD: Record<BotDifficulty, number> = { easy: 32, medium: 36, hard: 38 };
const WOBBLE: Record<BotDifficulty, number> = { easy: 6, medium: 2.5, hard: 1 };

class KartRush implements Minigame<KartState> {
  readonly defId = 'kart';
  readonly state: KartState;
  private events: GameEvent[] = [];

  constructor(players: PlayerInfo[]) {
    const karts = players.map((p, i): Kart => {
      const row = Math.floor(i / 2);
      const side = i % 2 === 0 ? -7 : 7;
      const pt = pointOnTrack(TRACK_LENGTH - 10 - row * 12);
      const nx = -Math.sin(pt.angle);
      const ny = Math.cos(pt.angle);
      return {
        id: p.id,
        character: p.character,
        x: pt.x + nx * side,
        y: pt.y + ny * side,
        angle: pt.angle,
        speed: 0,
        s: TRACK_LENGTH - 10 - row * 12,
        lap: 0,
        status: 'race',
        fall: 0,
        ghost: 0,
        drifting: false,
        steer: 0,
        place: 0,
      };
    });
    this.state = { karts, time: 0, finishCount: 0, done: false };
  }

  update(dt: number, inputs: Map<PlayerId, TickInput>, heat: number): void {
    const st = this.state;
    st.time += dt;
    const boost = 1 + heat * 0.3;

    for (const k of st.karts) {
      if (k.status === 'falling') {
        k.fall -= dt;
        k.x += Math.cos(k.angle) * k.speed * 0.3 * dt;
        k.y += Math.sin(k.angle) * k.speed * 0.3 * dt;
        if (k.fall <= 0) k.status = 'dead';
        continue;
      }
      if (k.status !== 'race') continue;

      const inp = inputs.get(k.id) ?? { ...NEUTRAL_INPUT, pressed: false };
      k.drifting = inp.action && inp.dx !== 0;
      k.steer = inp.dx;
      const turn = k.drifting ? DRIFT_TURN : TURN;
      k.angle += inp.dx * turn * dt * Math.min(1, k.speed / 40);

      const target = (inp.dy > 0 ? BRAKE_SPEED : k.drifting ? DRIFT_SPEED : MAX_SPEED) * boost;
      const diff = target - k.speed;
      k.speed += Math.max(-90 * dt, Math.min(55 * dt, diff));

      k.x += Math.cos(k.angle) * k.speed * dt;
      k.y += Math.sin(k.angle) * k.speed * dt;
      k.ghost = Math.max(0, k.ghost - dt);
    }

    this.collide();


    for (const k of st.karts) {
      if (k.status !== 'race') continue;
      const proj = projectOnTrack(k.x, k.y);
      const ds = proj.s - k.s;
      if (ds < -TRACK_LENGTH / 2) k.lap++;
      else if (ds > TRACK_LENGTH / 2) k.lap--;
      k.s = proj.s;

      if (proj.dist > TRACK_HALF_W && k.ghost <= 0) {
        k.status = 'falling';
        k.fall = FALL_TIME;
        this.events.push({ type: 'death', player: k.id }, { type: 'sfx', name: 'fall' });
        continue;
      }


      if (k.lap > LAPS) {
        k.status = 'done';
        k.place = ++st.finishCount;
        if (k.place === 1) {
          this.events.push({ type: 'bonusLife', player: k.id, reason: 'VENCEU A CORRIDA' });
          st.done = true;
        }
      }
    }

    if (st.time > TIME_CAP) st.done = true;
  }

  private collide(): void {
    const ks = this.state.karts.filter((k) => k.status === 'race' && k.ghost <= 0);
    for (let i = 0; i < ks.length; i++) {
      for (let j = i + 1; j < ks.length; j++) {
        const a = ks[i];
        const b = ks[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        if (d > 0 && d < KART_R * 2) {
          const push = (KART_R * 2 - d) / 2;
          a.x -= (dx / d) * push;
          a.y -= (dy / d) * push;
          b.x += (dx / d) * push;
          b.y += (dy / d) * push;
          a.speed *= 0.97;
          b.speed *= 0.97;
        }
      }
    }
  }

  onSuspend(): void {}

  onResume(): void {
    for (const k of this.state.karts) {
      if (k.status !== 'falling' && k.status !== 'dead') continue;
      const pt = pointOnTrack(k.s);
      k.x = pt.x;
      k.y = pt.y;
      k.angle = pt.angle;
      k.speed = 35;
      k.ghost = GHOST_TIME;
      k.fall = 0;
      k.status = 'race';
    }
  }

  removePlayer(id: PlayerId): void {
    const k = this.state.karts.find((k) => k.id === id);
    if (k) k.status = 'out';
  }

  isFinished(): boolean {
    return this.state.done;
  }

  /** Minigames mode: the race is over and nobody fell, so the last kart still racing goes out. */
  roundLosers(): PlayerId[] {
    const racing = this.state.karts.filter((k) => k.status === 'race' || k.status === 'falling' || k.status === 'dead');
    if (racing.length === 0) return [];
    const last = racing.reduce((a, b) => (a.lap * TRACK_LENGTH + a.s <= b.lap * TRACK_LENGTH + b.s ? a : b));
    return [last.id];
  }

  drainEvents(): GameEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  botInput(id: PlayerId, difficulty: BotDifficulty): PlayerInput {
    const k = this.state.karts.find((k) => k.id === id);
    if (!k || k.status !== 'race') return NEUTRAL_INPUT;
    const ahead = pointOnTrack(k.s + LOOKAHEAD[difficulty]);
    const wobble = Math.sin(this.state.time * 1.7 + id * 2.1) * WOBBLE[difficulty];
    const tx = ahead.x - Math.sin(ahead.angle) * wobble;
    const ty = ahead.y + Math.cos(ahead.angle) * wobble;
    const d = angleDiff(k.angle, Math.atan2(ty - k.y, tx - k.x));
    const dx = Math.abs(d) > 0.06 ? (Math.sign(d) as -1 | 1) : 0;
    const drift = difficulty !== 'easy' && Math.abs(d) > 0.5;
    const brake = Math.abs(d) > (difficulty === 'easy' ? 0.8 : 1.0);
    return { dx, dy: brake ? 1 : 0, action: drift };
  }
}

export const KartRushDef: MinigameDef = {
  id: 'kart',
  name: 'KART RUSH',
  handle: '@kart.rush',
  hint: 'A/D CURVA  S FREIO  ESPAÇO DRIFT',
  rounds: true,
  create: (players) => new KartRush(players),
};

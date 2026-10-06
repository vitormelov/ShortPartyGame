import { ARENA_H, HUD_H, SCREEN_H, SCREEN_W } from '@shared/arena';
import { NOTIFICATION_TIME, type FeedSnapshot } from '@shared/feed';
import { CHARACTERS, type PlayerId } from '@shared/types';
import { drawCharacter } from '../core/cast';
import { trackFor } from '../core/music';
import { PAL, RES, outlinedText, panel, text } from '../core/draw';
import { FakeComments, drawProgressBar, drawSocialOverlay, drawTopHud } from '../feed/hud';
import { drawComments, drawHaterPanel } from '../feed/haters';
import { CLIP_COLORS, RENDERERS } from '../minigames';
import type { Transport } from '../net/transport';
import { MinigameEndScreen } from './minigame-end';
import { ResultsScreen } from './results';
import type { App, Screen } from './screen';

interface Banner {
  title: string;
  sub: string;
  color: string;
  t: number;
}

interface Popup {
  text: string;
  x: number;
  y: number;
  color: string;
  t: number;
}

/** Two lines of at most 18 characters each (16px font). */
const NOTIFICATIONS: Array<[string, string]> = [
  ['ALGUÉM VIU', 'SEU PERFIL 3:33'],
  ['VOCÊ FOI MARCADO', 'EM 1 FOTO'],
  ['SEU EX COMEÇOU', 'A TE SEGUIR'],
  ['LEMBRETE:', 'BEBER ÁGUA'],
  ['99+ MENSAGENS', 'NÃO LIDAS'],
  ['BATERIA EM 1%', 'CARREGUE JÁ'],
];

/** Every death has a first and last name (style guide, "Tom de voz"). */
const DEATH_LINES: Record<string, string> = {
  kart: 'SAIU DA TRETA',
  penguin: 'FOI CANCELADO',
  tank: 'LEVOU RATIO',
  lantern: 'TOMOU SHADOWBAN',
  book: 'ACEITOU SEM LER',
  dance: 'CRINGE',
  filter: 'FILTRO ERRADO',
  ad: 'CAIU NO GOLPE',
  memoDo: 'CAIU NO GOLPE',
  bomb: 'EXPLODIU AO VIVO',
  meteor: 'CAIU DO CÉU',
  laser: 'CORTADO DA EDIÇÃO',
  elevator: 'NÃO SUBIU',
  beam: 'SAIU DO AR',
  mimic: 'NÃO FEZ A TREND',
  bubble: 'ESTOUROU A BOLHA',
  count: 'ERROU A CONTA',
  rope: 'QUEIMOU O FILME',
  look: 'OLHOU ERRADO',
  paddle: 'LEVOU GOL',
  duel: 'PERDEU O X1',
};

const HITSTOP = 0.05;
const SHAKE_TIME = 0.18;

/** What the fake viewers say when someone dies right after a return. */
const REACT_RETURN = ['VOLTA O CLIPE', 'ESQUECEU KKKK', 'MEMÓRIA DE PEIXE', 'NEM LEMBRAVA'];

const speedLabel = (s: number) => `${String(s).replace('.', ',')}x`;

const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);

export class GameScreen implements Screen {
  private t = 0;
  private flashes = new Map<PlayerId, number>();
  private banners: Banner[] = [];
  private popups: Popup[] = [];
  private shake = 0;
  /** Hitstop: the whole game freezes for 3 frames when someone dies. */
  private hitstop = 0;
  private overTime = 0;
  private heatAnnounced = false;
  private comments = new FakeComments();
  private sinceDeath = 99;
  /** Last place each player was seen alive in the current clip, for the death lines. */
  private lastPos = new Map<PlayerId, [number, number]>();
  private deathLines: Popup[] = [];
  private clipDeaths = 0;
  private snap: FeedSnapshot;

  /** `again` restarts the same match (REPETIR PARTIDA in the minigames mode). */
  constructor(private app: App, private transport: Transport, private again?: () => Screen) {
    this.snap = transport.snapshot();
  }

  private get localId(): PlayerId {
    return this.transport.localPlayerId;
  }

  private name(id: PlayerId): string {
    return this.snap.players.find((p) => p.info.id === id)?.info.name ?? '?';
  }

  /** Each clip has its own song, frozen and resumed with it; the swipe cuts it dead. */
  private updateMusic(): void {
    const m = this.app.music;
    const snap = this.snap;
    const clip = snap.clip;
    const playing = clip && (snap.phase === 'play' || snap.phase === 'preview');
    const track = playing ? trackFor(clip.defId) : null;
    if (snap.phase === 'over' || !clip || !track) {
      m.tension = 0;
      if (snap.phase === 'over') m.play('theme', 'menu');
      else m.stop();
      return;
    }
    m.rate = clip.speed;
    m.heat = snap.heat;
    m.tension = snap.phase === 'play' ? Math.max(0, (snap.clipTime / snap.clipDuration - 0.7) / 0.3) : 0;
    m.setMuffled(snap.haters.some((h) => h.id === this.localId));
    m.play(track, `clip${clip.instanceId}`);
  }

  private charOf(id: PlayerId): number {
    return this.snap.players.find((p) => p.info.id === id)?.info.character ?? 0;
  }

  private lifePopup(id: PlayerId): void {
    this.flashes.set(id, 0.6);
    this.popups.push({ text: '+1', x: this.chipX(id) + 4, y: 14, color: PAL.green, t: 0 });
  }

  private chipX(id: PlayerId): number {
    const i = this.snap.players.findIndex((p) => p.info.id === id);
    return i * Math.floor(SCREEN_W / this.snap.players.length);
  }

  update(dt: number): void {
    this.t += dt;
    this.transport.sendInput(this.app.input.playerInput());
    if (this.hitstop > 0) this.hitstop -= dt;
    else this.transport.update(dt);
    this.snap = this.transport.snapshot();

    if (!this.heatAnnounced && this.snap.heat > 0) {
      this.heatAnnounced = true;
      this.app.sfx.play('eliminated');
      this.banners.push({ title: 'O ALGORITMO', sub: 'ACELEROU! TUDO MAIS PERIGOSO', color: PAL.yellow, t: 0 });
    }

    for (const e of this.transport.drainEvents()) {
      switch (e.type) {
        case 'swipe':
          this.app.sfx.play('swipe');
          this.clipDeaths = 0;
          break;
        case 'clipStart': {
          this.app.sfx.play(e.isReturn ? 'return' : 'go');
          if (e.speed > 1) this.app.sfx.play('fastforward');
          break;
        }
        case 'countdown':
          this.app.sfx.play('tick');
          break;
        case 'notification':
          this.app.sfx.play('notification');
          break;
        case 'lifeLost': {
          this.flashes.set(e.player, 0.8);
          this.sinceDeath = 0;
          this.hitstop = HITSTOP;
          this.app.music.duck();
          {
            const def = this.snap.clip?.defId ?? '';
            const at = this.lastPos.get(e.player);
            const line = DEATH_LINES[def];
            if (line) this.deathLines.push({ text: line, x: at ? at[0] : SCREEN_W / 2, y: at ? at[1] + HUD_H - 16 : HUD_H + ARENA_H / 2, color: CHARACTERS[this.charOf(e.player)].color, t: 0 });
          }
          this.app.sfx.play('like');
          if (this.snap.clip?.defId === 'paddle') this.shake = SHAKE_TIME;
          this.clipDeaths++;
          this.comments.react(e.onReturn ? REACT_RETURN[this.clipDeaths % REACT_RETURN.length] : `KKKKKK O ${CHARACTERS[this.charOf(e.player)].name}`, CHARACTERS[(e.player + 3) % CHARACTERS.length].color);
          const mine = e.player === this.localId;
          if (mine) {
            this.shake = SHAKE_TIME;
            this.app.sfx.play('lifeLost');
          }
          this.popups.push({ text: e.onReturn ? 'FLOP!' : '-1', x: this.chipX(e.player) + 4, y: 14, color: e.onReturn ? PAL.pink : PAL.red, t: 0 });
          if (mine && e.onReturn && e.lives > 0) this.banners.push({ title: 'FLOPOU!', sub: 'ESQUECEU ONDE ESTAVA', color: PAL.pink, t: 0 });
          break;
        }
        case 'eliminated': {
          const mine = e.player === this.localId;
          this.app.sfx.play('eliminated');
          this.banners.push({
            title: mine ? 'VOCÊ SAIU!' : `${this.name(e.player)} SAIU`,
            sub: mine ? 'AGORA SÓ ASSISTINDO' : 'DEIXOU DE SEGUIR',
            color: mine ? PAL.red : PAL.white,
            t: 0,
          });
          break;
        }
        case 'bonusLife':
          this.app.sfx.play('bonusLife');
          this.flashes.set(e.player, 0.5);
          this.popups.push({ text: '+1', x: this.chipX(e.player) + 4, y: 14, color: PAL.green, t: 0 });
          // The X1 screen announces its own winner.
          if (e.reason !== 'VENCEU O X1') this.banners.push({ title: 'VIRALIZOU!', sub: `${this.name(e.player)}: ${e.reason} +1`, color: PAL.green, t: 0 });
          break;
        case 'sfx':
          this.app.sfx.play(e.name);
          if (e.name === 'explosion' || e.name === 'slam') this.shake = SHAKE_TIME;
          break;
        case 'pollResult':
          // The poll screen shows the outcome itself; just pop the hearts for gifts.
          if (e.kind === 'gift') for (const id of e.winners) this.lifePopup(id);
          break;
        case 'betResolved': {
          this.app.sfx.play(e.winners.length ? 'bonusLife' : 'lifeLost');
          for (const id of e.winners) this.lifePopup(id);
          const mine = e.winners.includes(this.localId);
          const who = e.winners.length ? `${e.winners.length} ACERTARAM +1` : 'NINGUÉM ACERTOU';
          this.banners.push({ title: mine ? 'ACERTOU A APOSTA!' : 'APOSTA ENCERRADA', sub: `${this.name(e.dead)} MORREU 1º - ${who}`, color: mine ? PAL.green : PAL.pink, t: 0 });
          break;
        }
        case 'duelResult':
          // The shield icon shows up on their chips; just make those chips flash.
          for (const id of e.torcida) this.flashes.set(id, 0.6);
          break;
        case 'shieldUsed':
          this.app.sfx.play('bump');
          this.flashes.set(e.player, 0.6);
          this.popups.push({ text: 'SALVO!', x: this.chipX(e.player) + 2, y: 14, color: PAL.cyan, t: 0 });
          break;
        case 'gameOver': {
          this.app.sfx.play('win');
          const w = this.snap.players.find((p) => p.info.id === e.winners[0]);
          if (w) setTimeout(() => this.app.sfx.voice(w.info.character, 8), 900);
          break;
        }
      }
    }

    for (const [id, v] of this.flashes) this.flashes.set(id, v - dt);
    this.popups.forEach((p) => (p.t += dt));
    this.deathLines.forEach((p) => (p.t += dt));
    this.deathLines = this.deathLines.filter((p) => p.t < 1.3);
    const clipNow = this.snap.clip;
    if (clipNow && (this.snap.phase === 'play' || this.snap.phase === 'preview')) {
      for (const [id, x, y] of RENDERERS[clipNow.defId]?.positions?.(clipNow.state) ?? []) this.lastPos.set(id, [x, y]);
    }
    if (this.snap.phase === 'swipe') this.lastPos.clear();
    this.popups = this.popups.filter((p) => p.t < 1);
    if (this.banners.length) {
      this.banners[0].t += dt;
      if (this.banners[0].t > 1.6) this.banners.shift();
    }
    this.shake = Math.max(0, this.shake - dt);
    this.sinceDeath += dt;
    this.updateMusic();
    this.comments.update(dt, this.snap.phase === 'play' && this.snap.clip?.defId !== 'duel');

    if (this.snap.phase === 'over') {
      this.overTime += dt;
      if (this.overTime > 2 && this.app.input.pressed('action')) {
        this.transport.dispose();
        if (this.snap.mode === 'minigame') this.app.go(new MinigameEndScreen(this.app, this.snap, this.localId, this.again));
        else this.app.go(new ResultsScreen(this.app, this.snap, this.localId));
      }
    }
  }

  private renderClip(ctx: CanvasRenderingContext2D, defId: string, state: unknown, offsetY: number): void {
    const renderer = RENDERERS[defId];
    if (!renderer) return;
    // Never more than 2px, so it doesn't get tiring.
    const sx = this.shake > 0 ? Math.round((Math.random() - 0.5) * 4) : 0;
    const sy = this.shake > 0 ? Math.round((Math.random() - 0.5) * 4) : 0;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, HUD_H, SCREEN_W, ARENA_H);
    ctx.clip();
    ctx.translate(sx, Math.round(HUD_H + offsetY) + sy);
    renderer.render(ctx, state, this.t, this.localId);
    ctx.restore();
  }

  render(ctx: CanvasRenderingContext2D): void {
    const snap = this.snap;
    ctx.fillStyle = PAL.ink;
    ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);

    const clip = snap.clip;
    if (snap.phase === 'swipe' && clip) {
      const p = ease(Math.min(1, snap.phaseTime / snap.phaseDuration));
      if (snap.prev) this.renderClip(ctx, snap.prev.defId, snap.prev.state, -p * ARENA_H);
      this.renderClip(ctx, clip.defId, clip.state, (1 - p) * ARENA_H);
      // speed lines
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      for (let i = 0; i < 12; i++) {
        const x = (i * 37 + Math.floor(this.t * 500)) % SCREEN_W;
        ctx.fillRect(x, HUD_H, 1, ARENA_H);
      }
    } else if (clip) {
      this.renderClip(ctx, clip.defId, clip.state, 0);
      if (snap.spotlight >= 0 && (snap.phase === 'play' || snap.phase === 'preview')) this.spotlightOverlay(ctx, clip.defId, clip.state);
    }

    const amHater = snap.haters.some((h) => h.id === this.localId);
    // The X1 needs the whole screen (Pong paddles live at the edges).
    if (clip && snap.phase !== 'swipe' && snap.phase !== 'over' && !amHater && clip.defId !== 'duel') {
      drawSocialOverlay(ctx, snap, this.t, { sinceDeath: this.sinceDeath, bonus: this.clipDeaths });
      if (snap.phase === 'play') this.comments.render(ctx);
    }
    if (clip && snap.phase === 'play' && snap.comments.length) {
      drawComments(ctx, snap, RENDERERS[clip.defId]?.positions?.(clip.state) ?? [], this.t);
    }
    if (clip && snap.phase === 'play' && snap.notification > 0) this.notificationPopup(ctx);

    if (snap.phase === 'countdown' && clip) {
      if (snap.tutorials) this.titleCard(ctx, clip.defId, clip.name, clip.hint, clip.handle);
      const n = Math.max(1, Math.ceil(snap.phaseDuration - snap.phaseTime));
      outlinedText(ctx, `${n}`, SCREEN_W / 2, 150, PAL.yellow, 32);
    } else if (snap.phase === 'preview' && clip) {
      if (clip.isReturn) this.returnCard(ctx);
      else if (snap.tutorials) this.titleCard(ctx, clip.defId, clip.name, clip.hint, clip.handle, clip.speed);
    } else if (snap.phase === 'play' && clip?.isReturn && snap.clipTime < 1.2 && Math.floor(this.t * 6) % 2 === 0) {
      panel(ctx, 4, HUD_H + 26, 64, 12, PAL.red, PAL.white);
      text(ctx, 'REPLAY', 36, HUD_H + 28, PAL.white, 8, 'center');
    }
    if (clip && clip.speed > 1 && (snap.phase === 'preview' || snap.phase === 'play')) this.speedBadge(ctx, clip.speed);
    if (snap.betActive && clip && clip.defId !== 'poll' && snap.phase !== 'over') {
      panel(ctx, SCREEN_W - 62, HUD_H + 2, 56, 12, PAL.ink, PAL.pink);
      text(ctx, 'APOSTA', SCREEN_W - 34, HUD_H + 4, PAL.pink, 8, 'center');
    }

    drawTopHud(ctx, snap, this.localId, this.flashes, this.t);
    if (clip && clip.defId !== 'duel') drawProgressBar(ctx, snap, this.t);

    for (const d of this.deathLines) {
      const k = Math.min(1, d.t / 0.12);
      ctx.globalAlpha = d.t > 1 ? (1.3 - d.t) / 0.3 : 1;
      const w = d.text.length * 8;
      const x = Math.max(4 + w / 2, Math.min(SCREEN_W - 4 - w / 2, d.x));
      outlinedText(ctx, d.text, x, d.y - d.t * 8 - (1 - k) * 6, Math.floor(d.t * 10) % 2 && d.t < 0.4 ? PAL.white : d.color, 8);
      ctx.globalAlpha = 1;
    }

    for (const p of this.popups) {
      outlinedText(ctx, p.text, p.x, p.y + p.t * 10, p.color, 8, 'left');
    }

    const me = snap.players.find((p) => p.info.id === this.localId);
    const myHater = snap.haters.find((h) => h.id === this.localId);
    if (me?.eliminated && myHater && snap.phase !== 'over') drawHaterPanel(ctx, snap, myHater, this.t);


    if (this.banners.length && snap.phase !== 'over') {
      const b = this.banners[0];
      const slide = Math.min(1, b.t / 0.15);
      const y = 80;
      const w = Math.floor(SCREEN_W * slide);
      ctx.fillStyle = 'rgba(10,6,20,0.85)';
      ctx.fillRect((SCREEN_W - w) / 2, y, w, 40);
      if (slide >= 1) {
        outlinedText(ctx, b.title, SCREEN_W / 2, y + 6, b.color, 16);
        text(ctx, b.sub, SCREEN_W / 2, y + 27, PAL.white, 8, 'center');
      }
    }

    if (snap.phase === 'over') this.overCard(ctx);
  }

  private spotCanvas: HTMLCanvasElement | null = null;

  /** HOLOFOTE: everything goes dark except a big light on the most-followed player. */
  private spotlightOverlay(ctx: CanvasRenderingContext2D, defId: string, state: unknown): void {
    const pos = RENDERERS[defId]?.positions?.(state);
    const star = pos?.find((p) => p[0] === this.snap.spotlight);
    if (!pos || !star) return;
    if (!this.spotCanvas) {
      this.spotCanvas = document.createElement('canvas');
      this.spotCanvas.width = SCREEN_W * RES;
      this.spotCanvas.height = ARENA_H * RES;
    }
    const dk = this.spotCanvas.getContext('2d')!;
    dk.setTransform(RES, 0, 0, RES, 0, 0);
    dk.globalCompositeOperation = 'source-over';
    dk.clearRect(0, 0, SCREEN_W, ARENA_H);
    dk.fillStyle = 'rgba(16,6,36,0.9)';
    dk.fillRect(0, 0, SCREEN_W, ARENA_H);
    dk.globalCompositeOperation = 'destination-out';
    const hole = (x: number, y: number, r: number) => {
      const g = dk.createRadialGradient(x, y, r * 0.5, x, y, r);
      g.addColorStop(0, 'rgba(20,6,46,1)');
      g.addColorStop(1, 'rgba(20,6,46,0)');
      dk.fillStyle = g;
      dk.beginPath();
      dk.arc(x, y, r, 0, Math.PI * 2);
      dk.fill();
    };
    hole(star[1], star[2], 48);
    const me = pos.find((p) => p[0] === this.localId);
    if (me && me[0] !== star[0]) hole(me[1], me[2], 16);
    ctx.drawImage(this.spotCanvas, 0, HUD_H, SCREEN_W, ARENA_H);
    // The beam of light coming from above, and a star over the famous one.
    const sx = star[1];
    const sy = star[2] + HUD_H;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = 'rgba(255,230,140,0.1)';
    ctx.beginPath();
    ctx.moveTo(sx - 8, HUD_H);
    ctx.lineTo(sx + 8, HUD_H);
    ctx.lineTo(sx + 44, sy);
    ctx.lineTo(sx - 44, sy);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    const bob = Math.floor(this.t * 4) % 2;
    ctx.fillStyle = PAL.yellow;
    ctx.fillRect(sx - 1, sy - 22 - bob, 3, 7);
    ctx.fillRect(sx - 3, sy - 20 - bob, 7, 3);
  }

  /** Mid-clip notification: a big pop-up right in the middle of the action. */
  private notificationPopup(ctx: CanvasRenderingContext2D): void {
    const snap = this.snap;
    const shown = NOTIFICATION_TIME - snap.notification;
    // Pop in with a little overshoot.
    const k = Math.min(1, shown / 0.15);
    const scale = k < 1 ? 0.6 + k * 0.5 : 1 + Math.max(0, 0.1 - (shown - 0.15));
    const [line1, line2] = NOTIFICATIONS[snap.notifIndex % NOTIFICATIONS.length];
    const w = 300;
    const h = 76;
    const cx = SCREEN_W / 2;
    const cy = HUD_H + ARENA_H / 2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);
    ctx.fillStyle = 'rgba(10,6,20,0.45)';
    ctx.fillRect(-w / 2 + 4, -h / 2 + 5, w, h);
    panel(ctx, -w / 2, -h / 2, w, h, '#f4f0fc', PAL.white);
    ctx.fillStyle = PAL.pink;
    ctx.fillRect(-w / 2 + 8, -h / 2 + 8, 22, 22);
    text(ctx, 'SP', -w / 2 + 19, -h / 2 + 15, PAL.white, 8, 'center', null);
    text(ctx, 'SHORTPARTY - AGORA', -w / 2 + 36, -h / 2 + 15, PAL.grey, 8, 'left', null);
    outlinedText(ctx, line1, 0, -h / 2 + 36, PAL.ink, 16, 'center', '#f4f0fc');
    outlinedText(ctx, line2, 0, -h / 2 + 54, PAL.red, 16, 'center', '#f4f0fc');
    ctx.restore();
  }

  /** Reels-style "2x >>" pill shown while a clip is fast-forwarded. */
  private speedBadge(ctx: CanvasRenderingContext2D, speed: number): void {
    const label = speedLabel(speed);
    const w = label.length * 8 + 24;
    const x = SCREEN_W - 6 - w;
    const y = HUD_H + 28;
    panel(ctx, x, y, w, 14, PAL.ink, PAL.yellow);
    text(ctx, label, x + 4, y + 3, PAL.yellow);
    // two play triangles, the second one blinking
    for (let k = 0; k < 2; k++) {
      if (k === 1 && Math.floor(this.t * 8) % 2 === 0) continue;
      const tx = x + w - 17 + k * 6;
      ctx.fillStyle = PAL.yellow;
      for (let i = 0; i < 4; i++) ctx.fillRect(tx + i, y + 3 + i, 1, 8 - i * 2);
    }
  }

  private titleCard(ctx: CanvasRenderingContext2D, defId: string, name: string, hint: string, handle: string, speed = 1): void {
    const color = CLIP_COLORS[defId] ?? PAL.pink;
    ctx.fillStyle = 'rgba(10,6,20,0.55)';
    ctx.fillRect(0, HUD_H, SCREEN_W, ARENA_H);
    panel(ctx, 52, 56, 280, 74, PAL.ink, color);
    outlinedText(ctx, name, SCREEN_W / 2, 66, color, 16);
    text(ctx, handle, SCREEN_W / 2, 90, PAL.grey, 8, 'center');
    text(ctx, hint, SCREEN_W / 2, 108, PAL.white, 8, 'center');
    if (speed > 1 && Math.floor(this.t * 6) % 2 === 0) text(ctx, `VELOCIDADE ${speedLabel(speed)}!`, SCREEN_W / 2, 119, PAL.yellow, 8, 'center');
  }

  private returnCard(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = 'rgba(255,59,92,0.18)';
    ctx.fillRect(0, HUD_H, SCREEN_W, ARENA_H);
    // Kept small and at the bottom: the player needs to see the frozen frame, not the label.
    ctx.fillStyle = 'rgba(10,6,20,0.8)';
    ctx.fillRect(0, SCREEN_H - 16, SCREEN_W, 16);
    outlinedText(ctx, 'VOLTOU! CONTINUA DE ONDE PAROU', SCREEN_W / 2, SCREEN_H - 12, Math.floor(this.t * 12) % 2 ? PAL.red : PAL.white, 8);
  }

  private overCard(ctx: CanvasRenderingContext2D): void {
    const snap = this.snap;
    ctx.fillStyle = 'rgba(10,6,20,0.75)';
    ctx.fillRect(0, HUD_H, SCREEN_W, ARENA_H);
    outlinedText(ctx, this.snap.mode === 'minigame' ? 'FIM DE JOGO' : 'FIM DO FEED', SCREEN_W / 2, 36, PAL.yellow, 16);
    const winners = snap.winners;
    const frame = Math.floor(this.t * 3) % 2;
    winners.forEach((id, i) => {
      const p = snap.players.find((pp) => pp.info.id === id);
      if (!p) return;
      const x = SCREEN_W / 2 - (winners.length * 64) / 2 + i * 64 + 32;
      drawCharacter(ctx, p.info.character, x, 110, { size: 50, pose: 'win', frame, time: this.t });
      text(ctx, p.info.name, x, 112, CHARACTERS[p.info.character].color, 8, 'center');
    });
    const mine = winners.includes(this.localId);
    outlinedText(ctx, mine ? 'VOCÊ VENCEU!' : winners.length > 1 ? 'EMPATE!' : 'VENCEU!', SCREEN_W / 2, 126, mine ? PAL.green : PAL.white, 16);
    // Everyone else, slumped.
    const losers = snap.players.filter((p) => !winners.includes(p.info.id));
    losers.forEach((p, i) => drawCharacter(ctx, p.info.character, SCREEN_W / 2 - (losers.length - 1) * 14 + i * 28, 176, { size: 22, pose: 'lose', time: this.t }));
    if (this.overTime > 2 && Math.floor(this.t * 2) % 2 === 0) text(ctx, this.snap.mode === 'minigame' ? 'ESPAÇO: CONTINUAR' : 'ESPAÇO: RESULTADOS', SCREEN_W / 2, 186, PAL.white, 8, 'center');
  }
}

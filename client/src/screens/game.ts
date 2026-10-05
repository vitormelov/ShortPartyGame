import { ARENA_H, HUD_H, SCREEN_H, SCREEN_W } from '@shared/arena';
import { NOTIFICATION_TIME, type FeedSnapshot } from '@shared/feed';
import { CHARACTERS, type PlayerId } from '@shared/types';
import { PAL, outlinedText, panel, portrait, text } from '../core/draw';
import { drawSocialOverlay, drawTopHud } from '../feed/hud';
import { drawComments, drawHaterPanel } from '../feed/haters';
import { CLIP_COLORS, RENDERERS } from '../minigames';
import type { Transport } from '../net/transport';
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

const speedLabel = (s: number) => `${String(s).replace('.', ',')}x`;

const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);

export class GameScreen implements Screen {
  private t = 0;
  private flashes = new Map<PlayerId, number>();
  private banners: Banner[] = [];
  private popups: Popup[] = [];
  private shake = 0;
  private overTime = 0;
  private heatAnnounced = false;
  private snap: FeedSnapshot;

  constructor(private app: App, private transport: Transport) {
    this.snap = transport.snapshot();
  }

  private get localId(): PlayerId {
    return this.transport.localPlayerId;
  }

  private name(id: PlayerId): string {
    return this.snap.players.find((p) => p.info.id === id)?.info.name ?? '?';
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
    this.transport.update(dt);
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
          break;
        case 'clipStart':
          this.app.sfx.play(e.isReturn ? 'return' : 'go');
          if (e.speed > 1) this.app.sfx.play('fastforward');
          break;
        case 'countdown':
          this.app.sfx.play('tick');
          break;
        case 'notification':
          this.app.sfx.play('notification');
          break;
        case 'lifeLost': {
          this.flashes.set(e.player, 0.8);
          const mine = e.player === this.localId;
          if (mine) {
            this.shake = 0.35;
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
        case 'gameOver':
          this.app.sfx.play('win');
          break;
      }
    }

    for (const [id, v] of this.flashes) this.flashes.set(id, v - dt);
    this.popups.forEach((p) => (p.t += dt));
    this.popups = this.popups.filter((p) => p.t < 1);
    if (this.banners.length) {
      this.banners[0].t += dt;
      if (this.banners[0].t > 1.6) this.banners.shift();
    }
    this.shake = Math.max(0, this.shake - dt);

    if (this.snap.phase === 'over') {
      this.overTime += dt;
      if (this.overTime > 2 && this.app.input.pressed('action')) {
        this.transport.dispose();
        this.app.go(new ResultsScreen(this.app, this.snap, this.localId));
      }
    }
  }

  private renderClip(ctx: CanvasRenderingContext2D, defId: string, state: unknown, offsetY: number): void {
    const renderer = RENDERERS[defId];
    if (!renderer) return;
    const sx = this.shake > 0 ? Math.round((Math.random() - 0.5) * 6) : 0;
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
    if (clip && snap.phase !== 'swipe' && snap.phase !== 'over' && !amHater && clip.defId !== 'duel') drawSocialOverlay(ctx, snap, this.t);
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
      this.spotCanvas.width = SCREEN_W;
      this.spotCanvas.height = ARENA_H;
    }
    const dk = this.spotCanvas.getContext('2d')!;
    dk.globalCompositeOperation = 'source-over';
    dk.clearRect(0, 0, SCREEN_W, ARENA_H);
    dk.fillStyle = 'rgba(4,2,10,0.9)';
    dk.fillRect(0, 0, SCREEN_W, ARENA_H);
    dk.globalCompositeOperation = 'destination-out';
    const hole = (x: number, y: number, r: number) => {
      const g = dk.createRadialGradient(x, y, r * 0.5, x, y, r);
      g.addColorStop(0, 'rgba(0,0,0,1)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      dk.fillStyle = g;
      dk.beginPath();
      dk.arc(x, y, r, 0, Math.PI * 2);
      dk.fill();
    };
    hole(star[1], star[2], 48);
    const me = pos.find((p) => p[0] === this.localId);
    if (me && me[0] !== star[0]) hole(me[1], me[2], 16);
    ctx.drawImage(this.spotCanvas, 0, HUD_H);
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
    // Kept small and at the top: the player needs to see the frozen frame, not the label.
    ctx.fillStyle = 'rgba(10,6,20,0.8)';
    ctx.fillRect(0, HUD_H, SCREEN_W, 22);
    outlinedText(ctx, 'VOLTOU! CONTINUA DE ONDE PAROU', SCREEN_W / 2, HUD_H + 7, Math.floor(this.t * 12) % 2 ? PAL.red : PAL.white, 8);
  }

  private overCard(ctx: CanvasRenderingContext2D): void {
    const snap = this.snap;
    ctx.fillStyle = 'rgba(10,6,20,0.75)';
    ctx.fillRect(0, HUD_H, SCREEN_W, ARENA_H);
    outlinedText(ctx, 'FIM DO FEED', SCREEN_W / 2, 36, PAL.yellow, 16);
    const winners = snap.winners;
    winners.forEach((id, i) => {
      const p = snap.players.find((pp) => pp.info.id === id);
      if (!p) return;
      const x = SCREEN_W / 2 - (winners.length * 56) / 2 + i * 56 + 12;
      portrait(ctx, p.info.character, x, 70, 2);
      text(ctx, p.info.name, x + 16, 108, CHARACTERS[p.info.character].color, 8, 'center');
    });
    const mine = winners.includes(this.localId);
    outlinedText(ctx, mine ? 'VOCÊ VENCEU!' : winners.length > 1 ? 'EMPATE!' : 'VENCEU!', SCREEN_W / 2, 126, mine ? PAL.green : PAL.white, 16);
    if (this.overTime > 2 && Math.floor(this.t * 2) % 2 === 0) text(ctx, 'ESPAÇO: RESULTADOS', SCREEN_W / 2, 170, PAL.white, 8, 'center');
  }
}

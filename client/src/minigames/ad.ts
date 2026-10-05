import { ARENA_H, ARENA_W } from '@shared/arena';
import type { AdState, AdViewer } from '@shared/minigames/ad/logic';
import type { PlayerId } from '@shared/types';
import { PAL, outlinedText, panel, portrait, text } from '../core/draw';
import type { MinigameRenderer } from './renderer';

export interface AdCopy {
  lines: [string, string];
  tagline: string;
  fine: string;
  bg: [string, string];
  accent: string;
  product: 'can' | 'chart' | 'phones' | 'bell' | 'kart' | 'pill';
}

export const ADS: AdCopy[] = [
  { lines: ['ENERGÉTICO', 'PIXEL MAX'], tagline: '+300% DE FOCO*', fine: '*POR 5 SEGUNDOS', bg: ['#1e3ad8', '#2a4ae8'], accent: PAL.yellow, product: 'can' },
  { lines: ['FIQUE RICO', 'EM 5 SEGUNDOS'], tagline: 'CURSO COM 97% OFF', fine: 'RESULTADOS NÃO GARANTIDOS', bg: ['#1a8a3a', '#22a046'], accent: PAL.yellow, product: 'chart' },
  { lines: ['FONE SEM FIO', '99% OFF'], tagline: 'SÓ HOJE! (TODO DIA)', fine: 'FRETE DE 4 ANOS', bg: ['#c8268a', '#e83aa0'], accent: PAL.white, product: 'phones' },
  { lines: ['ATENÇÃO', 'PREMIUM'], tagline: 'AGORA COM + NOTIFICAÇÕES', fine: 'ASSINATURA RENOVA SOZINHA', bg: ['#8a2ad8', '#9a3ae8'], accent: PAL.cyan, product: 'bell' },
  { lines: ['SKIN DOURADA', 'PRO SEU KART'], tagline: 'SÓ R$ 49,90', fine: 'NÃO AUMENTA A VELOCIDADE', bg: ['#c86a1e', '#e8821e'], accent: PAL.white, product: 'kart' },
  { lines: ['PÍLULA', 'ANTI-SCROLL'], tagline: 'LARGUE O CELULAR!', fine: 'EFEITO COLATERAL: SCROLL', bg: ['#d83a3a', '#e84a4a'], accent: PAL.yellow, product: 'pill' },
];

export function drawProduct(ctx: CanvasRenderingContext2D, kind: AdCopy['product'], x: number, y: number, time: number): void {
  const bob = Math.round(Math.sin(time * 4) * 2);
  y += bob;
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(x - 14, y + 34, 28, 4);
  switch (kind) {
    case 'can':
      ctx.fillStyle = PAL.ink;
      ctx.fillRect(x - 11, y - 2, 22, 36);
      ctx.fillStyle = '#d8d8e8';
      ctx.fillRect(x - 10, y - 1, 20, 34);
      ctx.fillStyle = '#1a1a2a';
      ctx.fillRect(x - 10, y + 6, 20, 20);
      ctx.fillStyle = PAL.yellow;
      for (let i = 0; i < 4; i++) ctx.fillRect(x - 3 + i * 2 - (i > 1 ? 4 : 0), y + 8 + i * 4, 4, 2);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x - 8, y + 1, 2, 30);
      break;
    case 'chart':
      ctx.fillStyle = PAL.ink;
      ctx.fillRect(x - 18, y, 36, 34);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x - 17, y + 1, 34, 32);
      [6, 10, 8, 16, 26].forEach((h, i) => {
        ctx.fillStyle = i === 4 ? '#22a046' : '#5cf26a';
        ctx.fillRect(x - 14 + i * 6, y + 30 - h, 4, h);
      });
      break;
    case 'phones':
      ctx.fillStyle = PAL.ink;
      ctx.fillRect(x - 14, y + 4, 28, 4);
      ctx.fillRect(x - 16, y + 4, 4, 22);
      ctx.fillRect(x + 12, y + 4, 4, 22);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x - 19, y + 16, 9, 14);
      ctx.fillRect(x + 10, y + 16, 9, 14);
      ctx.fillStyle = '#aaaacc';
      ctx.fillRect(x - 17, y + 18, 5, 10);
      ctx.fillRect(x + 12, y + 18, 5, 10);
      break;
    case 'bell':
      ctx.fillStyle = PAL.yellow;
      ctx.beginPath();
      ctx.arc(x, y + 16, 14, Math.PI, 0);
      ctx.fill();
      ctx.fillRect(x - 14, y + 16, 28, 12);
      ctx.fillRect(x - 18, y + 26, 36, 4);
      ctx.fillStyle = PAL.red;
      ctx.beginPath();
      ctx.arc(x + 12, y + 4, 7, 0, Math.PI * 2);
      ctx.fill();
      text(ctx, '99', x + 12, y + 1, PAL.white, 8, 'center', null);
      break;
    case 'kart':
      ctx.fillStyle = PAL.ink;
      ctx.fillRect(x - 20, y + 12, 40, 18);
      ctx.fillStyle = '#ffd23e';
      ctx.fillRect(x - 19, y + 13, 38, 12);
      ctx.fillStyle = '#fff08a';
      ctx.fillRect(x - 17, y + 14, 20, 2);
      ctx.fillStyle = PAL.ink;
      ctx.fillRect(x - 16, y + 24, 8, 8);
      ctx.fillRect(x + 8, y + 24, 8, 8);
      if (Math.floor(time * 6) % 2) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x + 14, y + 8, 2, 2);
        ctx.fillRect(x - 10, y + 6, 1, 1);
      }
      break;
    case 'pill':
      ctx.fillStyle = PAL.ink;
      ctx.fillRect(x - 20, y + 8, 40, 20);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x - 19, y + 9, 19, 18);
      ctx.fillStyle = '#3ee8ff';
      ctx.fillRect(x, y + 9, 19, 18);
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.fillRect(x - 16, y + 11, 30, 3);
      break;
  }
}

const STATUS_LABEL: Record<AdViewer['status'], [string, string]> = {
  watching: ['...', PAL.grey],
  skipped: ['OK', PAL.green],
  early: ['CEDO', PAL.red],
  late: ['LENTO', PAL.red],
  out: ['', PAL.grey],
};

export const adRenderer: MinigameRenderer = {
  render(ctx, raw, time, localId: PlayerId) {
    const st = raw as AdState;
    const ad = ADS[st.adIndex % ADS.length];

    for (let y = 0; y < ARENA_H; y += 8) {
      ctx.fillStyle = (y / 8) % 2 ? ad.bg[0] : ad.bg[1];
      ctx.fillRect(0, y, ARENA_W, 8);
    }
    // sparkles
    for (let i = 0; i < 10; i++) {
      if ((Math.floor(time * 5) + i) % 3) continue;
      ctx.fillStyle = '#ffffff';
      const x = (i * 71) % ARENA_W;
      const y = 20 + ((i * 37) % 120);
      ctx.fillRect(x, y - 2, 1, 5);
      ctx.fillRect(x - 2, y, 5, 1);
    }

    panel(ctx, 4, 4, 92, 12, PAL.ink, PAL.yellow);
    text(ctx, 'PATROCINADO', 50, 6, PAL.yellow, 8, 'center');

    drawProduct(ctx, ad.product, 70, 40, time);
    outlinedText(ctx, ad.lines[0], 236, 30, PAL.white, 16);
    outlinedText(ctx, ad.lines[1], 236, 50, ad.accent, 16);
    text(ctx, ad.tagline, 236, 76, PAL.white, 8, 'center');
    text(ctx, ad.fine, 236, 90, 'rgba(255,255,255,0.7)', 8, 'center');

    // Skip button.
    const unlockAt = st.digitEnds[st.digitEnds.length - 1];
    const bx = 236;
    const by = 112;
    if (st.phase === 'wait') {
      const passed = st.digitEnds.filter((t) => st.time >= t).length;
      panel(ctx, bx, by, 110, 20, 'rgba(10,6,20,0.85)', PAL.grey);
      text(ctx, `PULAR EM ${st.digitEnds.length - passed}`, bx + 55, by + 6, PAL.grey, 8, 'center');
    } else {
      const ready = st.phase === 'skip';
      const blink = ready && Math.floor(time * 10) % 2 === 0;
      panel(ctx, bx, by, 110, 20, blink ? PAL.yellow : PAL.ink, PAL.white);
      text(ctx, ready ? 'PULAR >>' : 'FIM', bx + 55, by + 6, blink ? PAL.ink : PAL.white, 8, 'center', null);
      if (ready) {
        const left = Math.max(0, 1 - (st.time - unlockAt) / st.window);
        ctx.fillStyle = PAL.red;
        ctx.fillRect(bx + 1, by + 17, Math.round(108 * left), 2);
      }
    }

    // Who has skipped.
    const n = st.viewers.length;
    const w = 40;
    const x0 = Math.floor((ARENA_W - n * w) / 2);
    st.viewers.forEach((v, i) => {
      if (v.status === 'out') return;
      const x = x0 + i * w;
      const y = 142;
      const bad = v.status === 'early' || v.status === 'late';
      portrait(ctx, v.character, x + 12, y, 1, bad);
      const [label, color] = STATUS_LABEL[v.status];
      text(ctx, label, x + 20, y + 19, color, 8, 'center');
      if (v.id === localId) {
        ctx.fillStyle = PAL.yellow;
        ctx.fillRect(x + 16, y - 4, 8, 2);
      }
    });

    const me = st.viewers.find((v) => v.id === localId);
    if (me && me.status !== 'watching' && me.status !== 'out') {
      const msg =
        me.status === 'skipped' ? `PULOU EM ${me.skipTime.toFixed(2)}s` : me.status === 'early' ? 'APRESSADO! -1' : 'ASSISTIU TUDO! -1';
      outlinedText(ctx, msg, ARENA_W / 2, 176, me.status === 'skipped' ? PAL.green : PAL.red, 8);
    }
  },
};

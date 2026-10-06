/*
 * Music: a small step sequencer that synthesizes every track live on WebAudio (no audio files).
 *
 * Why live: each minigame clip keeps its own place in its song. When the feed swipes away the
 * music cuts dead; when the clip comes back, the song picks up on the exact sixteenth note it
 * froze on, just like the frozen game state. On top of that the music reacts to the match:
 * - fast-forwarded clips play faster and higher, like a video at 2x;
 * - the "heat" adds layers and pushes the tempo;
 * - the last stretch of every clip builds tension (riser + snare roll) right up to the swipe;
 * - deaths duck the mix, and haters hear everything muffled, from outside the party.
 *
 * The sound aims at a Saturn/SNES-era chip sound: detuned pulse leads, saw basses, a little echo,
 * and a sidechain "pump" on every kick.
 */

import { TRACKS, type Inst, type Track } from './tracks';

export { trackFor } from './tracks';

// ---------- the player ----------

const LOOKAHEAD = 0.12; // seconds scheduled ahead
const BUS = 0.55;
/** Loudness matching: the sparser songs get a lift so every clip hits about as hard. */
const TRACK_GAIN: Record<string, number> = { count: 1.5, look: 1.45, elevator: 1.4, lantern: 1.4, rope: 1.3, ad: 1.2, meteor: 1.15, bubble: 1.15 };
const TICK_MS = 25;

export interface AudioOut {
  ctx: AudioContext;
  dest: AudioNode;
  noise: AudioBuffer;
}

export class Music {
  private out: AudioOut | null = null;
  private tracks = new Map<string, Track>();
  /** Where each clip's song stopped (in sixteenths), so a return resumes it. */
  private saved = new Map<string, number>();
  private current: { trackId: string; key: string; track: Track; step: number; next: number } | null = null;
  private wanted: { trackId: string; key: string } | null = null;
  private timer: number | null = null;
  private level = BUS;

  /** Fast-forward of the current clip (1 = normal). */
  rate = 1;
  /** 0..1: the match's heat (more layers, a bit faster). */
  heat = 0;
  /** 0..1: how close the clip is to the swipe. */
  tension = 0;

  // nodes
  private bus!: GainNode; // everything
  private muffle!: BiquadFilterNode;
  private synths!: GainNode; // pumped by the kick
  private drums!: GainNode;
  private echo!: DelayNode;
  private echoIn!: GainNode;
  private riser: { src: AudioBufferSourceNode; filter: BiquadFilterNode; gain: GainNode; whine: OscillatorNode; whineGain: GainNode } | null = null;

  constructor(private connect: () => AudioOut | null) {}

  private ensure(): boolean {
    if (this.out) return true;
    const out = this.connect();
    if (!out) return false;
    this.out = out;
    const { ctx } = out;
    this.bus = ctx.createGain();
    this.bus.gain.value = BUS;
    this.muffle = ctx.createBiquadFilter();
    this.muffle.type = 'lowpass';
    this.muffle.frequency.value = 20000;
    this.bus.connect(this.muffle).connect(out.dest);
    this.synths = ctx.createGain();
    this.synths.connect(this.bus);
    this.drums = ctx.createGain();
    this.drums.connect(this.bus);
    this.echo = ctx.createDelay(1);
    this.echoIn = ctx.createGain();
    this.echoIn.gain.value = 0.22;
    const fb = ctx.createGain();
    fb.gain.value = 0.32;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 3000;
    this.echoIn.connect(this.echo).connect(tone).connect(fb).connect(this.echo);
    tone.connect(this.synths);
    return true;
  }

  /** Plays `trackId` for `key` (a clip instance, or 'menu'), resuming where that key left off. */
  play(trackId: string, key: string): void {
    if (this.wanted?.trackId === trackId && this.wanted.key === key) return;
    this.wanted = { trackId, key };
    if (this.timer === null) this.timer = window.setInterval(() => this.tick(), TICK_MS);
    this.tick();
  }

  /** Hard cut (the swipe). The position is kept for when this clip comes back. */
  stop(): void {
    this.wanted = null;
    this.tick();
  }

  /** A death: the mix dips for a moment. */
  duck(): void {
    if (!this.out) return;
    const t = this.out.ctx.currentTime;
    const g = this.bus.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(0.2, t);
    g.linearRampToValueAtTime(this.level, t + 0.45);
  }

  /** Haters hear the party through a wall. */
  setMuffled(on: boolean): void {
    if (!this.out) return;
    this.muffle.frequency.setTargetAtTime(on ? 650 : 20000, this.out.ctx.currentTime, 0.15);
  }

  private track(id: string): Track {
    let t = this.tracks.get(id);
    if (!t) this.tracks.set(id, (t = (TRACKS[id] ?? TRACKS.theme)()));
    return t;
  }

  private tick(): void {
    if (!this.ensure()) return;
    const ctx = this.out!.ctx;
    const w = this.wanted;
    const cur = this.current;
    if (cur && (!w || w.key !== cur.key || w.trackId !== cur.trackId)) {
      this.saved.set(cur.key, cur.step);
      this.current = null;
      this.killRiser();
      // Cut dead: silence whatever is still ringing.
      for (const g of [this.synths, this.drums]) {
        g.gain.cancelScheduledValues(ctx.currentTime);
        g.gain.setValueAtTime(0, ctx.currentTime);
      }
    }
    if (!w) return;
    if (!this.current) {
      for (const g of [this.synths, this.drums]) {
        g.gain.cancelScheduledValues(ctx.currentTime);
        g.gain.setValueAtTime(1, ctx.currentTime + 0.01);
      }
      this.current = { ...w, track: this.track(w.trackId), step: this.saved.get(w.key) ?? 0, next: ctx.currentTime + 0.02 };
      this.level = BUS * (TRACK_GAIN[w.trackId] ?? 1);
      this.bus.gain.cancelScheduledValues(ctx.currentTime);
      this.bus.gain.setValueAtTime(this.level, ctx.currentTime);
    }
    const c = this.current;
    const speed = this.rate * (1 + this.heat * 0.06);
    const stepDur = 60 / c.track.bpm / 4 / speed;
    while (c.next < ctx.currentTime + LOOKAHEAD) {
      const swing = c.step % 2 === 1 ? c.track.swing * stepDur : 0;
      this.playStep(c.track, c.step % c.track.length, c.next + swing, stepDur);
      c.step++;
      c.next += stepDur;
    }
    this.updateRiser();
  }

  private playStep(track: Track, step: number, t: number, stepDur: number): void {
    const pitch = Math.pow(this.rate, 0.9); // tape speed: faster is higher
    for (const ev of track.steps[step]) {
      if (ev.heat !== undefined && this.heat < ev.heat) continue;
      const f = 440 * Math.pow(2, (ev.midi - 69) / 12) * pitch;
      this.voice(ev.inst, t, f, ev.len * stepDur, ev.vel);
    }
    // Tension: a snare roll that speeds up toward the swipe.
    if (this.tension > 0.25) {
      const every = this.tension > 0.75 ? 1 : this.tension > 0.5 ? 2 : 4;
      if (step % every === 0) this.voice('snare', t, 0, stepDur, 0.25 + this.tension * 0.45);
    }
  }

  // ---------- instruments ----------

  private env(t: number, peak: number, attack: number, dur: number, release: number): GainNode {
    const g = this.out!.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    g.gain.setValueAtTime(Math.max(0.0002, peak * 0.7), t + Math.max(attack, dur * 0.6));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + release);
    return g;
  }

  private osc(type: OscillatorType, f: number, t: number, end: number, detune = 0): OscillatorNode {
    const o = this.out!.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    o.detune.value = detune;
    o.start(t);
    o.stop(end + 0.05);
    return o;
  }

  private noise(t: number, end: number): AudioBufferSourceNode {
    const s = this.out!.ctx.createBufferSource();
    s.buffer = this.out!.noise;
    s.start(t, Math.random() * 0.5);
    s.stop(end + 0.05);
    return s;
  }

  private voice(inst: Inst, t: number, f: number, dur: number, vel: number): void {
    const ctx = this.out!.ctx;
    const lp = (freq: number) => {
      const b = ctx.createBiquadFilter();
      b.type = 'lowpass';
      b.frequency.value = freq;
      return b;
    };
    switch (inst) {
      case 'lead': {
        // Two detuned pulses with a quick vibrato kicking in on long notes: the hook.
        const g = this.env(t, 0.13 * vel, 0.005, dur, 0.06);
        const f1 = lp(5200);
        for (const d of [-9, 9]) {
          const o = this.osc('square', f, t, t + dur + 0.06, d);
          if (dur > 0.25) {
            const lfo = this.osc('sine', 6, t, t + dur + 0.06);
            const lg = ctx.createGain();
            lg.gain.setValueAtTime(0, t);
            lg.gain.linearRampToValueAtTime(f * 0.012, t + dur);
            lfo.connect(lg).connect(o.frequency);
          }
          o.connect(f1);
        }
        f1.connect(g);
        g.connect(this.synths);
        g.connect(this.echoIn);
        break;
      }
      case 'pluck':
      case 'arp': {
        const g = this.env(t, (inst === 'arp' ? 0.07 : 0.1) * vel * 2, 0.003, Math.min(dur, 0.09), 0.08);
        const f1 = ctx.createBiquadFilter();
        f1.type = 'lowpass';
        f1.Q.value = 6;
        f1.frequency.setValueAtTime(inst === 'arp' ? 5000 : 3500, t);
        f1.frequency.exponentialRampToValueAtTime(500, t + 0.15);
        this.osc(inst === 'arp' ? 'square' : 'sawtooth', f, t, t + 0.2).connect(f1).connect(g);
        g.connect(this.synths);
        g.connect(this.echoIn);
        break;
      }
      case 'bell': {
        const g = this.env(t, 0.09 * vel * 2, 0.002, 0.04, 0.25);
        this.osc('sine', f * 2, t, t + 0.35).connect(g);
        const g2 = this.env(t, 0.04 * vel * 2, 0.002, 0.02, 0.12);
        this.osc('sine', f * 5.01, t, t + 0.2).connect(g2);
        g.connect(this.synths);
        g2.connect(this.synths);
        g.connect(this.echoIn);
        break;
      }
      case 'bass': {
        const g = this.env(t, 0.22 * vel, 0.004, dur * 0.85, 0.04);
        const f1 = ctx.createBiquadFilter();
        f1.type = 'lowpass';
        f1.Q.value = 4;
        f1.frequency.setValueAtTime(1600, t);
        f1.frequency.exponentialRampToValueAtTime(300, t + 0.12);
        this.osc('sawtooth', f, t, t + dur).connect(f1);
        this.osc('square', f / 2, t, t + dur).connect(f1);
        f1.connect(g).connect(this.synths);
        break;
      }
      case 'pad': {
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.035 * vel * 2, t + dur * 0.3);
        g.gain.linearRampToValueAtTime(0.0001, t + dur);
        const f1 = lp(1400);
        for (const d of [-12, 0, 12]) this.osc('sawtooth', f, t, t + dur, d).connect(f1);
        f1.connect(g).connect(this.synths);
        break;
      }
      case 'stab': {
        const g = this.env(t, 0.06 * vel * 2, 0.003, 0.06, 0.06);
        const f1 = lp(2800);
        this.osc('sawtooth', f, t, t + 0.14, -6).connect(f1);
        this.osc('sawtooth', f, t, t + 0.14, 6).connect(f1);
        f1.connect(g).connect(this.synths);
        break;
      }
      case 'acid': {
        // 303-style: resonant filter snapping shut on every note.
        const g = this.env(t, 0.16 * vel, 0.003, dur * 0.8, 0.03);
        const f1 = ctx.createBiquadFilter();
        f1.type = 'lowpass';
        f1.Q.value = 16;
        f1.frequency.setValueAtTime(300 + vel * 2600, t);
        f1.frequency.exponentialRampToValueAtTime(260, t + 0.1);
        this.osc('sawtooth', f, t, t + dur + 0.05).connect(f1).connect(g).connect(this.synths);
        break;
      }
      case 'sub': {
        // 808: a sine that drops into place, long tail.
        const g = this.env(t, 0.45 * vel, 0.003, dur * 0.9, 0.08);
        const o = this.osc('sine', f * 1.5, t, t + dur + 0.1);
        o.frequency.exponentialRampToValueAtTime(f, t + 0.06);
        const o2 = this.osc('triangle', f * 2, t, t + dur + 0.1);
        const g2 = ctx.createGain();
        g2.gain.value = 0.25;
        o.connect(g);
        o2.connect(g2).connect(g);
        g.connect(this.synths);
        break;
      }
      case 'epiano': {
        const g = this.env(t, 0.12 * vel * 1.6, 0.003, 0.05, Math.min(0.6, dur + 0.25));
        this.osc('sine', f, t, t + dur + 0.7).connect(g);
        const g2 = this.env(t, 0.05 * vel, 0.002, 0.02, 0.15);
        this.osc('sine', f * 3, t, t + 0.3).connect(g2).connect(g);
        g.connect(this.synths);
        g.connect(this.echoIn);
        break;
      }
      case 'organ': {
        const g = this.env(t, 0.045 * vel * 2, 0.005, dur * 0.8, 0.04);
        for (const [m, a] of [[1, 1], [2, 0.5], [3, 0.3], [4, 0.2]]) {
          const og = ctx.createGain();
          og.gain.value = a;
          this.osc('sine', f * m, t, t + dur + 0.05).connect(og).connect(g);
        }
        g.connect(this.synths);
        break;
      }
      case 'accordion': {
        // Two reeds slightly out of tune with each other, through a nasal band-pass, with bellows vibrato.
        const g = this.env(t, 0.075 * vel * 1.6, 0.01, dur * 0.85, 0.05);
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = 1600;
        bp.Q.value = 0.7;
        for (const d of [-14, 14]) this.osc('sawtooth', f, t, t + dur + 0.06, d).connect(bp);
        this.osc('square', f / 2, t, t + dur + 0.06).connect(bp);
        const lfo = this.osc('sine', 5.5, t, t + dur + 0.06);
        const lg = ctx.createGain();
        lg.gain.value = 0.25;
        const trem = ctx.createGain();
        trem.gain.value = 0.85;
        lfo.connect(lg).connect(trem.gain);
        bp.connect(trem).connect(g).connect(this.synths);
        break;
      }
      case 'whistle': {
        // Slides up into the note, vibrato on the long ones, a breath of air.
        const g = this.env(t, 0.16 * vel, 0.03, dur * 0.85, 0.08);
        const o = this.osc('sine', f * 0.94, t, t + dur + 0.1);
        o.frequency.exponentialRampToValueAtTime(f, t + 0.05);
        const lfo = this.osc('sine', 5.8, t, t + dur + 0.1);
        const lg = ctx.createGain();
        lg.gain.setValueAtTime(0, t);
        lg.gain.linearRampToValueAtTime(f * 0.02, t + Math.max(0.1, dur));
        lfo.connect(lg).connect(o.frequency);
        o.connect(g);
        const air = this.env(t, 0.02 * vel, 0.02, dur * 0.8, 0.05);
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = f * 2;
        this.noise(t, t + dur + 0.1).connect(bp).connect(air);
        air.connect(g);
        g.connect(this.synths);
        g.connect(this.echoIn);
        break;
      }
      case 'brass': {
        // Saw with the filter blowing open on the attack: a big-band hit.
        const g = this.env(t, 0.1 * vel * 1.5, 0.015, dur * 0.85, 0.06);
        const f1 = ctx.createBiquadFilter();
        f1.type = 'lowpass';
        f1.Q.value = 2;
        f1.frequency.setValueAtTime(500, t);
        f1.frequency.exponentialRampToValueAtTime(3200, t + 0.04);
        f1.frequency.exponentialRampToValueAtTime(1600, t + 0.2);
        for (const d of [-7, 7]) this.osc('sawtooth', f, t, t + dur + 0.08, d).connect(f1);
        f1.connect(g).connect(this.synths);
        g.connect(this.echoIn);
        break;
      }
      case 'marimba': {
        const g = this.env(t, 0.16 * vel * 1.4, 0.002, 0.02, 0.22);
        this.osc('sine', f, t, t + 0.3).connect(g);
        const g2 = this.env(t, 0.05 * vel, 0.001, 0.005, 0.04);
        this.osc('sine', f * 4, t, t + 0.08).connect(g2).connect(g);
        g.connect(this.synths);
        break;
      }
      case 'tom': {
        const g = this.env(t, 0.55 * vel, 0.002, 0.05, 0.18);
        const o = this.osc('sine', 130, t, t + 0.3);
        o.frequency.exponentialRampToValueAtTime(70, t + 0.2);
        o.connect(g).connect(this.drums);
        break;
      }
      case 'tri': {
        // Metal triangle: two inharmonic partials ringing.
        const g = this.env(t, 0.06 * vel * 1.5, 0.001, 0.01, vel > 0.8 ? 0.25 : 0.07);
        this.osc('sine', 4200, t, t + 0.35).connect(g);
        this.osc('sine', 5660, t, t + 0.35).connect(g);
        g.connect(this.drums);
        break;
      }
      case 'tick': {
        const g = this.env(t, 0.12 * vel, 0.001, 0.004, 0.02);
        const hp = ctx.createBiquadFilter();
        hp.type = 'bandpass';
        hp.frequency.value = 3200;
        hp.Q.value = 4;
        this.noise(t, t + 0.05).connect(hp).connect(g).connect(this.drums);
        break;
      }
      case 'kick': {
        const g = this.env(t, 0.9 * vel, 0.002, 0.08, 0.12);
        const o = this.osc('sine', 160, t, t + 0.25);
        o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
        o.connect(g).connect(this.drums);
        // Sidechain pump: everything else ducks on the kick and swells back.
        const p = this.synths.gain;
        p.setValueAtTime(0.3, t);
        p.linearRampToValueAtTime(1, t + Math.min(0.18, dur * 3.5));
        break;
      }
      case 'snare':
      case 'clap': {
        const g = this.env(t, (inst === 'clap' ? 0.4 : 0.35) * vel, 0.001, inst === 'clap' ? 0.03 : 0.05, 0.1);
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = inst === 'clap' ? 1300 : 2200;
        bp.Q.value = 0.8;
        this.noise(t, t + 0.2).connect(bp).connect(g).connect(this.drums);
        if (inst === 'snare') {
          const tg = this.env(t, 0.25 * vel, 0.001, 0.02, 0.06);
          const o = this.osc('triangle', 220, t, t + 0.1);
          o.frequency.exponentialRampToValueAtTime(140, t + 0.08);
          o.connect(tg).connect(this.drums);
        }
        break;
      }
      case 'hat':
      case 'ohat': {
        const g = this.env(t, (inst === 'ohat' ? 0.16 : 0.12) * vel, 0.001, inst === 'ohat' ? 0.06 : 0.008, inst === 'ohat' ? 0.12 : 0.03);
        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = 7500;
        this.noise(t, t + 0.25).connect(hp).connect(g).connect(this.drums);
        break;
      }
    }
  }

  // ---------- the riser (tension before the swipe) ----------

  private updateRiser(): void {
    const ctx = this.out!.ctx;
    const k = this.tension;
    if (k <= 0.05) {
      this.killRiser();
      return;
    }
    if (!this.riser) {
      const src = ctx.createBufferSource();
      src.buffer = this.out!.noise;
      src.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.Q.value = 3;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      src.connect(filter).connect(gain).connect(this.bus);
      src.start();
      const whine = ctx.createOscillator();
      whine.type = 'sawtooth';
      const whineGain = ctx.createGain();
      whineGain.gain.value = 0;
      const wf = ctx.createBiquadFilter();
      wf.type = 'lowpass';
      wf.frequency.value = 2500;
      whine.connect(wf).connect(whineGain).connect(this.bus);
      whine.start();
      this.riser = { src, filter, gain, whine, whineGain };
    }
    const t = ctx.currentTime;
    this.riser.filter.frequency.setTargetAtTime(500 + k * k * 7000, t, 0.05);
    this.riser.gain.gain.setTargetAtTime(k * k * 0.22, t, 0.05);
    this.riser.whine.frequency.setTargetAtTime(110 * Math.pow(2, k * 3) * this.rate, t, 0.05);
    this.riser.whineGain.gain.setTargetAtTime(k * k * 0.035, t, 0.05);
  }

  private killRiser(): void {
    if (!this.riser) return;
    const t = this.out!.ctx.currentTime;
    this.riser.src.stop(t);
    this.riser.whine.stop(t);
    this.riser = null;
  }
}

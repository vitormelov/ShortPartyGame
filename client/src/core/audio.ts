/** Tiny chiptune-ish SFX synth on WebAudio. No assets needed. */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private volume = 0.35;

  /** Where the music plugs in (null until the first key press unlocks audio). */
  output(): { ctx: AudioContext; dest: AudioNode; noise: AudioBuffer } | null {
    if (!this.ctx || !this.master || !this.noiseBuf) return null;
    return { ctx: this.ctx, dest: this.master, noise: this.noiseBuf };
  }

  /** 0..1 (the Opções screen keeps it in 0..10 steps). */
  setVolume(v: number): void {
    this.volume = 0.35 * Math.max(0, Math.min(1, v));
    if (this.master) this.master.gain.value = this.volume;
  }

  unlock(): void {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, slideTo?: number, delay = 0): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private noise(dur: number, vol: number, from: number, to: number, type: BiquadFilterType = 'lowpass'): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noiseBuf) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(from, t);
    f.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  /** The 4-note signature (title, swipe, victory), in variations. */
  private jingle(kind: 'title' | 'swipe' | 'win'): void {
    const notes = [659, 784, 1175, 1047]; // E5 G5 D6 C6
    if (kind === 'swipe') {
      notes.forEach((f, i) => this.tone(f * 2, 0.05, 'square', 0.05, undefined, 0.05 + i * 0.035));
    } else if (kind === 'title') {
      notes.forEach((f, i) => {
        this.tone(f, 0.16, 'square', 0.16, undefined, i * 0.13);
        this.tone(f / 2, 0.16, 'triangle', 0.18, undefined, i * 0.13);
      });
    } else {
      // Victory: slower, harmonized, and it resolves up an octave.
      [...notes, 1319].forEach((f, i) => {
        const at = i * 0.16;
        const dur = i === 4 ? 0.6 : 0.18;
        this.tone(f, dur, 'square', 0.18, undefined, at);
        this.tone(f * 1.26, dur, 'square', 0.08, undefined, at);
        this.tone(f / 2, dur, 'triangle', 0.2, undefined, at);
      });
    }
  }

  /**
   * Animal Crossing-style babble: one blip per syllable with the character's own timbre and pitch.
   * `who` is a CHARACTERS index, or 8 for the Algoritmo.
   */
  voice(who: number, syllables = 6): void {
    const V: Array<[OscillatorType, number, number, number]> = [
      ['square', 340, 0.07, 0.15], // PALHAÇO: honky
      ['sawtooth', 280, 0.06, 0.1], // FOGO: crackling
      ['triangle', 640, 0.05, 0.2], // RISADA: giggles, fast and high
      ['sine', 460, 0.09, 0.12], // OLHINHOS: shy
      ['square', 130, 0.12, 0.16], // CHAD: deep, slow
      ['triangle', 520, 0.1, 0.16], // CHORÃO: wobbly
      ['sawtooth', 210, 0.07, 0.12], // CAVEIRA: bony clacks
      ['triangle', 720, 0.08, 0.16], // DIVA: high and sassy
      ['square', 330, 0.08, 0.1], // ALGORITMO: robotic, fixed steps
    ];
    const [type, base, step, vol] = V[who] ?? V[8];
    for (let i = 0; i < syllables; i++) {
      const robot = who === 8;
      const f = robot ? base * [1, 1.5, 1.25, 1.5][i % 4] : base * Math.pow(2, (Math.random() * 7 - 2) / 12);
      this.tone(f, step * 0.8, type, vol, robot ? undefined : f * (Math.random() < 0.3 ? 1.2 : 0.92), i * step);
    }
    if (who === 1) this.noise(syllables * step, 0.06, 3000, 800, 'bandpass'); // fire crackle
  }

  play(name: string): void {
    if (name.startsWith('mel')) {
      // Melody step on a major pentatonic scale (Trend da Dancinha).
      const steps = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21];
      const k = steps[Math.max(0, Math.min(steps.length - 1, Number(name.slice(3)) || 0))];
      this.tone(523 * Math.pow(2, k / 12), 0.12, 'square', 0.12);
      return;
    }
    switch (name) {
      case 'kick':
        this.tone(150, 0.12, 'sine', 0.45, 45);
        break;
      case 'hat':
        this.noise(0.04, 0.12, 9000, 7000, 'highpass');
        break;
      case 'blip':
        this.tone(880, 0.06, 'square', 0.2);
        break;
      case 'swipe':
        // The app's swipe: a soft "fwip" with the jingle's ghost on top.
        this.noise(0.22, 0.45, 500, 5000, 'bandpass');
        this.jingle('swipe');
        break;
      case 'jingle':
        this.jingle('title');
        break;
      case 'like':
        // Like "pop": a quick bubble that bends up.
        this.tone(520, 0.07, 'sine', 0.35, 1040);
        this.tone(1560, 0.05, 'sine', 0.12, undefined, 0.04);
        break;
      case 'tick':
        this.tone(660, 0.08, 'square', 0.25);
        break;
      case 'go':
        this.tone(990, 0.25, 'square', 0.3);
        break;
      case 'return':
        this.tone(220, 0.18, 'sawtooth', 0.3, 110);
        break;
      case 'fastforward':
        this.tone(440, 0.25, 'square', 0.2, 1760);
        this.tone(660, 0.25, 'square', 0.15, 2640, 0.08);
        break;
      case 'dash':
        this.noise(0.12, 0.3, 3000, 800, 'bandpass');
        break;
      case 'bump':
        this.tone(140, 0.1, 'square', 0.25, 70);
        break;
      case 'jump':
        this.tone(300, 0.15, 'square', 0.18, 900);
        break;
      case 'skipReady':
        this.tone(1320, 0.06, 'square', 0.22);
        this.tone(1760, 0.08, 'square', 0.22, undefined, 0.06);
        break;
      case 'zap':
        this.tone(1800, 0.25, 'sawtooth', 0.25, 120);
        this.noise(0.2, 0.3, 6000, 2000, 'highpass');
        break;
      case 'beamWarn':
        this.tone(1400, 0.05, 'square', 0.06);
        break;
      case 'beamFire':
        this.tone(900, 0.2, 'sawtooth', 0.12, 300);
        break;
      case 'command':
        this.tone(784, 0.08, 'square', 0.22);
        this.tone(1175, 0.1, 'square', 0.22, undefined, 0.08);
        break;
      case 'splash':
        this.noise(0.5, 0.5, 1500, 200, 'lowpass');
        this.tone(500, 0.3, 'sine', 0.2, 120);
        break;
      case 'whoosh':
        this.noise(0.18, 0.25, 600, 2400, 'bandpass');
        break;
      case 'cannon':
        this.noise(0.18, 0.45, 1800, 200, 'lowpass');
        this.tone(120, 0.12, 'square', 0.2, 60);
        break;
      case 'pew':
        // Space laser.
        this.tone(1600, 0.12, 'square', 0.14, 300);
        this.tone(2400, 0.06, 'sawtooth', 0.06, 900);
        break;
      case 'ricochet':
        this.tone(2400, 0.08, 'triangle', 0.15, 1200);
        break;
      case 'penguins':
        [880, 988, 880].forEach((f, i) => this.tone(f, 0.06, 'square', 0.12, undefined, i * 0.07));
        break;
      case 'slam':
        this.noise(0.35, 0.8, 900, 60, 'lowpass');
        this.tone(70, 0.3, 'square', 0.3, 35);
        break;
      case 'page':
        this.noise(0.25, 0.3, 1500, 5000, 'bandpass');
        break;
      case 'laserWall':
        this.tone(220, 0.35, 'sawtooth', 0.12, 440);
        break;
      case 'laserFlip':
        this.tone(660, 0.08, 'square', 0.2);
        this.tone(440, 0.12, 'square', 0.2, undefined, 0.09);
        break;
      case 'click':
        this.tone(2000, 0.02, 'square', 0.12);
        break;
      case 'poof':
        this.noise(0.3, 0.35, 4000, 300, 'bandpass');
        this.tone(600, 0.3, 'sine', 0.2, 1200);
        break;
      case 'scream':
        this.tone(1200, 0.45, 'sawtooth', 0.25, 300);
        this.noise(0.45, 0.3, 3000, 1500, 'bandpass');
        break;
      case 'notification':
        this.tone(1568, 0.1, 'sine', 0.3);
        this.tone(2093, 0.18, 'sine', 0.3, undefined, 0.1);
        break;
      case 'menu':
        // App tap.
        this.tone(1200, 0.035, 'sine', 0.22, 900);
        break;
      case 'confirm':
        // "Plim", like the notification but shorter.
        this.tone(1319, 0.07, 'sine', 0.28);
        this.tone(1976, 0.12, 'sine', 0.24, undefined, 0.06);
        break;
      case 'bomb':
        this.tone(180, 0.08, 'square', 0.2, 90);
        break;
      case 'explosion':
        this.noise(0.5, 0.7, 2000, 80);
        break;
      case 'fall':
        this.tone(700, 0.5, 'square', 0.2, 80);
        break;
      case 'die':
        this.tone(400, 0.3, 'square', 0.25, 60);
        break;
      case 'lifeLost':
        this.tone(300, 0.12, 'triangle', 0.4, 150);
        break;
      case 'powerup':
        [523, 659, 784].forEach((f, i) => this.tone(f, 0.08, 'square', 0.18, undefined, i * 0.05));
        break;
      case 'bonusLife':
        [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.1, 'square', 0.2, undefined, i * 0.07));
        break;
      case 'eliminated':
        [392, 330, 262, 196].forEach((f, i) => this.tone(f, 0.18, 'square', 0.25, undefined, i * 0.15));
        break;
      case 'win':
        this.jingle('win');
        break;
    }
  }
}

/** Tiny chiptune-ish SFX synth on WebAudio. No assets needed. */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;

  unlock(): void {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.35;
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
        this.noise(0.25, 0.5, 600, 6000, 'bandpass');
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
        this.tone(880, 0.05, 'square', 0.15);
        break;
      case 'confirm':
        this.tone(660, 0.07, 'square', 0.2);
        this.tone(990, 0.1, 'square', 0.2, undefined, 0.07);
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
        [523, 659, 784, 1046, 784, 1046].forEach((f, i) => this.tone(f, 0.14, 'square', 0.25, undefined, i * 0.12));
        break;
    }
  }
}

// WebAudio-synthesised sound only — no audio files. One AudioContext, created
// on the first user gesture; every effect is a short node graph, no assets.
export class AudioFX {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
  }

  ensure() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
    } catch { this.ctx = null; }
  }

  _noiseBuf(dur) {
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  _burst(dur, freq, gain, type = 'lowpass', q = 1) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuf(dur);
    const flt = this.ctx.createBiquadFilter();
    flt.type = type; flt.frequency.value = freq; flt.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(flt); flt.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + dur + 0.02);
  }

  _tone(freq, dur, gain, type = 'sine', slideTo = 0) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  shot(kind) {
    // kind: rifle | smg | sniper | pistol | distant
    if (kind === 'sniper') { this._burst(0.28, 900, 0.9); this._tone(140, 0.18, 0.5, 'sawtooth', 50); }
    else if (kind === 'smg') this._burst(0.09, 1800, 0.45);
    else if (kind === 'pistol') this._burst(0.12, 1400, 0.55);
    else if (kind === 'distant') this._burst(0.14, 700, 0.16);
    else this._burst(0.14, 1100, 0.7); // rifle
  }
  dryFire() { this._tone(1200, 0.03, 0.12, 'square'); }
  reload() { this._tone(900, 0.05, 0.2, 'square'); setTimeout(() => this._tone(650, 0.05, 0.2, 'square'), 160); }
  hit() { this._tone(1900, 0.06, 0.25, 'sine'); }
  kill() { this._tone(1900, 0.06, 0.25, 'sine'); setTimeout(() => this._tone(2400, 0.09, 0.25, 'sine'), 70); }
  hurt() { this._tone(220, 0.12, 0.35, 'sawtooth', 120); }
  plantBeep() { this._tone(1200, 0.09, 0.3, 'square'); }
  defuseBeep() { this._tone(1500, 0.09, 0.3, 'square'); }
  planted() { this._tone(880, 0.15, 0.3, 'square'); setTimeout(() => this._tone(880, 0.15, 0.3, 'square'), 200); }
  explosion() {
    this._burst(0.9, 220, 1.0); this._tone(70, 0.7, 0.6, 'sine', 30);
  }
  grenadePin() { this._tone(1600, 0.04, 0.2, 'square'); }
  bounce() { this._tone(300, 0.05, 0.15, 'sine'); }
  roundWin() { [523, 659, 784].forEach((f, i) => setTimeout(() => this._tone(f, 0.22, 0.3, 'triangle'), i * 130)); }
  roundLose() { [392, 330, 262].forEach((f, i) => setTimeout(() => this._tone(f, 0.25, 0.3, 'triangle'), i * 140)); }
  buy() { this._tone(1000, 0.07, 0.2, 'triangle'); setTimeout(() => this._tone(1300, 0.07, 0.2, 'triangle'), 80); }
  denied() { this._tone(180, 0.12, 0.25, 'square'); }
}

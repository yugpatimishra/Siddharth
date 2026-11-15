export class GameAudioSynth {
  private ctx: AudioContext | null = null;
  private engineOsc: OscillatorNode | null = null;
  private engineGain: GainNode | null = null;
  private muted = false;
  private lastStepTime = 0;

  private ensureContext(): AudioContext | null {
    if (this.muted) return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return null;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  setMuted(mute: boolean) {
    this.muted = mute;
    if (mute && this.engineGain && this.ctx) {
      this.engineGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
    }
  }

  isMuted() {
    return this.muted;
  }

  updateEngine(active: boolean, speedRatio: number) {
    if (this.muted || !active) {
      if (this.engineGain && this.ctx) {
        this.engineGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.08);
      }
      return;
    }

    const ctx = this.ensureContext();
    if (!ctx) return;

    if (!this.engineOsc || !this.engineGain) {
      this.engineOsc = ctx.createOscillator();
      const filter = ctx.createBiquadFilter();
      this.engineGain = ctx.createGain();
      this.engineOsc.type = 'sawtooth';
      this.engineOsc.frequency.value = 54;
      filter.type = 'lowpass';
      filter.frequency.value = 180;
      this.engineGain.gain.value = 0;
      this.engineOsc.connect(filter);
      filter.connect(this.engineGain);
      this.engineGain.connect(ctx.destination);
      this.engineOsc.start();
    }

    const targetFreq = 52 + Math.min(1.5, Math.abs(speedRatio)) * 92;
    this.engineOsc.frequency.setTargetAtTime(targetFreq, ctx.currentTime, 0.06);
    this.engineGain.gain.setTargetAtTime(0.035 + Math.min(1, Math.abs(speedRatio)) * 0.03, ctx.currentTime, 0.08);
  }

  playFootstep(sprinting: boolean) {
    const now = performance.now();
    const interval = sprinting ? 260 : 410;
    if (now - this.lastStepTime < interval) return;
    this.lastStepTime = now;

    const ctx = this.ensureContext();
    if (!ctx) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(sprinting ? 130 : 105, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(48, ctx.currentTime + 0.06);
    gain.gain.setValueAtTime(0.04, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.065);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.07);
  }

  playChime(kind: 'action' | 'mission' | 'alert' = 'action') {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const freqs =
      kind === 'mission'
        ? [523.25, 659.25, 783.99]
        : kind === 'alert'
        ? [320, 260]
        : [440, 554.37];

    freqs.forEach((f, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const t = ctx.currentTime + idx * 0.07;
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f, t);
      gain.gain.setValueAtTime(0.06, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.24);
    });
  }

  dispose() {
    try {
      this.engineOsc?.stop();
    } catch {
      // ignore
    }
    this.ctx?.close().catch(() => {});
    this.ctx = null;
  }
}

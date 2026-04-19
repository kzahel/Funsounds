// Synthesized engine rumble + collision bonks for the 3d-demo truck scene.
// Pure WebAudio — no asset files. AudioContext can't start without a user
// gesture, so `start()` must be called from a keydown/pointerdown handler.

export class TruckAudio {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;

  // Engine voice: two oscillators mixed through a shared lowpass whose cutoff
  // tracks RPM. A sawtooth carries the fundamental; a square an octave up adds
  // body. Frequencies are smoothed toward their RPM-derived targets each
  // frame via setTargetAtTime so the engine responds to throttle smoothly.
  private engineOsc1: OscillatorNode | null = null;
  private engineOsc2: OscillatorNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private engineGain: GainNode | null = null;
  private started = false;

  start(): void {
    if (this.started) return;
    const Ctx: typeof AudioContext =
      window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const master = ctx.createGain();
    master.gain.value = 0.4;
    master.connect(ctx.destination);

    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(master);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 500;
    filter.Q.value = 2;
    filter.connect(gain);

    const osc1 = ctx.createOscillator();
    osc1.type = 'sawtooth';
    osc1.frequency.value = 40;
    osc1.connect(filter);
    osc1.start();

    const osc2 = ctx.createOscillator();
    osc2.type = 'square';
    osc2.frequency.value = 80;
    const osc2Gain = ctx.createGain();
    osc2Gain.gain.value = 0.25;
    osc2.connect(osc2Gain);
    osc2Gain.connect(filter);
    osc2.start();

    this.ctx = ctx;
    this.masterGain = master;
    this.engineOsc1 = osc1;
    this.engineOsc2 = osc2;
    this.engineFilter = filter;
    this.engineGain = gain;
    this.started = true;
  }

  resume(): void {
    this.ctx?.resume();
  }

  // rpm ≈ truck.engineRpm (0..~5500). `throttling` adds a tiny floor so a
  // stalled truck with throttle held doesn't snap audibly from silent to loud
  // when rpm finally climbs.
  updateEngine(rpm: number, throttling: boolean): void {
    if (!this.ctx) return;
    const rpmNorm = Math.max(0, Math.min(1, rpm / 5500));
    // 4-cylinder ignition frequency ≈ rpm/30. 25Hz floor keeps the oscillator
    // audible at idle instead of collapsing to DC.
    const freq = 25 + rpmNorm * 150;
    const cutoff = 300 + rpmNorm * 1800;
    const level = rpmNorm * 0.5 + (throttling ? 0.04 : 0);

    const t = this.ctx.currentTime;
    const tc = 0.04;
    this.engineOsc1!.frequency.setTargetAtTime(freq, t, tc);
    this.engineOsc2!.frequency.setTargetAtTime(freq * 2, t, tc);
    this.engineFilter!.frequency.setTargetAtTime(cutoff, t, tc);
    this.engineGain!.gain.setTargetAtTime(level, t, tc);
  }

  // One-shot filtered noise burst. Bigger impacts drop the bandpass center to
  // sound thuddier and scale up volume, so a truck slam reads bigger than a
  // cube tap.
  bonk(magnitude: number): void {
    if (!this.ctx || !this.masterGain) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const duration = 0.18;

    const samples = Math.floor(ctx.sampleRate * duration);
    const buf = ctx.createBuffer(1, samples, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < samples; i++) {
      const env = Math.pow(1 - i / samples, 2);
      data[i] = (Math.random() * 2 - 1) * env;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;

    const intensity = Math.min(1, magnitude / 15);
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 350 - intensity * 150;
    filter.Q.value = 2 + intensity * 3;

    const gain = ctx.createGain();
    const vol = Math.min(0.7, 0.1 + magnitude * 0.035);
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    src.start(t);
    src.stop(t + duration + 0.05);
  }
}

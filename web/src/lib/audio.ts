/**
 * Audio Synthesizer for FlowScope Order Flow events.
 * Uses Web Audio API without any external mp3/wav assets.
 */
import { settings } from './settings';

class SoundFX {
  private ctx: AudioContext | null = null;

  private initCtx() {
    if (!this.ctx && typeof window !== 'undefined') {
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      if (AC) this.ctx = new AC();
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  playBigTrade(isBuy: boolean) {
    const s = settings.get().audio;
    if (!s || !s.enabled || !s.bigTrades) return;
    this.playTone(isBuy ? 820 : 220, isBuy ? 'sine' : 'triangle', 0.12, (s.volume / 100) * 0.4);
  }

  playLiquidation() {
    const s = settings.get().audio;
    if (!s || !s.enabled || !s.liquidations) return;
    this.playSweep(880, 440, 0.18, (s.volume / 100) * 0.45);
  }

  playExecution() {
    const s = settings.get().audio;
    if (!s || !s.enabled || !s.executions) return;
    this.playChord([523.25, 659.25], 0.14, (s.volume / 100) * 0.35);
  }

  playAlert() {
    const s = settings.get().audio;
    if (!s || !s.enabled || !s.alerts) return;
    this.playSweep(587.33, 880, 0.22, (s.volume / 100) * 0.5);
  }

  test(type: 'bigBuy' | 'bigSell' | 'liq' | 'exec' | 'alert') {
    this.initCtx();
    const s = settings.get().audio;
    const vol = ((s?.volume ?? 70) / 100);
    if (type === 'bigBuy') this.playTone(820, 'sine', 0.12, vol * 0.4);
    else if (type === 'bigSell') this.playTone(220, 'triangle', 0.12, vol * 0.4);
    else if (type === 'liq') this.playSweep(880, 440, 0.18, vol * 0.45);
    else if (type === 'exec') this.playChord([523.25, 659.25], 0.14, vol * 0.35);
    else if (type === 'alert') this.playSweep(587.33, 880, 0.22, vol * 0.5);
  }

  private playTone(freq: number, type: OscillatorType, dur: number, vol: number) {
    const c = this.initCtx();
    if (!c) return;
    try {
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, c.currentTime);
      gain.gain.setValueAtTime(Math.max(0.001, vol), c.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
      osc.connect(gain);
      gain.connect(c.destination);
      osc.start();
      osc.stop(c.currentTime + dur);
    } catch {}
  }

  private playSweep(startFreq: number, endFreq: number, dur: number, vol: number) {
    const c = this.initCtx();
    if (!c) return;
    try {
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(startFreq, c.currentTime);
      osc.frequency.exponentialRampToValueAtTime(endFreq, c.currentTime + dur);
      gain.gain.setValueAtTime(Math.max(0.001, vol), c.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
      osc.connect(gain);
      gain.connect(c.destination);
      osc.start();
      osc.stop(c.currentTime + dur);
    } catch {}
  }

  private playChord(freqs: number[], dur: number, vol: number) {
    const c = this.initCtx();
    if (!c) return;
    try {
      for (const f of freqs) {
        const osc = c.createOscillator();
        const gain = c.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(f, c.currentTime);
        gain.gain.setValueAtTime(Math.max(0.001, vol / freqs.length), c.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
        osc.connect(gain);
        gain.connect(c.destination);
        osc.start();
        osc.stop(c.currentTime + dur);
      }
    } catch {}
  }
}

export const soundFX = new SoundFX();

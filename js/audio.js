// Звуки на Web Audio API (осцилляторы, без аудиофайлов).
// iOS/Safari: AudioContext создаётся и возобновляется только внутри действия
// пользователя (тап, клик, клавиша), поэтому unlock() вызывается на каждом жесте.

import { storage } from './storage.js';

let ctx = null;
let out = null;
let primed = false;
let noise = null;
let enabled = storage.getSound();

function ensureContext() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  try {
    ctx = new AC({ latencyHint: 'interactive' });
  } catch {
    try { ctx = new AC(); } catch { return null; }
  }
  // Компрессор не даёт аккордам «хрипеть» на слабых динамиках телефона
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.knee.value = 12;
  comp.ratio.value = 4;
  comp.attack.value = 0.003;
  comp.release.value = 0.2;
  out = ctx.createGain();
  out.gain.value = 0.85;
  out.connect(comp);
  comp.connect(ctx.destination);
  return ctx;
}

/** Вызывать из обработчика жеста пользователя. */
export function unlock() {
  if (!enabled) return;
  const c = ensureContext();
  if (!c) return;
  if (c.state !== 'running' && c.resume) c.resume().catch(() => {});
  if (!primed) {
    // Старые iOS требуют реально проиграть буфер внутри жеста
    try {
      const src = c.createBufferSource();
      src.buffer = c.createBuffer(1, 1, c.sampleRate);
      src.connect(c.destination);
      src.start(0);
      primed = true;
    } catch { /* ignore */ }
  }
}

export const isEnabled = () => enabled;

export function setEnabled(on) {
  enabled = !!on;
  storage.setSound(enabled);
}

function tone(c, { f, f2, at = 0, dur = 0.25, type = 'sine', gain = 0.2, attack = 0.006, lowpass }) {
  const t0 = c.currentTime + 0.012 + at;
  const osc = c.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(f, t0);
  if (f2) osc.frequency.exponentialRampToValueAtTime(f2, t0 + dur);

  const env = c.createGain();
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.exponentialRampToValueAtTime(gain, t0 + attack);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

  osc.connect(env);
  let last = env;
  if (lowpass) {
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = lowpass;
    env.connect(lp);
    last = lp;
  }
  last.connect(out);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

function click(c) {
  if (!noise) {
    const len = Math.floor(c.sampleRate * 0.03);
    noise = c.createBuffer(1, len, c.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  }
  const t0 = c.currentTime + 0.005;
  const src = c.createBufferSource();
  src.buffer = noise;
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 2400;
  bp.Q.value = 1.2;
  const g = c.createGain();
  g.gain.setValueAtTime(0.16, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.03);
  src.connect(bp);
  bp.connect(g);
  g.connect(out);
  src.start(t0);
}

const SOUNDS = {
  // Восходящий двойной «динь»
  correct(c) {
    tone(c, { f: 880, dur: 0.2, gain: 0.2 });
    tone(c, { f: 1760, dur: 0.12, gain: 0.04 });
    tone(c, { f: 1318.5, at: 0.1, dur: 0.38, gain: 0.2 });
    tone(c, { f: 2637, at: 0.1, dur: 0.22, gain: 0.035 });
  },
  // Мягкий низкий «бум» вниз
  wrong(c) {
    tone(c, { f: 220, f2: 160, dur: 0.34, type: 'triangle', gain: 0.26, attack: 0.02, lowpass: 750 });
    tone(c, { f: 110, f2: 92, dur: 0.32, gain: 0.16, attack: 0.02 });
  },
  flip(c) { click(c); },
  toggle(c) { tone(c, { f: 660, dur: 0.12, gain: 0.12 }); tone(c, { f: 990, at: 0.06, dur: 0.14, gain: 0.08 }); },
  // Победное арпеджио и аккорд
  victory(c) {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, i) => {
      tone(c, { f, at: i * 0.1, dur: 0.3, type: 'triangle', gain: 0.13 });
      tone(c, { f: f * 2, at: i * 0.1, dur: 0.2, gain: 0.03 });
    });
    [1046.5, 1318.5, 1567.98].forEach((f) => tone(c, { f, at: 0.44, dur: 1.2, gain: 0.085, attack: 0.02 }));
    tone(c, { f: 2093, at: 0.44, dur: 0.9, gain: 0.025, attack: 0.03 });
    tone(c, { f: 2637, at: 0.62, dur: 0.7, gain: 0.02, attack: 0.03 });
  },
};

export function play(name) {
  if (!enabled) return;
  const c = ensureContext();
  if (!c || !SOUNDS[name]) return;
  if (c.state !== 'running' && c.resume) c.resume().catch(() => {});
  try { SOUNDS[name](c); } catch { /* ignore */ }
}

export function vibrate(ms) {
  try { if (navigator.vibrate) navigator.vibrate(ms); } catch { /* ignore */ }
}

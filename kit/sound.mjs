// Original music bed and sound effects for the demo video, synthesized to 44.1 kHz stereo WAV.
//   node sound.mjs music <seconds> <out.wav>
//   node sound.mjs chime <out.wav>
//   node sound.mjs fanfare <out.wav>
import { writeFileSync } from 'node:fs';

const SR = 44100;
const midi = (m) => 440 * 2 ** ((m - 69) / 12);

function writeWav(path, left, right) {
  let peak = 0;
  for (let i = 0; i < left.length; i++) peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
  const gain = peak > 0 ? 0.85 / peak : 1;
  const buffer = Buffer.alloc(44 + left.length * 4);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + left.length * 4, 4);
  buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(2, 22);
  buffer.writeUInt32LE(SR, 24);
  buffer.writeUInt32LE(SR * 4, 28);
  buffer.writeUInt16LE(4, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(left.length * 4, 40);
  for (let i = 0; i < left.length; i++) {
    buffer.writeInt16LE(Math.round(Math.max(-1, Math.min(1, left[i] * gain)) * 32767), 44 + i * 4);
    buffer.writeInt16LE(Math.round(Math.max(-1, Math.min(1, right[i] * gain)) * 32767), 46 + i * 4);
  }
  writeFileSync(path, buffer);
}

// Adds one voice into the buffers: `sample(t)` for t seconds into the note, panned -1..1.
function add(left, right, start, length, pan, sample) {
  const from = Math.max(0, Math.floor(start * SR));
  const to = Math.min(left.length, Math.floor((start + length) * SR));
  const l = Math.cos(((pan + 1) * Math.PI) / 4);
  const r = Math.sin(((pan + 1) * Math.PI) / 4);
  for (let i = from; i < to; i++) {
    const v = sample(i / SR - start);
    left[i] += v * l;
    right[i] += v * r;
  }
}

function music(seconds) {
  const n = Math.ceil(seconds * SR);
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  const beat = 60 / 96;
  const bar = beat * 4;
  // vi - IV - I - V in C: warm, hopeful, loops cleanly.
  const progression = [
    [57, 60, 64],
    [53, 57, 60],
    [48, 52, 55],
    [55, 59, 62],
  ];
  const bars = Math.ceil(seconds / bar);
  for (let b = 0; b < bars; b++) {
    const chord = progression[b % 4];
    const t0 = b * bar;
    // Pad: soft additive tones with slow attack, two slightly detuned copies for width.
    for (const note of [chord[0] - 12, ...chord]) {
      for (const [detune, pan] of [[-0.12, -0.5], [0.12, 0.5]]) {
        const f = midi(note) + detune;
        add(left, right, t0, bar + 1.2, pan, (t) => {
          const env = Math.min(1, t / 0.9) * (t > bar ? Math.max(0, 1 - (t - bar) / 1.2) : 1);
          let v = 0;
          for (let h = 1; h <= 5; h++) v += Math.sin(2 * Math.PI * f * h * t) / h ** 1.8;
          return v * env * 0.035;
        });
      }
    }
    // Bass on beats 1 and 3.
    for (const k of [0, 2]) {
      const f = midi(chord[0] - 24);
      add(left, right, t0 + k * beat, beat * 1.8, 0, (t) => (Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(4 * Math.PI * f * t)) * Math.min(1, t / 0.02) * Math.exp(-t * 2.2) * 0.16);
    }
    if (b < 2) continue; // intro: pads and bass only
    // Plucked arpeggio in eighth notes, alternating sides.
    const tones = [...chord.map((m) => m + 12), chord[1] + 24];
    for (let e = 0; e < 8; e++) {
      const f = midi(tones[[0, 1, 2, 3, 2, 1, 0, 1][e]]);
      add(left, right, t0 + (e * beat) / 2, 0.6, e % 2 ? 0.45 : -0.45, (t) => (Math.sin(2 * Math.PI * f * t) + 0.25 * Math.sin(4 * Math.PI * f * t)) * Math.min(1, t / 0.005) * Math.exp(-t * 7) * 0.05);
    }
    // Kick on 1 and 3, soft hat on the off-beats.
    for (const k of [0, 2]) {
      add(left, right, t0 + k * beat, 0.3, 0, (t) => Math.sin(2 * Math.PI * (45 * t + (65 / 18) * (1 - Math.exp(-t * 18)))) * Math.exp(-t * 14) * 0.3);
    }
    let noise = 0;
    for (let k = 0; k < 4; k++) {
      add(left, right, t0 + (k + 0.5) * beat, 0.08, k % 2 ? 0.3 : -0.3, (t) => {
        const white = Math.random() * 2 - 1;
        const high = white - noise;
        noise = white;
        return high * Math.exp(-t * 70) * 0.03;
      });
    }
  }
  // Fade in and out.
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const g = Math.min(1, t / 2.5, (seconds - t) / 4);
    left[i] *= Math.max(0, g);
    right[i] *= Math.max(0, g);
  }
  return [left, right];
}

// A bell: inharmonic partials with their own decays.
const bell = (f) => (t) =>
  (Math.sin(2 * Math.PI * f * t) * Math.exp(-t * 3) +
    0.5 * Math.sin(2 * Math.PI * f * 2.76 * t) * Math.exp(-t * 5) +
    0.25 * Math.sin(2 * Math.PI * f * 5.4 * t) * Math.exp(-t * 9)) *
  Math.min(1, t / 0.003);

function chime() {
  const n = Math.ceil(2.2 * SR);
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  [84, 88, 91, 96].forEach((m, i) => add(left, right, i * 0.09, 2, (i - 1.5) / 3, bell(midi(m))));
  return [left, right];
}

function fanfare() {
  const n = Math.ceil(3 * SR);
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  const brass = (f, hold) => (t) => {
    let v = 0;
    for (let h = 1; h <= 6; h++) v += Math.sin(2 * Math.PI * f * h * t) / h;
    return v * Math.min(1, t / 0.03) * (t < hold ? 1 : Math.max(0, 1 - (t - hold) / 0.8)) * 0.25;
  };
  [60, 64, 67].forEach((m, i) => add(left, right, i * 0.14, 0.5, (i - 1) / 2, brass(midi(m), 0.12)));
  for (const [m, pan] of [[60, -0.4], [64, 0], [67, 0.4], [72, 0]]) add(left, right, 0.42, 2.5, pan, brass(midi(m), 1.4));
  [96, 100, 103, 108].forEach((m, i) => add(left, right, 0.45 + i * 0.07, 2, (i - 1.5) / 3, (t) => bell(midi(m))(t) * 0.35));
  return [left, right];
}

const [kind, ...args] = process.argv.slice(2);
if (kind === 'music') writeWav(args[1], ...music(Number(args[0])));
else if (kind === 'chime') writeWav(args[0], ...chime());
else if (kind === 'fanfare') writeWav(args[0], ...fanfare());
else throw new Error('usage: node sound.mjs music <seconds> <out.wav> | chime <out.wav> | fanfare <out.wav>');

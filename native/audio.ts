// Sound, as the browser build's audio.js: the authored one-shots
// (sfx/<name>.opus, sfx/manifest.json, each event rotating through its
// variants), the quiet railway ambience (two seconds of smoothed noise through
// a 320 Hz low-pass, looped) and the music stem (84 bpm: Cmaj7 · Am7 · Fmaj7
// · G7 with a triangle bass on every other eighth and the 32-step melody),
// both rendered once into looping clips in slices across frames (per-sample
// work is slow natively) at the old buses' default balance (music 0.5,
// effects 0.8, ambience 0.4). The runtime has no ambience bus, so the
// ambience plays on the music bus. The synthesized blips audio.js played
// while a sample loaded are not ported (a live synthesis graph makes clip
// loads fail on the web runtime): a clip still loading is silent. The
// runtime's Options own the volumes, the mute and the voice limit.
import { context, createClip, loadClip, play as playClip, type AudioClip, type Sound } from "starhermit:audio";

export type Sfx = "select" | "confirm" | "play" | "draw" | "eight" | "error" | "win" | "lose" | "turn";
const SAMPLES: Record<Sfx, string[]> = {
  select: ["ui-select-tick", "ui-select-card"], confirm: ["ui-confirm", "ui-confirm-chip"], play: ["card-play", "card-play-felt"],
  draw: ["card-draw"], eight: ["wild-eight-chime"], error: ["ui-error-buzz"], win: ["victory-fanfare"], lose: ["defeat-descend"],
  turn: ["turn-notify", "turn-tap"],
};
const pick: Partial<Record<Sfx, number>> = {};
const clips = new Map<string, AudioClip>();
const queue: string[] = [];
let loading = false;
let wantClips = false;
export function loadSfx(): void { wantClips = true; }
export function play(ev: Sfx): void {
  const names = SAMPLES[ev];
  const i = (pick[ev] ?? 0) % names.length;
  pick[ev] = i + 1;
  const clip = clips.get(names[i]!);
  if (!clip) return;
  try { playClip(clip, { bus: "effects", gain: 0.8 }); } catch { /* voice limit */ }
}

// ---- rendered loops ---------------------------------------------------------------------------
const RATE = 22050;
const SINE = new Float32Array(4096);
for (let i = 0; i < SINE.length; i++) SINE[i] = Math.sin((i / SINE.length) * Math.PI * 2);
interface Job { data: Float32Array; pos: number; step: (budget: number) => boolean; clip: AudioClip | null }

function ambienceJob(): Job {
  const data = new Float32Array(RATE * 2);
  let seed = 0x5eed;
  const rand = (): number => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2147483648 - 1; };
  // smoothed noise (v = v·0.97 + n·0.03, ×6) through an RBJ low-pass at 320 Hz, Q 1
  const w0 = (2 * Math.PI * 320) / RATE, al = Math.sin(w0) / 2, cw = Math.cos(w0);
  const b0 = (1 - cw) / 2 / (1 + al), b1 = (1 - cw) / (1 + al), a1 = (-2 * cw) / (1 + al), a2 = (1 - al) / (1 + al);
  let v = 0, x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  const job: Job = {
    data, pos: 0, clip: null,
    step: (budget) => {
      const end = Math.min(data.length, job.pos + budget);
      for (let i = job.pos; i < end; i++) {
        v = v * 0.97 + rand() * 0.03;
        const x = v * 6;
        const y = b0 * x + b1 * x1 + b0 * x2 - a1 * y1 - a2 * y2;
        x2 = x1; x1 = x; y2 = y1; y1 = y;
        data[i] = y;
      }
      job.pos = end;
      return end >= data.length;
    },
  };
  return job;
}

const beat = 60 / 84, eighth = beat / 2;
const CHORDS = [[48, 52, 55, 59], [45, 48, 52, 56], [41, 45, 48, 53], [43, 47, 50, 54]];
const MELODY = [60, -1, 64, -1, 67, -1, 69, -1, 65, -1, 64, -1, 62, -1, 60, -1, 58, -1, 60, -1, 63, -1, 67, -1, 64, -1, 62, -1, 60, -1, 59, -1];
const midi = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);
interface Note { at: number; freq: number; dur: number; gain: number; tri: boolean }
function musicJob(): Job {
  const steps = 32;
  const len = Math.round(steps * eighth * RATE);
  const data = new Float32Array(len);
  const notes: Note[] = [];
  for (let s = 0; s < steps; s++) {
    const t = s * eighth;
    const chord = CHORDS[Math.floor(s / 8) % 4]!;
    if (s % 2 === 0) notes.push({ at: t, freq: midi(chord[0]! - 12), dur: eighth * 1.8, gain: 0.3, tri: true });
    notes.push({ at: t, freq: midi(chord[1]!), dur: eighth * 3.4, gain: 0.14, tri: false });
    notes.push({ at: t, freq: midi(chord[2]!), dur: eighth * 3.4, gain: 0.14, tri: false });
    notes.push({ at: t, freq: midi(chord[3]!), dur: eighth * 3.4, gain: 0.12, tri: false });
    const m = MELODY[s % MELODY.length]!;
    if (m >= 0) notes.push({ at: t, freq: midi(m), dur: eighth * 1.6, gain: 0.3, tri: false });
  }
  let n = 0, k = 0; // note index, sample within the note
  const job: Job = {
    data, pos: 0, clip: null,
    step: (budget) => {
      let done = 0;
      while (n < notes.length && done < budget) {
        const note = notes[n]!;
        const count = Math.round(note.dur * RATE);
        const start = Math.round(note.at * RATE);
        const decay = Math.log(0.0001 / note.gain) / count;
        const inc = note.freq / RATE;
        const end = Math.min(count, k + (budget - done));
        for (let i = k; i < end; i++) {
          const ph = (inc * i) % 1;
          const w = note.tri ? (ph < 0.5 ? 4 * ph - 1 : 3 - 4 * ph) : SINE[Math.floor(ph * 4096)]!;
          data[(start + i) % len] = data[(start + i) % len]! + w * note.gain * Math.exp(decay * i);
        }
        done += end - k;
        k = end;
        if (k >= count) { n++; k = 0; }
      }
      return n >= notes.length;
    },
  };
  return job;
}
function run(job: Job, budget: number): void {
  if (job.clip) return;
  if (!job.step(budget)) return;
  try { job.clip = createClip([job.data], RATE); } catch (e) { console.warn(`audio: ${String(e)}`); }
}

const amb = ambienceJob();
const music = musicJob();
let ambVoice: Sound | null = null, musicVoice: Sound | null = null;
let musicOn = true;
/** audio.js startMusic / stopMusic (backgrounding stops the stem). */
export function setMusic(on: boolean): void { musicOn = on; }

/** Each frame: clips one at a time once the mixer runs, loop slices, the loop voices. */
export function update(): void {
  if (context.state !== "running") return;
  if (wantClips) {
    wantClips = false;
    for (const list of Object.values(SAMPLES)) for (const n of list) if (!queue.includes(n)) queue.push(n);
  }
  if (!loading && queue.length) {
    const name = queue.shift()!;
    if (!clips.has(name)) {
      loading = true;
      loadClip(`sfx/${name}.opus`).then((c) => { clips.set(name, c); loading = false; }, (e: unknown) => {
        console.warn(`sfx ${name}: ${e instanceof Error ? e.message : String(e)}`);
        loading = false;
      });
    }
  }
  run(amb, 6000);
  if (amb.clip && !ambVoice) { try { ambVoice = playClip(amb.clip, { bus: "music", gain: 0.4, loop: true }); } catch { ambVoice = null; } }
  if (amb.clip) run(music, 12000);
  if (musicOn && music.clip && !musicVoice && ambVoice) {
    try { musicVoice = playClip(music.clip, { bus: "music", gain: 0.5, loop: true }); } catch { musicVoice = null; }
  } else if (!musicOn && musicVoice) {
    try { musicVoice.stop(); } catch { /* gone */ }
    musicVoice = null;
  }
}

// Sound, as the browser build's audio.js: the authored one-shots
// (sfx/<name>.opus, sfx/manifest.json, each event a sound bank playing its
// variants in turn), the quiet railway ambience (brown noise through a 320 Hz
// low-pass, looped) and the music stem (84 bpm: Cmaj7 · Am7 · Fmaj7 · G7 with a
// triangle bass on every other eighth and the 32-step melody), both rendered
// once offline into looping clips at the old buses' default balance (music 0.5,
// effects 0.8, ambience 0.4). The runtime has no ambience bus, so the ambience
// plays on the music bus. The synthesized blips audio.js played while a sample
// loaded are not ported: a clip still loading is silent. The runtime's Options
// own the volumes, the mute and the voice limit.
import { OfflineAudioContext, SoundBank, context, createClip, loadClip, play as playClip, type AudioBuffer, type AudioClip, type Sound } from "starhermit:audio";

export type Sfx = "select" | "confirm" | "play" | "draw" | "eight" | "error" | "win" | "lose" | "turn";
const SAMPLES: Record<Sfx, string[]> = {
  select: ["ui-select-tick", "ui-select-card"], confirm: ["ui-confirm", "ui-confirm-chip"], play: ["card-play", "card-play-felt"],
  draw: ["card-draw"], eight: ["wild-eight-chime"], error: ["ui-error-buzz"], win: ["victory-fanfare"], lose: ["defeat-descend"],
  turn: ["turn-notify", "turn-tap"],
};
const banks = new Map<Sfx, SoundBank>();
export function play(ev: Sfx): void {
  try { banks.get(ev)?.play(); } catch { /* voice limit */ }
}

// ---- rendered loops ---------------------------------------------------------------------------
const RATE = 22050;
const AMB_S = 2;
const AMB_GAIN = 2.11; // make-up: the old script noise's rms .4155 (the engine's brown noise unscaled: .1966)
async function renderAmbience(): Promise<AudioClip> {
  const settle = RATE, n = AMB_S * RATE;
  const off = new OfflineAudioContext(1, settle + n, RATE);
  const noise = off.createNoise({ color: "brown", seed: 0x5eed, seconds: AMB_S });
  const lp = off.createBiquadFilter();
  lp.type = "lowpass"; lp.frequency.value = 320; // Q 1 (0 dB), the old RBJ's
  lp.Q.value = 0;
  const g = off.createGain(); g.gain.value = AMB_GAIN;
  noise.connect(lp); lp.connect(g); g.connect(off.destination);
  noise.start();
  const r = await off.startRendering();
  return createClip([r.getChannelData(0).slice(settle)], RATE); // filtered periodic noise is periodic once settled
}

const beat = 60 / 84, eighth = beat / 2;
const CHORDS = [[48, 52, 55, 59], [45, 48, 52, 56], [41, 45, 48, 53], [43, 47, 50, 54]];
const MELODY = [60, -1, 64, -1, 67, -1, 69, -1, 65, -1, 64, -1, 62, -1, 60, -1, 58, -1, 60, -1, 63, -1, 67, -1, 64, -1, 62, -1, 60, -1, 59, -1];
const midi = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);
interface Note { at: number; freq: number; dur: number; gain: number; tri: boolean }
function musicNotes(): Note[] {
  const notes: Note[] = [];
  for (let s = 0; s < 32; s++) {
    const t = s * eighth;
    const chord = CHORDS[Math.floor(s / 8) % 4]!;
    if (s % 2 === 0) notes.push({ at: t, freq: midi(chord[0]! - 12), dur: eighth * 1.8, gain: 0.3, tri: true });
    notes.push({ at: t, freq: midi(chord[1]!), dur: eighth * 3.4, gain: 0.14, tri: false });
    notes.push({ at: t, freq: midi(chord[2]!), dur: eighth * 3.4, gain: 0.14, tri: false });
    notes.push({ at: t, freq: midi(chord[3]!), dur: eighth * 3.4, gain: 0.12, tri: false });
    const m = MELODY[s % MELODY.length]!;
    if (m >= 0) notes.push({ at: t, freq: midi(m), dur: eighth * 1.6, gain: 0.3, tri: false });
  }
  return notes;
}
const LOOP_S = 32 * eighth, TAIL_S = eighth * 3.4;
/** A note list in one context (an offline context holds a bounded number of nodes): each note an oscillator and an exponential decay to 0.0001. */
function renderNotes(notes: Note[]): Promise<AudioBuffer> {
  const off = new OfflineAudioContext(1, Math.ceil((LOOP_S + TAIL_S) * RATE), RATE);
  for (const n of notes) {
    const osc = off.createOscillator();
    osc.type = n.tri ? "triangle" : "sine";
    osc.frequency.value = n.freq;
    const g = off.createGain();
    g.gain.setValueAtTime(n.gain, n.at);
    g.gain.exponentialRampToValueAtTime(0.0001, n.at + n.dur);
    osc.connect(g); g.connect(off.destination);
    osc.start(n.at); osc.stop(n.at + n.dur);
  }
  return off.startRendering();
}
/** Two renders of the notes, mixed into one loop with the tails past its end laid back over its start. */
async function renderMusic(): Promise<AudioClip> {
  const notes = musicNotes(), half = notes.length >> 1;
  const parts = await Promise.all([renderNotes(notes.slice(0, half)), renderNotes(notes.slice(half))]);
  const off = new OfflineAudioContext(1, Math.round(LOOP_S * RATE), RATE);
  for (const buffer of parts) {
    for (const offset of [0, LOOP_S]) {
      const src = off.createBufferSource();
      src.buffer = buffer;
      src.connect(off.destination);
      src.start(0, offset);
    }
  }
  return createClip(await off.startRendering());
}

let ambClip: AudioClip | null = null, musicClip: AudioClip | null = null;
let ambVoice: Sound | null = null, musicVoice: Sound | null = null;
let musicOn = true;
/** audio.js startMusic / stopMusic (backgrounding stops the stem). */
export function setMusic(on: boolean): void { musicOn = on; }

/** Loads every clip and renders the loops (from onStart). */
export function loadSfx(): void {
  const load = (name: string): Promise<AudioClip | null> => loadClip(`sfx/${name}.opus`).catch((e: unknown) => {
    console.warn(`sfx ${name}: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  });
  for (const ev of Object.keys(SAMPLES) as Sfx[]) {
    void Promise.all(SAMPLES[ev].map(load)).then((loaded) => {
      const list = loaded.filter((c) => c !== null);
      if (list.length) banks.set(ev, new SoundBank({ clips: list, order: "sequence", bus: "effects", gain: 0.8 }));
    });
  }
  renderAmbience().then((c) => { ambClip = c; }, (e: unknown) => console.warn(`audio: ${String(e)}`));
  renderMusic().then((c) => { musicClip = c; }, (e: unknown) => console.warn(`audio: ${String(e)}`));
}

/** Each frame: the loop voices once the mixer runs. */
export function update(): void {
  if (context.state !== "running") return;
  if (ambClip && !ambVoice) { try { ambVoice = playClip(ambClip, { bus: "music", gain: 0.4, loop: true }); } catch { ambVoice = null; } }
  if (musicOn && musicClip && !musicVoice && ambVoice) {
    try { musicVoice = playClip(musicClip, { bus: "music", gain: 0.5, loop: true }); } catch { musicVoice = null; }
  } else if (!musicOn && musicVoice) {
    try { musicVoice.stop(); } catch { /* gone */ }
    musicVoice = null;
  }
}

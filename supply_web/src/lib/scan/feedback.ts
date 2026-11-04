/** Sound, vibration and colour for every scan result, so staff never have to look at the screen to know. */
export type FeedbackKind = "ok" | "dup" | "warn" | "error";

let ctx: AudioContext | null = null;
let muted = false;

export function setMuted(v: boolean) { muted = v; }

/** Browsers only allow sound after a tap: call this from the button that opens the camera. */
export function unlockAudio() {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
  } catch { /* no audio available */ }
}

const TONES: Record<FeedbackKind, [number, number][]> = {
  ok: [[1100, 70]],
  dup: [[600, 60], [600, 60]],
  warn: [[700, 90], [520, 90]],
  error: [[200, 260]],
};
const VIBRATE: Record<FeedbackKind, number[]> = { ok: [25], dup: [20, 40, 20], warn: [60, 40, 60], error: [200] };

export function feedback(kind: FeedbackKind) {
  try { navigator.vibrate?.(VIBRATE[kind]); } catch { /* iOS has no vibration */ }
  if (muted || !ctx) return;
  let at = ctx.currentTime;
  for (const [freq, ms] of TONES[kind]) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "square";
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.12, at + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, at + ms / 1000);
    o.connect(g).connect(ctx.destination);
    o.start(at);
    o.stop(at + ms / 1000 + 0.02);
    at += ms / 1000 + 0.04;
  }
}

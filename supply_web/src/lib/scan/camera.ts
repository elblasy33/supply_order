/**
 * Camera barcode reading for phones, built for speed:
 *  - the browser's own BarcodeDetector when it exists (Chrome on Android: on-device, fastest), else zxing-cpp
 *    compiled to WebAssembly (served from our own origin);
 *  - only the formats we use, decoded from a centre crop of the frame at a modest resolution;
 *  - one result per physical label (a code counts again only after it left the view), weak symbologies need
 *    two consecutive reads;
 *  - rear camera, continuous autofocus, torch and zoom when the device offers them, screen kept awake,
 *    camera released as soon as it is not needed.
 */
export type DetectedCode = { code: string; format: string };
export type CameraError = "insecure" | "unsupported" | "denied" | "not_found" | "busy" | "failed";

export type CameraCaps = {
  torch: boolean;
  zoom: { min: number; max: number; step: number } | null;
  cameras: { id: string; label: string }[];
  deviceId: string;
};

/** Formats of products and lots. Fewer formats = faster decoding and fewer false reads. */
export const SCAN_FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "itf", "qr_code", "data_matrix"] as const;
/** Symbologies without a strong check digit: confirmed by a second read before they count. */
const WEAK = new Set(["code_39", "itf", "code_128", "data_matrix"]);

type Detector = { detect(source: CanvasImageSource): Promise<{ rawValue: string; format: string }[]> };
let detectorPromise: Promise<Detector> | null = null;

/** Loads (once) the native detector or the WASM one, and warms it up so the first real scan is instant. */
export function loadDetector(): Promise<Detector> {
  detectorPromise ??= (async () => {
    const formats = [...SCAN_FORMATS];
    const Native = (globalThis as { BarcodeDetector?: { new (o: { formats: string[] }): Detector; getSupportedFormats(): Promise<string[]> } }).BarcodeDetector;
    if (Native) {
      try {
        const supported = await Native.getSupportedFormats();
        const usable = formats.filter((f) => supported.includes(f));
        if (usable.length >= 5) return new Native({ formats: usable });
      } catch { /* fall back to WASM */ }
    }
    const mod = await import("barcode-detector/ponyfill");
    mod.prepareZXingModule({
      overrides: { locateFile: (path: string, prefix: string) => (path.endsWith(".wasm") ? "/wasm/zxing_reader.wasm" : prefix + path) },
      fireImmediately: true,
    });
    const d = new mod.BarcodeDetector({ formats: formats as unknown as never }) as unknown as Detector;
    const warm = document.createElement("canvas");
    warm.width = warm.height = 32;
    await d.detect(warm).catch(() => []);
    return d;
  })();
  return detectorPromise;
}

export function classifyError(e: unknown): CameraError {
  if (typeof window !== "undefined" && !window.isSecureContext) return "insecure";
  if (!navigator.mediaDevices?.getUserMedia) return "unsupported";
  const name = e instanceof DOMException ? e.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "denied";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "not_found";
  if (name === "NotReadableError" || name === "AbortError") return "busy";
  return "failed";
}

type Options = {
  onDetect: (d: DetectedCode) => void;
  /** Time a code must be out of sight before it can count again (a new box with the same label). */
  leaveMs?: number;
  /** Part of the frame that is read (centre crop), as fractions of width and height. */
  region?: { w: number; h: number };
};

export class CameraSession {
  private stream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;
  private running = false;
  private paused = false;
  private busy = false;
  private wake: WakeLockSentinel | null = null;
  private canvas = document.createElement("canvas");
  private lastSeen = new Map<string, number>();
  private pending: { code: string; at: number } | null = null;
  private readonly leaveMs: number;
  private readonly region: { w: number; h: number };

  constructor(private opts: Options) {
    this.leaveMs = opts.leaveMs ?? 700;
    this.region = opts.region ?? { w: 0.86, h: 0.5 };
  }

  async start(video: HTMLVideoElement, deviceId?: string): Promise<CameraCaps> {
    this.video = video;
    const detector = loadDetector(); // load while the permission dialog is open
    const base: MediaTrackConstraints = { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } };
    const attempt = (v: MediaTrackConstraints) => navigator.mediaDevices.getUserMedia({ video: { ...base, ...v }, audio: false });
    try {
      this.stream = await attempt(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: "environment" } });
    } catch (e) {
      if (deviceId) this.stream = await attempt({ facingMode: { ideal: "environment" } }); // saved camera is gone
      else throw e;
    }
    video.srcObject = this.stream;
    video.setAttribute("playsinline", "true");
    video.muted = true;
    await video.play();
    await this.tune();
    this.running = true;
    this.paused = false;
    void this.keepAwake();
    void detector.then((d) => this.loop(d));
    return this.caps();
  }

  private track() { return this.stream?.getVideoTracks()[0]; }

  /** Continuous autofocus where the device supports it (checked, not assumed). */
  private async tune() {
    const t = this.track();
    const caps = t?.getCapabilities?.() as (MediaTrackCapabilities & { focusMode?: string[] }) | undefined;
    if (t && caps?.focusMode?.includes("continuous")) {
      await t.applyConstraints({ advanced: [{ focusMode: "continuous" } as MediaTrackConstraintSet] }).catch(() => {});
    }
  }

  async caps(): Promise<CameraCaps> {
    const t = this.track();
    const c = (t?.getCapabilities?.() ?? {}) as MediaTrackCapabilities & { torch?: boolean; zoom?: { min: number; max: number; step: number } };
    let cameras: CameraCaps["cameras"] = [];
    try {
      cameras = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput").map((d, i) => ({ id: d.deviceId, label: d.label || `Camera ${i + 1}` }));
    } catch { /* ignore */ }
    return { torch: !!c.torch, zoom: c.zoom ? { min: c.zoom.min, max: c.zoom.max, step: c.zoom.step || 0.1 } : null, cameras, deviceId: t?.getSettings().deviceId ?? "" };
  }

  async setTorch(on: boolean) { await this.track()?.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] }); }
  async setZoom(z: number) { await this.track()?.applyConstraints({ advanced: [{ zoom: z } as MediaTrackConstraintSet] }); }

  pause() { this.paused = true; }
  resume() { this.paused = false; this.lastSeen.clear(); this.pending = null; }

  stop() {
    this.running = false;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.video) this.video.srcObject = null;
    void this.wake?.release().catch(() => {});
    this.wake = null;
  }

  private async keepAwake() {
    try { this.wake = (await navigator.wakeLock?.request("screen")) ?? null; } catch { /* not allowed: fine */ }
  }
  /** Called when the tab becomes visible again (the wake lock is dropped when hidden). */
  async reacquire() { if (this.running && !this.wake) await this.keepAwake(); }

  private schedule(next: () => void) {
    const v = this.video as (HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number }) | null;
    if (!this.running || !v) return;
    // one decode per ~70 ms is plenty for a hand-held label and keeps phones cool
    if (v.requestVideoFrameCallback) setTimeout(() => this.running && v.requestVideoFrameCallback!(next), 55);
    else setTimeout(next, 70);
  }

  private loop(detector: Detector) {
    const tick = async () => {
      const v = this.video;
      if (!this.running || !v) return;
      if (!this.paused && !this.busy && v.readyState >= 2 && v.videoWidth > 0) {
        this.busy = true;
        try { await this.scanFrame(detector, v); } catch { /* a bad frame: the next one will do */ } finally { this.busy = false; }
      }
      this.schedule(tick);
    };
    this.schedule(tick);
  }

  private async scanFrame(detector: Detector, v: HTMLVideoElement) {
    const { videoWidth: vw, videoHeight: vh } = v;
    const sw = Math.round(vw * this.region.w), sh = Math.round(vh * this.region.h);
    const sx = Math.round((vw - sw) / 2), sy = Math.round((vh - sh) / 2);
    const scale = Math.min(1, 900 / sw);
    this.canvas.width = Math.round(sw * scale);
    this.canvas.height = Math.round(sh * scale);
    const g = this.canvas.getContext("2d", { willReadFrequently: true })!;
    g.drawImage(v, sx, sy, sw, sh, 0, 0, this.canvas.width, this.canvas.height);
    const found = await detector.detect(this.canvas);
    const now = performance.now();
    const seen = new Set<string>();
    for (const f of found) {
      const code = f.rawValue;
      if (!code) continue;
      seen.add(code);
      const last = this.lastSeen.get(code);
      this.lastSeen.set(code, now);
      if (last !== undefined && now - last < this.leaveMs) continue; // still the same label in view
      if (WEAK.has(f.format)) {
        // needs the same value twice in a row (within half a second)
        if (this.pending?.code !== code || now - this.pending.at > 500) { this.pending = { code, at: now }; this.lastSeen.delete(code); continue; }
        this.pending = null;
      }
      this.opts.onDetect({ code, format: f.format });
    }
    for (const k of this.lastSeen.keys()) if (!seen.has(k) && now - this.lastSeen.get(k)! > 3000) this.lastSeen.delete(k);
  }
}

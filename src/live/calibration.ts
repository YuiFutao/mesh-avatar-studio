/** Studio-only tracking calibration. No model, sprite or runtime API changes. */
export interface TrackingCalibration {
  neutralMouth: number;
  floor: number;
  enter: number;
  exit: number;
  gentle: number;
  big: number;
  open: [number, number];
  closed: [number, number];
  enterSeconds: number;
  exitSeconds: number;
  riseSeconds: number;
  fallSeconds: number;
}
export interface CalibrationProfile { version: 1; config: TrackingCalibration }
const fields = ['neutralMouth', 'floor', 'enter', 'exit', 'gentle', 'big', 'enterSeconds', 'exitSeconds', 'riseSeconds', 'fallSeconds'] as const;
const object = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const number = (x: unknown, min: number, max: number): x is number => typeof x === 'number' && Number.isFinite(x) && x >= min && x <= max;
const pair = (x: unknown): x is [number, number] => Array.isArray(x) && x.length === 2 && x.every(v => number(v, 0, 1));
export function parseCalibrationProfile(value: unknown): CalibrationProfile | null {
  if (!object(value) || value.version !== 1 || !object(value.config)) return null;
  const c = value.config;
  for (const key of fields) if (!number(c[key], 0, key.endsWith('Seconds') ? 2 : 1)) return null;
  if (!pair(c.open) || !pair(c.closed)) return null;
  const config = { ...Object.fromEntries(fields.map(k => [k, c[k]])), open: [...c.open], closed: [...c.closed] } as TrackingCalibration;
  if (!(config.floor < config.exit && config.exit < config.enter && config.enter < config.gentle && config.gentle < config.big)
    || config.enter < 1e-9 || config.big - config.gentle < 1e-6
    || config.riseSeconds <= 0 || config.fallSeconds <= 0 || config.closed.some((v, i) => v - config.open[i] < .05)) return null;
  return { version: 1, config };
}
const required = ['mouthSmileLeft', 'mouthSmileRight', 'eyeBlinkLeft', 'eyeBlinkRight'];
export function validCalibrationShapes(shapes: Record<string, number>) { return required.every(k => number(shapes[k], 0, 1)); }
const clamp = (n: number) => Math.max(0, Math.min(1, n));
export class FaceCalibration {
  private active = false;
  private enterTime = 0;
  private exitTime = 0;
  private strength = 0;
  output = { valid: false, smile: 0, eyes: [1, 1], wideEyes: [0, 0] };
  constructor(private config: TrackingCalibration) { this.config = structuredClone(config); }
  reset() { this.active = false; this.enterTime = this.exitTime = this.strength = 0; this.output = { valid: false, smile: 0, eyes: [1, 1], wideEyes: [0, 0] }; }
  update(shapes: Record<string, number>, dt: number) {
    if (!validCalibrationShapes(shapes) || !number(dt, 0, .25)) { this.reset(); return; }
    const c = this.config, elapsed = Math.min(.15, dt);
    const mouth = Math.max(0, (shapes.mouthSmileLeft + shapes.mouthSmileRight) / 2 - c.neutralMouth);
    if (!this.active) {
      this.enterTime = mouth >= c.enter ? this.enterTime + elapsed : 0;
      if (mouth >= c.enter && this.enterTime + 1e-9 >= c.enterSeconds) { this.active = true; this.exitTime = 0; }
    } else {
      this.exitTime = mouth <= c.exit ? this.exitTime + elapsed : 0;
      if (mouth <= c.exit && this.exitTime + 1e-9 >= c.exitSeconds) { this.active = false; this.enterTime = 0; }
    }
    const curve = (v: number) => Math.log1p(Math.max(0, v - c.floor) / c.enter);
    const g = curve(c.gentle), b = curve(c.big), x = curve(mouth);
    const target = this.active ? clamp(x <= g ? .4 * x / g : .4 + .6 * (x - g) / (b - g)) : 0;
    const tau = target > this.strength ? c.riseSeconds : c.fallSeconds;
    this.strength += (target - this.strength) * (1 - Math.exp(-elapsed / tau));
    if (this.strength < 1e-5) this.strength = 0;
    const keys = ['eyeBlinkLeft', 'eyeBlinkRight'];
    this.output = { valid: true, smile: this.strength,
      eyes: keys.map((key, i) => clamp(1 - (shapes[key] - c.open[i]) / (c.closed[i] - c.open[i]))),
      // Openness below the calibrated relaxed blink score was previously clipped at 1.
      // Retain it as an independent widening signal, with a neutral noise band.
      wideEyes: keys.map((key, i) => clamp((c.open[i] - shapes[key] - Math.max(.025, c.open[i] * .2)) / Math.max(.04, c.open[i] * .6))),
    };
  }
}
export interface StoredCalibration { enabled: boolean; profile: CalibrationProfile | null }
const key = (project: string, avatar?: string) => `mesh-avatar:tracking-calibration:${JSON.stringify([project, avatar ?? null])}`;
export function loadCalibration(project: string, avatar?: string): StoredCalibration {
  try {
    const value = JSON.parse(localStorage.getItem(key(project, avatar)) ?? 'null');
    const profile = parseCalibrationProfile(value?.profile);
    return { enabled: !!profile && value.enabled === true, profile };
  } catch { return { enabled: false, profile: null }; }
}
export function saveCalibration(project: string, avatar: string | undefined, value: StoredCalibration) {
  try { localStorage.setItem(key(project, avatar), JSON.stringify(value)); } catch { /* Optional browser storage. */ }
}
/** Explicit same-origin profile link; never request a third-party URL. */
export async function calibrationFromQuery(search: string, origin: string): Promise<CalibrationProfile | null> {
  const path = new URLSearchParams(search).get('trackingProfile');
  if (!path) return null;
  const url = new URL(path, origin);
  if (url.origin !== origin || !/^https?:$/.test(url.protocol) || url.username || url.password) throw new Error('Invalid calibration URL');
  const response = await fetch(url.href, { credentials: 'same-origin', redirect: 'error' });
  if (!response.ok) throw new Error('Calibration could not load');
  const text = await response.text();
  if (text.length > 65536) throw new Error('Calibration exceeds 64 KiB');
  const profile = parseCalibrationProfile(JSON.parse(text));
  if (!profile) throw new Error('Invalid calibration');
  return profile;
}

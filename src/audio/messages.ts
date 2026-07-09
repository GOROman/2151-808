// Message protocol between the UI thread and the AudioWorklet (public/worklet.js).

/** One instrument's trigger recipe, fully precomputed on the UI thread. */
export interface TriggerSpec {
  /** YM2151 channel 0-7 */
  ch: number
  /** Full register dump applied at trigger time: [reg, val] pairs */
  initRegs: [number, number][]
  /** KC/KF written at trigger */
  kc: number
  kf: number
  /** Carrier TL registers with their base values, for accent handling */
  carrierTL: { reg: number; base: number }[]
  /** TL reduction applied on accented steps */
  accentBoost: number
  /** Pitch sweep: register writes at millisecond offsets after the trigger */
  sweep: { ms: number; kc: number; kf: number }[]
  /** Extra key-on retriggers (ms offsets), e.g. for handclap */
  retrigMs: number[]
  /** Noise register value (0x0F) to write at trigger, or null */
  noise: number | null
  /** Key-off after this many ms (0 = leave ringing) */
  gateMs: number
}

/** Master output filter settings. */
export interface FilterParams {
  mode: 'off' | 'lp' | 'hp'
  /** cutoff frequency in Hz */
  cutoff: number
  /** resonance 0-1 */
  res: number
}

export const NUM_STEPS = 16
export const NUM_INSTRUMENTS = 9

/** step value: 0 = off, 1 = on, 2 = accent */
export type StepGrid = number[][] // [instrument][step]

export type ToWorklet =
  | { type: 'wasm'; bytes: ArrayBuffer }
  | { type: 'pattern'; a: StepGrid; b: StepGrid }
  | { type: 'tempo'; bpm: number }
  | { type: 'swing'; amount: number }
  | { type: 'mode'; value: 'A' | 'B' | 'AB' }
  | { type: 'fill' }
  | { type: 'play' }
  | { type: 'stop' }
  | { type: 'triggers'; specs: TriggerSpec[] }
  | { type: 'preview'; inst: number; accent: boolean }
  | { type: 'filter'; params: FilterParams }

export type FromWorklet =
  | { type: 'ready' }
  | { type: 'pos'; step: number; pattern: 'A' | 'B' }
  | { type: 'stopped' }
  | { type: 'level'; peak: number }

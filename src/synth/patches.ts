// YM2151 FM patches approximating the TR-808 voices, plus the register
// compiler that turns a Patch into a TriggerSpec for the worklet.
import type { TriggerSpec } from '../audio/messages'

/** Operator parameters. Array order matches register rows: [M1, M2, C1, C2]. */
export interface OpParams {
  dt1: number // 0-7
  mul: number // 0-15
  tl: number // 0-127
  ks: number // 0-3
  ar: number // 0-31
  d1r: number // 0-31
  d1l: number // 0-15
  d2r: number // 0-31
  rr: number // 0-15
  dt2: number // 0-3
}

export interface Patch {
  name: string
  short: string
  color: string // 808 button color group
  ch: number
  alg: number // 0-7 (CONNECT)
  fb: number // 0-7
  note: number // MIDI note (fractional allowed)
  sweep?: { toNote: number; ms: number; steps?: number }
  retrigMs?: number[]
  /** noise frequency 0-31 (ch7 only); undefined = noise off */
  noiseFreq?: number
  gateMs?: number
  accentBoost?: number
  ops: [OpParams, OpParams, OpParams, OpParams]
}

const op = (p: Partial<OpParams>): OpParams => ({
  dt1: 0, mul: 1, tl: 127, ks: 0, ar: 31, d1r: 0, d1l: 0, d2r: 0, rr: 15, dt2: 0,
  ...p,
})

/** Carrier op indices (into the [M1,M2,C1,C2] array) for each CONNECT value. */
export function carriers(alg: number): number[] {
  switch (alg) {
    case 4: return [2, 3]
    case 5: case 6: return [1, 2, 3]
    case 7: return [0, 1, 2, 3]
    default: return [3]
  }
}

/** MIDI note -> YM2151 KC/KF. A4 (midi 69, 440Hz) maps to KC 0x4A. */
export function noteToKcKf(midi: number): { kc: number; kf: number } {
  const CODE = [0, 1, 2, 4, 5, 6, 8, 9, 10, 12, 13, 14] // C#..C
  let n = midi - 13
  if (n < 0) n = 0
  const whole = Math.floor(n)
  const frac = n - whole
  let oct = Math.floor(whole / 12)
  if (oct > 7) oct = 7
  const idx = whole % 12
  const kc = (oct << 4) | CODE[idx]
  const kf = Math.round(frac * 64) & 0x3f
  return { kc, kf: kf << 2 }
}

/** Compile a patch into the full register list + trigger metadata. */
export function compilePatch(p: Patch): TriggerSpec {
  const ch = p.ch
  const regs: [number, number][] = []
  // RL (both speakers) / FB / CONNECT
  regs.push([0x20 + ch, 0xc0 | (p.fb << 3) | p.alg])
  // PMS/AMS off
  regs.push([0x38 + ch, 0])
  p.ops.forEach((o, i) => {
    const base = i * 8 + ch
    regs.push([0x40 + base, ((o.dt1 & 7) << 4) | (o.mul & 15)])
    regs.push([0x60 + base, o.tl & 127])
    regs.push([0x80 + base, ((o.ks & 3) << 6) | (o.ar & 31)])
    regs.push([0xa0 + base, o.d1r & 31])
    regs.push([0xc0 + base, ((o.dt2 & 3) << 6) | (o.d2r & 31)])
    regs.push([0xe0 + base, ((o.d1l & 15) << 4) | (o.rr & 15)])
  })

  const { kc, kf } = noteToKcKf(p.note)
  const carrierTL = carriers(p.alg).map((i) => ({
    reg: 0x60 + i * 8 + ch,
    base: p.ops[i].tl,
  }))

  const sweep: { ms: number; kc: number; kf: number }[] = []
  if (p.sweep) {
    const steps = p.sweep.steps ?? 24
    for (let s = 1; s <= steps; s++) {
      const t = s / steps
      const note = p.note + (p.sweep.toNote - p.note) * t
      const k = noteToKcKf(note)
      sweep.push({ ms: (p.sweep.ms * s) / steps, kc: k.kc, kf: k.kf })
    }
  }

  return {
    ch,
    initRegs: regs,
    kc,
    kf,
    carrierTL,
    accentBoost: p.accentBoost ?? 12,
    sweep,
    retrigMs: p.retrigMs ?? [],
    noise: p.noiseFreq !== undefined ? 0x80 | (p.noiseFreq & 31) : ch === 7 ? 0 : null,
    gateMs: p.gateMs ?? 0,
  }
}

// ---------------------------------------------------------------------------
// The nine voices. Channel plan: BD0 SD1 LT2 MT3 HT4 CB5 CP6 OH/CH7(noise)
// ---------------------------------------------------------------------------

// Envelope note: D1L is *attenuation* (0 = sustain at full level!). Percussive
// voices need d1l:15 so D1R carries the level all the way down.
export function defaultPatches(): Patch[] {
  return [
    {
      name: 'Bass Drum', short: 'BD', color: 'red', ch: 0,
      alg: 4, fb: 4, note: 57, sweep: { toNote: 33, ms: 40 }, accentBoost: 8,
      ops: [
        op({ mul: 1, tl: 36, ar: 31, d1r: 17, d1l: 15, d2r: 0, rr: 15 }), // M1 attack click
        op({ tl: 127 }), // M2 unused
        op({ mul: 1, tl: 0, ar: 31, d1r: 13, d1l: 15, d2r: 0, rr: 12 }), // C1 body ~55Hz
        op({ tl: 127 }), // C2 unused
      ],
    },
    {
      name: 'Snare Drum', short: 'SD', color: 'red', ch: 1,
      alg: 4, fb: 7, note: 54, sweep: { toNote: 50, ms: 30 }, accentBoost: 8,
      ops: [
        op({ mul: 13, tl: 32, ar: 31, d1r: 17, d1l: 15, d2r: 0, rr: 15 }), // M1 noise src (FB7)
        op({ mul: 1, tl: 72, ar: 31, d1r: 19, d1l: 15, d2r: 0, rr: 15 }), // M2 body mod
        op({ mul: 6, tl: 8, ar: 31, d1r: 16, d1l: 15, d2r: 0, rr: 13, dt2: 3 }), // C1 snappy
        op({ mul: 1, tl: 5, ar: 31, d1r: 15, d1l: 15, d2r: 0, rr: 13 }), // C2 tone ~185Hz
      ],
    },
    {
      name: 'Low Tom', short: 'LT', color: 'orange', ch: 2,
      alg: 4, fb: 3, note: 46, sweep: { toNote: 40, ms: 120 },
      ops: [
        op({ mul: 1, tl: 45, ar: 31, d1r: 18, d1l: 15, d2r: 0, rr: 15 }),
        op({ tl: 127 }),
        op({ mul: 1, tl: 4, ar: 31, d1r: 12, d1l: 15, d2r: 0, rr: 11 }), // ~82Hz
        op({ tl: 127 }),
      ],
    },
    {
      name: 'Mid Tom', short: 'MT', color: 'orange', ch: 3,
      alg: 4, fb: 3, note: 53, sweep: { toNote: 47, ms: 100 },
      ops: [
        op({ mul: 1, tl: 45, ar: 31, d1r: 18, d1l: 15, d2r: 0, rr: 15 }),
        op({ tl: 127 }),
        op({ mul: 1, tl: 4, ar: 31, d1r: 13, d1l: 15, d2r: 0, rr: 11 }), // ~123Hz
        op({ tl: 127 }),
      ],
    },
    {
      name: 'Hi Tom', short: 'HT', color: 'orange', ch: 4,
      alg: 4, fb: 3, note: 59, sweep: { toNote: 53, ms: 80 },
      ops: [
        op({ mul: 1, tl: 45, ar: 31, d1r: 18, d1l: 15, d2r: 0, rr: 15 }),
        op({ tl: 127 }),
        op({ mul: 1, tl: 4, ar: 31, d1r: 13, d1l: 15, d2r: 0, rr: 11 }), // ~175Hz
        op({ tl: 127 }),
      ],
    },
    {
      name: 'Cowbell', short: 'CB', color: 'yellow', ch: 5,
      alg: 4, fb: 5, note: 60.5, gateMs: 350,
      ops: [
        op({ mul: 7, tl: 52, ar: 31, d1r: 20, d1l: 15, d2r: 0, rr: 15 }), // M1 clang
        op({ mul: 7, tl: 58, ar: 31, d1r: 20, d1l: 15, d2r: 0, rr: 15, dt2: 1 }),
        op({ mul: 2, tl: 10, ar: 31, d1r: 14, d1l: 3, d2r: 12, rr: 13 }), // C1 ~540Hz
        op({ mul: 3, tl: 12, ar: 31, d1r: 14, d1l: 3, d2r: 12, rr: 13 }), // C2 ~810Hz
      ],
    },
    {
      name: 'Hand Clap', short: 'CP', color: 'yellow', ch: 6,
      alg: 5, fb: 7, note: 65, retrigMs: [11, 23], accentBoost: 8,
      ops: [
        op({ mul: 4, tl: 22, ar: 31, d1r: 14, d1l: 15, d2r: 0, rr: 15, dt2: 3 }), // M1 noise src (FB7)
        op({ mul: 2, tl: 8, ar: 31, d1r: 17, d1l: 15, d2r: 0, rr: 13, dt2: 1 }),
        op({ mul: 3, tl: 8, ar: 31, d1r: 17, d1l: 15, d2r: 0, rr: 13, dt2: 3 }),
        op({ mul: 4, tl: 10, ar: 31, d1r: 15, d1l: 15, d2r: 0, rr: 13, dt2: 2 }), // longer tail
      ],
    },
    {
      name: 'Open Hat', short: 'OH', color: 'white', ch: 7,
      alg: 7, fb: 6, note: 91, noiseFreq: 26, gateMs: 600,
      ops: [
        op({ mul: 11, tl: 20, ar: 31, d1r: 14, d1l: 15, d2r: 0, rr: 10, dt2: 2 }), // metallic partials
        op({ mul: 7, tl: 22, ar: 31, d1r: 14, d1l: 15, d2r: 0, rr: 10, dt2: 3 }),
        op({ mul: 13, tl: 24, ar: 31, d1r: 14, d1l: 15, d2r: 0, rr: 10, dt2: 1 }),
        op({ mul: 15, tl: 0, ar: 31, d1r: 13, d1l: 15, d2r: 0, rr: 10 }), // C2 = noise slot
      ],
    },
    {
      name: 'Closed Hat', short: 'CH', color: 'white', ch: 7,
      alg: 7, fb: 6, note: 91, noiseFreq: 26, accentBoost: 8,
      ops: [
        op({ mul: 11, tl: 24, ar: 31, d1r: 22, d1l: 15, d2r: 0, rr: 15, dt2: 2 }),
        op({ mul: 7, tl: 26, ar: 31, d1r: 22, d1l: 15, d2r: 0, rr: 15, dt2: 3 }),
        op({ mul: 13, tl: 28, ar: 31, d1r: 22, d1l: 15, d2r: 0, rr: 15, dt2: 1 }),
        op({ mul: 15, tl: 0, ar: 31, d1r: 20, d1l: 15, d2r: 0, rr: 15 }),
      ],
    },
  ]
}

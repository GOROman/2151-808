// MDX (MXDRV / X68000) file parser — extracts the OPM voice definitions so
// they can be assigned to instruments. We only read the tone data block, not
// the MML performance data.
//
// Layout: Shift-JIS title terminated by 0x1A (preceded by CR/LF), then a
// NUL-terminated PDX filename, then the base offset table (big-endian words
// relative to the table start): +0 = tone data offset, +2.. = channel MML
// offsets. Each voice is 27 bytes: number, FB/ALG, slot mask, then 24 bytes
// of operator data stored parameter-major in register order
// (DT1/MUL, TL, KS/AR, AME/D1R, DT2/D2R, D1L/RR × ops M1,M2,C1,C2).
import { carriers, type OpParams, type Patch } from './patches'

export interface MdxVoice {
  num: number
  alg: number
  fb: number
  slotMask: number
  ops: [OpParams, OpParams, OpParams, OpParams]
}

export interface MdxFile {
  title: string
  voices: MdxVoice[]
}

export function parseMdx(buf: ArrayBuffer): MdxFile {
  const b = new Uint8Array(buf)

  // title: bytes up to 0x1A, minus the trailing CR/LF
  let i = 0
  while (i < b.length && b[i] !== 0x1a) i++
  if (i >= b.length) throw new Error('not an MDX file (no title terminator)')
  let titleEnd = i
  while (titleEnd > 0 && (b[titleEnd - 1] === 0x0d || b[titleEnd - 1] === 0x0a)) titleEnd--
  let title = ''
  try {
    title = new TextDecoder('shift-jis').decode(b.subarray(0, titleEnd)).trim()
  } catch {
    /* decoder unavailable — title stays empty */
  }
  i++

  // PDX filename (NUL-terminated, may be empty)
  while (i < b.length && b[i] !== 0) i++
  i++

  const base = i
  if (base + 2 > b.length) throw new Error('not an MDX file (truncated header)')
  const toneOffset = (b[base] << 8) | b[base + 1]
  const voices: MdxVoice[] = []
  let p = base + toneOffset
  if (toneOffset >= 2 && p < b.length) {
    while (p + 27 <= b.length) {
      const flcon = b[p + 1]
      const op = (j: number): OpParams => ({
        dt1: (b[p + 3 + j] >> 4) & 7,
        mul: b[p + 3 + j] & 15,
        tl: b[p + 7 + j] & 127,
        ks: (b[p + 11 + j] >> 6) & 3,
        ar: b[p + 11 + j] & 31,
        d1r: b[p + 15 + j] & 31, // bit7 = AME, dropped (AMS is off)
        d2r: b[p + 19 + j] & 31,
        dt2: (b[p + 19 + j] >> 6) & 3,
        d1l: (b[p + 23 + j] >> 4) & 15,
        rr: b[p + 23 + j] & 15,
      })
      voices.push({
        num: b[p],
        alg: flcon & 7,
        fb: (flcon >> 3) & 7,
        slotMask: b[p + 2],
        ops: [op(0), op(1), op(2), op(3)],
      })
      p += 27
    }
  }
  voices.sort((a, z) => a.num - z.num)
  return { title, voices }
}

/** Copy an MDX voice into an instrument patch (keeps channel/note/name). */
export function applyVoiceToPatch(v: MdxVoice, p: Patch): void {
  p.alg = v.alg
  p.fb = v.fb
  p.ops = v.ops.map((o) => ({ ...o })) as Patch['ops']
  // MDX voices are melodic: no pitch sweep, retrigger, or noise
  delete p.sweep
  delete p.retrigMs
  delete p.noiseFreq
  // A carrier that never decays would ring until the next hit — gate it.
  const sustains = carriers(v.alg).some((i) => v.ops[i].d1l < 15 && v.ops[i].d2r <= 4)
  p.gateMs = sustains ? 400 : 0
}

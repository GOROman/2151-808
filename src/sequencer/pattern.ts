import { NUM_INSTRUMENTS, NUM_STEPS, type StepGrid } from '../audio/messages'
import type { Patch } from '../synth/patches'

export interface AppState {
  version: 2
  tempo: number
  swing: number
  mode: 'A' | 'B' | 'AB'
  patterns: { a: StepGrid; b: StepGrid }
  patches: Patch[]
}

export function emptyGrid(): StepGrid {
  return Array.from({ length: NUM_INSTRUMENTS }, () => Array(NUM_STEPS).fill(0))
}

/** A little four-on-the-floor demo pattern so first play makes sound. */
export function demoGrid(): StepGrid {
  const g = emptyGrid()
  const BD = 0, SD = 1, CP = 6, OH = 7, CH = 8
  for (let s = 0; s < 16; s += 4) g[BD][s] = s === 0 ? 2 : 1
  g[SD][4] = 1
  g[SD][12] = 2
  g[CP][12] = 1
  // CH skips the steps where OH plays (they share ch7 and would choke it)
  for (let s = 0; s < 16; s += 2) if (s !== 2 && s !== 10) g[CH][s] = 1
  g[OH][2] = 1
  g[OH][10] = 1
  return g
}

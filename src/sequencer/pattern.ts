import { MAX_STEPS, NUM_INSTRUMENTS, type FilterParams, type StepGrid } from '../audio/messages'
import type { Patch } from '../synth/patches'

export interface AppState {
  version: 7
  tempo: number
  swing: number
  mode: 'A' | 'B' | 'AB'
  /** sequence length in steps (16-64); grids always hold MAX_STEPS columns */
  length: number
  patterns: { a: StepGrid; b: StepGrid }
  patches: Patch[]
  filter: FilterParams
}

export function defaultFilter(): FilterParams {
  return { mode: 'off', cutoff: 8000, res: 0.3 }
}

export function emptyGrid(): StepGrid {
  return Array.from({ length: NUM_INSTRUMENTS }, () => Array(MAX_STEPS).fill(0))
}

/** Widen old 16-step rows to MAX_STEPS columns. */
export function padGrid(g: StepGrid): StepGrid {
  return g.map((row) => {
    const r = row.slice(0, MAX_STEPS)
    while (r.length < MAX_STEPS) r.push(0)
    return r
  })
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

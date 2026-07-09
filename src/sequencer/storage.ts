import { defaultFilter, emptyGrid, padGrid, type AppState } from './pattern'
import { defaultPatches, type Patch } from '../synth/patches'

const KEY = '2151-808-state'

const VERSION = 5

/** Accept current-version state as-is; upgrade older versions in place.
 *  v5 adds sequence length (grids widen to 64 steps) and swaps in the new
 *  default BD (Dragon Spirit @1) and 808-style CB voices; v4 gained the
 *  filter section; pre-v3 default patches were broken, so those get all
 *  patches reset. */
function migrate(s: unknown): AppState | null {
  const st = s as AppState | null
  if (!st || typeof st !== 'object' || typeof st.version !== 'number') return null
  if (st.version === VERSION) return st
  if (st.version < VERSION) {
    const fresh = defaultPatches()
    return {
      ...st,
      version: VERSION,
      length: st.length ?? 16,
      patterns: { a: padGrid(st.patterns.a), b: padGrid(st.patterns.b) },
      patches:
        st.version >= 3
          ? st.patches.map((p, i) => (i === 0 || i === 5 ? fresh[i] : p))
          : fresh,
      filter: st.filter ?? defaultFilter(),
    }
  }
  return null
}

export function saveLocal(state: AppState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
  } catch {
    /* private mode etc. */
  }
}

export function loadLocal(): AppState | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    return migrate(JSON.parse(raw))
  } catch {
    return null
  }
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

function base64UrlToBytes(s: string): Uint8Array {
  const bin = atob(s.replaceAll('-', '+').replaceAll('_', '/'))
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

async function pipe(bytes: Uint8Array, t: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(t)
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** Share URLs (#z=): short keys, unmodified patches / empty pattern B elided,
 *  then deflate + base64url. Keeps well under X's URL limit. */
export async function stateToHash(state: AppState): Promise<string> {
  const defs = defaultPatches()
  const share = {
    v: state.version,
    t: state.tempo,
    s: state.swing,
    m: state.mode,
    l: state.length,
    a: state.patterns.a,
    b: state.patterns.b.some((row) => row.some(Boolean)) ? state.patterns.b : 0,
    p: state.patches.map((p, i) => (JSON.stringify(p) === JSON.stringify(defs[i]) ? 0 : p)),
    f: state.filter,
  }
  const packed = await pipe(new TextEncoder().encode(JSON.stringify(share)), new CompressionStream('deflate-raw'))
  return '#z=' + bytesToBase64Url(packed)
}

export async function stateFromHash(hash: string): Promise<AppState | null> {
  const z = hash.match(/^#z=(.+)$/)
  if (z) {
    try {
      const json = new TextDecoder().decode(
        await pipe(base64UrlToBytes(z[1]), new DecompressionStream('deflate-raw')),
      )
      const o = JSON.parse(json)
      const defs = defaultPatches()
      return migrate({
        version: o.v,
        tempo: o.t,
        swing: o.s,
        mode: o.m,
        length: o.l ?? 16,
        patterns: { a: o.a, b: o.b || emptyGrid() },
        patches: (o.p as (Patch | 0)[]).map((p, i) => p || defs[i]),
        filter: o.f,
      })
    } catch {
      return null
    }
  }
  // legacy uncompressed links
  const m = hash.match(/^#p=(.+)$/)
  if (!m) return null
  try {
    const json = new TextDecoder().decode(base64UrlToBytes(m[1]))
    return migrate(JSON.parse(json))
  } catch {
    return null
  }
}

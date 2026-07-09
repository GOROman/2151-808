import { defaultFilter, type AppState } from './pattern'
import { defaultPatches } from '../synth/patches'

const KEY = '2151-808-state'

const VERSION = 4

/** Accept current-version state as-is; upgrade older versions in place.
 *  v3 -> v4 only gains the filter section; pre-v3 default patches were
 *  broken, so those also get their patches reset. */
function migrate(s: unknown): AppState | null {
  const st = s as AppState | null
  if (!st || typeof st !== 'object' || typeof st.version !== 'number') return null
  if (st.version === VERSION) return st
  if (st.version < VERSION) {
    return {
      ...st,
      version: VERSION,
      patches: st.version >= 3 ? st.patches : defaultPatches(),
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

function toBase64Url(s: string): string {
  const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(s)))
  return b64.replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

function fromBase64Url(s: string): string {
  const b64 = s.replaceAll('-', '+').replaceAll('_', '/')
  const bin = atob(b64)
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))
}

export function stateToHash(state: AppState): string {
  return '#p=' + toBase64Url(JSON.stringify(state))
}

export function stateFromHash(hash: string): AppState | null {
  const m = hash.match(/^#p=(.+)$/)
  if (!m) return null
  try {
    return migrate(JSON.parse(fromBase64Url(m[1])))
  } catch {
    return null
  }
}

import type { AppState } from './pattern'

const KEY = '2151-808-state'

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
    const s = JSON.parse(raw)
    return s?.version === 1 ? (s as AppState) : null
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
    const s = JSON.parse(fromBase64Url(m[1]))
    return s?.version === 1 ? (s as AppState) : null
  } catch {
    return null
  }
}

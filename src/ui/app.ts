// TR-808 style panel UI. Pure DOM, no framework.
import { NUM_STEPS } from '../audio/messages'
import type { AppState } from '../sequencer/pattern'
import { stateToHash } from '../sequencer/storage'
import { buildEditor } from './editor'

export interface UIHandlers {
  ensureAudio: () => Promise<void>
  play: () => void
  stop: () => void
  patternChanged: () => void
  tempoChanged: () => void
  swingChanged: () => void
  modeChanged: () => void
  fill: () => void
  patchChanged: () => void
  preview: (inst: number, accent: boolean) => void
}

export interface UIController {
  onPos: (step: number, pattern: 'A' | 'B') => void
  onStopped: () => void
  onLevel: (peak: number) => void
}

const STEP_COLORS = ['red', 'red', 'red', 'red', 'orange', 'orange', 'orange', 'orange',
  'yellow', 'yellow', 'yellow', 'yellow', 'white', 'white', 'white', 'white']

export function buildUI(root: HTMLElement, state: AppState, h: UIHandlers): UIController {
  let playing = false
  let editPattern: 'a' | 'b' = 'a'
  let selectedInst = 0
  let audioStarted = false

  const ensureAudio = async (): Promise<void> => {
    if (audioStarted) return
    audioStarted = true
    try {
      await h.ensureAudio()
    } catch (err) {
      console.error('[2151-808] audio init failed (insecure context?)', err)
    }
  }

  root.innerHTML = ''
  const panel = el('div', 'panel')
  root.appendChild(panel)

  // ---- header ----
  const header = el('div', 'header')
  header.appendChild(el('div', 'brand', 'Rhythm Composer <b>YM-808</b> <span>Computer Controlled — YM2151 OPM</span>'))
  const vu = el('div', 'vu')
  for (let i = 0; i < 8; i++) vu.appendChild(el('i'))
  header.appendChild(vu)
  panel.appendChild(header)

  // ---- transport row ----
  const transport = el('div', 'transport')

  const startBtn = el('button', 'btn start', 'START<br>STOP') as HTMLButtonElement
  startBtn.onclick = async () => {
    await ensureAudio()
    playing = !playing
    if (playing) h.play()
    else h.stop()
    startBtn.classList.toggle('active', playing)
  }
  transport.appendChild(labeled('main', startBtn))

  const tempoWrap = el('div', 'knobwrap')
  const tempoVal = el('div', 'knobval', String(state.tempo))
  const tempo = document.createElement('input')
  tempo.type = 'range'
  tempo.min = '40'
  tempo.max = '260'
  tempo.value = String(state.tempo)
  tempo.oninput = () => {
    state.tempo = Number(tempo.value)
    tempoVal.textContent = tempo.value
    h.tempoChanged()
  }
  tempoWrap.append(tempoVal, tempo)
  transport.appendChild(labeled('tempo', tempoWrap))

  const swingWrap = el('div', 'knobwrap')
  const swingVal = el('div', 'knobval', pct(state.swing))
  const swing = document.createElement('input')
  swing.type = 'range'
  swing.min = '0'
  swing.max = '100'
  swing.value = String(Math.round(state.swing * 100))
  swing.oninput = () => {
    state.swing = Number(swing.value) / 100
    swingVal.textContent = pct(state.swing)
    h.swingChanged()
  }
  swingWrap.append(swingVal, swing)
  transport.appendChild(labeled('swing', swingWrap))

  // pattern mode
  const modeWrap = el('div', 'modes')
  const modeBtns: Record<string, HTMLButtonElement> = {}
  for (const m of ['A', 'B', 'AB'] as const) {
    const b = el('button', 'btn small', m) as HTMLButtonElement
    b.onclick = () => {
      state.mode = m
      for (const k in modeBtns) modeBtns[k].classList.toggle('active', k === m)
      h.modeChanged()
    }
    modeBtns[m] = b
    modeWrap.appendChild(b)
  }
  modeBtns[state.mode].classList.add('active')
  transport.appendChild(labeled('play mode', modeWrap))

  const fillBtn = el('button', 'btn small warn', 'FILL') as HTMLButtonElement
  fillBtn.onclick = async () => {
    await ensureAudio()
    h.fill()
    fillBtn.classList.add('active')
    setTimeout(() => fillBtn.classList.remove('active'), 400)
  }
  transport.appendChild(labeled('fill in', fillBtn))

  // edit target A/B
  const editWrap = el('div', 'modes')
  const editBtns: Record<string, HTMLButtonElement> = {}
  for (const m of ['a', 'b'] as const) {
    const b = el('button', 'btn small', m.toUpperCase()) as HTMLButtonElement
    b.onclick = () => {
      editPattern = m
      for (const k in editBtns) editBtns[k].classList.toggle('active', k === m)
      refreshSteps()
    }
    editBtns[m] = b
    editWrap.appendChild(b)
  }
  editBtns[editPattern].classList.add('active')
  transport.appendChild(labeled('edit pattern', editWrap))

  const clearBtn = el('button', 'btn small', 'CLEAR') as HTMLButtonElement
  clearBtn.onclick = () => {
    grid()[selectedInst].fill(0)
    refreshSteps()
    h.patternChanged()
  }
  transport.appendChild(labeled('clear track', clearBtn))

  const shareBtn = el('button', 'btn small', 'SHARE') as HTMLButtonElement
  const shareMsg = el('span', 'sharemsg', '')
  shareBtn.onclick = async () => {
    const url = location.origin + location.pathname + stateToHash(state)
    history.replaceState(null, '', stateToHash(state))
    try {
      await navigator.clipboard.writeText(url)
      shareMsg.textContent = 'URL copied!'
    } catch {
      shareMsg.textContent = 'URL set in address bar'
    }
    setTimeout(() => (shareMsg.textContent = ''), 2000)
  }
  const shareWrap = el('div')
  shareWrap.append(shareBtn, shareMsg)
  transport.appendChild(labeled('share', shareWrap))

  panel.appendChild(transport)

  // ---- instrument selector ----
  const instRow = el('div', 'instruments')
  const instBtns: HTMLButtonElement[] = []
  state.patches.forEach((p, i) => {
    const b = el('button', `inst ${p.color}`, `<b>${p.short}</b><span>${p.name}</span>`) as HTMLButtonElement
    b.onclick = async () => {
      await ensureAudio()
      selectedInst = i
      instBtns.forEach((x, j) => x.classList.toggle('active', j === i))
      h.preview(i, false)
      refreshSteps()
      editor.select(i)
    }
    instBtns.push(b)
    instRow.appendChild(b)
  })
  instBtns[0].classList.add('active')
  panel.appendChild(instRow)

  // ---- step row ----
  const stepRow = el('div', 'steps')
  const stepBtns: HTMLButtonElement[] = []
  const leds: HTMLElement[] = []
  for (let s = 0; s < NUM_STEPS; s++) {
    const wrap = el('div', 'stepwrap')
    const led = el('div', 'led')
    const b = el('button', `step ${STEP_COLORS[s]}`, String(s + 1)) as HTMLButtonElement
    b.onclick = async () => {
      await ensureAudio()
      const row = grid()[selectedInst]
      row[s] = (row[s] + 1) % 3
      refreshSteps()
      h.patternChanged()
    }
    leds.push(led)
    stepBtns.push(b)
    wrap.append(led, b)
    stepRow.appendChild(wrap)
  }
  panel.appendChild(stepRow)

  // ---- sound editor ----
  const editorHost = el('div', 'editorhost')
  panel.appendChild(editorHost)
  const editor = buildEditor(editorHost, state, () => h.patchChanged(), (i, acc) => h.preview(i, acc))
  editor.select(0)

  const footer = el('div', 'footer',
    'YM2151 (OPM) emulation by <a href="https://github.com/aaronsgiles/ymfm" target="_blank" rel="noreferrer">ymfm</a>' +
    ' — <a href="https://github.com/GOROman/2151-808" target="_blank" rel="noreferrer">source</a>')
  panel.appendChild(footer)

  function grid() {
    return state.patterns[editPattern]
  }

  function refreshSteps(): void {
    const row = grid()[selectedInst]
    stepBtns.forEach((b, s) => {
      b.classList.toggle('on', row[s] === 1)
      b.classList.toggle('accent', row[s] === 2)
    })
  }
  refreshSteps()

  let lastLedStep = -1
  return {
    onPos(step, pattern) {
      if (lastLedStep >= 0) leds[lastLedStep].classList.remove('lit')
      leds[step].classList.add('lit')
      lastLedStep = step
      startBtn.dataset.pattern = pattern
    },
    onStopped() {
      if (lastLedStep >= 0) leds[lastLedStep].classList.remove('lit')
      lastLedStep = -1
    },
    onLevel(peak) {
      const n = Math.min(8, Math.round(peak * 10))
      Array.from(vu.children).forEach((c, i) => c.classList.toggle('lit', i < n))
    },
  }
}

function el(tag: string, cls?: string, html?: string): HTMLElement {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (html !== undefined) e.innerHTML = html
  return e
}

function labeled(label: string, child: HTMLElement): HTMLElement {
  const w = el('div', 'ctl')
  w.appendChild(child)
  w.appendChild(el('label', undefined, label.toUpperCase()))
  return w
}

function pct(v: number): string {
  return Math.round(v * 100) + '%'
}

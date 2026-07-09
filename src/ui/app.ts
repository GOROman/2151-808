// TR-808 style panel UI. Pure DOM, no framework.
import { NUM_STEPS } from '../audio/messages'
import type { AppState } from '../sequencer/pattern'
import { stateToHash } from '../sequencer/storage'
import { applyVoiceToPatch, parseMdx, type MdxFile } from '../synth/mdx'
import { buildEditor } from './editor'

export interface UIHandlers {
  ensureAudio: () => Promise<void>
  play: () => void
  stop: () => void
  pause: () => void
  resume: () => void
  patternChanged: () => void
  tempoChanged: () => void
  swingChanged: () => void
  modeChanged: () => void
  lengthChanged: () => void
  fill: () => void
  patchChanged: () => void
  preview: (inst: number, accent: boolean) => void
  filterChanged: () => void
}

export interface UIController {
  onPos: (step: number, pattern: 'A' | 'B', fired: number[]) => void
  onStopped: () => void
  onLevel: (peak: number) => void
  onRegs: (regs: Uint8Array) => void
}

const STEP_COLORS = ['red', 'red', 'red', 'red', 'orange', 'orange', 'orange', 'orange',
  'yellow', 'yellow', 'yellow', 'yellow', 'white', 'white', 'white', 'white']

export function buildUI(root: HTMLElement, state: AppState, h: UIHandlers): UIController {
  let playing = false
  let paused = false
  let editPattern: 'a' | 'b' = 'a'
  let selectedInst = 0
  let curPage = 0
  let audioStarted = false

  const ensureAudio = async (): Promise<void> => {
    if (audioStarted) return
    audioStarted = true
    try {
      await h.ensureAudio()
    } catch (err) {
      audioStarted = false // e.g. transient network failure — retry on next gesture
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
    paused = false
    if (playing) h.play()
    else h.stop()
    startBtn.classList.toggle('active', playing)
  }
  transport.appendChild(labeled('main', startBtn))

  // keyboard: SPACE = play/pause toggle, ENTER = restart from step 1
  document.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement | null
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return
    if (e.code !== 'Space' && e.code !== 'Enter') return
    e.preventDefault() // keep focused buttons from also activating
    void ensureAudio().then(() => {
      if (e.code === 'Space') {
        if (playing) {
          h.pause()
          playing = false
          paused = true
        } else if (paused) {
          h.resume()
          playing = true
          paused = false
        } else {
          h.play()
          playing = true
        }
      } else {
        h.play()
        playing = true
        paused = false
      }
      startBtn.classList.toggle('active', playing)
    })
  })

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

  const lenWrap = el('div', 'knobwrap')
  const lenVal = el('div', 'knobval', String(state.length))
  const len = document.createElement('input')
  len.type = 'range'
  len.min = '16'
  len.max = '64'
  len.value = String(state.length)
  len.oninput = () => {
    state.length = Number(len.value)
    lenVal.textContent = len.value
    h.lengthChanged()
    refreshPages()
  }
  lenWrap.append(lenVal, len)
  transport.appendChild(labeled('length', lenWrap))

  // ---- master filter ----
  const filtModes = el('div', 'modes')
  const filtBtns: Record<string, HTMLButtonElement> = {}
  for (const m of ['off', 'lp', 'hp'] as const) {
    const b = el('button', 'btn small', m.toUpperCase()) as HTMLButtonElement
    b.onclick = () => {
      state.filter.mode = m
      for (const k in filtBtns) filtBtns[k].classList.toggle('active', k === m)
      h.filterChanged()
    }
    filtBtns[m] = b
    filtModes.appendChild(b)
  }
  filtBtns[state.filter.mode].classList.add('active')
  transport.appendChild(labeled('filter', filtModes))

  const hzLabel = (hz: number): string => (hz >= 1000 ? (hz / 1000).toFixed(1) + 'k' : String(Math.round(hz)))
  const cutWrap = el('div', 'knobwrap')
  const cutVal = el('div', 'knobval', hzLabel(state.filter.cutoff))
  const cut = document.createElement('input')
  cut.type = 'range'
  cut.min = '0'
  cut.max = '100'
  // exponential 20Hz..20kHz
  cut.value = String(Math.round((100 * Math.log10(state.filter.cutoff / 20)) / 3))
  cut.oninput = () => {
    state.filter.cutoff = Math.round(20 * Math.pow(10, (Number(cut.value) / 100) * 3))
    cutVal.textContent = hzLabel(state.filter.cutoff)
    h.filterChanged()
  }
  cutWrap.append(cutVal, cut)
  transport.appendChild(labeled('cutoff', cutWrap))

  const resWrap = el('div', 'knobwrap')
  const resVal = el('div', 'knobval', pct(state.filter.res))
  const res = document.createElement('input')
  res.type = 'range'
  res.min = '0'
  res.max = '100'
  res.value = String(Math.round(state.filter.res * 100))
  res.oninput = () => {
    state.filter.res = Number(res.value) / 100
    resVal.textContent = pct(state.filter.res)
    h.filterChanged()
  }
  resWrap.append(resVal, res)
  transport.appendChild(labeled('reso', resWrap))

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
    const hash = await stateToHash(state)
    const url = location.origin + location.pathname + hash
    history.replaceState(null, '', hash)
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
      mdxAssign.textContent = `ASSIGN → ${p.short}`
    }
    instBtns.push(b)
    instRow.appendChild(b)
  })
  instBtns[0].classList.add('active')
  panel.appendChild(instRow)

  // ---- step page selector ----
  const pagesWrap = el('div', 'pages')
  pagesWrap.appendChild(el('span', 'pagelabel', 'STEP PAGE'))
  const pageBtns: HTMLButtonElement[] = []
  for (let pg = 0; pg < 4; pg++) {
    const b = el('button', 'btn small', `${pg * 16 + 1}-${pg * 16 + 16}`) as HTMLButtonElement
    b.onclick = () => {
      curPage = pg
      refreshPages()
    }
    pageBtns.push(b)
    pagesWrap.appendChild(b)
  }
  panel.appendChild(pagesWrap)

  function refreshPages(): void {
    const pageCount = Math.ceil(state.length / NUM_STEPS)
    if (curPage >= pageCount) curPage = pageCount - 1
    pagesWrap.style.display = pageCount > 1 ? '' : 'none'
    pageBtns.forEach((b, i) => {
      b.style.display = i < pageCount ? '' : 'none'
      b.classList.toggle('active', i === curPage)
    })
    refreshSteps()
  }

  // ---- step row ----
  const stepRow = el('div', 'steps')
  const stepBtns: HTMLButtonElement[] = []
  const leds: HTMLElement[] = []
  for (let s = 0; s < NUM_STEPS; s++) {
    const wrap = el('div', 'stepwrap')
    const led = el('div', 'led')
    const b = el('button', `step ${STEP_COLORS[s]}`, String(s + 1)) as HTMLButtonElement
    b.onclick = async (e) => {
      await ensureAudio()
      const g = curPage * NUM_STEPS + s
      if (g >= state.length) return
      const row = grid()[selectedInst]
      // plain click: on/off toggle; shift-click: accent on/off
      if (e.shiftKey) row[g] = row[g] === 2 ? 1 : 2
      else row[g] = row[g] ? 0 : 1
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

  // ---- MDX voice import ----
  let mdxFile: MdxFile | null = null
  const mdxRow = el('div', 'mdxrow')
  mdxRow.appendChild(el('span', 'mdxlabel', 'MDX VOICE'))
  const mdxInput = document.createElement('input')
  mdxInput.type = 'file'
  mdxInput.accept = '.mdx'
  mdxInput.style.display = 'none'
  const mdxLoad = el('button', 'btn small', 'LOAD MDX') as HTMLButtonElement
  mdxLoad.onclick = () => mdxInput.click()
  const mdxTitle = el('span', 'mdxtitle', '')
  const mdxSelect = document.createElement('select')
  mdxSelect.className = 'mdxselect'
  mdxSelect.disabled = true
  const mdxAssign = el('button', 'btn small', `ASSIGN → ${state.patches[selectedInst].short}`) as HTMLButtonElement
  mdxAssign.disabled = true
  mdxInput.onchange = async () => {
    const file = mdxInput.files?.[0]
    mdxInput.value = ''
    if (!file) return
    try {
      const parsed = parseMdx(await file.arrayBuffer())
      if (parsed.voices.length === 0) {
        mdxTitle.textContent = 'no voices found'
        return
      }
      mdxFile = parsed
      mdxTitle.textContent = `${parsed.title || file.name} — ${parsed.voices.length} voices`
      mdxSelect.innerHTML = ''
      parsed.voices.forEach((v, i) => {
        const o = document.createElement('option')
        o.value = String(i)
        o.textContent = `@${v.num}  (alg${v.alg} fb${v.fb})`
        mdxSelect.appendChild(o)
      })
      mdxSelect.disabled = false
      mdxAssign.disabled = false
    } catch (err) {
      mdxFile = null
      mdxSelect.disabled = true
      mdxAssign.disabled = true
      mdxTitle.textContent = 'load failed: ' + (err instanceof Error ? err.message : String(err))
    }
  }
  mdxAssign.onclick = async () => {
    const v = mdxFile?.voices[Number(mdxSelect.value)]
    if (!v) return
    await ensureAudio()
    applyVoiceToPatch(v, state.patches[selectedInst])
    h.patchChanged()
    editor.select(selectedInst)
    h.preview(selectedInst, false)
  }
  mdxRow.append(mdxLoad, mdxSelect, mdxAssign, mdxTitle, mdxInput)
  panel.appendChild(mdxRow)

  // ---- YM2151 register viewer ----
  const regBox = document.createElement('details')
  regBox.className = 'regview'
  const regSummary = document.createElement('summary')
  regSummary.textContent = 'YM2151 REGISTERS'
  const regPre = document.createElement('pre')
  regBox.append(regSummary, regPre)
  panel.appendChild(regBox)

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
      const g = curPage * NUM_STEPS + s
      const inRange = g < state.length
      b.textContent = String(g + 1)
      b.disabled = !inRange
      b.classList.toggle('off', !inRange)
      leds[s].classList.toggle('set', inRange && row[g] >= 1)
      leds[s].classList.toggle('accent', inRange && row[g] === 2)
    })
  }
  refreshPages()

  const flashTimers: number[] = []
  function flashInst(i: number): void {
    instBtns[i].classList.add('hit')
    clearTimeout(flashTimers[i])
    flashTimers[i] = window.setTimeout(() => instBtns[i].classList.remove('hit'), 130)
  }

  let lastLedStep = -1
  return {
    onPos(step, pattern, fired) {
      if (lastLedStep >= 0) leds[lastLedStep].classList.remove('lit')
      lastLedStep = -1
      const local = step - curPage * NUM_STEPS
      if (local >= 0 && local < NUM_STEPS) {
        leds[local].classList.add('lit')
        lastLedStep = local
      }
      startBtn.dataset.pattern = pattern
      for (const i of fired) flashInst(i)
    },
    onStopped() {
      if (lastLedStep >= 0) leds[lastLedStep].classList.remove('lit')
      lastLedStep = -1
    },
    onLevel(peak) {
      const n = Math.min(8, Math.round(peak * 10))
      Array.from(vu.children).forEach((c, i) => c.classList.toggle('lit', i < n))
    },
    onRegs(regs) {
      if (!regBox.open) return
      const hex = (v: number): string => v.toString(16).toUpperCase().padStart(2, '0')
      let s = '    ' + Array.from({ length: 16 }, (_, i) => hex(i)).join(' ') + '\n'
      for (let row = 0; row < 16; row++) {
        s += hex(row * 16) + ': '
        for (let col = 0; col < 16; col++) {
          const v = regs[row * 16 + col]
          s += (v ? hex(v) : '··') + ' '
        }
        s += '\n'
      }
      regPre.textContent = s
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

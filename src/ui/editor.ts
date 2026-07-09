// Sound edit panel: FM parameters of the selected instrument.
import type { AppState } from '../sequencer/pattern'
import type { OpParams } from '../synth/patches'

export interface EditorController {
  select: (inst: number) => void
}

interface ParamDef {
  key: keyof OpParams
  label: string
  max: number
}

const OP_PARAMS: ParamDef[] = [
  { key: 'mul', label: 'MUL', max: 15 },
  { key: 'tl', label: 'TL', max: 127 },
  { key: 'ar', label: 'AR', max: 31 },
  { key: 'd1r', label: 'D1R', max: 31 },
  { key: 'd1l', label: 'D1L', max: 15 },
  { key: 'd2r', label: 'D2R', max: 31 },
  { key: 'rr', label: 'RR', max: 15 },
  { key: 'dt1', label: 'DT1', max: 7 },
  { key: 'dt2', label: 'DT2', max: 3 },
]

const OP_NAMES = ['M1', 'M2', 'C1', 'C2']
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

export function buildEditor(
  host: HTMLElement,
  state: AppState,
  onChange: () => void,
  preview: (inst: number, accent: boolean) => void,
): EditorController {
  let inst = 0

  const box = document.createElement('details')
  box.className = 'editor'
  const summary = document.createElement('summary')
  box.appendChild(summary)
  const body = document.createElement('div')
  body.className = 'editorbody'
  box.appendChild(body)
  host.appendChild(box)

  function slider(label: string, value: number, max: number, set: (v: number) => void): HTMLElement {
    const w = document.createElement('div')
    w.className = 'param'
    const l = document.createElement('label')
    const val = document.createElement('b')
    val.textContent = String(value)
    l.textContent = label + ' '
    l.appendChild(val)
    const r = document.createElement('input')
    r.type = 'range'
    r.min = '0'
    r.max = String(max)
    r.value = String(value)
    r.oninput = () => {
      val.textContent = r.value
      set(Number(r.value))
      onChange()
    }
    r.onchange = () => preview(inst, false)
    w.append(l, r)
    return w
  }

  function render(): void {
    const p = state.patches[inst]
    summary.innerHTML = `SOUND EDIT — <b>${p.name}</b> (ch${p.ch}${p.noiseFreq !== undefined ? ' +noise' : ''})`
    body.innerHTML = ''

    const chRow = document.createElement('div')
    chRow.className = 'oprow chrow'
    chRow.appendChild(slider('ALG', p.alg, 7, (v) => (p.alg = v)))
    chRow.appendChild(slider('FB', p.fb, 7, (v) => (p.fb = v)))

    // pitch: note name + octave + fine detune (cents)
    {
      const w = document.createElement('div')
      w.className = 'param notectl'
      const l = document.createElement('label')
      const val = document.createElement('b')
      l.textContent = 'NOTE '
      l.appendChild(val)
      const row = document.createElement('div')
      row.className = 'noterow'
      const noteSel = document.createElement('select')
      NOTE_NAMES.forEach((n, i) => {
        const o = document.createElement('option')
        o.value = String(i)
        o.textContent = n
        noteSel.appendChild(o)
      })
      const octSel = document.createElement('select')
      for (let o = 0; o <= 8; o++) {
        const e = document.createElement('option')
        e.value = String(o)
        e.textContent = String(o)
        octSel.appendChild(e)
      }
      const fine = document.createElement('input')
      fine.type = 'range'
      fine.min = '-50'
      fine.max = '50'
      fine.className = 'fine'
      const sync = (): void => {
        const semi = Math.round(p.note)
        noteSel.value = String(((semi % 12) + 12) % 12)
        octSel.value = String(Math.max(0, Math.min(8, Math.floor(semi / 12))))
        const cents = Math.round((p.note - semi) * 100)
        fine.value = String(cents)
        val.textContent = `${NOTE_NAMES[Number(noteSel.value)]}${octSel.value}${cents ? (cents > 0 ? ' +' : ' ') + cents + 'c' : ''}`
      }
      const apply = (): void => {
        const target = Number(octSel.value) * 12 + Number(noteSel.value) + Number(fine.value) / 100
        const clamped = Math.max(0, Math.min(96, target))
        const d = clamped - p.note
        p.note = clamped
        if (p.sweep) p.sweep.toNote += d
        sync()
        onChange()
        preview(inst, false)
      }
      noteSel.onchange = apply
      octSel.onchange = apply
      fine.oninput = apply
      sync()
      row.append(noteSel, octSel, fine)
      w.append(l, row)
      chRow.appendChild(w)
    }
    if (p.sweep) {
      const sw = p.sweep
      chRow.appendChild(slider('SWEEP', Math.round(p.note - sw.toNote), 36, (v) => (sw.toNote = p.note - v)))
      chRow.appendChild(slider('SW.MS', sw.ms, 300, (v) => (sw.ms = v)))
    }
    if (p.noiseFreq !== undefined) {
      chRow.appendChild(slider('NFRQ', p.noiseFreq, 31, (v) => (p.noiseFreq = v)))
    }
    body.appendChild(chRow)

    p.ops.forEach((o, i) => {
      const row = document.createElement('div')
      row.className = 'oprow'
      const name = document.createElement('span')
      name.className = 'opname'
      name.textContent = OP_NAMES[i]
      row.appendChild(name)
      for (const d of OP_PARAMS) {
        row.appendChild(slider(d.label, o[d.key], d.max, (v) => (o[d.key] = v)))
      }
      body.appendChild(row)
    })
  }

  return {
    select(i: number) {
      inst = i
      render()
    },
  }
}

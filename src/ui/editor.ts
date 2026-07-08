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
    chRow.appendChild(slider('NOTE', Math.round(p.note), 96, (v) => {
      const d = v - Math.round(p.note)
      p.note = v
      if (p.sweep) p.sweep.toNote += d
    }))
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

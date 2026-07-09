import './ui/style.css'
import type { FromWorklet, ToWorklet } from './audio/messages'
import { compilePatch, type Patch } from './synth/patches'
import { defaultFilter, demoGrid, emptyGrid, type AppState } from './sequencer/pattern'
import { defaultPatches } from './synth/patches'
import { loadLocal, saveLocal, stateFromHash } from './sequencer/storage'
import { buildUI } from './ui/app'

const DEBUG = new URLSearchParams(location.search).has('debug')

class AudioEngine {
  private ctx: AudioContext | null = null
  private node: AudioWorkletNode | null = null
  private queue: ToWorklet[] = []
  ready = false
  onMessage: ((m: FromWorklet) => void) | null = null

  /** Call from a user-gesture handler; safe to call repeatedly. */
  resume(): void {
    void this.ctx?.resume().catch(() => {})
  }

  async start(): Promise<void> {
    if (this.ctx) {
      this.resume()
      return
    }
    const ctx = new AudioContext({ latencyHint: 'interactive' })
    this.ctx = ctx
    const base = import.meta.env.BASE_URL
    let wasmBytes: ArrayBuffer
    try {
      await ctx.audioWorklet.addModule(base + 'worklet.js')
      wasmBytes = await (await fetch(base + 'ymfm.wasm')).arrayBuffer()
    } catch (err) {
      // network hiccup — undo so the next user gesture can retry
      this.ctx = null
      void ctx.close().catch(() => {})
      throw err
    }
    const node = new AudioWorkletNode(ctx, 'opm-processor', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    })
    const gain = ctx.createGain()
    gain.gain.value = 1.4
    node.connect(gain).connect(ctx.destination)
    node.port.onmessage = (e: MessageEvent<FromWorklet>) => {
      const m = e.data
      if (m.type === 'ready') {
        this.ready = true
        for (const q of this.queue) node.port.postMessage(q)
        this.queue = []
      }
      if (DEBUG && m.type === 'level' && m.peak > 0.001) {
        console.log('[2151-808] peak', m.peak.toFixed(3))
      }
      this.onMessage?.(m)
    }
    this.node = node
    node.port.postMessage({ type: 'wasm', bytes: wasmBytes } satisfies ToWorklet, [wasmBytes])
    this.resume()
  }

  send(msg: ToWorklet): void {
    if (msg.type === 'play' || msg.type === 'resume' || msg.type === 'preview') this.resume()
    if (!this.node || !this.ready) {
      this.queue.push(msg)
      return
    }
    this.node.port.postMessage(msg)
  }
}

async function initialState(): Promise<AppState> {
  const fromUrl = await stateFromHash(location.hash)
  if (fromUrl) return fromUrl
  const local = loadLocal()
  if (local) return local
  return {
    version: 5,
    tempo: 126,
    swing: 0,
    mode: 'A',
    length: 16,
    patterns: { a: demoGrid(), b: emptyGrid() },
    patches: defaultPatches(),
    filter: defaultFilter(),
  }
}

async function main(): Promise<void> {
  const state = await initialState()
  const engine = new AudioEngine()

  const syncAll = (): void => {
    engine.send({ type: 'pattern', a: state.patterns.a, b: state.patterns.b })
    engine.send({ type: 'tempo', bpm: state.tempo })
    engine.send({ type: 'swing', amount: state.swing })
    engine.send({ type: 'mode', value: state.mode })
    engine.send({ type: 'length', steps: state.length })
    engine.send({ type: 'triggers', specs: state.patches.map((p: Patch) => compilePatch(p)) })
    engine.send({ type: 'filter', params: { ...state.filter } })
  }

  let saveTimer: number | undefined
  const persist = (): void => {
    clearTimeout(saveTimer)
    saveTimer = window.setTimeout(() => saveLocal(state), 300)
  }

  const ui = buildUI(document.getElementById('app')!, state, {
    ensureAudio: async () => {
      await engine.start()
      syncAll()
    },
    play: () => engine.send({ type: 'play' }),
    stop: () => engine.send({ type: 'stop' }),
    pause: () => engine.send({ type: 'pause' }),
    resume: () => engine.send({ type: 'resume' }),
    lengthChanged: () => {
      engine.send({ type: 'length', steps: state.length })
      persist()
    },
    patternChanged: () => {
      engine.send({ type: 'pattern', a: state.patterns.a, b: state.patterns.b })
      persist()
    },
    tempoChanged: () => {
      engine.send({ type: 'tempo', bpm: state.tempo })
      persist()
    },
    swingChanged: () => {
      engine.send({ type: 'swing', amount: state.swing })
      persist()
    },
    modeChanged: () => {
      engine.send({ type: 'mode', value: state.mode })
      persist()
    },
    fill: () => engine.send({ type: 'fill' }),
    patchChanged: () => {
      engine.send({ type: 'triggers', specs: state.patches.map((p: Patch) => compilePatch(p)) })
      persist()
    },
    preview: (inst: number, accent: boolean) => engine.send({ type: 'preview', inst, accent }),
    filterChanged: () => {
      engine.send({ type: 'filter', params: { ...state.filter } })
      persist()
    },
  })

  engine.onMessage = (m) => {
    if (m.type === 'pos') ui.onPos(m.step, m.pattern, m.fired)
    if (m.type === 'stopped') ui.onStopped()
    if (m.type === 'level') ui.onLevel(m.peak)
    if (m.type === 'regs') ui.onRegs(m.regs)
  }
}

void main()

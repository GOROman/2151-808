import './ui/style.css'
import type { FromWorklet, ToWorklet } from './audio/messages'
import { compilePatch, type Patch } from './synth/patches'
import { demoGrid, emptyGrid, type AppState } from './sequencer/pattern'
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

  async start(): Promise<void> {
    if (this.ctx) {
      await this.ctx.resume()
      return
    }
    const ctx = new AudioContext({ latencyHint: 'interactive' })
    this.ctx = ctx
    const base = import.meta.env.BASE_URL
    await ctx.audioWorklet.addModule(base + 'worklet.js')
    const wasmBytes = await (await fetch(base + 'ymfm.wasm')).arrayBuffer()
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
    await ctx.resume()
  }

  send(msg: ToWorklet): void {
    if (!this.node || !this.ready) {
      this.queue.push(msg)
      return
    }
    this.node.port.postMessage(msg)
  }
}

function initialState(): AppState {
  const fromUrl = stateFromHash(location.hash)
  if (fromUrl) return fromUrl
  const local = loadLocal()
  if (local) return local
  return {
    version: 1,
    tempo: 126,
    swing: 0,
    mode: 'A',
    patterns: { a: demoGrid(), b: emptyGrid() },
    patches: defaultPatches(),
  }
}

function main(): void {
  const state = initialState()
  const engine = new AudioEngine()

  const syncAll = (): void => {
    engine.send({ type: 'pattern', a: state.patterns.a, b: state.patterns.b })
    engine.send({ type: 'tempo', bpm: state.tempo })
    engine.send({ type: 'swing', amount: state.swing })
    engine.send({ type: 'mode', value: state.mode })
    engine.send({ type: 'triggers', specs: state.patches.map((p: Patch) => compilePatch(p)) })
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
  })

  engine.onMessage = (m) => {
    if (m.type === 'pos') ui.onPos(m.step, m.pattern)
    if (m.type === 'stopped') ui.onStopped()
    if (m.type === 'level') ui.onLevel(m.peak)
  }
}

main()

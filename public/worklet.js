// AudioWorkletProcessor driving the ymfm YM2151 WASM core.
// Runs the step sequencer sample-accurately and resamples the chip's
// native rate (3.579545MHz / 64 ≈ 55.93kHz) to the context rate.
//
// Plain JS on purpose: worklet modules can't share the Vite bundle.
// Message types mirror src/audio/messages.ts.

const NUM_STEPS = 16

class OpmProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.wasm = null
    this.chipRate = 55930
    this.buf = null // Float32Array view over wasm memory (stereo interleaved)

    // resampler state
    this.ratio = 1
    this.phase = 1 // force initial chip sample fetch
    this.prevL = 0
    this.prevR = 0
    this.curL = 0
    this.curR = 0

    // sequencer state
    this.playing = false
    this.frame = 0 // global output-frame counter
    this.nextStepFrame = 0
    this.step = 0
    this.bpm = 120
    this.swing = 0
    this.mode = 'A' // 'A' | 'B' | 'AB'
    this.fillArmed = false
    this.fillReturn = null
    this.curPattern = 'A'
    this.patterns = { A: null, B: null }
    this.triggers = []
    this.events = [] // pending register writes: {frame, reg, val} (kept sorted)

    // master filter (TPT state-variable filter)
    this.filterMode = 'off' // 'off' | 'lp' | 'hp'
    this.fA1 = 0
    this.fA2 = 0
    this.fA3 = 0
    this.fK = 2
    this.fS = [0, 0, 0, 0] // integrator states: [ic1L, ic2L, ic1R, ic2R]

    this.peak = 0
    this.peakCountdown = 0

    this.port.onmessage = (e) => this.onMessage(e.data)
  }

  async onMessage(msg) {
    switch (msg.type) {
      case 'wasm': {
        const mod = await WebAssembly.compile(msg.bytes)
        // stdio stubs — the standalone build imports a few unused WASI fns
        const wasi = { fd_close: () => 0, fd_write: () => 0, fd_seek: () => 0, proc_exit: () => {} }
        const inst = await WebAssembly.instantiate(mod, { wasi_snapshot_preview1: wasi })
        this.wasm = inst.exports
        // WASI reactor init (runs C++ static constructors)
        if (this.wasm._initialize) this.wasm._initialize()
        this.chipRate = this.wasm.opm_init()
        this.ratio = this.chipRate / sampleRate
        const ptr = this.wasm.opm_buffer()
        this.buf = new Float32Array(this.wasm.memory.buffer, ptr, 2)
        this.port.postMessage({ type: 'ready' })
        break
      }
      case 'pattern':
        this.patterns.A = msg.a
        this.patterns.B = msg.b
        break
      case 'tempo':
        this.bpm = msg.bpm
        break
      case 'swing':
        this.swing = msg.amount
        break
      case 'mode':
        this.mode = msg.value
        if (this.mode !== 'AB') this.curPattern = this.mode
        break
      case 'fill':
        this.fillArmed = true
        break
      case 'triggers':
        this.triggers = msg.specs
        break
      case 'play':
        this.step = 0
        this.curPattern = this.mode === 'AB' ? 'A' : this.mode
        this.nextStepFrame = this.frame
        this.playing = true
        break
      case 'stop':
        this.playing = false
        this.events = []
        this.allKeysOff()
        this.port.postMessage({ type: 'stopped' })
        break
      case 'preview':
        if (this.wasm) this.fireTrigger(msg.inst, msg.accent ? 2 : 1, this.frame)
        break
      case 'filter': {
        const p = msg.params
        const fc = Math.max(20, Math.min(p.cutoff, sampleRate * 0.45))
        const g = Math.tan((Math.PI * fc) / sampleRate)
        const k = 2 - 1.95 * Math.max(0, Math.min(1, p.res))
        this.fA1 = 1 / (1 + g * (g + k))
        this.fA2 = g * this.fA1
        this.fA3 = g * this.fA2
        this.fK = k
        if (this.filterMode === 'off' && p.mode !== 'off') {
          this.fS[0] = this.fS[1] = this.fS[2] = this.fS[3] = 0
        }
        this.filterMode = p.mode
        break
      }
    }
  }

  write(reg, val) {
    this.wasm.opm_write(reg, val)
  }

  allKeysOff() {
    if (!this.wasm) return
    for (let ch = 0; ch < 8; ch++) this.write(0x08, ch)
  }

  pushEvent(frame, reg, val, chTag) {
    // insertion keeping the queue sorted by frame (stable: after equal frames)
    const ev = { frame, reg, val, chTag }
    let i = this.events.length
    while (i > 0 && this.events[i - 1].frame > frame) i--
    this.events.splice(i, 0, ev)
  }

  msToFrames(ms) {
    return Math.round((ms / 1000) * sampleRate)
  }

  fireTrigger(inst, stepVal, atFrame) {
    const t = this.triggers[inst]
    if (!t) return
    const accent = stepVal === 2

    // key off first (also chokes whatever shares the channel, e.g. OH/CH)
    this.write(0x08, t.ch)
    // drop any queued events for the same channel (stale sweeps/retrigs)
    this.events = this.events.filter((e) => (e.chTag ?? -1) !== t.ch)

    for (const [reg, val] of t.initRegs) this.write(reg, val)
    if (t.noise !== null) this.write(0x0f, t.noise)
    this.write(0x28 + t.ch, t.kc)
    this.write(0x30 + t.ch, t.kf)
    for (const c of t.carrierTL) {
      const tl = Math.max(0, Math.min(127, c.base - (accent ? t.accentBoost : 0)))
      this.write(c.reg, tl)
    }
    // Key-on must land on a later chip clock than the key-off above, or the
    // EG never sees an off->on edge and a still-keyed channel stays silent.
    this.pushEvent(atFrame + 1, 0x08, 0x78 | t.ch, t.ch)

    for (const s of t.sweep) {
      const f = atFrame + this.msToFrames(s.ms)
      this.pushEvent(f, 0x28 + t.ch, s.kc, t.ch)
      this.pushEvent(f, 0x30 + t.ch, s.kf, t.ch)
    }
    for (const ms of t.retrigMs) {
      const f = atFrame + this.msToFrames(ms)
      this.pushEvent(f, 0x08, t.ch, t.ch) // off
      this.pushEvent(f + 1, 0x08, 0x78 | t.ch, t.ch) // on again, one frame later
    }
    if (t.gateMs > 0) this.pushEvent(atFrame + this.msToFrames(t.gateMs), 0x08, t.ch, t.ch)
  }

  // One channel of the TPT SVF; o = state offset (0 = L, 2 = R).
  // tanh keeps resonance peaks from clipping harshly.
  filterSample(x, o) {
    const s = this.fS
    const v3 = x - s[o + 1]
    const v1 = this.fA1 * s[o] + this.fA2 * v3
    const v2 = s[o + 1] + this.fA2 * s[o] + this.fA3 * v3
    s[o] = 2 * v1 - s[o]
    s[o + 1] = 2 * v2 - s[o + 1]
    const y = this.filterMode === 'lp' ? v2 : x - this.fK * v1 - v2
    return Math.tanh(y)
  }

  framesPerStep() {
    return (sampleRate * 60) / this.bpm / 4
  }

  fireStep(atFrame) {
    const grid = this.patterns[this.curPattern]
    if (grid) {
      for (let inst = 0; inst < grid.length; inst++) {
        const v = grid[inst][this.step]
        if (v) this.fireTrigger(inst, v, atFrame)
      }
    }
    this.port.postMessage({ type: 'pos', step: this.step, pattern: this.curPattern })

    // advance
    const base = this.framesPerStep()
    const cur = this.step
    this.step = (this.step + 1) % NUM_STEPS
    if (this.step === 0) {
      // bar boundary: resolve A/B/fill
      if (this.fillArmed) {
        this.curPattern = this.curPattern === 'A' ? 'B' : 'A'
        this.fillArmed = false
        this.fillReturn = this.mode !== 'AB' ? this.mode : null
      } else if (this.fillReturn) {
        this.curPattern = this.fillReturn
        this.fillReturn = null
      } else if (this.mode === 'AB') {
        this.curPattern = this.curPattern === 'A' ? 'B' : 'A'
      } else {
        this.curPattern = this.mode
      }
    }
    // swing: delay odd steps
    let delta = base
    if (this.swing > 0) {
      const half = base * 0.5 * this.swing
      delta = cur % 2 === 0 ? base + half : base - half
    }
    this.nextStepFrame += delta
  }

  process(_inputs, outputs, _params) {
    const outL = outputs[0][0]
    const outR = outputs[0][1] || outputs[0][0]
    if (!this.wasm) {
      return true
    }
    const n = outL.length
    for (let i = 0; i < n; i++) {
      const f = this.frame + i
      // apply due register events
      while (this.events.length && this.events[0].frame <= f) {
        const e = this.events.shift()
        this.write(e.reg, e.val)
      }
      // sequencer
      if (this.playing && f >= this.nextStepFrame) {
        this.fireStep(f)
      }
      // resample chip -> context rate (linear interpolation)
      this.phase += this.ratio
      while (this.phase >= 1) {
        this.phase -= 1
        this.prevL = this.curL
        this.prevR = this.curR
        this.wasm.opm_generate(1)
        // memory may have grown/moved; re-view defensively
        if (this.buf.buffer !== this.wasm.memory.buffer) {
          this.buf = new Float32Array(this.wasm.memory.buffer, this.wasm.opm_buffer(), 2)
        }
        this.curL = this.buf[0]
        this.curR = this.buf[1]
      }
      let l = this.prevL + (this.curL - this.prevL) * this.phase
      let r = this.prevR + (this.curR - this.prevR) * this.phase
      if (this.filterMode !== 'off') {
        l = this.filterSample(l, 0)
        r = this.filterSample(r, 2)
      }
      outL[i] = l
      outR[i] = r
      const a = Math.max(Math.abs(l), Math.abs(r))
      if (a > this.peak) this.peak = a
    }
    this.frame += n

    this.peakCountdown -= n
    if (this.peakCountdown <= 0) {
      this.port.postMessage({ type: 'level', peak: this.peak })
      this.peak = 0
      this.peakCountdown = sampleRate / 15
    }
    return true
  }
}

registerProcessor('opm-processor', OpmProcessor)

// Measures Whisper (via OpenRouter) latency on a short WAV: simulang run tools/stt-latency.ts <file.wav>
import { SttModel, SamplesBuffer } from '@simular-ai/simulang-js'
import { readFileSync } from 'node:fs'

const b = readFileSync(process.argv[2])
const d = b.indexOf('data') + 8
const pcm = new Int16Array(b.buffer.slice(b.byteOffset + d, b.byteOffset + b.length - ((b.length - d) % 2)))
const buf = new SamplesBuffer(1, 16000, Array.from(pcm, (v) => v / 32768))
for (const alias of ['openrouter_whisper_large_v3']) {
  const m = SttModel.byAlias(alias)
  for (let i = 0; i < 3; i++) {
    const t = performance.now()
    const txt = buf.transcribe(m)
    console.log(alias, Math.round(performance.now() - t) + 'ms', JSON.stringify(txt))
  }
}


// Compares Deepgram Nova-3 via OpenRouter on test clips: node tools/nova-latency.mjs <wav>...
import { readFileSync } from 'node:fs'

const key = process.env.OPENROUTER_API_KEY
for (const file of process.argv.slice(2)) {
  for (let i = 0; i < 2; i++) {
    const t = performance.now()
    const res = await fetch('https://openrouter.ai/api/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'deepgram/nova-3', input_audio: { data: readFileSync(file).toString('base64'), format: 'wav' } }),
    })
    const body = await res.json()
    console.log(`${String(Math.round(performance.now() - t)).padStart(5)} ms  HTTP ${res.status}  ${file.split(/[\\/]/).pop()}  ${JSON.stringify(body.text ?? body.error ?? body)}`)
  }
}

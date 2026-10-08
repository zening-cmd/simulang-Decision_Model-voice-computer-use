// Checks that garbled phrases are ignored while real requests still route: simulang run tools/sensible-test.ts
import { readFileSync } from 'node:fs'
import { route, lastSensible } from '../router.ts'

const cfg = JSON.parse(readFileSync(new URL('../commands.json', import.meta.url), 'utf8'))
const ctx = { currentApp: 'YouTube - Google Chrome', recent: ['Maximize the window.'] }
for (const [text, want] of [
  ['Many minds in the window.', 'ignore'],
  ['Open a LinkedIn this bra.', 'any'],
  ['Help me to open the second video.', 'task'],
  ['Like this post.', 'task'],
  ['Comment is post, congratulations.', 'task'],
  ['Maximize the window.', 'key'],
] as const) {
  const t = performance.now()
  const r = await route(text, Object.keys(cfg.sites), Object.keys(cfg.apps), ctx)
  const ok = want === 'any' || r.kind === want
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${String(Math.round(performance.now() - t)).padStart(4)} ms  ${text.padEnd(36)} -> ${JSON.stringify(r)}  (sensible ${lastSensible.toFixed(2)})`)
}

// Sensible-instruction scores with the configured decider: simulang run tools/sensible-openai.ts
import { readFileSync } from 'node:fs'
import { route, lastSensible, useDecider } from '../router.ts'
import { makeDecider } from '../decider.ts'

const cfg = JSON.parse(readFileSync(new URL('../commands.json', import.meta.url), 'utf8'))
useDecider(makeDecider(cfg.decider, console.log))
for (const [text, want] of [
  ['Many minds in the window.', 'ignore'], ['Comet miss comet', 'ignore'], ["That's really understood my context.", 'ignore'],
  ['Let\'s get this.', 'ignore'], ['so anyway I was telling her about the trip', 'ignore'],
  ['Comment is post, congratulations.', 'task'], ['Open a LinkedIn this bra.', 'any'], ['type hello world', 'type'],
  ['Help me to open the second video.', 'task'], ['Can you like the post in this LinkedIn page?', 'task'],
] as const) {
  const r = await route(text, Object.keys(cfg.sites), Object.keys(cfg.apps), { currentApp: 'Feed | LinkedIn - Google Chrome', recent: [] })
  const ok = want === 'any' || r.kind === want
  console.log(`${ok ? 'ok  ' : 'FAIL'} sensible ${lastSensible.toFixed(2)}  ${text.padEnd(46)} -> ${r.kind}`)
}

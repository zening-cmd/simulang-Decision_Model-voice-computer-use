// Checks comment/common corrections are applied only when they make sense: simulang run tools/reading-test2.ts
import { readFileSync } from 'node:fs'
import { pickReading } from '../router.ts'

const cfg = JSON.parse(readFileSync(new URL('../commands.json', import.meta.url), 'utf8'))
const rules = Object.entries(cfg.aliases as Record<string, string>)
  .sort((a, b) => b[0].length - a[0].length)
  .map(([h, m]) => [new RegExp(`\\b${h.replace(/ /g, '\\s+')}\\b`, 'gi'), m] as const)
const fix = (t: string) => rules.reduce((s, [re, m]) => s.replace(re, m), t)

const front = 'Feed | LinkedIn - Google Chrome'
for (const [heard, wantFixed] of [
  ['Common is post', true],
  ['Comment is post congratulations', true],
  ['Comment list post congratulations', true],
  ['Common this post, great idea', true],
  ['Search for the most common AI tools', false],
  ['Open the comet browser', false],
] as const) {
  const t = performance.now()
  const got = pickReading(heard, fix(heard), Object.keys(cfg.sites), Object.keys(cfg.apps), front)
  const fixed = got !== heard
  console.log(`${fixed === wantFixed ? 'ok  ' : 'FAIL'} ${String(Math.round(performance.now() - t)).padStart(4)} ms  ${heard.padEnd(38)} -> ${got}`)
}

// "restart video" vs "the third video", with the configured decider: simulang run tools/reading-test3.ts
import { readFileSync } from 'node:fs'
import { pickReading, useDecider } from '../router.ts'
import { makeDecider } from '../decider.ts'

const cfg = JSON.parse(readFileSync(new URL('../commands.json', import.meta.url), 'utf8'))
useDecider(makeDecider(cfg.decider))
const rules = Object.entries(cfg.aliases as Record<string, string>).sort((a, b) => b[0].length - a[0].length)
  .map(([h, m]) => [new RegExp(`\\b${h.replace(/ /g, '\\s+')}\\b`, 'gi'), m] as const)
const fix = (t: string) => rules.reduce((s, [re, m]) => s.replace(re, m), t)
const front = 'ai news - YouTube - Google Chrome'
for (const [heard, want] of [
  ['I like to watch Restart video.', 'third'],
  ['Watch restart video.', 'third'],
  ['Restart video.', 'any'],
  ['Restart the video.', 'restart'],
] as const) {
  const got = await pickReading(heard, fix(heard), Object.keys(cfg.sites), Object.keys(cfg.apps), front)
  const kind = /third/i.test(got) ? 'third' : 'restart'
  console.log(`${want === 'any' || kind === want ? 'ok  ' : 'FAIL'} ${heard.padEnd(32)} -> ${got}`)
}

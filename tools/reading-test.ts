// Checks that name corrections are applied only when they make sense: simulang run tools/reading-test.ts
import { readFileSync } from 'node:fs'
import { pickReading } from '../router.ts'

const cfg = JSON.parse(readFileSync(new URL('../commands.json', import.meta.url), 'utf8'))
const rules = Object.entries(cfg.aliases as Record<string, string>)
  .sort((a, b) => b[0].length - a[0].length)
  .map(([h, m]) => [new RegExp(`\\b${h.replace(/ /g, '\\s+')}\\b`, 'gi'), m] as const)
const fix = (t: string) => rules.reduce((s, [re, m]) => s.replace(re, m), t)

const cases: [string, string, 'LinkedIn' | 'as heard'][] = [
  ['Open the link in this browser.', 'New Tab - Google Chrome', 'LinkedIn'],
  ['Open the Link In in its browser.', 'Google - Google Chrome', 'LinkedIn'],
  ['Click the link in this email.', 'Inbox - Outlook', 'as heard'],
  ['Open the link in the message from Jordan.', 'Alex (DM) - Acme - Slack', 'as heard'],
  ['Go to link in and check my messages.', 'Google - Google Chrome', 'LinkedIn'],
  ['Can you copy the link in the address bar?', 'Feed | LinkedIn - Google Chrome', 'as heard'],
]
for (const [heard, front, want] of cases) {
  const t = performance.now()
  const got = pickReading(heard, fix(heard), Object.keys(cfg.sites), Object.keys(cfg.apps), front)
  const kind = got === heard ? 'as heard' : 'LinkedIn'
  console.log(`${kind === want ? 'ok  ' : 'FAIL'} ${String(Math.round(performance.now() - t)).padStart(4)} ms  [${front}]  ${heard}  ->  ${got}`)
}

// All earlier name-correction cases with the configured decider: simulang run tools/reading-all.ts
import { readFileSync } from 'node:fs'
import { pickReading, useDecider } from '../router.ts'
import { makeDecider } from '../decider.ts'
const cfg = JSON.parse(readFileSync(new URL('../commands.json', import.meta.url), 'utf8'))
useDecider(makeDecider(cfg.decider))
const rules = Object.entries(cfg.aliases as Record<string, string>).sort((a, b) => b[0].length - a[0].length)
  .map(([h, m]) => [new RegExp(`\\b${h.replace(/ /g, '\\s+')}\\b`, 'gi'), m] as const)
const fix = (t: string) => rules.reduce((s, [re, m]) => s.replace(re, m), t)
let fail = 0
for (const [heard, front, want] of [
  ['Click the link in this email.', 'Inbox - Outlook', false], ['Open the link in the message from Jordan.', 'Alex (DM) - Acme - Slack', false],
  ['Go to link in and check my messages.', 'Google - Google Chrome', true], ['Can you copy the link in the address bar?', 'Feed | LinkedIn - Google Chrome', false],
  ['Common is post', 'Feed | LinkedIn - Google Chrome', true], ['Search for the most common AI tools', 'Google - Google Chrome', false],
  ['Open the comet browser', 'Google - Google Chrome', false], ['Comment list post congratulations', 'Feed | LinkedIn - Google Chrome', true],
  ['Search for particle physics lectures', 'Google - Google Chrome', false],
] as const) {
  const got = await pickReading(heard, fix(heard), Object.keys(cfg.sites), Object.keys(cfg.apps), front)
  const ok = (got !== heard) === want; if (!ok) fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${heard.padEnd(44)} -> ${got}`)
}
console.log(fail ? `${fail} failed` : 'all passed')

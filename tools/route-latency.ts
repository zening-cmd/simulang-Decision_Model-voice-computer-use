// Checks Jev routing decisions and latency on sample requests: simulang run tools/route-latency.ts
import { readFileSync } from 'node:fs'
import { route } from '../router.ts'

const cfg = JSON.parse(readFileSync(new URL('../commands.json', import.meta.url), 'utf8'))
const samples = [
  'Find the best pizza. Near me in a Google search',
  'Open Reddit',
  'Can you pull up my email',
  'take me to youtube',
  'what is the weather in San Francisco tomorrow',
  'scroll down a bit',
  'go back to the previous page',
  'I need the calculator',
  'write an email to John saying I will be late',
  'so anyway I was telling her about the trip',
  'type hello world',
]
for (const s of samples) {
  const t = performance.now()
  const r = await route(s, Object.keys(cfg.sites), Object.keys(cfg.apps))
  console.log(`${String(Math.round(performance.now() - t)).padStart(5)} ms  ${s}  ->  ${JSON.stringify(r)}`)
}

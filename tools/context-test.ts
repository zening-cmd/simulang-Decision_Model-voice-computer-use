// Replays the Slack conversation from engine.log through Jev with context: simulang run tools/context-test.ts
import { readFileSync } from 'node:fs'
import { route } from '../router.ts'

const cfg = JSON.parse(readFileSync(new URL('../commands.json', import.meta.url), 'utf8'))
const ctx = { currentApp: 'slack' as string | null, recent: ['Can you open the Slack?'] }
for (const s of [
  'K-find Jordin in a Slack.',
  'I asked you to find Jordan in select.',
  'I asked you to find Jordan in the slack you just opened.',
  "That's really understood my context.",
  'Open YouTube',
]) {
  const t = performance.now()
  const r = route(s, Object.keys(cfg.sites), Object.keys(cfg.apps), ctx)
  console.log(`${String(Math.round(performance.now() - t)).padStart(5)} ms  ${s}  ->  ${JSON.stringify(r)}`)
  ctx.recent = [...ctx.recent, s].slice(-3)
}

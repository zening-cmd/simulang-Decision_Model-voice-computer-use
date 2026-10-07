// Runs one agent task in its own process so voice control keeps listening (and can cancel it).
// Input comes from env: AGENT_TASK (the request) and AGENT_FRONT (title of the window in front).
// Approval protocol: prints "CONFIRM <what>" and waits for a "yes"/"no" line on stdin (no answer in 30 s = no).
import { createInterface } from 'node:readline'
import { runTask } from './agent.ts'

const answers = createInterface({ input: process.stdin })
let waiting: ((ok: boolean) => void) | null = null
answers.on('line', (l) => { waiting?.(l.trim().toLowerCase() === 'yes'); waiting = null })

const confirm = (what: string) => new Promise<boolean>((resolve) => {
  waiting = resolve
  console.log(`CONFIRM ${what}`)
  setTimeout(() => { if (waiting === resolve) { waiting = null; resolve(false) } }, 30_000)
})

try {
  await runTask(process.env.AGENT_TASK ?? '', (l) => console.log(l), process.env.AGENT_FRONT || null, confirm)
} catch (e) {
  console.log(`task failed: ${e instanceof Error ? e.message : e}`)
}
process.exit(0)

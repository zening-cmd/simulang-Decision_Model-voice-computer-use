// Read-only: shows what the agent's observe() offers the model for a window. simulang run tools/probe-observe.ts <title word>
import { Machine } from '@simular-ai/simulang-js'
import { observe } from '../agent.ts'

const word = process.argv[2] ?? 'Partiful'
const win = Machine.local().windows().find((w) => w.title.toLowerCase().includes(word.toLowerCase()))
if (!win) { console.log(`no window with "${word}"`); process.exit(0) }
const c = observe(win.node(), win.boundingBox())
console.log(`${c.length} candidates`)
c.forEach((x, i) => console.log(`i${i} ${x.role}: ${x.label}`))

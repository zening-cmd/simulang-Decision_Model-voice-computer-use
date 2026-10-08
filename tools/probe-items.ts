// Read-only: the items "first / second / third ..." would count on a window. simulang run tools/probe-items.ts <title word>
import { Machine } from '@simular-ai/simulang-js'
import { observe, listItems } from '../agent.ts'

const word = process.argv[2] ?? 'YouTube'
const win = Machine.local().windows().find((w) => w.title.toLowerCase().includes(word.toLowerCase()))
if (!win) { console.log(`no window with "${word}"`); process.exit(0) }
console.log('window:', win.title)
listItems(observe(win.node(), win.boundingBox()), win.boundingBox()).slice(0, 6).forEach((c, i) => console.log(`${i + 1}) ${c.label}`))

// Opens one guest's status dropdown the way the agent does, lists what the agent can see, then presses Escape.
// Never selects an option. Usage: simulang run tools/probe-dropdown.ts <title word> <guest name>
import { Machine, Key, Direction } from '@simular-ai/simulang-js'
import { observe } from '../agent.ts'

const [word = 'Partiful', guest = 'Guest Name'] = process.argv.slice(2)
const machine = Machine.local()
const win = machine.windows().find((w) => w.title.toLowerCase().includes(word.toLowerCase()))
if (!win) { console.log(`no window with "${word}"`); process.exit(0) }
win.focus()
const before = observe(win.node(), win.boundingBox())
const opener = before.find((c) => c.label.includes(`near "${guest}"`))
if (!opener) { console.log(`no button near "${guest}"`); process.exit(0) }
console.log(`opening: ${opener.role}: ${opener.label}`)
try { opener.node.activate() } catch (e) { console.log('activate failed:', e) }
for (const wait of [300, 1000, 2000]) {
  await new Promise((r) => setTimeout(r, wait))
  const now = observe(win.node(), win.boundingBox())
  const added = now.filter((c) => !before.some((b) => b.label === c.label))
  console.log(`after ${wait} ms: ${now.length} elements, new ones: ${added.map((c) => `${c.role}: ${c.label}`).join(' | ') || '(none)'}`)
}
machine.key(Key.Escape, Direction.Click)
console.log('pressed Escape (nothing selected)')

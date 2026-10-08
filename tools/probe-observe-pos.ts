// Read-only: the agent's element list for a window, with each element's on-screen position (top, left).
import { Machine } from '@simular-ai/simulang-js'
import { observe } from '../agent.ts'
const word = process.argv[2] ?? 'YouTube'
const win = Machine.local().windows().find((w) => w.title.toLowerCase().includes(word.toLowerCase()))
if (!win) { console.log(`no window with "${word}"`); process.exit(0) }
console.log('window:', win.title)
observe(win.node(), win.boundingBox()).forEach((c, i) => {
  let pos = ''
  try { const b = c.node.boundingBox(); pos = `top ${Math.round(b.top)} left ${Math.round(b.left)}` } catch {}
  if (c.role === 'link') console.log(`i${i} [${pos}] ${c.role}: ${c.label}`)
})

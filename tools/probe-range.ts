// Read-only: prints every named node in walk-order range [from, to] of the window whose title contains a word.
// Usage: simulang run tools/probe-range.ts <title word> <from> <to>
import { Machine, ariaRoleToString, type AccessibilityNode } from '@simular-ai/simulang-js'

const [word = 'Partiful', from = '520', to = '700'] = process.argv.slice(2)
const win = Machine.local().windows().find((w) => w.title.toLowerCase().includes(word.toLowerCase()))
if (!win) { console.log(`no window with "${word}" in its title`); process.exit(0) }
let order = 0
const walk = (n: AccessibilityNode, depth: number) => {
  order++
  if (order > Number(to)) return
  let role = ''
  try { role = ariaRoleToString(n.role).toLowerCase() } catch {}
  const name = (n.name || n.value || '').replace(/\s+/g, ' ').trim()
  if (order >= Number(from) && name) {
    let actions = ''
    try { actions = n.supportedActions().join(',') } catch {}
    console.log(`#${order} ${'  '.repeat(Math.min(depth, 12))}${role} "${name.slice(0, 50)}"${actions ? ` [${actions}]` : ''}`)
  }
  let kids: AccessibilityNode[] = []
  try { kids = n.children() } catch {}
  for (const k of kids) walk(k, depth + 1)
}
walk(win.node(), 0)

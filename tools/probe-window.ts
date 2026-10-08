// Read-only: lists dialogs and matching buttons in the window whose title contains a word, plus where they sit
// in the walk order. Usage: simulang run tools/probe-window.ts <title word> <label regex>
import { Machine, ariaRoleToString, type AccessibilityNode } from '@simular-ai/simulang-js'

const [word = 'Partiful', pattern = 'pending|approve'] = process.argv.slice(2)
const win = Machine.local().windows().find((w) => w.title.toLowerCase().includes(word.toLowerCase()))
if (!win) { console.log(`no window with "${word}" in its title`); process.exit(0) }
console.log('window:', win.title)
const re = new RegExp(pattern, 'i')
let order = 0
const walk = (n: AccessibilityNode, depth: number, inDialog: boolean) => {
  if (order > 8000 || depth > 50) return
  order++
  let role = ''
  try { role = ariaRoleToString(n.role).toLowerCase() } catch {}
  const name = (n.name || '').replace(/\s+/g, ' ').trim()
  const dialog = role === 'dialog' || role === 'alertdialog'
  if (dialog) console.log(`#${order} DIALOG "${name.slice(0, 60)}" visible=${n.isVisible}`)
  else if (re.test(name) && ['button', 'menuitem', 'option', 'link', 'radio', 'checkbox'].includes(role))
    console.log(`#${order} ${inDialog ? '[in dialog] ' : ''}${role} "${name.slice(0, 60)}"`)
  let kids: AccessibilityNode[] = []
  try { kids = n.children() } catch {}
  for (const k of kids) walk(k, depth + 1, inDialog || dialog)
}
walk(win.node(), 0, false)
console.log('nodes walked:', order)

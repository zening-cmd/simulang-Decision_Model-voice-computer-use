// Read-only: lists grounding models and locates a described element on a window's screenshot (no click).
// Usage: simulang run tools/ground-test.ts "<window title word>" "<what to find>"
import { Machine, GroundingModel } from '@simular-ai/simulang-js'

const [word = 'Chrome', concept = 'the browser address bar'] = process.argv.slice(2)
console.log('grounding aliases:', GroundingModel.availableAliases().join(', '))
const win = Machine.local().windows().find((w) => w.title.toLowerCase().includes(word.toLowerCase()))
if (!win) { console.log(`no window with "${word}"`); process.exit(0) }
const b = win.boundingBox()
console.log(`window: ${win.title}  (left ${b.left}, top ${b.top}, ${b.width}x${b.height})`)
for (const alias of ['default', ...GroundingModel.availableAliases().filter((a) => /openrouter|tars|venus|qwen|gpt|claude/i.test(a)).slice(0, 4)]) {
  let model: GroundingModel
  try { model = alias === 'default' ? GroundingModel.default() : GroundingModel.byAlias(alias); model.checkAuth() } catch (e) { console.log(`${alias}: unavailable (${String(e).slice(0, 90)})`); continue }
  const shot = win.screenshot(true)
  const t = performance.now()
  try {
    const [x, y] = shot.ground(model, concept)
    console.log(`${alias.padEnd(28)} ${model.name.padEnd(36)} ${Math.round(performance.now() - t)} ms -> (${x}, ${y})  = ${Math.round((x - b.left) / b.width * 100)}%,${Math.round((y - b.top) / b.height * 100)}% of the window`)
  } catch (e) { console.log(`${alias}: failed (${String(e).slice(0, 120)})`) }
}

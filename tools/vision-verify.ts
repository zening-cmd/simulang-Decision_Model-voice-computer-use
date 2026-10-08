// Read-only: asks the vision model whether a goal is already achieved on a window right now. Nothing is clicked.
import { readFileSync } from 'node:fs'
import { Machine, QuestionKind } from '@simular-ai/simulang-js'
import { screenshotOf } from '../agent.ts'
import { makeDecider } from '../decider.ts'
const [word = 'Chrome', goal = 'A video is playing'] = process.argv.slice(2)
const d = makeDecider(JSON.parse(readFileSync(new URL('../commands.json', import.meta.url), 'utf8')).decider)
const win = Machine.local().windows().find((w) => w.title.toLowerCase().includes(word.toLowerCase()))
if (!win) { console.log(`no window with "${word}"`); process.exit(0) }
const shot = screenshotOf(win)
const t = performance.now()
const a = await d.decide({ goal }, { achieved: { kind: QuestionKind.Noul, instructions: `The image shows the window. Judging only from what is visible, is this true: "${goal}"?` } }, shot ? [shot] : [])
console.log(`${Math.round(performance.now() - t)} ms  [${win.title}]  "${goal}" -> ${a.achieved.probability.toFixed(2)}  (screenshot ${shot ? Math.round(shot.length * 0.75 / 1024) + ' KB' : 'missing'})`)

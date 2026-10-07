// Checks the agent's planner on requests from the log (no UI actions): simulang run tools/plan-test.ts
import { planTask } from '../agent.ts'

const front = 'Feed | LinkedIn - Google Chrome'
for (const task of [
  'I like this post.',
  'Can you click like for me for this post?',
  'Release PowerPoint.',
  'open youtube and play lofi music',
  'open notepad and write hello from voice control',
]) {
  const t = performance.now()
  console.log(`${Math.round(performance.now() - t + 0)}`.padStart(0), task, '->', JSON.stringify(planTask(task, front)), `${Math.round(performance.now() - t)} ms`)
}

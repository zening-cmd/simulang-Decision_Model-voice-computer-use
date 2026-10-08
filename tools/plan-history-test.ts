// Planner with history: simulang run tools/plan-history-test.ts
import { planTask } from '../agent.ts'
const front = 'Sample Event: Art Night | Partiful - Google Chrome'
const history = ['"There are a few guests still pending. Can you help me approve all of them?" -> stopped: clicking button "Pending (near Guest A)" is not making progress']
for (const t of ['Please approve for all of them. You just approve one.', 'Who are still pending?',
  'Why you do not click on pending. Retry - last attempt ended with "done"; the user says: "Why you do not click on pending?"'])
  console.log(t.slice(0, 60), '->', JSON.stringify(planTask(t, front, history)))

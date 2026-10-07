import { planTask } from '../agent.ts'
for (const t of ['Can you comment in this post?', 'comment on this post: great idea, thanks for sharing']) console.log(t, '->', JSON.stringify(planTask(t, 'Feed | LinkedIn - Google Chrome')))

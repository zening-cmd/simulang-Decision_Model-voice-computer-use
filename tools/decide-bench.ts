// Jev vs OpenAI Decisions API on the same decisions: simulang run tools/decide-bench.ts
// Routing + name corrections go through the real router code; element choices use the agent's question shape.
import { readFileSync } from 'node:fs'
import { DecisionModel, QuestionKind } from '@simular-ai/simulang-js'
import { route, pickReading, useDecider } from '../router.ts'
import { openaiDecide } from '../openai-decider.ts'

const cfg = JSON.parse(readFileSync(new URL('../commands.json', import.meta.url), 'utf8'))
const sites = Object.keys(cfg.sites), apps = Object.keys(cfg.apps)
const rules = Object.entries(cfg.aliases as Record<string, string>).sort((a, b) => b[0].length - a[0].length)
  .map(([h, m]) => [new RegExp(`\\b${h.replace(/ /g, '\\s+')}\\b`, 'gi'), m] as const)
const fix = (t: string) => rules.reduce((s, [re, m]) => s.replace(re, m), t)

// [request, window in front, accepted results]
const ROUTING: [string, string | null, string[]][] = [
  ['Find the best pizza. Near me in a Google search', null, ['search']],
  ['what is the weather in San Francisco tomorrow', null, ['search']],
  ['scroll down a bit', null, ['key:scroll down']],
  ['go back to the previous page', null, ['key:go back']],
  ['Can you pull up my email', null, ['app:outlook', 'site:gmail']],
  ['write an email to John saying I will be late', null, ['task']],
  ['so anyway I was telling her about the trip', null, ['ignore']],
  ['type hello world', null, ['type']],
  ['Open Reddit', null, ['url']],
  ['Many minds in the window.', 'YouTube - Google Chrome', ['ignore']],
  ['Help me to open the second video.', 'ai news - YouTube - Google Chrome', ['task']],
  ['Like this post.', 'Feed | LinkedIn - Google Chrome', ['task']],
  ['Comment is post, congratulations.', 'Feed | LinkedIn - Google Chrome', ['task']],
  ['Can you like the post in this LinkedIn page?', 'Feed | LinkedIn - Google Chrome', ['task']],
  ['I asked you to find Jordan in select.', 'Alex (DM) - Acme - Slack', ['task']],
  ["That's really understood my context.", 'Feed | LinkedIn - Google Chrome', ['ignore']],
]
// [as heard, window in front, should the name correction be used?]
const READINGS: [string, string, boolean][] = [
  ['Open the link in this browser and check messages.', 'New Tab - Google Chrome', true],
  ['Click the link in this email.', 'Inbox - Outlook', false],
  ['Open the link in the message from Jordan.', 'Alex (DM) - Acme - Slack', false],
  ['Go to link in and check my messages.', 'Google - Google Chrome', true],
  ['Can you copy the link in the address bar?', 'Feed | LinkedIn - Google Chrome', false],
  ['Common is post', 'Feed | LinkedIn - Google Chrome', true],
  ['Comment is post congratulations', 'Feed | LinkedIn - Google Chrome', true],
  ['Comment list post congratulations', 'Feed | LinkedIn - Google Chrome', true],
  ['Common this post, great idea', 'Feed | LinkedIn - Google Chrome', true],
  ['Search for the most common AI tools', 'Google - Google Chrome', false],
  ['Open the comet browser', 'Google - Google Chrome', false],
  ['Search for git hub copilot pricing', 'Google - Google Chrome', true],
]
// Agent step decisions, shaped like agent.ts
const LINKEDIN = ['button: Home', 'button: My Network', 'button: Messaging', 'link: Sam Lee', 'button: Follow',
  'button: Reaction button state: no reaction', 'button: Comment', 'button: Repost', 'button: Send in a private message',
  'textbox: Search = ""', 'button: Open control menu for post by Sam Lee']
const LINKEDIN_COMMENTING = [...LINKEDIN, 'textbox: Text editor for creating comment = "Add a comment..."', 'button: Open Emoji Keyboard']
const YOUTUBE = ['link: YouTube Home', 'combobox: Search = "ai news"', 'button: Search',
  'link: AI News Today: OpenAI Dots Launch 12:04', 'link: Sam Altman Goes Viral With His Most Explosive AI Statement 1',
  'link: GPT-7 Bel First Preview, Mythos 5.1 Access 25:15', 'button: Action menu']
const AGENT: { name: string; goal: string; text?: string; done?: string[]; title: string; els: string[]; want: { target?: string; action?: string; doneOver?: number } }[] = [
  { name: 'like the post', goal: 'Like the post on LinkedIn.', title: 'Feed | LinkedIn - Google Chrome', els: LINKEDIN, want: { target: 'Reaction button', action: 'click' } },
  { name: 'type comment', goal: 'Comment on the post', text: 'Congratulations.', title: 'Feed | LinkedIn - Google Chrome', els: LINKEDIN_COMMENTING, want: { target: 'Text editor for creating comment', action: 'type' } },
  { name: 'open 2nd video', goal: 'Open the second video on YouTube.', title: 'ai news - YouTube - Google Chrome', els: YOUTUBE, want: { target: 'Sam Altman', action: 'click' } },
  { name: 'like already done', goal: 'Like the post on LinkedIn.', done: ['clicked button "Reaction button state: no reaction"'], title: 'Feed | LinkedIn - Google Chrome', els: LINKEDIN, want: { doneOver: 0.5 } },
]
const agentQuestions = (goal: string, options: Record<string, string>) => ({
  target: { kind: QuestionKind.Choice, instructions: `Which single element should be acted on next to accomplish: ${goal}`, options },
  action: { kind: QuestionKind.Choice, instructions: 'What is the next action?', options: {
    click: 'Click / activate the chosen element', type: 'Put text_to_type into the chosen text field',
    submit: 'Press Enter in the chosen field (submits forms, sends messages)', clear: 'Erase the text in the chosen text field',
    done: 'The goal is already achieved', stop: 'Cannot make progress or needs the user' } },
  done: { kind: QuestionKind.Noul, instructions: `Given actions_already_done and the screen, is the goal already achieved? Goal: ${goal}` },
  risk: { kind: QuestionKind.Noul, instructions: 'Does the next action need explicit user confirmation (delete data, send/submit a message or form, pay/subscribe, change permissions or settings, upload/share, enter credentials, install software)?' },
})

type Decider = { decide(state: unknown, q: any): any }
const jev = DecisionModel.openrouterJev()
const providers: [string, Decider][] = [
  ['Jev (jev-1.13)', jev],
  ['OpenAI (gpt-6-luna)', { decide: (s: unknown, q: any) => openaiDecide(s, q) }],
]
const intentKey = (r: any) => r.kind === 'site' || r.kind === 'app' || r.kind === 'key' ? `${r.kind}:${r.name}` : r.kind

const summary: string[] = []
for (const [label, d] of providers) {
  useDecider(d as any)
  try { await d.decide('warm up', { ok: { kind: QuestionKind.Noul, instructions: 'Is this text?' } }) } catch (e) { console.log(`${label} warm-up failed: ${e}`) }
  console.log(`\n===== ${label} =====`)
  const times: number[] = []
  let right = 0, total = 0
  const timed = async <T>(f: () => Promise<T> | T) => { const t = performance.now(); const v = await f(); times.push(performance.now() - t); return v }
  for (const [text, front, ok] of ROUTING) {
    total++
    try {
      const r = await timed(() => route(text, sites, apps, { currentApp: front, recent: [] }))
      const good = ok.includes(intentKey(r)); if (good) right++
      console.log(`${good ? 'ok  ' : 'MISS'} route    ${Math.round(times.at(-1)!)}ms  ${text} -> ${intentKey(r)}`)
    } catch (e) { console.log(`ERR  route    ${text}: ${e}`) }
  }
  for (const [heard, front, wantFixed] of READINGS) {
    total++
    try {
      const got = await timed(() => pickReading(heard, fix(heard), sites, apps, front))
      const good = (got !== heard) === wantFixed; if (good) right++
      console.log(`${good ? 'ok  ' : 'MISS'} reading  ${Math.round(times.at(-1)!)}ms  ${heard} -> ${got}`)
    } catch (e) { console.log(`ERR  reading  ${heard}: ${e}`) }
  }
  for (const c of AGENT) {
    total++
    const options: Record<string, string> = {}; c.els.forEach((e, i) => (options[`i${i}`] = e))
    const state = { goal: c.goal, window_title: c.title, text_to_type: c.text ?? null, actions_already_done: c.done ?? [], elements: options }
    try {
      const a = await timed(() => d.decide(state, agentQuestions(c.goal, options)))
      const target = c.els[Number(String(a.target.choice).slice(1))] ?? '?'
      const good = c.want.doneOver !== undefined
        ? a.done.probability > c.want.doneOver || a.action.choice === 'done'
        : target.includes(c.want.target!) && a.action.choice === c.want.action
      if (good) right++
      console.log(`${good ? 'ok  ' : 'MISS'} agent    ${Math.round(times.at(-1)!)}ms  ${c.name}: ${a.action.choice} -> ${target} (done ${a.done.probability.toFixed(2)}, risk ${a.risk.probability.toFixed(2)})`)
    } catch (e) { console.log(`ERR  agent    ${c.name}: ${e}`) }
  }
  const sorted = [...times].sort((x, y) => x - y)
  const pct = (p: number) => Math.round(sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? NaN)
  summary.push(`${label.padEnd(22)} accuracy ${right}/${total}   latency median ${pct(0.5)} ms, p90 ${pct(0.9)} ms, max ${Math.round(sorted.at(-1) ?? NaN)} ms`)
}
console.log('\n===== summary =====\n' + summary.join('\n'))

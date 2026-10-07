// Free-form task agent: an LLM picks the starting app/site, then Jev chooses each on-screen element
// from the focused window's accessibility tree, and Simulang performs the action.
import {
  Machine, AskModel, DecisionModel, QuestionKind, FocusPolicy, Visibility, Key, Direction, Coordinate, Button,
  ariaRoleToString, type AccessibilityNode, type BoundingBox, type Window,
} from '@simular-ai/simulang-js'

const MAX_STEPS = 8
const RISK_STOP = 0.3 // above this Jev thinks the action needs a human (send, delete, pay, credentials...)
const ACTIONABLE = new Set(['button', 'link', 'menuitem', 'tab', 'textbox', 'searchbox', 'combobox',
  'checkbox', 'radio', 'listitem', 'option', 'treeitem', 'switch', 'cell', 'gridcell', 'document', 'textarea', 'edit'])
const EDITABLE = new Set(['textbox', 'searchbox', 'combobox', 'document', 'textarea', 'edit'])

const machine = Machine.local()
const llm = AskModel.default()
const jev = DecisionModel.openrouterJev()
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

type Candidate = { node: AccessibilityNode; role: string; label: string }

// Collect enabled, actionable elements under root that are on screen inside the window (bounded walk),
// so long pages like a LinkedIn feed offer the posts you can see, not the whole page. Text fields show their value.
function observe(root: AccessibilityNode, view?: BoundingBox, limit = 120): Candidate[] {
  const out: Candidate[] = []
  let visited = 0
  const onScreen = (n: AccessibilityNode) => {
    if (!view) return true
    try { const b = n.boundingBox(); return b.width > 0 && b.height > 0 && b.bottom > view.top && b.top < view.bottom && b.right > view.left && b.left < view.right } catch { return false }
  }
  const walk = (n: AccessibilityNode, depth: number) => {
    if (out.length >= limit || visited++ > 5000 || depth > 40) return
    let role = ''
    try { role = ariaRoleToString(n.role).toLowerCase() } catch {}
    const clean = (s: string) => (s || '').replace(/\s+/g, ' ').trim()
    let label = clean(n.name || n.description).slice(0, 60)
    // An unnamed "document" is a whole web page, not a text field; named ones are real editors ("Text editor").
    if (role === 'document' && !label) label = ''
    else if (EDITABLE.has(role)) label = `${label || 'text field'} = "${clean(n.value).slice(0, 60)}"`
    else if (!label) label = clean(n.value).slice(0, 60)
    if (ACTIONABLE.has(role) && label && n.isEnabled && n.isVisible !== false && onScreen(n)) out.push({ node: n, role, label })
    let kids: AccessibilityNode[] = []
    try { kids = n.children() } catch {}
    for (const k of kids) walk(k, depth + 1)
  }
  walk(root, 0)
  return out
}

function press(key: Key) { machine.key(key, Direction.Click) }

// A real mouse click on an element; falls back to focusing it when it has no clickable point.
function clickNode(node: AccessibilityNode) {
  try {
    const [x, y] = node.clickablePoint(true)
    machine.moveMouse(x, y, Coordinate.Abs); machine.mouseButton(Button.Left, Direction.Click)
  } catch { node.focus() }
}

// The window the user is looking at (skipping our own status badge).
function frontWindow() {
  const ours = (t: string) => !t || t.startsWith('Voice Control')
  const w = machine.focusedWindow()
  if (w && !ours(w.title)) return w
  return machine.windows().find((x) => !ours(x.title) && !x.isMinimized()) ?? null
}

// Does the request itself name this app/site? Guards against the planner inventing one.
function mentions(task: string, name: string) {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '')
  const t = norm(task), n = norm(name.replace(/^https?:\/\/(www\.)?/, '').replace(/\.[a-z]+(\/.*)?$/, ''))
  return n.length >= 3 && t.includes(n)
}

/** Asks the user to approve an irreversible step (post, send, delete...). Resolves true only on a clear yes. */
export type Confirm = (what: string) => Promise<boolean>

export async function runTask(task: string, log: (s: string) => void, front: string | null = frontWindow()?.title ?? null,
  confirm: Confirm = async () => false) {
  const plan = planTask(task, front)
  log(`plan: ${JSON.stringify(plan)}`)
  // Writing something needs the words to write; don't open an empty comment box and guess.
  const writing = /\b(?:comment|reply|respond|write|type|tweet|email|text|dm|send (?:a |him |her |them |me )?(?:message|note|dm))\b/i.test(task)
  // "Post the comment" / "click comment" / "send it": the text is already in a box; just publish it.
  // Must START with the verb: "comment on this post" contains "post" but asks for a new comment.
  const submitOnly = !plan.text && /^\W*(?:please\s+|can you\s+|now\s+)?(?:post|send|submit|publish|click|hit|press)\b/i.test(task) && /\b(?:comment|reply|message|it|this)\b/i.test(task)
  if (!plan.text && writing && !submitOnly && !/\b(?:open|go to|delete|remove|clear|erase|undo|edit)\b/i.test(task))
    return log('NEED_TEXT what should it say?')

  // Open what the request names (without waiting on windows that may never appear), else use the window in front.
  if (plan.url) machine.defaultBrowser().open(plan.url, FocusPolicy.Steal, Visibility.Show, false)
  else if (plan.app) machine.fuzzyApp(plan.app).open(null, FocusPolicy.Steal, Visibility.Show, false)
  if (!plan.goal) return log('done')
  await sleep(plan.url || plan.app ? 2000 : 300)
  const win = frontWindow()
  if (!win) return log('no window to work in; stopping')
  win.focus()
  log(`working in: ${win.title}`)
  await jevLoop(win, plan, log, confirm, submitOnly)
}

// 1. Plan the starting point: the window in front (default), or an app/site the request names.
export function planTask(task: string, front: string | null) {
  const plan = llm.askJson(
    (front ? `The window in front is "${front}". ` : '') +
    `A user said this voice command for their Windows PC: "${task}". Speech-to-text may mishear words; fix obvious ` +
    `mistakes. Decide where to start. If the request refers to what is on screen ("this post", "this page", "it") or ` +
    `does not name an app or website, use neither and act in the window in front. Only set "url" (prefer a direct URL ` +
    `such as a search results page) or "app" (a desktop program name) when the request asks to open that app/site. ` +
    `"goal" restates what must happen on screen, or "" if opening it already completes the task. ` +
    `"text" is any literal text the user wants typed, else "".`,
    null, null,
    { type: 'object', properties: { url: { type: 'string' }, app: { type: 'string' }, goal: { type: 'string' }, text: { type: 'string' } },
      required: ['url', 'app', 'goal', 'text'], additionalProperties: false },
  ) as { url: string; app: string; goal: string; text: string }
  if (plan.app && !mentions(task, plan.app)) plan.app = ''
  if (plan.url && !mentions(task, plan.url) && !/search/i.test(task)) plan.url = ''
  if (!plan.app && !plan.url && !plan.goal) plan.goal = task
  // Literal text comes from the user's own words, not the model's paraphrase ("hello from voice control", not "hello").
  const said = task.match(/\b(?:comment|reply|write|type|saying|say|enter)\b[^:]*:\s*["']?(.+?)["']?[.!?]?$/i) // "comment on this post: great idea"
    ?? task.match(/\b(?:write|type|saying|say|enter)\s+["']?(.+?)["']?[.!?]?$/i)
  if (plan.text && said) plan.text = said[1]
  return plan
}

// 2. Jev loop on that window.
async function jevLoop(win: Window, plan: { goal: string; text: string }, log: (s: string) => void, confirm: Confirm, submitOnly = false) {
  // What this task has already done. Jev sees it (so a liked post counts as done), and it blocks repeat clicks:
  // buttons like Like are toggles whose name doesn't change, so a second click would undo the first.
  const done: string[] = []
  const clicked = new Set<string>()
  // "Like this post", "click Follow": one click and finished.
  // Also "open/play/watch the second video": clicking the item on the page is the whole job.
  const oneClick = /^(?:click|like|press|tap|hit|select|choose|react|follow|unfollow|open|play|watch|view|show|start)\b/i.test(plan.goal.trim()) && !/\b(?:and|then)\b/i.test(plan.goal)
  let typed = ''
  let typedBox: BoundingBox | null = null // where we typed, to find the matching Post/Comment button
  if (submitOnly) {
    // Publish text the user already has in a box: find the editor holding real text (not a placeholder).
    const editor = observe(win.node(), win.boundingBox()).find((c) => EDITABLE.has(c.role) && c.node.value.trim() &&
      !/^(?:add a|write a|type a|start a|message|reply|search)/i.test(c.node.value.trim()))
    if (!editor) return log('stopped: no text box with text to post on screen')
    typed = editor.node.value.trim().slice(0, 80)
    try { typedBox = editor.node.boundingBox() } catch {}
  }
  for (let step = 1; step <= MAX_STEPS; step++) {
    const cands = observe(win.node(), win.boundingBox())
    if (!cands.length) return log('no clickable elements found; stopping')
    // Once the text is typed, publishing is one specific button (Comment / Post / Reply / Send). Pick it directly
    // rather than asking Jev, and ask the user in plain words what will happen.
    if (typed && typedBox) {
      // Several buttons can share the name (LinkedIn: the "Comment" icon under every post vs. the blue "Comment"
      // that publishes). The publishing one sits next to the box we typed into, so take the nearest.
      const box = typedBox
      const dist = (c: Candidate) => { try { return c.node.boundingBox().shortestDistanceTo(box) } catch { return Infinity } }
      const submit = cands
        .filter((c) => c.role === 'button' && /^(?:comment|post|reply|send|submit|publish|send now|save)$/i.test(c.label))
        .map((c) => ({ c, d: dist(c) })).filter((x) => x.d < 150).sort((a, b) => a.d - b.d)[0]?.c
      if (submit) {
        const verb = /comment|reply/i.test(submit.label) ? `post ${submit.label.toLowerCase()}` : submit.label.toLowerCase()
        if (!(await confirm(`${verb}: "${typed}"`))) return log(`stopped: not confirmed - your text is still in the box`)
        clickNode(submit.node)
        await sleep(1500)
        // Posted means the box we typed into no longer holds the text.
        const still = observe(win.node(), win.boundingBox()).some((c) => EDITABLE.has(c.role) && c.label.includes(typed.slice(0, 20)))
        return log(still ? `clicked "${submit.label}" but the text is still in the box - please check` : `done (${verb})`)
      }
    }
    const options: Record<string, string> = {}
    cands.forEach((c, i) => (options[`i${i}`] = `${c.role}: ${c.label}`))
    // The current title shows where earlier clicks led (e.g. the video that is now playing).
    let title = ''
    try { title = win.title } catch {}
    const state = { goal: plan.goal, window_title: title, text_to_type: plan.text || null, actions_already_done: done, elements: options }
    const a = jev.decide(state, {
      target: { kind: QuestionKind.Choice, instructions: `Which single element should be acted on next to accomplish: ${plan.goal}`, options },
      action: { kind: QuestionKind.Choice, instructions: 'What is the next action?', options: {
        click: 'Click / activate the chosen element',
        type: 'Put text_to_type into the chosen text field',
        submit: 'Press Enter in the chosen field (submits forms, sends messages)',
        clear: 'Erase the text in the chosen text field (delete an unsent draft)',
        done: 'The goal is already achieved',
        stop: 'Cannot make progress or needs the user',
      } },
      done: { kind: QuestionKind.Noul, instructions: `Given actions_already_done and the screen, is the goal already achieved? A single click on the right element (e.g. Like) achieves a one-click goal. Goal: ${plan.goal}` },
      risk: { kind: QuestionKind.Noul, instructions: 'Does the next action need explicit user confirmation (delete data, send/submit a message or form, pay/subscribe, change permissions or settings, upload/share, enter credentials, install software)?' },
    })
    const target = cands[Number(a.target.choice.slice(1))]
    log(`step ${step}: ${a.action.choice} -> ${target ? `${target.role} "${target.label}"` : '?'} (done ${a.done.probability.toFixed(2)}, risk ${a.risk.probability.toFixed(2)})`)

    if (a.action.choice === 'done' || a.done.probability > 0.7) return log('done')
    if (a.action.choice === 'stop' || !target) return log('stopped: no confident next step')
    // Text only goes into real text fields. "Type into the Comment button" means open the box first: click it
    // and keep the text. (Keystrokes on a button are dangerous: each space clicks it.)
    let action = a.action.choice
    if (action === 'type' && !EDITABLE.has(target.role)) action = 'click'
    if (action === 'type' && !plan.text) return log('done (text already typed)')
    if (action === 'clear' && !EDITABLE.has(target.role)) return log('stopped: can only clear a text field')
    const key = `${target.role}:${target.label}`.toLowerCase()
    if (action === 'click' && clicked.has(key)) return log(`done (already clicked ${target.role} "${target.label}"; not clicking again)`)
    // Typing is a draft and can be edited, so it never needs approval. Clicking or pressing Enter can publish,
    // send, delete or pay: when Jev rates it sensitive, the user has to say yes first.
    // Before anything is typed, a click like "Comment" only opens a box; after typing, the same button publishes.
    const typedSomething = done.some((d) => d.startsWith('typed'))
    const destructive = /\b(?:delete|remove|send|post|publish|submit|pay|buy|purchase|order|checkout|transfer|unsubscribe|sign out|log ?out|install|share)\b/i.test(target.label)
    const canPublish = action === 'submit' || typedSomething || destructive
    if (action !== 'type' && action !== 'clear' && a.risk.probability > RISK_STOP && canPublish) {
      const what = `${action === 'submit' ? 'press Enter in' : 'click'} ${target.role} "${target.label}"`
      if (!(await confirm(what))) return log(`stopped: not confirmed (${what})`)
      log('confirmed')
    }

    if (action === 'type') {
      // Click into the field, then type like a person: works for plain inputs and rich editors (LinkedIn, Slack).
      clickNode(target.node)
      await sleep(250)
      machine.typeText(plan.text)
      typed = plan.text
      try { typedBox = target.node.boundingBox() } catch {}
      plan.text = '' // typed once
      clicked.clear() // after typing, "Comment"/"Send" is a new action (posting), not a repeat of opening the box
    } else if (action === 'clear') {
      // Unsent text only (a text field); deleting a sent message is a click on Delete and goes through approval.
      clickNode(target.node)
      await sleep(150)
      machine.key(Key.Control, Direction.Press); machine.keyUnicode('a', Direction.Click); machine.key(Key.Control, Direction.Release)
      press(Key.Delete)
    } else if (action === 'submit') {
      target.node.focus(); press(Key.Return) // Enter can send/submit, so it only runs after the risk check above
    } else {
      try { target.node.activate() } catch { clickNode(target.node) }
    }
    done.push(action === 'clear' ? `cleared ${target.role} "${target.label}"` : action === 'type' ? `typed into ${target.role} "${target.label}"` : `${action === 'submit' ? 'pressed Enter in' : 'clicked'} ${target.role} "${target.label}"`)
    if (action === 'click') clicked.add(key)
    if (action === 'click' && oneClick) return log('done')
    await sleep(1200)
  }
  log('stopped: step limit reached')
}

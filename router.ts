// Intent router: Jev classifies any spoken request into one fast action; Simulang then runs it.
// Only multi-step requests fall through to the slower agent (agent.ts).
import { DecisionModel, QuestionKind } from '@simular-ai/simulang-js'

export type Intent =
  | { kind: 'search'; query: string }
  | { kind: 'site'; name: string }
  | { kind: 'app'; name: string }
  | { kind: 'url'; url: string }
  | { kind: 'key'; name: string }
  | { kind: 'type'; text: string }
  | { kind: 'task'; text: string }
  | { kind: 'ignore' }

// Below this, Jev thinks a phrase is garbled speech, not an instruction. Low on purpose: slightly garbled but clear
// requests ("comment is post, congratulations") must still work.
const SENSIBLE_MIN = 0.12
export let lastSensible = 1

const KEYS = ['new tab', 'close tab', 'next tab', 'previous tab', 'go back', 'go forward', 'refresh',
  'scroll down', 'scroll up', 'press enter', 'stop listening', 'maximize window', 'minimize window']

let jev: DecisionModel | null = null
export function warm() { jev ??= DecisionModel.openrouterJev() }

// Pull the search terms out of a request like "find the best pizza near me in a google search".
export function searchQuery(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9' ]+/g, ' ')
    .replace(/\b(?:(?:in|on|with|using) (?:a |the )?(?:google|web|internet|browser)(?: search)?|on the web|online)\b/g, ' ')
    .replace(/^\s*(?:(?:hey|okay|ok|please|can you|could you|i want to|i'd like to)\s+)*/, '')
    .replace(/^(?:do a |run a )?(?:google|search|search for|look up|look for|find(?: me)?|show me|what is|what's|who is)\s+/, (m) => (/what|who/.test(m) ? m : ''))
    .replace(/\s+/g, ' ').trim()
}

// Words after "open"/"go to"/"launch" etc., when the request is that simple.
function target(text: string) {
  const m = text.toLowerCase().replace(/[^a-z0-9.' ]+/g, ' ').trim()
    .match(/^(?:please\s+)?(?:open(?: up)?|go to|launch|start|bring up|take me to|navigate to)\s+(?:the |a |my )?(.+?)(?:\s+(?:app|website|site|page|please))?$/)
  return m ? m[1].trim() : null
}

/** What the user has been doing, so follow-ups ("find Jordan in it") make sense. */
export type Context = { currentApp: string | null; recent: string[] }

// True for "open linkedin", "can you pull up linkedin please", "I need the calculator", "take me to youtube";
// false when anything beyond opening is asked ("like the post in this linkedin page").
export function isJustOpening(text: string, name: string) {
  const words = text.toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').split(/\s+/).filter(Boolean)
  const filler = new Set(['can', 'could', 'would', 'you', 'please', 'hey', 'okay', 'ok', 'i', 'need', 'want', 'to',
    'the', 'a', 'my', 'me', 'up', 'open', 'opening', 'launch', 'start', 'go', 'take', 'bring', 'pull', 'show',
    'get', 'navigate', 'switch', 'app', 'website', 'site', 'page', 'for', 'now', 'just', 'quickly', 'in', 'browser',
    'new', 'tab', 'let', "let's", 'lets', 'us', 'on', 'this', 'that', 'it', 'its', "it's", 'current', 'here', 'there', 'chrome',
    'edge', 'window', 'with', 'using', 'an', 'and', 'of'])
  const nameWords = new Set(name.toLowerCase().split(/\s+/))
  // Allow speech-to-text variants of the name ("linking" for linkedin) by prefix.
  const shared = (a: string, b: string) => { let i = 0; while (i < a.length && a[i] === b[i]) i++; return i }
  const isName = (w: string) => nameWords.has(w) || [...nameWords].some((n) => n.length > 4 && shared(w, n) >= 4)
  const hasWholeName = [...nameWords].every((n) => words.some((w) => w === n || (n.length > 4 && shared(w, n) >= 4)))
  return hasWholeName && words.every((w) => filler.has(w) || isName(w))
}

// Speech-to-text often hears a name as ordinary words ("LinkedIn" -> "link in"). Given the literal transcript and the
// name-corrected one, keep whichever the user most plausibly said; never rewrite blindly.
export function pickReading(heard: string, corrected: string, sites: string[], apps: string[], front: string | null): string {
  if (heard === corrected) return heard
  // The corrected sentence is a clear "open <name>" request: no model call needed.
  if ([...sites, ...apps].some((n) => isJustOpening(corrected, n))) return corrected
  jev ??= DecisionModel.openrouterJev()
  const a = jev.decide({ window_in_front: front, as_heard: heard, with_name: corrected }, {
    reading: { kind: QuestionKind.Choice, options: { as_heard: heard, with_name: corrected }, instructions:
      'A voice command to a PC was transcribed by speech-to-text, which can mishear a product name as ordinary words ' +
      '(e.g. "LinkedIn" as "link in", "comment" as "common"). Given the window in front, which version did the user ' +
      'actually say? Keep as_heard when it already makes sense as an instruction (a real product, place or phrase).' },
  })
  return a.reading.choice === 'with_name' ? corrected : heard
}

export function route(text: string, sites: string[], apps: string[], ctx: Context = { currentApp: null, recent: [] }): Intent {
  if (!/[a-z0-9]/i.test(text)) return { kind: 'ignore' }
  // Plain "open <known name>" needs no model call.
  for (const s of sites) if (isJustOpening(text, s)) return { kind: 'site', name: s }
  for (const a of apps) if (isJustOpening(text, a)) return { kind: 'app', name: a }
  jev ??= DecisionModel.openrouterJev()
  const options: Record<string, string> = {
    search: 'Search the web / Google for information (questions, finding places, products, facts)',
    open_other_website: 'Open a website that is not in this list',
    type: 'Type or write some text into the current window (dictation)',
    task: 'Do something INSIDE an app or site (find a person or message, click, fill, send, navigate within it), ' +
      'including follow-ups about the app that is already open, or any multi-step job',
    ignore: 'Not a request to the computer (chatter, background talk, noise, complaints about the assistant)',
  }
  for (const s of sites) options[`site:${s}`] = `Only open/launch the ${s} website, nothing more`
  for (const a of apps) options[`app:${a}`] = `Only open/launch the ${a} app, nothing more`
  for (const k of KEYS) options[`key:${k}`] = `Browser/keyboard action: ${k}`
  const state = { request: text, app_already_open: ctx.currentApp, previous_requests: ctx.recent }
  const a = jev.decide(state, {
    intent: { kind: QuestionKind.Choice, options, instructions:
      'A user spoke this request to their Windows PC. Which single action fulfills it? ' +
      'If the request asks to do something inside an app (especially the one already open), choose task, not opening it again.' },
    sensible: { kind: QuestionKind.Noul, instructions:
      'Is this a clear, sensible instruction to a computer (not a garbled speech-to-text fragment like "many minds in the window")?' },
  })
  const c = a.intent.choice
  lastSensible = a.sensible.probability
  // Tasks act on the screen, so a garbled phrase must never start one (it would invent a goal and click around).
  if (c === 'task' && a.sensible.probability < SENSIBLE_MIN) return { kind: 'ignore' }
  // Guard: "open X" only when the request is just opening X. "Like the post on this LinkedIn page" names
  // LinkedIn but asks for more, so it must not shrink to "open linkedin".
  if (c.startsWith('site:') || c.startsWith('app:')) {
    const name = c.slice(c.indexOf(':') + 1)
    if (!isJustOpening(text, name)) return { kind: 'task', text }
    return c.startsWith('site:') ? { kind: 'site', name } : { kind: 'app', name }
  }
  if (c.startsWith('key:')) return { kind: 'key', name: c.slice(4) }
  if (c === 'search') return { kind: 'search', query: searchQuery(text) }
  if (c === 'type') return { kind: 'type', text: text.trim().replace(/^\W*(?:please\s+)?(?:type|write|dictate)\W+/i, '') }
  if (c === 'task') return { kind: 'task', text }
  if (c === 'open_other_website') {
    const t = target(text)
    // "open reddit" -> reddit.com; anything longer becomes a search
    if (t && /^[a-z0-9-]+(?:\.[a-z]{2,})?$/.test(t.replace(/\s+/g, ''))) {
      const host = t.replace(/\s+/g, '')
      return { kind: 'url', url: `https://www.${host.includes('.') ? host : host + '.com'}` }
    }
    return { kind: 'search', query: searchQuery(text) }
  }
  return { kind: 'ignore' }
}

// Search on the site the user names ("AI news in YouTube", "youtube for AI news"), else on the site already in
// front (a YouTube page searches YouTube), else Google.
export function searchUrl(query: string, engines: Record<string, string>, front: string | null) {
  const sites = Object.keys(engines).sort((a, b) => b.length - a.length) // "google maps" before "google"
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  let q = query.trim().replace(/[.?!]+$/, '')
  for (const site of sites) {
    const m = q.match(new RegExp(`^(?:the\\s+)?${esc(site)}\\s+(?:for|about)\\s+(.+)$`, 'i'))
      ?? q.match(new RegExp(`^(.+?)\\s+(?:in|on|at|using|with|from)\\b.*\\b${esc(site)}\\b.*$`, 'i'))
    if (m) return engines[site] + encodeURIComponent(m[1].trim())
  }
  q = q.replace(/\s+(?:in|on)\s+(?:the |a |this |its )?(?:search bar|search box|page|site)\b.*$/i, '')
  const here = front ? sites.find((site) => site !== 'google' && new RegExp(`\\b${esc(site)}\\b`, 'i').test(front)) : undefined
  return (here ? engines[here] : engines.google ?? 'https://www.google.com/search?q=') + encodeURIComponent(q)
}

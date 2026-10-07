// Voice control: the offline listener hears a command, Simulang carries it out on this machine.
//   simulang run voice.ts                 listen to the microphone
//   VOICE_TEXT=1 simulang run voice.ts    type commands instead (for testing)
import { Machine, FocusPolicy, Visibility, Key, Direction, Coordinate, type App } from '@simular-ai/simulang-js'
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { searchUrl } from './router.ts'

const here = dirname(fileURLToPath(import.meta.url))
const cfg = JSON.parse(readFileSync(join(here, 'commands.json'), 'utf8')) as {
  sites: Record<string, string>
  apps: Record<string, string>
  aliases?: Record<string, string>
  search?: Record<string, string>
}
const machine = Machine.local()

// Sound-alike fixes from commands.json ("link in" -> "LinkedIn"): names that Whisper hears as ordinary words.
const aliasRules = Object.entries(cfg.aliases ?? {})
  .sort((a, b) => b[0].length - a[0].length) // longer phrases first ("linked in" before "linkin")
  .map(([heard, meant]) => [new RegExp(`\\b${heard.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+')}\\b`, 'gi'), meant] as const)
const applyAliases = (text: string) => aliasRules.reduce((t, [re, meant]) => t.replace(re, meant), text)

// Resolve the browser and every app once at startup so a command only has to launch, not search.
const browser = machine.defaultBrowser()
// One listing of installed apps, matched locally (fuzzyApp re-lists every app on each call, ~2 s each).
const apps = new Map<string, App>()
const installed = machine.apps()
const norm = (s: string | null) => (s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
for (const [spoken, name] of Object.entries(cfg.apps)) {
  const want = norm(name)
  const hit = installed.find((a) => norm(a.canonicalName) === want)
    ?? installed.find((a) => norm(a.canonicalName).startsWith(want + ' '))
  if (hit) apps.set(spoken, hit)
}
const openUrl = (url: string | null) => browser.open(url, FocusPolicy.Steal, Visibility.Show, false)
let agentBusy = false
// Conversation memory: the app last opened and the last few things said, for Whisper, Jev and the agent.
const ctx: { currentApp: string | null; recent: string[] } = { currentApp: null, recent: [] }

// The window the user is working in: the focused one, unless that is our own status badge.
function targetWindow() {
  const ours = (t: string) => !t || t.startsWith('Voice Control')
  const w = machine.focusedWindow()
  if (w && !ours(w.title)) return w
  return machine.windows().find((x) => !ours(x.title) && !x.isMinimized()) ?? null
}

// Mouse-wheel scroll over the middle of the user's window, then put the pointer back.
// Unlike Page Down, this works no matter which control has keyboard focus (e.g. the address bar).
function scrollWindow(ticks: number) {
  const w = targetWindow()
  if (!w) return combo([], ticks > 0 ? Key.PageDown : Key.PageUp)
  const b = w.boundingBox()
  const [mx, my] = machine.mouseLocation()
  w.moveMouse(Math.round(b.width / 2), Math.round(b.height / 2))
  w.scroll(0, ticks)
  machine.moveMouse(mx, my, Coordinate.Abs)
}

// Hold modifiers, tap the key, release modifiers (sent to the user's window, not our badge).
function combo(mods: Key[], key: Key | string) {
  const w = targetWindow()
  if (w && machine.focusedWindow()?.title !== w.title) w.focus()
  for (const m of mods) machine.key(m, Direction.Press)
  try {
    if (typeof key === 'string') machine.keyUnicode(key, Direction.Click)
    else machine.key(key, Direction.Click)
  } finally {
    for (const m of [...mods].reverse()) machine.key(m, Direction.Release)
  }
}

// Tasks run in a separate process: the agent's model calls and UI automation block while they work,
// and running them here would stop voice control from hearing anything (including "stop").
let agentProc: ReturnType<typeof spawn> | null = null
// Set while the agent waits for the user to approve a sensitive step; the next phrase is the answer.
let pendingConfirm = false
let pendingTextFor: string | null = null // a task waiting for the words to write
let leftover: { text: string; at: number } | null = null // last phrase that matched no command
function answerConfirm(text: string) {
  const t = text.toLowerCase().replace(/[^a-z' ]+/g, ' ').trim()
  const yes = /^(?:yes|yeah|yep|yup|sure|confirm|confirmed|go ahead|do it|post it|send it|okay|ok|please do)\b/.test(t)
  const no = /^(?:no|nope|don't|do not|cancel|stop|never ?mind)\b/.test(t)
  if (!yes && !no) return console.log('  (waiting for yes or no)')
  pendingConfirm = false
  agentProc?.stdin?.write(yes ? 'yes\n' : 'no\n')
  console.log(yes ? '  approved' : '  declined')
}
function startTask(task: string) {
  if (agentBusy) return console.log('  (still working on the last task - say "stop" to cancel it)')
  agentBusy = true
  console.log('  task started')
  const front = targetWindow()?.title ?? ''
  const startedAt = Date.now()
  const proc = spawn('cmd.exe', ['/c', 'simulang', 'run', join(here, 'agent-cli.ts')], {
    cwd: here, env: { ...process.env, AGENT_TASK: task, AGENT_FRONT: front, RUST_LOG: 'warn' }, stdio: ['pipe', 'pipe', 'pipe'],
  })
  agentProc = proc
  createInterface({ input: proc.stdout! }).on('line', (l) => {
    if (l.startsWith('CONFIRM ')) { pendingConfirm = true; return console.log('ASK ' + l.slice(8)) }
    // The agent needs the words to write: the user's next phrase is that text, for this same task.
    if (l.startsWith('NEED_TEXT')) {
      // A pause can split "comment on this post, ... congratulations" in two. If the second half already arrived
      // (and matched nothing) after this task started, it is the text.
      if (leftover && leftover.at >= startedAt && Date.now() - leftover.at < 8000) {
        const words = leftover.text
        leftover = null
        console.log(`  using "${words}" as the text`)
        agentBusy = false // this process is about to exit
        return startTask(`${task.replace(/[.?!,\s]+$/, '')}: ${words}`)
      }
      pendingTextFor = task
      return console.log('ASKTEXT ' + l.slice(10))
    }
    if (l.trim() && !l.includes('OPENROUTER_API_KEY')) console.log('  ' + l.trim())
  })
  createInterface({ input: proc.stderr! }).on('line', (l) => { if (/error|failed/i.test(l) && !l.includes('OPENROUTER_API_KEY')) console.log('  ' + l.trim()) })
  // Only reset if this is still the current task (a follow-up task may already have replaced it).
  proc.on('exit', () => { if (agentProc === proc) { agentBusy = false; agentProc = null; pendingConfirm = false } })
}
function stopTask() {
  if (!agentProc?.pid) return console.log('  (no task running)')
  spawn('taskkill', ['/PID', String(agentProc.pid), '/T', '/F'], { stdio: 'ignore' })
  console.log('  task stopped')
}

function handle(said: string): boolean {
  const s = said.trim().toLowerCase().replace(/[.?!,]+$/, '')
  if (!s) return true
  const m = s.match(/^(?:open|go to) (.+)$/)
  if (s === 'stop listening') return false
  if (/^(?:stop|cancel|stop it|cancel that|never ?mind)$/.test(s)) { stopTask(); return true }
  if (/^open (?:the |a )?browser$/.test(s)) openUrl('https://www.google.com')
  else if (m && cfg.sites[m[1]]) { openUrl(cfg.sites[m[1]]); ctx.currentApp = m[1] }
  else if (m && apps.has(m[1])) { apps.get(m[1])!.open(null, FocusPolicy.Steal, Visibility.Show, false); ctx.currentApp = m[1] }
  else if (s.startsWith('url https://')) openUrl(s.slice(4))
  else if (s.startsWith('search for ')) openUrl(searchUrl(s.slice(11), cfg.search ?? {}, targetWindow()?.title ?? null))
  else if (s.startsWith('computer ')) { startTask(said.trim().slice(9)); return true }
  else if (s.startsWith('type ')) machine.typeText(said.trim().slice(5))
  else if (s === 'new tab') combo([Key.Control], 't')
  else if (s === 'close tab') combo([Key.Control], 'w')
  else if (s === 'next tab') combo([Key.Control], Key.Tab)
  else if (s === 'previous tab') combo([Key.Control, Key.Shift], Key.Tab)
  else if (s === 'go back') combo([Key.Alt], Key.LeftArrow)
  else if (s === 'go forward') combo([Key.Alt], Key.RightArrow)
  else if (s === 'refresh') combo([], Key.F5)
  else if (s === 'scroll down') scrollWindow(6)
  else if (s === 'scroll up') scrollWindow(-6)
  else if (s === 'press enter') combo([], Key.Return)
  else if (/^maximi[sz]e (?:the |this )?window$/.test(s)) targetWindow()?.maximize()
  else if (/^minimi[sz]e (?:the |this )?window$/.test(s)) targetWindow()?.minimize()
  else { console.log(`  (no command for "${s}")`); return true }
  return true
}

// ---------- accurate path: Whisper transcript -> closest command ----------
const FIXED = ['open browser', 'new tab', 'close tab', 'next tab', 'previous tab', 'go back', 'go forward',
  'refresh', 'scroll down', 'scroll up', 'press enter', 'stop listening', 'stop', 'cancel',
  'maximize window', 'maximize the window', 'minimize window', 'minimize the window',
  ...Object.keys(cfg.sites).map((s) => `open ${s}`), ...Object.keys(cfg.apps).map((a) => `open ${a}`)]
// Whisper's usual output for silence or noise
const NOISE = new Set(['', 'you', 'thank you', 'thanks', 'thanks for watching', 'bye', 'okay', 'ok', 'uh', 'um'])

function editDistance(a: string, b: string) {
  const d = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0]; d[0] = i
    for (let j = 1; j <= b.length; j++) {
      const tmp = d[j]
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = tmp
    }
  }
  return d[b.length]
}

// Map free speech ("Okay, open Google please.") onto a command the handler understands, or null.
export function toCommand(text: string): string | null {
  let s = text.toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim()
  s = s.replace(/^(?:hey|okay|ok|please|can you|could you)\s+/, '').replace(/\s+please$/, '')
  if (NOISE.has(s)) return null
  let m
  if ((m = s.match(/^(?:search(?: for)?|google|look up)\s+(.+)$/))) return `search for ${m[1]}`
  if ((m = s.match(/^(?:hey )?computer\s+(.+)$/))) return `computer ${m[1]}`
  if ((m = s.match(/^type\s+(.+)$/))) return `type ${text.trim().replace(/^\W*type\W+/i, '')}`
  s = s.replace(/^(?:open up|launch|start)\s+/, 'open ').replace(/^(?:open|go to) (?:the |a )/, 'open ').replace(/^go to /, 'open ')
  let best = '', bestScore = 0
  for (const p of FIXED) {
    const score = 1 - editDistance(s, p) / Math.max(s.length, p.length)
    if (score > bestScore) { best = p; bestScore = score }
  }
  return bestScore >= 0.75 ? best : null
}

// Local Whisper (whisper.cpp) server, no network. small.en (5-bit quantized) is clearly more accurate than base.en
// at ~0.56 s per phrase on this CPU. The audio window (-ac 384, ~7.7 s) is sized for spoken commands;
// Whisper's default 30 s window is 2-3x slower. -nf: no temperature-fallback retries, which can take seconds.
const WHISPER_URL = 'http://127.0.0.1:8178'
const whisperDir = join(here, 'whisper')
let localWhisper = false
function startLocalWhisper() {
  const exe = join(whisperDir, 'Release', 'whisper-server.exe'), model = join(whisperDir, 'ggml-small.en-q5_1.bin')
  if (!existsSync(exe) || !existsSync(model)) return
  const server = spawn(exe, ['-m', model, '-t', '8', '-ac', '384', '-nt', '-nf', '--host', '127.0.0.1', '--port', '8178'], { stdio: 'ignore' })
  process.on('exit', () => server.kill())
  whisperReady = (async () => {
    for (let i = 0; i < 80 && !localWhisper; i++) {
      try { await fetch(WHISPER_URL + '/'); localWhisper = true } catch { await new Promise((r) => setTimeout(r, 250)) }
    }
  })()
}
let whisperReady: Promise<void> = Promise.resolve()
startLocalWhisper()

// Quiet microphones give Whisper too little signal: scale 16-bit PCM so its peak sits near full scale.
// Returns null for near-silent clips (breaths, room noise), which Whisper tends to hallucinate on.
function normalizeWav(b: Buffer): Buffer | null {
  let o = 12
  while (o + 8 <= b.length) {
    const id = b.toString('ascii', o, o + 4), size = b.readUInt32LE(o + 4)
    if (id === 'data') {
      const start = o + 8, end = Math.min(b.length, start + size) & ~1
      let peak = 1
      for (let i = start; i < end; i += 2) peak = Math.max(peak, Math.abs(b.readInt16LE(i)))
      if (peak < 40) return null // digital silence only; the capture's speech detector decides what is speech
      const gain = Math.min(20, 29000 / peak)
      if (gain > 1.2) {
        b = Buffer.from(b)
        for (let i = start; i < end; i += 2) b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(b.readInt16LE(i) * gain))), i)
      }
      return b
    }
    o += 8 + size + (size & 1)
  }
  return b
}

async function transcribeLocal(path: string): Promise<string> {
  const wav = normalizeWav(readFileSync(path))
  if (!wav) return ''
  const form = new FormData()
  form.append('file', new Blob([wav], { type: 'audio/wav' }), 'clip.wav')
  form.append('response_format', 'json')
  form.append('temperature', '0')
  // Vocabulary hint only (names, no earlier sentences): stops "LinkedIn" -> "link in", "Slack" -> "select".
  // Earlier sentences in the hint made Whisper loop ("Open a... Open a..."), so they stay out.
  form.append('prompt', VOCAB)
  const res = await fetch(WHISPER_URL + '/inference', { method: 'POST', body: form })
  if (!res.ok) throw new Error(`local whisper HTTP ${res.status}`)
  // whisper.cpp marks non-speech as [BLANK_AUDIO], (music), *door opens*, etc.
  return collapseRepeats(((await res.json()) as { text: string }).text.replace(/\[[^\]]*\]|\([^)]*\)|\*[^*]*\*/g, '').trim())
}

const titleCase = (s: string) => s.replace(/\b[a-z]/g, (c) => c.toUpperCase())
const VOCAB = [...Object.keys(cfg.sites), ...Object.keys(cfg.apps)].map(titleCase).join(', ')
  .replace('Linkedin', 'LinkedIn').replace('Youtube', 'YouTube').replace('Github', 'GitHub').replace('Powerpoint', 'PowerPoint') +
  '. Comment, like, reply, post, send, delete, scroll down, scroll up, search for, open, new tab, go back, yes, no.'

// "Open a... Open a... Open a..." -> "Open a..."
function collapseRepeats(text: string) {
  return text.replace(/(\b.{3,40}?)(?:[\s.,]*\1){2,}/gi, '$1')
}

let stt: { transcribe(b: unknown): string } | null | undefined
// ---------- Deepgram Nova-3 (preferred when DEEPGRAM_API_KEY is set) ----------
// The key is read from the user's Windows environment on each phrase, so setting it with `setx` takes effect
// without restarting anything. Keyterms tell Nova-3 which names and command words to expect.
let dgKeyCache: { key: string | null; at: number } = { key: null, at: 0 }
function deepgramKey(): string | null {
  if (process.env.DEEPGRAM_API_KEY) return process.env.DEEPGRAM_API_KEY
  if (Date.now() - dgKeyCache.at < 15_000) return dgKeyCache.key // re-check every 15 s
  let key: string | null = null
  try {
    const out = execFileSync('reg', ['query', 'HKCU\\Environment', '/v', 'DEEPGRAM_API_KEY'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    key = out.match(/DEEPGRAM_API_KEY\s+REG_\w+\s+(\S+)/)?.[1] ?? null
  } catch {}
  dgKeyCache = { key, at: Date.now() }
  return key
}
const KEYTERMS = [...new Set([
  ...[...Object.keys(cfg.sites), ...Object.keys(cfg.apps)].map(titleCase),
  ...Object.values(cfg.aliases ?? {}),
  'LinkedIn', 'YouTube', 'GitHub', 'Gmail', 'Slack', 'comment', 'scroll down', 'scroll up',
])].slice(0, 50)
let deepgramAnnounced = false
async function transcribeDeepgram(path: string, key: string): Promise<string> {
  const wav = normalizeWav(readFileSync(path))
  if (!wav) return ''
  const params = new URLSearchParams({ model: 'nova-3', language: 'en', smart_format: 'true' })
  for (const k of KEYTERMS) params.append('keyterm', k)
  const res = await fetch(`https://api.deepgram.com/v1/listen?${params}`, {
    method: 'POST', body: wav, headers: { Authorization: `Token ${key}`, 'Content-Type': 'audio/wav' },
    signal: AbortSignal.timeout(4000),
  })
  if (!res.ok) throw new Error(`Deepgram HTTP ${res.status}`)
  const json = (await res.json()) as { results?: { channels?: { alternatives?: { transcript?: string }[] }[] } }
  if (!deepgramAnnounced) { deepgramAnnounced = true; console.log('  (using Deepgram Nova-3 for speech-to-text)') }
  return json.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() ?? ''
}

// Deepgram Nova-3 through OpenRouter, with the existing OpenRouter key: ~0.2-0.4 s and more accurate than local
// Whisper on quiet audio (it hears "LinkedIn", not "link in").
let novaAnnounced = false
async function transcribeOpenRouterNova(path: string): Promise<string> {
  const wav = normalizeWav(readFileSync(path))
  if (!wav) return ''
  const res = await fetch('https://openrouter.ai/api/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'deepgram/nova-3', input_audio: { data: wav.toString('base64'), format: 'wav' } }),
    signal: AbortSignal.timeout(4000),
  })
  if (!res.ok) throw new Error(`OpenRouter Nova-3 HTTP ${res.status}`)
  if (!novaAnnounced) { novaAnnounced = true; console.log('  (using Deepgram Nova-3 via OpenRouter for speech-to-text)') }
  return (((await res.json()) as { text?: string }).text ?? '').trim()
}

// Order: Nova-3 via OpenRouter -> Deepgram directly (if its own key is set) -> local Whisper -> hosted Whisper.
// The last 20 phrases are kept (on this PC only, in app\clips) so accuracy can be checked against real speech.
const clipsDir = join(here, 'app', 'clips')
function keepClip(path: string) {
  try {
    mkdirSync(clipsDir, { recursive: true })
    renameSync(path, join(clipsDir, `${new Date().toISOString().replace(/[:.]/g, '-')}.wav`))
    const old = readdirSync(clipsDir).filter((f) => f.endsWith('.wav')).sort()
    for (const f of old.slice(0, Math.max(0, old.length - 20))) unlinkSync(join(clipsDir, f))
  } catch { try { unlinkSync(path) } catch {} }
}

async function transcribeClip(path: string): Promise<string> {
  if (process.env.OPENROUTER_API_KEY) {
    try {
      const text = await transcribeOpenRouterNova(path)
      try { keepClip(path) } catch {}
      return text
    } catch (e) {
      console.log(`  (Nova-3 failed: ${e instanceof Error ? e.message : e} - trying the next option)`)
    }
  }
  const dgKey = deepgramKey()
  if (dgKey) {
    try {
      const text = await transcribeDeepgram(path, dgKey)
      try { keepClip(path) } catch {}
      return text
    } catch (e) {
      console.log(`  (Deepgram failed: ${e instanceof Error ? e.message : e} - using local Whisper)`)
    }
  }
  await whisperReady
  if (localWhisper) {
    try {
      const text = await transcribeLocal(path)
      try { keepClip(path) } catch {}
      return text
    } catch {
      // Local server died: restart it in the background and use the hosted model for this phrase.
      localWhisper = false
      startLocalWhisper()
    }
  }
  if (stt === undefined) {
    const { SttModel } = await import('@simular-ai/simulang-js')
    try { stt = SttModel.byAlias('openrouter_whisper_large_v3') as any } catch { stt = null }
  }
  const { SamplesBuffer } = await import('@simular-ai/simulang-js')
  const b = readFileSync(path)
  keepClip(path)
  if (!stt) throw new Error('no speech-to-text model (is OPENROUTER_API_KEY set?)')
  // Minimal WAV parse: read the fmt and data chunks.
  let o = 12, rate = 16000, channels = 1, bits = 16, data: Buffer | null = null
  while (o + 8 <= b.length) {
    const id = b.toString('ascii', o, o + 4), size = b.readUInt32LE(o + 4)
    if (id === 'fmt ') { channels = b.readUInt16LE(o + 10); rate = b.readUInt32LE(o + 12); bits = b.readUInt16LE(o + 22) }
    if (id === 'data') { data = b.subarray(o + 8, Math.min(b.length, o + 8 + size)); break }
    o += 8 + size + (size & 1)
  }
  if (!data || bits !== 16) throw new Error('unsupported audio clip')
  const samples = new Array<number>(data.length >> 1)
  for (let i = 0; i < samples.length; i++) samples[i] = data.readInt16LE(i * 2) / 32768
  return new SamplesBuffer(channels, rate, samples).transcribe(stt as any)
}

async function runClip(path: string): Promise<boolean> {
  const t0 = performance.now()
  console.log('THINK')
  let text: string
  try { text = await transcribeClip(path) } catch (e) {
    console.log(`  (could not transcribe: ${e instanceof Error ? e.message : e})`); return true
  }
  const corrected = applyAliases(text)
  if (corrected !== text) {
    // Only use the name-corrected wording when it makes sense ("open the link in this browser" -> LinkedIn,
    // but "click the link in this email" stays as heard).
    const { pickReading } = await import('./router.ts')
    try { text = pickReading(text, corrected, Object.keys(cfg.sites), Object.keys(cfg.apps), targetWindow()?.title ?? null) } catch {}
  }
  console.log(`HEARD ${text.trim()}`)
  if (text.trim()) ctx.recent = [...ctx.recent, text.trim()].slice(-3)
  // Nothing understood means nothing to do: never let a model guess an action from an empty transcript.
  if (!/[a-z0-9]/i.test(text)) { console.log('  (heard nothing clear - try again a bit louder)'); return true }
  if (pendingConfirm) { answerConfirm(text); return true }
  if (pendingTextFor) {
    const task = pendingTextFor
    pendingTextFor = null
    if (/^\W*(?:cancel|never ?mind|stop)\W*$/i.test(text)) { console.log('  cancelled'); return true }
    // Strip lead-ins like "just saying ..." so only the words to post remain.
    const words = text.trim().replace(/^(?:just |please |um |uh )*(?:say(?:ing)?|write|type|comment|reply)\s*[:,]?\s*/i, '')
    startTask(`${task.replace(/[.?!]+$/, '')}: ${words}`)
    return true
  }
  // A near-exact command needs no model call; anything else is routed by Jev.
  const command = toCommand(text) ?? (await routed(text))
  if (!command) {
    leftover = { text: text.trim().replace(/[.?!]+$/, ''), at: Date.now() }
    console.log(`  (no command for "${text.trim().toLowerCase().replace(/[.?!]+$/, '')}")`)
    return true
  }
  return run(command, performance.now() - t0)
}

// Turn Jev's intent into a command string the handler runs.
async function routed(text: string): Promise<string | null> {
  const { route } = await import('./router.ts')
  const r = route(text, Object.keys(cfg.sites), Object.keys(cfg.apps), { currentApp: targetWindow()?.title ?? null, recent: ctx.recent.slice(0, -1) })
  switch (r.kind) {
    case 'search': return r.query ? `search for ${r.query}` : null
    case 'site': case 'app': return `open ${r.name}`
    case 'url': return `url ${r.url}`
    case 'key': return r.name
    case 'type': return r.text ? `type ${r.text}` : null
    case 'task': return `computer ${r.text}`
    default: return null
  }
}

function run(said: string, alreadyMs = 0): boolean {
  const t0 = performance.now() - alreadyMs
  try {
    const keepGoing = handle(said)
    console.log(`> ${said}  [${Math.round(performance.now() - t0)} ms]`)
    return keepGoing
  } catch (err) {
    console.log(`> ${said}  failed: ${err instanceof Error ? err.message : err}`)
    return true
  }
}

if (process.env.VOICE_TEXT === '1') {
  const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: 'command> ' })
  rl.prompt()
  // Lines starting with "~" go through the Whisper-style matcher, e.g. "~Okay, open Google please."
  rl.on('line', (line) => {
    line = line.replace(/^﻿/, '')
    // "@<wav path>" runs a recorded clip through the full spoken pipeline (the clip is deleted afterwards).
    if (line.startsWith('@')) { void runClip(line.slice(1).trim()).then(() => { try { rl.prompt() } catch {} }); return }
    if (!line.startsWith('~')) return run(line) ? rl.prompt() : rl.close()
    const t0 = performance.now()
    void (async () => {
      const command = toCommand(line.slice(1)) ?? (await routed(line.slice(1)))
      console.log(`  matched: ${command}`)
      if (command && !run(command, performance.now() - t0)) return rl.close()
      rl.prompt()
    })()
  })
} else {
  // The desktop app sends "ANSWER yes|no" here when the Yes/No buttons on the badge are clicked.
  createInterface({ input: process.stdin }).on('line', (l) => {
    const m = l.trim().match(/^ANSWER (yes|no)$/i)
    if (m && pendingConfirm) answerConfirm(m[1])
  })
  const listener = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(here, 'listener.ps1')], {
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  const rl = createInterface({ input: listener.stdout })
  let clips: Promise<unknown> = Promise.resolve()
  rl.on('line', (line) => {
    if (line === 'READY') {
      // Load the models now so the first spoken request doesn't pay their setup cost.
      import('./router.ts').then((r) => r.warm()).catch(() => {})
      import('@simular-ai/simulang-js').then(({ SttModel }) => { try { stt ??= SttModel.byAlias('openrouter_whisper_large_v3') as any } catch {} })
    }
    if (line === 'READY') return console.log('Listening. Try "open google", "search for weather", "computer <any task>", or "stop listening".')
    if (/^(HEAR|MISS|LEVEL) /.test(line)) return console.log(line) // live feedback for the UI, not a command
    if (line.startsWith('AUDIO ')) {
      // One clip at a time, in order, so commands never run out of sequence.
      clips = clips.then(() => runClip(line.slice(6))).then((go) => { if (!go) { listener.kill(); process.exit(0) } })
      return
    }
    if (!run(line)) { listener.kill(); process.exit(0) }
  })
  listener.on('exit', (code) => { console.log(`listener stopped (${code})`); process.exit(code ?? 0) })
}

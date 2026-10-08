// OpenAI Decisions API (gpt-6-luna) behind Jev's decide() shape, so it can stand in for Jev.
// Jev "noul" questions map to OpenAI "predicate"; "choice" maps to "choice" (options -> choices).
import { QuestionKind } from '@simular-ai/simulang-js'

type Q = { kind: QuestionKind; instructions: string; options?: Record<string, string | null> }
const DECISIONS_URL = 'https://api.openai.com/v1/decisions'

// Async (Jev's decide() is sync); router callers await either.
// images: base64 data URLs (e.g. a screenshot of the window being automated) the model looks at with the text.
export async function openaiDecide(state: unknown, questions: Record<string, Q>, images: string[] = [], model = 'gpt-6-luna') {
  const text = typeof state === 'string' ? state : JSON.stringify(state)
  // OpenAI requires at least 2 choices; a choice with one option has only one answer, so answer it here
  // (Jev did the same). Without this, a page with a single clickable element made every decision fail.
  const local: Record<string, any> = {}
  questions = Object.fromEntries(Object.entries(questions).filter(([name, q]) => {
    const opts = Object.keys(q.options ?? {})
    if (q.kind === QuestionKind.Choice && opts.length <= 1) {
      local[name] = { choice: opts[0] ?? '', confidence: 1, probabilities: opts[0] ? { [opts[0]]: 1 } : {} }
      return false
    }
    return true
  }))
  if (!Object.keys(questions).length) return { usage: null, ...local }
  const body = {
    model,
    input: images.length
      ? [{ role: 'user', content: [{ type: 'input_text', text }, ...images.map((url) => ({ type: 'input_image', image_url: url }))] }]
      : text,
    questions: Object.entries(questions).map(([name, q]) => q.kind === QuestionKind.Choice
      ? { type: 'choice', name, instructions: q.instructions,
          choices: Object.entries(q.options ?? {}).map(([value, description]) => ({ value, description: description || value })) }
      : { type: 'predicate', name, instructions: q.instructions }),
  }
  const res = await fetch(DECISIONS_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = await res.json() as any
  if (!res.ok) throw new Error(`OpenAI decisions HTTP ${res.status}: ${JSON.stringify(json.error ?? json).slice(0, 300)}`)
  const out: Record<string, any> = { usage: json.usage ?? null, ...local }
  for (const a of json.answers ?? []) {
    if (a.type === 'refusal') throw new Error(`OpenAI refused question ${a.name}`)
    if (a.type === 'predicate') out[a.name] = { probability: a.probability }
    else if (a.type === 'choice') out[a.name] = {
      choice: a.choice, confidence: a.confidence,
      probabilities: Object.fromEntries((a.probabilities ?? []).map((p: any) => [p.value, p.probability])),
    }
    else out[a.name] = a
  }
  return out
}

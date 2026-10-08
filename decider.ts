// Picks the decision model for routing and the agent: OpenAI's Decisions API (gpt-6-luna) or Jev.
// Set "decider": "openai" | "jev" in commands.json. OpenAI falls back to Jev for any decision it fails on.
import { execFileSync } from 'node:child_process'
import { DecisionModel } from '@simular-ai/simulang-js'
import { openaiDecide } from './openai-decider.ts'

/** A user environment variable, read from the registry so keys set with `setx` work without restarting. */
export function userEnv(name: string): string | null {
  if (process.env[name]) return process.env[name]!
  try {
    const out = execFileSync('reg', ['query', 'HKCU\\Environment', '/v', name], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    const value = out.match(new RegExp(`${name}\\s+REG_\\w+\\s+(\\S+)`))?.[1] ?? null
    if (value) process.env[name] = value // child processes (the agent) inherit it
    return value
  } catch { return null }
}

/** images: base64 data URLs the model should look at (only the OpenAI decider uses them; Jev is text-only). */
export type Decider = { name: string; decide(state: unknown, questions: any, images?: string[]): Promise<any> }

// "openai" uses OpenAI only: no fallback to another model. If a decision fails, it fails (the caller reports it
// and nothing runs). "jev" uses Jev only.
export function makeDecider(pref: string | undefined, log: (s: string) => void = () => {}): Decider {
  if (pref !== 'openai') {
    let jev: DecisionModel | null = null
    return { name: 'jev', decide: async (s, q) => (jev ??= DecisionModel.openrouterJev()).decide(s as any, q) }
  }
  if (!userEnv('OPENAI_API_KEY')) log('decider: OPENAI_API_KEY is not set - decisions will fail until it is')
  return {
    name: 'openai',
    decide: async (s, q, images = []) => {
      if (!userEnv('OPENAI_API_KEY')) throw new Error('OPENAI_API_KEY is not set')
      return openaiDecide(s, q, images)
    },
  }
}

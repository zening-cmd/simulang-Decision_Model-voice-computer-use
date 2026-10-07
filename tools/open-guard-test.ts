// Checks the "just opening" guard: node tools/open-guard-test.ts
import { isJustOpening } from '../router.ts'

const cases: [string, string, boolean][] = [
  ['Open linking.', 'linkedin', true],
  ['Can you open LinkedIn please', 'linkedin', true],
  ['take me to youtube', 'youtube', true],
  ['I need the calculator', 'calculator', true],
  ['Can you open the Slack?', 'slack', true],
  ['open google drive', 'google drive', true],
  ['Opening the LinkedIn in this browser.', 'linkedin', true],
  ['open youtube in a new tab', 'youtube', true],
  ['Can you like the post in this LinkedIn page?', 'linkedin', false],
  ['K-find Jordin in a Slack.', 'slack', false],
  ['I asked you to find Jordan in the slack you just opened.', 'slack', false],
  ['check my messages on linkedin', 'linkedin', false],
  ['open youtube and play lofi music', 'youtube', false],
  ['open the browser', 'linkedin', false],
  ['can you open google', 'google drive', false],
]
let fail = 0
for (const [text, name, want] of cases) {
  const got = isJustOpening(text, name)
  if (got !== want) fail++
  console.log(`${got === want ? 'ok  ' : 'FAIL'} ${String(got).padEnd(5)} ${text}`)
}
console.log(fail ? `${fail} failed` : 'all passed')

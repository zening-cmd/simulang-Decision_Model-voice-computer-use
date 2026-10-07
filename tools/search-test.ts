// Checks site-aware search URLs: node tools/search-test.ts
import { readFileSync } from 'node:fs'
import { searchUrl } from '../router.ts'

const cfg = JSON.parse(readFileSync(new URL('../commands.json', import.meta.url), 'utf8'))
const cases: [string, string | null, string][] = [
  ['ai news in youtube', 'Google - Google Chrome', 'youtube.com/results?search_query=ai%20news'],
  ['ai news in a search bar in its youtube page', 'YouTube - Google Chrome', 'youtube.com/results?search_query=ai%20news'],
  ['youtube for ai news', null, 'youtube.com/results?search_query=ai%20news'],
  ['ai news', 'YouTube - Google Chrome', 'youtube.com/results?search_query=ai%20news'],
  ['ai news', 'Google - Google Chrome', 'google.com/search?q=ai%20news'],
  ['pizza near me on google maps', null, 'google.com/maps/search/pizza%20near%20me'],
  ['richard on linkedin', null, 'linkedin.com/search/results/all/?keywords=richard'],
  ['the best pizza near me', null, 'google.com/search?q=the%20best%20pizza%20near%20me'],
]
let fail = 0
for (const [q, front, want] of cases) {
  const got = searchUrl(q, cfg.search, front)
  if (!got.includes(want)) fail++
  console.log(`${got.includes(want) ? 'ok  ' : 'FAIL'} ${q.padEnd(46)} [${front ?? '-'}] -> ${got}`)
}
console.log(fail ? `${fail} failed` : 'all passed')

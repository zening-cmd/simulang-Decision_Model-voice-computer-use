// Routes one request with optional context: simulang run tools/route-one.ts "<request>" [currentApp] [previous request]
import { readFileSync } from 'node:fs'
import { route } from '../router.ts'

const cfg = JSON.parse(readFileSync(new URL('../commands.json', import.meta.url), 'utf8'))
const [text, currentApp, previous] = process.argv.slice(2)
const t = performance.now()
const r = await route(text, Object.keys(cfg.sites), Object.keys(cfg.apps), { currentApp: currentApp || null, recent: previous ? [previous] : [] })
console.log(`${Math.round(performance.now() - t)} ms  ${text}  (open: ${currentApp || 'none'})  ->  ${JSON.stringify(r)}`)

// Checks the sound-alike rewrites in commands.json: node tools/alias-test.mjs
import { readFileSync } from 'node:fs'

const cfg = JSON.parse(readFileSync(new URL('../commands.json', import.meta.url), 'utf8'))
const rules = Object.entries(cfg.aliases ?? {})
  .sort((a, b) => b[0].length - a[0].length)
  .map(([heard, meant]) => [new RegExp(`\\b${heard.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+')}\\b`, 'gi'), meant])
const fix = (t) => rules.reduce((s, [re, meant]) => s.replace(re, meant), t)

for (const t of ['Open the Link In in its browser.', "Open a link in Unity's browser.", 'Open the link in this browser.',
  'Open linking.', 'go to you tube', 'open git hub', 'check my g mail', 'Open party full.', 'Go to partyful please', 'Open the party floor.', 'Open the party phone in my browser.', 'Particle.'])
  console.log(t.padEnd(36), '->', fix(t))

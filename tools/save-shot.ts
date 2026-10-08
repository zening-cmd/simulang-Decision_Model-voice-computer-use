import { Machine } from '@simular-ai/simulang-js'
const w = Machine.local().windows().find((x) => x.title.toLowerCase().includes((process.argv[2] ?? 'Chrome').toLowerCase()))
if (w) { const s = w.screenshot(true); s.shrink(1280, 1280); s.save(process.argv[3]); console.log('saved') }

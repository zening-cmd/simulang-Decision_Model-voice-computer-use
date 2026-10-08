import { Machine } from '@simular-ai/simulang-js'
for (const w of Machine.local().windows()) console.log(JSON.stringify(w.title))

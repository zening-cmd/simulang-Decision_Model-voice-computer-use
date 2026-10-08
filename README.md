# Voice Control v2 (Simulang + OpenAI Decisions with vision)

Talk to your Windows PC and it acts in about a second: open sites and apps, search, scroll, play videos, and do
tasks inside apps ("like this video", "watch the second video", "approve all pending guests", "comment on this post:
congratulations"). Ask questions ("who's still pending?") and it looks, then answers.

What's new in v2:
- **Vision:** the decision model sees a screenshot of the window with every element's position, and a **vision
  verifier** compares before/after screenshots to confirm a task actually worked.
- **OpenAI Decisions API** (`gpt-6-luna`) for all decisions, about 2x faster than before (Jev remains available).
- **Echo cancellation:** Windows' Voice Capture DSP removes your speakers' sound from the microphone, so a playing
  video is never heard as you.
- Questions (look-only), memory of recent requests, "try again" retries, screen-order "first/second/last" picking,
  dropdown and list handling, self-recovering audio capture.

## How it works

```
microphone ─► listener.ps1 ─────────► speech-to-text ─► voice.ts ─┬─► fast command (open, search, scroll, media keys)
             (echo cancellation,       (Deepgram Nova-3            │      ─► Simulang
              phrase detection)         via OpenRouter;            │
                                        local Whisper backup)      └─► decision model routes the request
                                                                         ─► agent (its own process)
                                                                            plan → loop:
                                                                              Simulang reads the window + screenshot
                                                                              model picks element + action (vision)
                                                                              guard rules check it
                                                                              Simulang acts
                                                                              vision verifier confirms the result
```

| Piece | Job |
|---|---|
| **Simulang** | Reads the window's accessibility tree, screenshots, opens apps/URLs, clicks, types, scrolls |
| **OpenAI Decisions API** (`gpt-6-luna`) | Multiple-choice decisions in ~0.1–0.4 s with screenshots: intent, element, done?, sensible?, misheard name? |
| **Deepgram Nova-3** (via OpenRouter) | Speech-to-text, ~0.2–0.4 s per phrase |
| **Voice Capture DSP** (Windows) | Echo cancellation: subtracts what the speakers play from the microphone |
| **GPT-4o-mini** (via OpenRouter) | Plans a task's goal, extracts text to type, answers questions from screen text |
| **whisper.cpp** (optional) | Local speech-to-text backup |

## Files

| File | What it does |
|---|---|
| `voice.ts` | Engine: speech-to-text, fast commands, site search, phrase joining, retries, task launcher, confirmations |
| `router.ts` | Decisions: intent routing, nonsense filter, context-checked sound-alike corrections, site search URLs |
| `agent.ts` | Task agent: planning, vision step loop, verifier, ordinal/list/dropdown handling, guard rules, questions |
| `decider.ts`, `openai-decider.ts` | Chooses the decision model; OpenAI Decisions API client with image input |
| `agent-cli.ts` | Runs one task in its own process so listening never stops |
| `listener.ps1` | Echo-cancelled microphone capture with pre-roll, end-of-phrase detection and auto-recovery |
| `commands.json` | Your sites, apps, site searches, sound-alike corrections and decision model |
| `app/` | Desktop app: status badge, Yes/No buttons, answer notifications, tray menu, auto-reload and auto-restart |
| `tools/` | Read-only probes and test scripts (routing, corrections, vision decisions, echo test, latency) |

## Setup (Windows 10/11)

1. Install [Node.js](https://nodejs.org/) 22.18 or newer and the Simulang CLI:
   ```
   npm install -g @simular-ai/simulang
   ```
2. Set two API keys as user environment variables:
   ```
   setx OPENROUTER_API_KEY "your-openrouter-key"
   setx OPENAI_API_KEY "your-openai-key"
   ```
   OpenRouter: Deepgram Nova-3 speech-to-text and the planner. OpenAI: the Decisions API (`"decider": "openai"` in
   `commands.json`; set it to `"jev"` to use Jev via OpenRouter instead).
3. Optional, for offline speech-to-text: download a whisper.cpp Windows build
   (`whisper-bin-x64.zip` from [ggml-org/whisper.cpp releases](https://github.com/ggml-org/whisper.cpp/releases))
   and extract it to `whisper/Release/`, then put
   [`ggml-small.en-q5_1.bin`](https://huggingface.co/ggerganov/whisper.cpp/blob/main/ggml-small.en-q5_1.bin)
   in `whisper/`.
4. Create the Desktop shortcut:
   ```
   powershell -NoProfile -ExecutionPolicy Bypass -File app/install.ps1
   ```
5. Double-click **Voice Control** on the Desktop. The badge shows "Listening (echo cancellation on…)".

To test without a microphone: `set VOICE_TEXT=1` then `simulang run voice.ts`, and type commands
(`~sentence` runs it through the full spoken-request path). `tools/echo-test.ps1` checks echo cancellation by
playing a test sentence through the speakers.

## Things to say

| Say | Result |
|---|---|
| "open LinkedIn", "take me to YouTube", "I need the calculator" | Opens it |
| "search AI news in YouTube", "search pizza near me on Google Maps" | Site search (or the site in front) |
| "scroll down", "go back", "new tab", "pause", "mute", "volume up" | Instant actions |
| "watch the second video", "open the last result" | Picks by screen order |
| "like this video", "follow this account" | One-click task, verified on screen; a repeat won't undo it |
| "approve all the pending guests" | Batch task through lists and dropdowns |
| "who's still pending?" | Looks (clicks filters only), reads the screen, answers on the badge |
| "comment on this post: congratulations" | Types the comment, then asks before posting |
| "you missed some" / "try again" | Redoes the last task with your feedback |
| "stop" / "cancel" | Stops a running task |

## Safety

- Only **sending** asks first (pressing Enter in a field, Send buttons, posting text the agent typed); answer
  "yes"/"no" or click the badge buttons (no answer in 30 s = no). Everything else runs without asking.
- Questions are look-only: they can click tabs, filters, links and counts, nothing that changes anything.
- The agent only opens apps or sites your sentence names, works on the window in front, never repeats a toggle
  (Like, Follow…), never types into non-text elements, ignores garbled phrases and single stray words, and treats
  screen text as untrusted data, never as instructions.
- If echo cancellation is unavailable, phrases recorded while sound is playing must start with "Computer, …".

## Customizing

Edit `commands.json` (the app reloads automatically):

- `decider`: `"openai"` or `"jev"`.
- `sites`, `apps`: names you can open by voice. `search`: per-site search URLs.
- `aliases`: words speech-to-text tends to mishear (e.g. `"link in": "LinkedIn"`). They are only applied when the
  decision model judges the corrected sentence is what you meant.

## Privacy

Each spoken phrase is sent to OpenRouter (Deepgram Nova-3) for transcription. The transcript, the title of the
window in front, the names of on-screen elements and the text just before each one (e.g. the person a list row
belongs to), plus a screenshot of that window at each step of a task and before/after screenshots to verify that a
one-click task worked, are sent to the decision model (OpenAI Decisions API, or Jev via OpenRouter). The task planner
(GPT-4o-mini via OpenRouter) receives the request, the window title and your last three requests with their results;
for questions it also receives all visible text in the window. With local Whisper and no network, transcription
stays on the PC. The log (`app/engine.log`), your last 20 voice clips (`app/clips/`) and recently clicked toggles
(`app/toggles.json`) stay on the PC and are excluded from git.

## Known limits

- With "only sending asks first", a misheard request can delete, remove or reject without a pause.
- Batch tasks ("approve all…") start without an up-front confirmation.
- Web page text and images reach the models; they are labelled untrusted, which reduces but cannot rule out
  prompt-injection attempts.

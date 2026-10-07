# Voice Control (Simulang + Jev)

Talk to your Windows PC and it acts in about a second: open sites and apps, search, scroll, and do multi-step
tasks inside apps ("like this post", "comment on this post: congratulations"), asking before anything that posts,
sends or deletes.

Built on [Simulang](https://simulang.simular.ai/) for seeing and controlling the desktop, and
[Jev](https://openrouter.ai/typesafe) (a fast decision model) for choosing what to do.

## How it works

```
microphone ─► listener.ps1 ─► speech-to-text ─► voice.ts ─┬─► fast command (open, search, scroll, keys) ─► Simulang
             (phrase capture)  (Deepgram Nova-3,           │
                                local Whisper backup)      └─► Jev routes the request ─► agent (separate process)
                                                                                         plan → loop:
                                                                                           Simulang reads the window
                                                                                           Jev picks element + action
                                                                                           guard rules check it
                                                                                           Simulang acts
```

| Piece | Job |
|---|---|
| **Simulang** | Reads the window's accessibility tree, opens apps/URLs, clicks, types, scrolls |
| **Jev** | Multiple-choice decisions in ~0.2 s: which intent, which element, is it done, is it risky, is the phrase sensible, which reading of a misheard name is right |
| **Deepgram Nova-3** (via OpenRouter) | Speech-to-text, ~0.2–0.4 s per phrase |
| **whisper.cpp** (optional) | Local speech-to-text backup if the network is down |
| **GPT-4o-mini** (via OpenRouter) | Plans a task's goal and extracts literal text to type |

Typical latency: ~0.7 s for the end of a phrase to be detected, then ~1 s to act for simple commands; multi-step
tasks take a few seconds.

## Files

| File | What it does |
|---|---|
| `voice.ts` | Engine: speech-to-text, fast commands, site search, task launcher, confirmations |
| `router.ts` | Jev decisions: intent routing, nonsense filter, sound-alike corrections, site search URLs |
| `agent.ts` | Task agent: planning, the Simulang + Jev step loop, safety rules |
| `agent-cli.ts` | Runs one task in its own process so listening never stops |
| `listener.ps1` | Microphone capture with pre-roll and end-of-phrase detection |
| `commands.json` | Your sites, apps, site searches and sound-alike corrections |
| `app/` | Desktop app: floating status badge, Yes/No buttons, tray menu, auto-reload on code changes |
| `tools/` | Test scripts for routing, corrections, search URLs and latency |

## Setup (Windows 10/11)

1. Install [Node.js](https://nodejs.org/) 22.18 or newer and the Simulang CLI:
   ```
   npm install -g @simular-ai/simulang
   ```
2. Get an [OpenRouter](https://openrouter.ai/) API key and set it as a user environment variable:
   ```
   setx OPENROUTER_API_KEY "your-key"
   ```
   It is used for Deepgram Nova-3 (speech-to-text), Jev and the planner.
3. Optional, for offline speech-to-text: download a whisper.cpp Windows build
   (`whisper-bin-x64.zip` from [ggml-org/whisper.cpp releases](https://github.com/ggml-org/whisper.cpp/releases))
   and extract it to `whisper/Release/`, then put
   [`ggml-small.en-q5_1.bin`](https://huggingface.co/ggerganov/whisper.cpp/blob/main/ggml-small.en-q5_1.bin)
   in `whisper/`.
4. Create the Desktop shortcut:
   ```
   powershell -NoProfile -ExecutionPolicy Bypass -File app/install.ps1
   ```
5. Double-click **Voice Control** on the Desktop. The badge turns green ("Listening") within a few seconds.

To test without a microphone: `set VOICE_TEXT=1` then `simulang run voice.ts`, and type commands
(`~sentence` runs it through the full spoken-request path).

## Things to say

| Say | Result |
|---|---|
| "open LinkedIn", "take me to YouTube", "I need the calculator" | Opens it |
| "search AI news in YouTube", "search pizza near me on Google Maps" | Site search (or the site in front) |
| "scroll down", "go back", "new tab", "maximize the window" | Instant actions |
| "like this post", "open the second video" | One-click task on the window in front |
| "comment on this post: congratulations" | Types the comment, then asks before posting |
| "delete the message" | Clears an unsent draft |
| "stop" / "cancel" | Stops a running task |

## Safety

- Typing and clearing drafts happen freely. Anything that can publish, send, delete or pay asks first:
  answer "yes"/"no" or click the badge buttons (no answer in 30 s = no).
- The agent only opens apps or sites your sentence names, works on the window in front, never clicks the same
  toggle twice, never types into non-text elements, and ignores phrases Jev rates as garbled.

## Customizing

Edit `commands.json` (the app reloads automatically):

- `sites`, `apps`: names you can open by voice.
- `search`: per-site search URLs.
- `aliases`: words speech-to-text tends to mishear (e.g. `"link in": "LinkedIn"`). They are only applied when Jev
  judges the corrected sentence is what you meant.

## Privacy

Each spoken phrase is sent to OpenRouter (Deepgram Nova-3) for transcription, and the text plus the names of
on-screen elements are sent for Jev/planner decisions. With local Whisper and no network, transcription stays on
the PC. The app keeps its log (`app/engine.log`) and your last 20 voice clips (`app/clips/`) locally for
troubleshooting; both are excluded from git.

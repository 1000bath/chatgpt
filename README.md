# chatgpt

Drive ChatGPT's web UI over the **Chrome DevTools Protocol** — no API key, no puppeteer, **zero runtime dependencies** (Node 24 built-ins only).

Where `dek-gateway` talks to model APIs, this package talks to the ChatGPT product: it launches an isolated Chrome profile, attaches over CDP, types into the composer, and reads the answer back — including the things the API has no equivalent for, like account Saved Memory and the composer's Deep Research / Create Image tools.

## Quick Start

```bash
npm install bunraku
```

```typescript
import {
  ChatGptBrowserBackend,
  ChatGptBrowserError,
  serializeChatGptBrowserError
} from "bunraku";

const backend = new ChatGptBrowserBackend({
  profileDir: "/path/to/dedicated-chrome-profile",
  enabled: true,   // browser mode is opt-in by design
  headed: true,    // headed so you can log in and watch the session
  streamEnabled: true
});

try {
  const result = await backend.run({
    model: "gpt-5",
    systemPrompt: "You are concise.",
    userPrompt: "Summarize the CDP handshake in three sentences.",
    cwd: process.cwd()
  });

  console.log(result.text);
} catch (error) {
  if (error instanceof ChatGptBrowserError) {
    console.error(error.code, error.message);
    console.error(error.suggestion);
  } else {
    console.error(serializeChatGptBrowserError(error));
  }
}
```

## CLI

The package ships a `bunraku` command for the same flow without writing code:

```bash
bunraku login                      # sign in once per profile (see below)
bunraku doctor                     # platform, Chrome, profile, selectors, sign-in
bunraku ask "explain the CDP handshake in three sentences"
git diff | bunraku ask - --system "You review diffs."
bunraku ask "a fox in the snow" --tool create-image --artifacts ./out
bunraku memory                     # list the account's saved memories
bunraku close                      # close the managed Chrome
```

The answer goes to stdout and everything else to stderr, so `bunraku ask ... > answer.md`
captures only the response. `--json` emits the full result object instead.

`--profile <dir>` selects the Chrome user-data directory, defaulting to
`$CHATGPT_PROFILE_DIR` and then `~/.chatgpt-cli/profile`.

**Run `bunraku login` first.** It opens Chrome *without* a debugger port, which
matters: a fresh profile driven over CDP is routinely met with a Cloudflare
"Verify you are human" interstitial and never reaches the sign-in form. Clear
the challenge and sign in there once; the profile keeps both the Cloudflare
clearance and the session, and later runs attach to it.

### Efficient memory sync

Keep Oracle as the source of truth and treat ChatGPT Saved Memory as a cache. Build a snapshot and send `memorySyncPrompt` only for an initial sync or changed digest:

```typescript
import { createMemorySnapshot, planMemorySync, buildMemorySyncPrompt } from "bunraku";

const current = createMemorySnapshot(["Prefer concise answers", "Use TypeScript"]);
const plan = planMemorySync(previousSnapshot, current);
const memorySyncPrompt = buildMemorySyncPrompt(plan);
await backend.run({ ...request, ...(memorySyncPrompt ? { memorySyncPrompt } : {}) });
```

Persist `current` locally after a successful/unverified sync and reconcile with `listAccountMemories()` when needed. Do not put secrets or transient conversation details into Saved Memory.

First run: launch headed, sign in to ChatGPT once. The profile directory keeps the session, so later runs attach to an already-authenticated browser.

## Features

- **Raw CDP** — attaches over a WebSocket to Chrome's debugger port. No puppeteer, no bundled Chromium.
- **Streaming** — reads assistant tokens from CDP `Network` events, with a DOM poll as fallback
- **Composer tools** — engage Web search, Deep research, or Create image for a turn, each with a timeout floor matched to how long it actually runs
- **Image upload & artifacts** — send images into the composer; persist generated images to a caller-owned directory with traversal and size checks
- **Account Saved Memory** — read, write, and delete entries, with a verification step that refuses to report success on an unconfirmed save
- **Memory delta sync** — build a hashed baseline once and send only added/removed durable memories on later updates
- **Rate-limit & challenge detection** — classifies Cloudflare challenges and usage caps as distinct, actionable errors
- **Diagnostics** — a doctor routine that checks Chrome, the profile, authentication, and whether the UI selectors still match

## Requirements

- **Node 24+** — uses the built-in `WebSocket` global and `node:sqlite`-era runtime features
- **Google Chrome or Chromium** installed locally
- A **dedicated Chrome profile directory**. Do not point this at your everyday profile: the backend launches Chrome with a debugger port open and manages windows on that profile.

## Configuration

```typescript
const backend = new ChatGptBrowserBackend({
  profileDir: "/path/to/dedicated-chrome-profile",
  enabled: true,
  headed: true,
  timeoutMs: 180_000,
  streamEnabled: true
});
```

- `profileDir` must be a persistent, dedicated Chrome user-data directory.
- `enabled` is intentionally required so callers opt in to browser automation.
- `headed` should be `true` for first login and troubleshooting; set `false` only after the profile is authenticated.
- `timeoutMs` is the normal turn budget. Deep research and image generation automatically use higher minimums because those tools can sit quiet for minutes.
- `streamEnabled` reads ChatGPT's response stream from CDP network events, with DOM polling as the fallback. Set it to `false` to force DOM-only reads.

## Error Handling

All deliberate package failures use `ChatGptBrowserError`:

```typescript
try {
  await backend.run(request);
} catch (error) {
  const serialized = serializeChatGptBrowserError(error);
  logger.error(serialized);
}
```

Common codes:

- `CHATGPT_BROWSER_MODE_DISABLED` — set `enabled: true` before using the browser backend.
- `CHATGPT_BROWSER_UNSUPPORTED_PLATFORM` — run on macOS, Linux, or Windows with a GUI session.
- `CHATGPT_BROWSER_RATE_LIMITED` — ChatGPT reported a usage cap; wait or switch account/model.
- `CHATGPT_BROWSER_CHALLENGE_REQUIRED` — complete the visible browser challenge in the managed Chrome profile.
- `CHATGPT_BROWSER_EXECUTION_FAILED` — the UI, renderer, CDP connection, or selector flow failed. Run diagnostics and inspect the managed browser.
- `CHATGPT_ACCOUNT_MEMORY_NOT_CONFIRMED` — ChatGPT did not verify the requested Saved Memory write.

Unexpected errors serialize as `CHATGPT_INTERNAL_ERROR` so callers can log a stable shape without losing process control.

## Reliability

The browser backend is built for flaky local browser automation:

- Consults are retried up to three times when the failure is classified as transient, such as a closed WebSocket, renderer context destruction, target crash, navigation race, or CDP command timeout.
- Permanent failures are not retried: missing Chrome, disabled browser mode, unauthenticated profiles, rate limits, challenges, unsupported platforms, and response timeouts fail fast with an actionable suggestion.
- DevTools HTTP `GET` calls retry short-lived connection failures, 5xx responses, and incomplete JSON while Chrome is starting or publishing targets.
- Mutating DevTools calls, such as creating a target, are not blindly retried because a retry could create duplicate windows or tabs.
- Continuations lock per conversation URL so two callers do not post into the same ChatGPT thread concurrently; unrelated fresh chats and different conversations can run in parallel windows.
- Generated image artifacts are written under the caller-provided artifact directory with traversal, MIME, count, and size checks.

Run `backend.healthCheck()` before first use or after selector breakage. It checks platform support, browser mode, Chrome/profile access, authentication, and live selector health where possible.

## A note on what this is

This automates a signed-in browser session against ChatGPT's web interface. That means it depends on UI structure that can change without notice (see `selectors.ts`), and its use is subject to OpenAI's terms for the ChatGPT product. Treat selector breakage as expected maintenance, not as a bug in the protocol layer.

## Development

```bash
npm install
npm run build        # src/ → dist/
npm run typecheck    # strict mode, exact optional properties, checked indexed access
npm test             # vitest, 82 tests
npx vitest run src/response.test.ts   # single file
```

## License

MIT — built by Jonus Nattapong (@jonusnattapong)

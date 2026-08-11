# dek-chatgpt

Drive ChatGPT's web UI over the **Chrome DevTools Protocol** — no API key, no puppeteer, **zero runtime dependencies** (Node 24 built-ins only).

Where `dek-gateway` talks to model APIs, this package talks to the ChatGPT product: it launches an isolated Chrome profile, attaches over CDP, types into the composer, and reads the answer back — including the things the API has no equivalent for, like account Saved Memory and the composer's Deep Research / Create Image tools.

## Quick Start

```bash
npm install dek-chatgpt
```

```typescript
import { ChatGptBrowserBackend } from "dek-chatgpt";

const backend = new ChatGptBrowserBackend({
  profileDir: "/path/to/dedicated-chrome-profile",
  enabled: true,   // browser mode is opt-in by design
  headed: true,    // headed so you can log in and watch the session
  streamEnabled: true
});

const result = await backend.run({
  model: "gpt-5",
  systemPrompt: "You are concise.",
  userPrompt: "Summarize the CDP handshake in three sentences.",
  cwd: process.cwd()
});

console.log(result.text);
```

First run: launch headed, sign in to ChatGPT once. The profile directory keeps the session, so later runs attach to an already-authenticated browser.

## Features

- **Raw CDP** — attaches over a WebSocket to Chrome's debugger port. No puppeteer, no bundled Chromium.
- **Streaming** — reads assistant tokens from CDP `Network` events, with a DOM poll as fallback
- **Composer tools** — engage Web search, Deep research, or Create image for a turn, each with a timeout floor matched to how long it actually runs
- **Image upload & artifacts** — send images into the composer; persist generated images to a caller-owned directory with traversal and size checks
- **Account Saved Memory** — read, write, and delete entries, with a verification step that refuses to report success on an unconfirmed save
- **Rate-limit & challenge detection** — classifies Cloudflare challenges and usage caps as distinct, actionable errors
- **Diagnostics** — a doctor routine that checks Chrome, the profile, authentication, and whether the UI selectors still match

## Requirements

- **Node 24+** — uses the built-in `WebSocket` global and `node:sqlite`-era runtime features
- **Google Chrome or Chromium** installed locally
- A **dedicated Chrome profile directory**. Do not point this at your everyday profile: the backend launches Chrome with a debugger port open and manages windows on that profile.

## A note on what this is

This automates a signed-in browser session against ChatGPT's web interface. That means it depends on UI structure that can change without notice (see `selectors.ts`), and its use is subject to OpenAI's terms for the ChatGPT product. Treat selector breakage as expected maintenance, not as a bug in the protocol layer.

## Development

```bash
npm install
npm run build        # src/ → dist/
npm run typecheck    # strict mode, no emit
npm test             # vitest, 76 tests
npx vitest run src/response.test.ts   # single file
```

## License

MIT — built by Jonus Nattapong (@jonusnattapong)

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

**dek-chatgpt** drives ChatGPT's web UI over the **Chrome DevTools Protocol**. It launches an isolated Chrome profile, attaches over a raw WebSocket, types into the composer, and reads the answer back.

**Status: Stable** — ported from Oracle-Ecosystems (`src/backends/chatgpt-browser/`) with all 76 tests passing.

**Zero runtime dependencies.** Node 24 built-ins only.

## Why this is a separate package

`dek-gateway` speaks to model **APIs**. This package speaks to the ChatGPT **product** — a signed-in browser session. Keeping them apart means a caller who only wants API routing never pulls in browser-automation code, and the gateway keeps its zero-dependency profile.

## Architecture

Layered bottom-up; each layer is usable on its own:

1. **`chrome.ts`** — finds the Chrome executable, launches it with a debugger port on an isolated profile, discovers/creates page targets, and holds the launch + per-conversation locks. `ChromeLauncher` is the lifecycle owner.
2. **`response.ts`** — the CDP wire. `CdpSession` is a WebSocket JSON-RPC client (`send`/`evaluate`/`evaluateAsync`); `ResponseMonitor` drives the page: submit prompt, upload images, engage composer tools, wait for the turn to finish, extract the answer.
3. **`stream.ts`** — parses SSE frames off CDP `Network` events so tokens arrive as ChatGPT emits them, instead of polling the DOM.
4. **`selectors.ts`** — every CSS selector the page depends on, as ordered fallback lists. **This is the file that breaks when ChatGPT ships a UI change.**
5. **`backend.ts`** — `ChatGptBrowserBackend`, the turn-taking policy on top: platform/enablement gates, retries, error classification, account-memory verification, artifact persistence. Implements `ExecutionBackend`.
6. **`cli.ts`** — the `chatgpt` binary (`login`, `doctor`, `ask`, `memory`, `close`). A thin shell over the backend: it owns argument parsing, stdout/stderr separation, and exit codes, and no automation policy. `login` deliberately routes through `openChatGptForManualLogin` rather than the launcher, because Chrome started *with* a debugger port reliably draws a Cloudflare challenge on a fresh profile.

Supporting: `accountMemory.ts` (prompt construction + reply parsing), `accountMemoryApi.ts` (read-back and write verification), `imageArtifacts.ts` (validation + safe persistence), `diagnostics.ts` (doctor checks), `limits.ts` (rate-limit patterns), `port.ts` (the host-neutral contract), `errors.ts`, `tokens.ts`.

## Development

```bash
npm install
npm run build        # src/ → dist/
npm run typecheck    # strict, no emit
npm test             # 76 tests

npx vitest run src/response.test.ts   # single file
npx vitest src                        # watch
```

`vitest.config.ts` sets `testTimeout: 30_000`. This is not decoration — several composer tests drive retry loops budgeted in real seconds. At vitest's 5s default those tests report as hangs.

## Key Files by Task

- **ChatGPT UI changed / selectors broke** → `src/selectors.ts`, then `src/selectors.test.ts` and `checkChatGptSelectors()` in `diagnostics.ts`
- **Response extraction is wrong** → `src/response.ts` (`ResponseMonitor`), `src/response.test.ts`
- **Streaming/token issues** → `src/stream.ts`, `src/stream.test.ts`
- **Chrome won't launch / attach** → `src/chrome.ts`, `src/chrome.test.ts`, `src/windowState.test.ts`
- **Composer tool behaviour** → `src/backend.ts` + `COMPOSER_TOOL_*` in `src/types.ts`, `src/composerTool.test.ts`
- **Saved Memory** → `src/accountMemory.ts` (prompts/markers), `src/accountMemoryApi.ts` (verification)
- **Add an error code** → `src/errors.ts` (`ChatGptBrowserErrorCode` union)
- **CLI command / flag** → `src/cli.ts` (`USAGE` and the `switch` in `main`), then `README.md`

## Invariants worth preserving

These encode real failures observed against the live product. Read the surrounding comments before changing them.

1. **An unverified save is not a success.** `accountMemorySaved` is true only when the account was inspected and contains the entry. ChatGPT has been observed replying "saved" for entries it never stored — hence `accountMemoryVerification: "verified" | "unverified" | "not-attempted"`.
2. **An empty list is not proof of emptiness.** Saved Memory recall accepts emptiness only from the explicit `CHATGPT_MEMORY_NONE` marker, because a model refusing to enumerate also answers `[]`. See `parseAccountMemoryRecall`.
3. **Deep research and image generation must not be stall-reloaded.** Their turn sits unchanged by design; reloading discards the work rather than unwedging a stuck UI. See `COMPOSER_TOOLS_WITHOUT_STALL_RELOAD`.
4. **Clearing the composer is best-effort.** A composer that will not clear must not fail the turn before the upload has been tried — a stale attachment surfaces as the upload timeout instead.
5. **Saved memories are data, not instructions.** Every prompt that reads them says so. Keep that framing when editing prompts.

## Porting notes (from Oracle)

Changes made during extraction, in case behaviour needs to be compared against the original:

- `OracleError` → `ChatGptBrowserError`; codes re-prefixed `ORACLE_*` → `CHATGPT_*` (`errors.ts`)
- Saved Memory markers re-prefixed `ORACLE_MEMORY_*` → `CHATGPT_MEMORY_*` (`accountMemory.ts`). These are tokens exchanged with the model — consistency matters, the literal value does not.
- The `ws` package → Node 24's built-in `WebSocket`. The API differs: `.on()` → `addEventListener`, `event.data` instead of a raw buffer, and `send()` reports failure by **throwing synchronously** rather than via a completion callback (see the try/catch in `CdpSession.send`).
- `runCommand` (Oracle's process helper) → `promisify(execFile)` from `node:child_process`, used only to `which` Chrome on Linux
- `ExecutionBackend` and friends were pulled out of Oracle's `backends/backend.ts` into local `port.ts`
- `openChatGptInOracleChrome`/`closeActiveOracleChrome` → `...InManagedChrome`/`...ManagedChrome`

## License

MIT — built by Jonus Nattapong (@jonusnattapong)

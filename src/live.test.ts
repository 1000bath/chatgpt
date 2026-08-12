import { describe, expect, test } from "vitest";
import { ChatGptBrowserBackend } from "./backend.js";
import { checkChatGptSelectors, checkLiveChatGptAuthentication } from "./diagnostics.js";

/**
 * Live smoke tests.
 *
 * These tests require a real Chrome, a real ChatGPT account, and a real
 * network. They are skipped unless `CHATGPT_LIVE=1` is set, so the default
 * CI run does not touch ChatGPT. Run them locally with:
 *
 *   CHATGPT_LIVE=1 PROFILE_DIR=/path/to/profile npx vitest run src/live.test.ts
 *
 * The tests are not exhaustive — they only catch the changes that hit you
 * hardest: selectors that break without warning, expired sessions, and a
 * selector drift that no longer blocks but has clearly fallen through to a
 * fallback.
 */

const ENABLED = process.env["CHATGPT_LIVE"] === "1";
const PROFILE_DIR = process.env["PROFILE_DIR"] ?? "/tmp/chatgpt-live-profile";

const describeLive = ENABLED ? describe : describe.skip;

describeLive("live ChatGPT smoke", () => {
  test("checkChatGptSelectors reports each group as matched at index 0", async () => {
    const checks = await checkChatGptSelectors({
      profileDir: PROFILE_DIR,
      enabled: true,
      headed: true
    });
    const failed = checks.filter((c) => !c.ok);
    if (failed.length > 0) {
      // Surfacing these so the failure is not just "selectors skipped" but a
      // readable list of exactly which ones drifted.
      const summary = failed.map((c) => `  • ${c.name}: ${c.detail}`).join("\n");
      throw new Error(`Selector drift detected:\n${summary}`);
    }
    expect(failed).toHaveLength(0);
  }, 90_000);

  test("checkLiveChatGptAuthentication detects a signed-in account", async () => {
    const check = await checkLiveChatGptAuthentication({
      profileDir: PROFILE_DIR,
      enabled: true,
      headed: true
    });
    if (!check.ok) {
      throw new Error(`Authentication check failed: ${check.detail}`);
    }
    expect(check.ok).toBe(true);
  }, 90_000);

  test("backend runs a single consult turn against the live product", async () => {
    const backend = new ChatGptBrowserBackend({
      profileDir: PROFILE_DIR,
      enabled: true,
      headed: true,
      timeoutMs: 120_000
    });
    const response = await backend.run({
      model: "gpt-5.4",
      systemPrompt: "You are concise.",
      userPrompt: "Reply with the single word: pong",
      cwd: process.cwd()
    });
    expect(response.text.toLowerCase()).toContain("pong");
    expect(response.usage.totalTokens).toBeGreaterThan(0);
  }, 180_000);
});

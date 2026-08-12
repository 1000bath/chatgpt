import { describe, expect, test } from "vitest";
import type { ExecutionBackend } from "./port.js";
import { ChatGptBrowserBackend } from "./backend.js";

/**
 * Properties every `ExecutionBackend` implementation in this monorepo must
 * hold. Tests a host (gateway, agent) would write against the contract
 * itself go here, so the contract body cannot drift away from how the
 * backend actually behaves.
 */

function freshBackend(): ChatGptBrowserBackend {
  return new ChatGptBrowserBackend({
    profileDir: "/tmp/fake-profile",
    enabled: false,
    headed: true
  });
}

function implementsExecutionBackend(backend: ChatGptBrowserBackend): ExecutionBackend {
  // Compile-time structural check; the test also exercises the runtime shape.
  return backend;
}

describe("ExecutionBackend contract", () => {
  test("advertises a stable id and supported capabilities", () => {
    const backend = implementsExecutionBackend(freshBackend());
    expect(typeof backend.id).toBe("string");
    expect(backend.id.length).toBeGreaterThan(0);
    expect(backend.capabilities).toMatchObject({
      consult: expect.any(Boolean),
      toolUse: expect.any(Boolean),
      images: expect.any(Boolean),
      continuation: expect.any(Boolean),
      structuredUsage: expect.any(Boolean),
      supportedPlatforms: expect.any(Array)
    });
    for (const platform of backend.capabilities.supportedPlatforms) {
      expect(["darwin", "linux", "win32"]).toContain(platform);
    }
  });

  test("never throws on healthCheck — returns a check array even when things fail", async () => {
    const backend = implementsExecutionBackend(freshBackend());
    const checks = await backend.healthCheck();
    expect(Array.isArray(checks)).toBe(true);
    // Every check has the contract shape, regardless of pass/fail.
    for (const check of checks) {
      expect(typeof check.name).toBe("string");
      expect(typeof check.ok).toBe("boolean");
      expect(typeof check.detail).toBe("string");
    }
  });

  test("pre-flight rejections carry actionable suggestions", async () => {
    const backend = implementsExecutionBackend(freshBackend());
    await expect(
      backend.run({
        model: "gpt-5.4",
        systemPrompt: "s",
        userPrompt: "u",
        cwd: "/tmp"
      })
    ).rejects.toMatchObject({
      name: "ChatGptBrowserError",
      code: "CHATGPT_BROWSER_MODE_DISABLED",
      message: expect.any(String),
      suggestion: expect.any(String)
    });
  });

  test("rejects an invalid previousResponseId without hitting Chrome", async () => {
    const backend = new ChatGptBrowserBackend({
      profileDir: "/tmp/fake-profile",
      enabled: true,
      headed: true
    });
    await expect(
      backend.run({
        model: "gpt-5.4",
        systemPrompt: "s",
        userPrompt: "u",
        cwd: "/tmp",
        previousResponseId: "https://example.com/not-a-threat"
      })
    ).rejects.toThrow(/invalid or is not a ChatGPT conversation/);
  });
});

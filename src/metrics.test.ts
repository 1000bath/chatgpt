import { describe, expect, test } from "vitest";
import { ChatGptBrowserMetricsCollector, formatChatGptBrowserMetrics } from "./metrics.js";
import { ChatGptBrowserBackend } from "./backend.js";

describe("ChatGptBrowserMetricsCollector", () => {
  test("rolls up counters from the event stream", () => {
    const collector = new ChatGptBrowserMetricsCollector();
    const events = [
      { type: "run:started" as const, model: "gpt-5.4", continuation: false },
      { type: "answer:received" as const, tier: "stream" as const, durationMs: 1500 },
      {
        type: "run:completed" as const,
        durationMs: 2200,
        usage: { totalTokens: 100 }
      },
      { type: "run:started" as const, model: "gpt-5.4", continuation: false },
      { type: "run:retry" as const, nextAttempt: 2, classification: "transient" as const, message: "ws" },
      { type: "answer:received" as const, tier: "dom" as const, durationMs: 1900 },
      {
        type: "run:failed" as const,
        durationMs: 3000,
        message: "boom",
        code: "CHATGPT_BROWSER_RATE_LIMITED" as const
      }
    ];
    for (const event of events) collector.record(event);

    const snapshot = collector.snapshot();
    expect(snapshot.runsStarted).toBe(2);
    expect(snapshot.runsCompleted).toBe(1);
    expect(snapshot.runsFailed).toBe(1);
    expect(snapshot.retries).toBe(1);
    expect(snapshot.answerTiers).toEqual({ stream: 1, dom: 1 });
    expect(snapshot.rateLimitsObserved).toBe(1);
    expect(snapshot.challengesObserved).toBe(0);
    expect(snapshot.lastAnswerDurationMs).toBe(1900);
    // lastRunDurationMs reflects the most recent successful completion; the
    // average is over completed runs only.
    expect(snapshot.lastRunDurationMs).toBe(2200);
    expect(snapshot.averageRunDurationMs).toBe(2200);
    expect(snapshot.failuresByCode).toEqual({ CHATGPT_BROWSER_RATE_LIMITED: 1 });
  });

  test("attach wires the collector to a backend's event stream", async () => {
    const backend = new ChatGptBrowserBackend({
      profileDir: "/tmp/fake-profile",
      enabled: false,
      headed: true
    });
    const collector = new ChatGptBrowserMetricsCollector();
    collector.attach(backend);

    await backend
      .run({ model: "gpt-5.4", systemPrompt: "s", userPrompt: "u", cwd: "/tmp" })
      .catch(() => undefined);

    const snapshot = collector.snapshot();
    expect(snapshot.runsStarted).toBe(1);
    expect(snapshot.runsFailed).toBe(1);
    expect(snapshot.failuresByCode["CHATGPT_BROWSER_MODE_DISABLED"]).toBe(1);
  });

  test("formatChatGptBrowserMetrics produces a readable summary", () => {
    const collector = new ChatGptBrowserMetricsCollector();
    collector.record({ type: "run:started", model: "gpt-5.4", continuation: false });
    collector.record({ type: "answer:received", tier: "stream", durationMs: 1000 });
    collector.record({
      type: "run:completed",
      durationMs: 1800,
      usage: { totalTokens: 1 }
    });
    const summary = formatChatGptBrowserMetrics(collector.snapshot());
    expect(summary).toContain("runs=1/1");
    expect(summary).toContain("avg=1800ms");
    expect(summary).toContain("stream=100%");
  });
});

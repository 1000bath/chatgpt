import { describe, expect, test, vi } from "vitest";
import { HealthWatcher } from "./watcher.js";
import type { ExecutionBackend, DoctorCheck } from "./port.js";

function fakeBackend(checks: DoctorCheck[], failNext = false): ExecutionBackend {
  return {
    id: "fake",
    capabilities: {
      consult: true, toolUse: false, images: false, continuation: false,
      structuredUsage: false, supportedPlatforms: ["linux" as const]
    },
    run: () => Promise.reject(new Error("not used")),
    async healthCheck() {
      if (failNext) throw new Error("healthCheck exploded");
      return checks;
    }
  };
}

describe("HealthWatcher", () => {
  test("replays every healthCheck result to onReport until stopped", async () => {
    const checks: DoctorCheck[] = [{ name: "platform", ok: true, detail: "linux" }];
    const backend = fakeBackend(checks);
    const reports: { ok: boolean }[] = [];
    const watcher = new HealthWatcher(backend, {
      intervalMs: 20,
      onReport: (report) => {
        reports.push({ ok: report.ok });
      }
    });
    watcher.start();
    // Wait long enough for two ticks at a 20ms interval.
    await new Promise((resolve) => setTimeout(resolve, 70));
    watcher.stop();
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(reports.length).toBeGreaterThanOrEqual(2);
    expect(reports.every((report) => report.ok === true)).toBe(true);
  });

  test("does not overlap checks when a poll is still running", async () => {
    let inFlight = 0;
    let concurrent = 0;
    const backend: ExecutionBackend = {
      id: "slow",
      capabilities: {
        consult: true, toolUse: false, images: false, continuation: false,
        structuredUsage: false, supportedPlatforms: ["linux" as const]
      },
      run: () => Promise.reject(new Error("not used")),
      async healthCheck() {
        inFlight += 1;
        concurrent = Math.max(concurrent, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 50));
        inFlight -= 1;
        return [{ name: "platform", ok: true, detail: "linux" }];
      }
    };
    const reports: unknown[] = [];
    const watcher = new HealthWatcher(backend, {
      intervalMs: 10,
      onReport: (report) => reports.push(report)
    });
    watcher.start();
    await new Promise((resolve) => setTimeout(resolve, 120));
    watcher.stop();
    expect(concurrent).toBe(1);
    expect(reports.length).toBeGreaterThanOrEqual(1);
  });

  test("reports a failing check as ok=false", async () => {
    const backend = fakeBackend([
      { name: "platform", ok: true, detail: "linux" },
      { name: "chrome executable", ok: false, detail: "missing chrome" }
    ]);
    const reports: { ok: boolean; names: string[] }[] = [];
    const watcher = new HealthWatcher(backend, {
      intervalMs: 20,
      onReport: (report) => reports.push({ ok: report.ok, names: report.checks.map((c) => c.name) })
    });
    watcher.start();
    await new Promise((resolve) => setTimeout(resolve, 60));
    watcher.stop();
    expect(reports[0]?.ok).toBe(false);
  });

  test("surfaces a healthCheck rejection instead of crashing", async () => {
    const backend = fakeBackend([], /* failNext */ true);
    const onError = vi.fn();
    const reports: { ok: boolean }[] = [];
    const watcher = new HealthWatcher(backend, {
      intervalMs: 20,
      onReport: (report) => reports.push({ ok: report.ok }),
      onError
    });
    watcher.start();
    await new Promise((resolve) => setTimeout(resolve, 60));
    watcher.stop();
    expect(onError).toHaveBeenCalled();
    expect(reports.every((report) => report.ok === false)).toBe(true);
  });

  test("rejects a non-positive interval", () => {
    expect(() => new HealthWatcher(fakeBackend([]), { intervalMs: 0, onReport: () => undefined }))
      .toThrow(/intervalMs must be a positive number/);
  });

  test("stop then start throws", async () => {
    const watcher = new HealthWatcher(fakeBackend([]), {
      intervalMs: 20,
      onReport: () => undefined
    });
    watcher.start();
    watcher.stop();
    expect(() => watcher.start()).toThrow(/has been stopped/);
  });
});

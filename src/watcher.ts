import type { DoctorCheck, ExecutionBackend } from "./port.js";

/**
 * A health report as produced by {@link HealthWatcher}. `ok` is true only when
 * every check in `checks` passes — a single failing check fails the report.
 */
export interface HealthReport {
  at: string;
  ok: boolean;
  checks: DoctorCheck[];
}

export interface HealthWatcherOptions {
  /** Milliseconds between checks. Defaults to 60_000. */
  intervalMs?: number;
  /** Report a check the moment it finishes, before the next tick. */
  onReport: (report: HealthReport) => void | Promise<void>;
  /** Called when a check itself rejects, instead of the error killing the loop. */
  onError?: (error: unknown) => void;
}

function toIsoDate(): string {
  return new Date().toISOString();
}

/**
 * Polls an {@link ExecutionBackend}'s `healthCheck` on a fixed cadence and
 * hands each report to a caller-supplied callback. The watcher never overlaps
 * checks: if a poll is still running when the next tick fires, that tick is
 * skipped rather than queued, so a single slow Chrome detection does not
 * stack up pending health checks.
 *
 * Intended for daemon-style usage (a cron job that pings an inbox) or a
 * long-lived agent loop that wants early warning before a consult fails.
 */
export class HealthWatcher {
  readonly intervalMs: number;
  private readonly onReport: (report: HealthReport) => void | Promise<void>;
  private readonly onError?: (error: unknown) => void;
  readonly backend: ExecutionBackend;
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private stopped = false;

  constructor(backend: ExecutionBackend, options: HealthWatcherOptions) {
    if (typeof options.intervalMs === "number" && options.intervalMs <= 0) {
      throw new Error(`intervalMs must be a positive number, got ${options.intervalMs}`);
    }
    this.backend = backend;
    this.intervalMs = options.intervalMs ?? 60_000;
    this.onReport = options.onReport;
    this.onError = options.onError;
  }

  start(): void {
    if (this.stopped) throw new Error("HealthWatcher has been stopped and cannot be restarted.");
    if (this.timer) return; // already running
    void this.tick();
    this.timer = setInterval(() => {
      void this.tick();
    }, this.intervalMs);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  private async tick(): Promise<void> {
    if (this.running) return; // a check is still in flight; skip this tick
    this.running = true;
    try {
      const checks = await this.backend.healthCheck();
      await this.onReport({
        at: toIsoDate(),
        ok: checks.every((check) => check.ok),
        checks
      });
    } catch (error) {
      this.onError?.(error);
      // healthCheck rejecting is itself a failing state worth reporting rather
      // than hiding behind a swallowed error.
      try {
        await this.onReport({
          at: toIsoDate(),
          ok: false,
          checks: [
            { name: "healthCheck", ok: false, detail: error instanceof Error ? error.message : String(error) }
          ]
        });
      } catch {
        // onReport is best-effort; never let it crash the loop.
      }
    } finally {
      this.running = false;
    }
  }
}

import type { ChatGptBrowserEvent } from "./events.js";
import type { ChatGptBrowserErrorCode } from "./errors.js";

/**
 * Cumulative metrics for the lifetime of a backend instance.
 *
 * Counters are computed from the event stream the backend already emits, so
 * there is no parallel hook to keep in sync. The metrics object is itself a
 * value: callers can snapshot it any time and round-trip it through JSON.
 */
export interface ChatGptBrowserMetrics {
  runsStarted: number;
  runsCompleted: number;
  runsFailed: number;
  retries: number;
  /** Last `answer:received` duration in ms. `null` when no answer has arrived. */
  lastAnswerDurationMs: number | null;
  /** Last `run:completed` total in ms. `null` when no run has ended yet. */
  lastRunDurationMs: number | null;
  /** Average `run:completed` duration in ms, or `null` when no completions. */
  averageRunDurationMs: number | null;
  answerTiers: { stream: number; dom: number };
  challengesObserved: number;
  rateLimitsObserved: number;
  /** Failures grouped by `ChatGptBrowserErrorCode`. */
  failuresByCode: Record<string, number>;
}

/**
 * Listens to a backend's event stream and rolls up the numbers a caller
 * typically wants from observability — completion count, retry count, average
 * turn duration, fractions of stream- vs dom-tier answers, and failure
 * counts grouped by error code.
 */
export class ChatGptBrowserMetricsCollector {
  private durationSum = 0;
  private durationCount = 0;
  private failuresByCode: Record<string, number> = {};

  readonly metrics: ChatGptBrowserMetrics = {
    runsStarted: 0,
    runsCompleted: 0,
    runsFailed: 0,
    retries: 0,
    lastAnswerDurationMs: null,
    lastRunDurationMs: null,
    averageRunDurationMs: null,
    answerTiers: { stream: 0, dom: 0 },
    challengesObserved: 0,
    rateLimitsObserved: 0,
    failuresByCode: {}
  };

  record(event: ChatGptBrowserEvent): void {
    switch (event.type) {
      case "run:started":
        this.metrics.runsStarted += 1;
        return;
      case "run:retry":
        this.metrics.retries += 1;
        return;
      case "answer:received": {
        this.metrics.lastAnswerDurationMs = event.durationMs;
        if (event.tier === "stream") this.metrics.answerTiers.stream += 1;
        else this.metrics.answerTiers.dom += 1;
        return;
      }
      case "run:completed": {
        this.metrics.runsCompleted += 1;
        this.metrics.lastRunDurationMs = event.durationMs;
        this.durationSum += event.durationMs;
        this.durationCount += 1;
        this.metrics.averageRunDurationMs = Math.round(this.durationSum / this.durationCount);
        return;
      }
      case "run:failed": {
        this.metrics.runsFailed += 1;
        this.failuresByCode[event.code ?? "unknown"] =
          (this.failuresByCode[event.code ?? "unknown"] ?? 0) + 1;
        this.metrics.failuresByCode = { ...this.failuresByCode };
        if (event.code === "CHATGPT_BROWSER_CHALLENGE_REQUIRED") this.metrics.challengesObserved += 1;
        if (event.code === "CHATGPT_BROWSER_RATE_LIMITED") this.metrics.rateLimitsObserved += 1;
        return;
      }
      default:
        return;
    }
  }

  /** A point-in-time view of the counters. */
  snapshot(): ChatGptBrowserMetrics {
    return { ...this.metrics, failuresByCode: { ...this.metrics.failuresByCode } };
  }

  /** Wires the collector up to a backend's event stream and returns the unsubscribe. */
  attach(events: {
    onEvent(listener: (event: ChatGptBrowserEvent) => void): () => void;
  }): () => void {
    return events.onEvent((event) => this.record(event));
  }
}

/**
 * Convenience: a JSON-friendly summary string. Useful for `console.log` in
 * long-running daemons. Format is readable, not stable.
 */
export function formatChatGptBrowserMetrics(metrics: ChatGptBrowserMetrics): string {
  const total = metrics.answerTiers.stream + metrics.answerTiers.dom;
  const streamShare = total > 0
    ? Math.round((metrics.answerTiers.stream / total) * 100)
    : 0;
  return [
    `runs=${metrics.runsCompleted}/${metrics.runsStarted}`,
    `failed=${metrics.runsFailed}`,
    `retries=${metrics.retries}`,
    `avg=${metrics.averageRunDurationMs ?? 0}ms`,
    `stream=${streamShare}%`,
    `rate-limits=${metrics.rateLimitsObserved}`,
    `challenges=${metrics.challengesObserved}`
  ].join(" ");
}

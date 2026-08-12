import type { ChatGptBrowserErrorCode } from "./errors.js";
import type { TokenUsage } from "./port.js";
import type { ChatGptComposerTool } from "./types.js";

/**
 * Structured lifecycle events emitted while the backend drives a turn.
 *
 * Callers that want progress instead of one result at the end subscribe with
 * `ChatGptBrowserBackend.onEvent`. The union is closed on purpose: an event
 * either describes something the backend already committed to, or it does not
 * exist.
 */
export type ChatGptBrowserEvent =
  | {
      type: "run:started";
      model: string;
      /** True when the turn continues an existing ChatGPT conversation. */
      continuation: boolean;
      tool?: ChatGptComposerTool;
    }
  | {
      type: "run:retry";
      /** The attempt number about to run (2 or 3). */
      nextAttempt: number;
      classification: "transient" | "permanent";
      message: string;
    }
  | { type: "browser:launched"; port: number }
  | { type: "navigate"; url: string }
  | { type: "memory:update"; kind: "save" | "sync" }
  | { type: "tool:engaged"; tool: ChatGptComposerTool }
  | { type: "prompt:sent" }
  | {
      type: "answer:received";
      /** Which tier produced the answer: the CDP stream or the DOM poller. */
      tier: "stream" | "dom";
      durationMs: number;
    }
  | { type: "run:completed"; durationMs: number; usage: TokenUsage }
  | {
      type: "run:failed";
      durationMs: number;
      message: string;
      code?: ChatGptBrowserErrorCode;
    };

export type ChatGptBrowserEventListener = (event: ChatGptBrowserEvent) => void;

/**
 * Listener-set emitter, matching the `onEvent` shape `CdpSession` already
 * uses. A listener that throws is silenced rather than allowed to fail the
 * turn it is observing: observation must not change the outcome.
 */
export class ChatGptBrowserEventEmitter {
  private readonly listeners = new Set<ChatGptBrowserEventListener>();

  onEvent(listener: ChatGptBrowserEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(event: ChatGptBrowserEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // A broken observer must not break the backend.
      }
    }
  }

  get listenerCount(): number {
    return this.listeners.size;
  }
}

import { describe, expect, test } from "vitest";
import { ChatGptBrowserEventEmitter, type ChatGptBrowserEvent } from "./events.js";
import { ChatGptBrowserBackend } from "./backend.js";

const EVENT: ChatGptBrowserEvent = { type: "prompt:sent" };

describe("ChatGptBrowserEventEmitter", () => {
  test("delivers every event to every listener", () => {
    const emitter = new ChatGptBrowserEventEmitter();
    const seen: ChatGptBrowserEvent[][] = [[], []];
    emitter.onEvent((event) => seen[0]!.push(event));
    emitter.onEvent((event) => seen[1]!.push(event));

    emitter.emit(EVENT);
    emitter.emit({ type: "browser:launched", port: 9222 });

    expect(seen[0]).toHaveLength(2);
    expect(seen[1]).toHaveLength(2);
    expect(emitter.listenerCount).toBe(2);
  });

  test("the returned function unsubscribes", () => {
    const emitter = new ChatGptBrowserEventEmitter();
    const seen: ChatGptBrowserEvent[] = [];
    const unsubscribe = emitter.onEvent((event) => seen.push(event));

    emitter.emit(EVENT);
    unsubscribe();
    emitter.emit(EVENT);

    expect(seen).toHaveLength(1);
    expect(emitter.listenerCount).toBe(0);
  });

  test("a throwing listener does not break the others", () => {
    const emitter = new ChatGptBrowserEventEmitter();
    const seen: ChatGptBrowserEvent[] = [];
    emitter.onEvent(() => {
      throw new Error("broken observer");
    });
    emitter.onEvent((event) => seen.push(event));

    expect(() => emitter.emit(EVENT)).not.toThrow();
    expect(seen).toEqual([EVENT]);
  });
});

describe("ChatGptBrowserBackend events", () => {
  test("emits run:started and run:failed when browser mode is disabled", async () => {
    const backend = new ChatGptBrowserBackend({
      profileDir: "/tmp/fake-profile",
      enabled: false,
      headed: true
    });
    const seen: ChatGptBrowserEvent[] = [];
    backend.onEvent((event) => seen.push(event));

    await backend
      .run({ model: "gpt-5.4", systemPrompt: "s", userPrompt: "u", cwd: "/tmp" })
      .catch(() => undefined);

    expect(seen.map((event) => event.type)).toEqual(["run:started", "run:failed"]);
    const started = seen[0]!;
    expect(started.type === "run:started" && started.model).toBe("gpt-5.4");
    expect(started.type === "run:started" && started.continuation).toBe(false);
    const failed = seen[1]!;
    expect(failed.type === "run:failed" && failed.code).toBe("CHATGPT_BROWSER_MODE_DISABLED");
    expect(failed.type === "run:failed" && typeof failed.durationMs === "number").toBe(true);
  });
});

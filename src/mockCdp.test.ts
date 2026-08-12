import { describe, expect, test } from "vitest";
import { MockCdpServer } from "./mockCdp.js";
import { CdpSession } from "./response.js";

describe("MockCdpServer", () => {
  test("accepts a CdpSession and answers simple commands", async () => {
    const replies: Record<string, unknown> = {
      "Runtime.evaluate": { result: { value: 42 } }
    };
    const server = new MockCdpServer({
      pages: [{ url: "https://chatgpt.com", methodResults: replies }]
    });
    const port = await server.start();
    try {
      // Construct the WebSocket URL the way `chrome.ts` would: query /json/version
      const version = await fetch(`http://127.0.0.1:${port}/json/version`).then((res) => res.json() as Promise<{ webSocketDebuggerUrl: string }>);
      const session = new CdpSession(version.webSocketDebuggerUrl);
      await session.connect();
      const value = await session.evaluate("1 + 1");
      expect(value).toBe(42);
      await session.close();
    } finally {
      await server.stop();
    }
  });

  test("tracks what the client sent", async () => {
    const server = new MockCdpServer({ pages: [{}] });
    const port = await server.start();
    try {
      const version = await fetch(`http://127.0.0.1:${port}/json/version`).then((res) => res.json() as Promise<{ webSocketDebuggerUrl: string }>);
      const session = new CdpSession(version.webSocketDebuggerUrl);
      await session.connect();
      await session.send("Page.enable");
      await session.send("Runtime.enable");
      await session.close();
      expect(server.receivedCommands.map((c) => c.method)).toEqual([
        "Page.enable",
        "Runtime.enable"
      ]);
    } finally {
      await server.stop();
    }
  });
});

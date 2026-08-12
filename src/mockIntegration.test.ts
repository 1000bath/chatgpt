import { describe, expect, test, beforeEach, afterEach } from "vitest";
import { MockCdpServer } from "./mockCdp.js";
import { CdpSession } from "./response.js";

/**
 * Mock CdpSession wrapping the test's server connection. The integration
 * level being tested here is the wire, not the turn policy — the turn policy
 * is exercised by the live smoke tests and by the existing live tests.
 */
describe("CdpSession over a mock CDP peer", () => {
  let server: MockCdpServer;
  let session: CdpSession;

  beforeEach(async () => {
    server = new MockCdpServer({
      pages: [{ url: "https://chatgpt.com", methodResults: {} }]
    });
    const port = await server.start();
    const version = await fetch(`http://127.0.0.1:${port}/json/version`).then((res) => res.json() as Promise<{ webSocketDebuggerUrl: string }>);
    session = new CdpSession(version.webSocketDebuggerUrl);
    await session.connect();
  });

  afterEach(async () => {
    session.close();
    await server.stop();
  });

  test("echoes an event back to onEvent listeners", async () => {
    const seen: string[] = [];
    session.onEvent((event) => seen.push(event.method));
    server.receivedCommands; // not used, keeps the linter happy
    // The mock sends pre-baked events on a per-page basis; spin a page with one.
    const server2 = new MockCdpServer({
      pages: [{
        url: "https://chatgpt.com",
        events: [{ method: "Network.responseReceived", params: { requestId: "1" } }]
      }]
    });
    const port = await server2.start();
    const version = await fetch(`http://127.0.0.1:${port}/json/version`).then((res) => res.json() as Promise<{ webSocketDebuggerUrl: string }>);
    const session2 = new CdpSession(version.webSocketDebuggerUrl);
    await session2.connect();
    const seen2: string[] = [];
    session2.onEvent((event) => seen2.push(event.method));
    await session2.send("Page.enable");
    expect(seen2).toEqual(["Network.responseReceived"]);
    session2.close();
    await server2.stop();
  });

  test("rejects pending commands with a CDP error when the peer replies with one", async () => {
    const server2 = new MockCdpServer({
      pages: [{
        url: "https://chatgpt.com",
        methodResults: {
          "Runtime.evaluate": { exceptionDetails: { text: "boom" } }
        }
      }]
    });
    const port = await server2.start();
    const version = await fetch(`http://127.0.0.1:${port}/json/version`).then((res) => res.json() as Promise<{ webSocketDebuggerUrl: string }>);
    const session2 = new CdpSession(version.webSocketDebuggerUrl);
    await session2.connect();
    await expect(session2.evaluate("1 + 1")).rejects.toThrow(/Runtime.evaluate exception/);
    session2.close();
    await server2.stop();
  });

  test("multiple commands are answered in order", async () => {
    const methods: string[] = [];
    for (const method of ["Page.enable", "Runtime.enable", "Network.enable"]) {
      await session.send(method);
      methods.push(method);
    }
    expect(server.receivedCommands.map((c) => c.method)).toEqual(methods);
  });
});

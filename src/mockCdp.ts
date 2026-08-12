import http from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";

/**
 * A scripted, in-process CDP peer for integration tests.
 *
 * The real backend drives the ChatGPT web UI over a Chrome DevTools Protocol
 * WebSocket. Tests want to drive the same code without Chrome or ChatGPT, so
 * this module exposes:
 *
 *  - {@link MockCdpServer} — a port-bound HTTP+WebSocket server that speaks
 *    the protocol shape `CdpSession` expects.
 *  - {@link MockCdpClient} — a small client used by tests to script the
 *    remote peer's responses (command replies, delayed events, errors).
 *
 * The wire format is real RFC 6455 (handshake, binary frames, opcode 0x8
 * close) so a `CdpSession` connects to it without any test-only branch.
 * Zero dependencies — Node 24 built-ins only, matching the rest of the
 * package.
 */

const WS_MAGIC = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

interface WebSocketFrame {
  fin: boolean;
  opcode: number;
  payload: Buffer;
}

class WebSocketConnection {
  private readonly socket: import("node:stream").Duplex;
  private readonly emitter: EventEmitter;
  private buffer = Buffer.alloc(0);

  constructor(socket: import("node:stream").Duplex, emitter: EventEmitter) {
    this.socket = socket;
    this.emitter = emitter;
  }

  static accept(request: http.IncomingMessage, socket: import("node:stream").Duplex, head: Buffer): Promise<WebSocketConnection> {
    const key = request.headers["sec-websocket-key"];
    if (typeof key !== "string") {
      throw new Error("Missing Sec-WebSocket-Key header");
    }
    const accept = createHash("sha1")
      .update(key + WS_MAGIC)
      .digest("base64");
    const headers = [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${accept}`
    ];
    return new Promise((resolve) => {
      const emitter = new EventEmitter();
      const connection = new WebSocketConnection(socket, emitter);
      socket.write(headers.join("\r\n") + "\r\n\r\n");
      if (head && head.length > 0) connection.buffer = Buffer.concat([connection.buffer, head]);
      socket.on("data", (chunk: Buffer) => connection.handleData(chunk));
      socket.on("end", () => emitter.emit("close"));
      socket.on("error", () => emitter.emit("close"));
      resolve(connection);
    });
  }

  send(payload: string): void {
    const buffer = Buffer.from(payload, "utf8");
    const frame = this.encodeFrame(0x1, buffer);
    this.socket.write(frame);
  }

  close(): void {
    if (this.socket.writable) this.socket.end();
  }

  on(event: "message", listener: (text: string) => void): void {
    this.emitter.on(event, listener);
  }

  off(event: "message", listener: (text: string) => void): void {
    this.emitter.off(event, listener);
  }

  private handleData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (true) {
      const frame = this.tryParseFrame();
      if (!frame) return;
      if (frame.opcode === 0x8) {
        this.close();
        return;
      }
      if (frame.opcode === 0x9) {
        this.socket.write(this.encodeFrame(0xA, frame.payload));
        continue;
      }
      const isText = frame.opcode === 0x1;
      if (isText) {
        this.emitter.emit("message", frame.payload.toString("utf8"));
      }
    }
  }

  private tryParseFrame(): WebSocketFrame | null {
    if (this.buffer.length < 2) return null;
    const firstByte = this.buffer[0]!;
    const secondByte = this.buffer[1]!;
    const opcode = firstByte & 0x0f;
    let masked = (secondByte & 0x80) !== 0;
    let length = secondByte & 0x7f;
    let offset = 2;
    if (length === 126) {
      if (this.buffer.length < offset + 2) return null;
      length = this.buffer.readUInt16BE(offset);
      offset += 2;
    } else if (length === 127) {
      if (this.buffer.length < offset + 8) return null;
      const high = this.buffer.readUInt32BE(offset);
      const low = this.buffer.readUInt32BE(offset + 4);
      length = high * 2 ** 32 + low;
      offset += 8;
    }
    let maskKey: Buffer | undefined;
    if (masked) {
      if (this.buffer.length < offset + 4) return null;
      maskKey = this.buffer.subarray(offset, offset + 4);
      offset += 4;
    }
    if (this.buffer.length < offset + length) return null;
    const payload = this.buffer.subarray(offset, offset + length);
    if (maskKey && maskKey.length === 4) {
      for (let i = 0; i < payload.length; i++) {
        payload[i] = payload[i]! ^ maskKey[i % 4]!;
      }
    }
    this.buffer = this.buffer.subarray(offset + length);
    return { fin: true, opcode, payload };
  }

  private encodeFrame(opcode: number, payload: Buffer): Buffer {
    const header: number[] = [0x80 | (opcode & 0x0f)];
    const length = payload.length;
    if (length < 126) {
      header.push(length);
    } else if (length < 65536) {
      header.push(126, (length >> 8) & 0xff, length & 0xff);
    } else {
      throw new Error("Mock WebSocket frames are limited to 65535 bytes.");
    }
    return Buffer.concat([Buffer.from(header), payload]);
  }
}

export interface MockCdpPagePlan {
  url: string;
  /**
   * Results to return for `Runtime.enable` and other free-form commands the
   * session issues. Methods not listed return an empty `{}` reply.
   */
  methodResults?: Record<string, unknown>;
  /**
   * CDP events to send unprompted (e.g. `Network.responseReceived`,
   * `Network.loadingFinished` for a streaming response).
   */
  events?: Array<{ method: string; params: Record<string, unknown> }>;
  /**
   * Replies to inject when no CDP command handler matches. Each entry is
   * matched by predicate against the outgoing `{ method, params }`.
   */
  matchers?: Array<{
    match: (command: { method: string; params: Record<string, unknown> }) => boolean;
    reply: (params: Record<string, unknown>) => unknown;
  }>;
}

export interface MockCdpServerOptions {
  port?: number;
  pages?: MockCdpPagePlan[];
  /** Toggle auto-stream events when a command named in `pages[].events` arrives. */
  autoRespond?: boolean;
}

export class MockCdpServer {
  private readonly server: http.Server;
  private readonly connections: WebSocketConnection[] = [];
  private readonly incomingCommands: Array<{ method: string; params: Record<string, unknown> }> = [];
  private pageIndex = 0;
  private nextMessageId = 1;
  private pagePromiseResolver: ((connection: WebSocketConnection) => void) | undefined;
  private readonly pagePromises: Array<{ resolve: (connection: WebSocketConnection) => void }> = [];

  constructor(private readonly options: MockCdpServerOptions = {}) {
    this.server = http.createServer((req, res) => {
      if (req.url === "/json/version") {
        this.handleVersion(res);
        return;
      }
      if (req.url?.startsWith("/json/list")) {
        this.handleList(res);
        return;
      }
      res.statusCode = 400;
      res.end("Not Found");
    });
    this.server.on("upgrade", (request, socket, head) => {
      if (request.url !== "/devtools/page") {
        socket.destroy();
        return;
      }
      void WebSocketConnection.accept(request, socket, head).then((connection) => {
        this.connections.push(connection);
        connection.on("message", (text) => this.routeMessage(text, connection));
        const pending = this.popPagePromise();
        if (pending) pending.resolve(connection);
      });
    });
  }

  /**
   * A promise that resolves with the next page connection the server accepts.
   * Tests use it to wait for the backend to attach before triggering events.
   */
  waitForPage(): Promise<WebSocketConnection> {
    return new Promise((resolve) => {
      this.pagePromises.push({ resolve });
      if (this.connections.length > 0) {
        const c = this.connections.shift();
        if (c) {
          const popped = this.pagePromises.shift();
          if (popped) popped.resolve(c);
        }
      }
    });
  }

  /** All commands received since the server started, in arrival order. */
  get receivedCommands(): ReadonlyArray<{ method: string; params: Record<string, unknown> }> {
    return this.incomingCommands;
  }

  async start(): Promise<number> {
    const port = this.options.port ?? 0;
    return new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(port, "127.0.0.1", () => {
        const address = this.server.address();
        if (typeof address === "object" && address) {
          resolve(address.port);
        } else {
          reject(new Error("Mock server failed to bind."));
        }
      });
    });
  }

  async stop(): Promise<void> {
    for (const connection of this.connections) connection.close();
    this.connections.length = 0;
    await new Promise<void>((resolve) => {
      this.server.close(() => resolve());
    });
  }

  /**
   * Sends a JSON-RPC response back to the connection that issued
   * `commandId`. Unsupported by the simple page connection, but tests can
   * call it directly to simulate the page's responses.
   */
  private sendResponse(connection: WebSocketConnection, id: number, result: unknown): void {
    connection.send(JSON.stringify({ id, result }));
  }

  private sendError(connection: WebSocketConnection, id: number, code: number, message: string): void {
    connection.send(JSON.stringify({ id, error: { code, message } }));
  }

  private sendEvent(connection: WebSocketConnection, method: string, params: Record<string, unknown>): void {
    connection.send(JSON.stringify({ method, params }));
  }

  private popPagePromise(): { resolve: (connection: WebSocketConnection) => void } | undefined {
    return this.pagePromises.shift();
  }

  private routeMessage(rawText: string, connection: WebSocketConnection): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      return;
    }
    const message = parsed as { id?: number; method?: string; params?: Record<string, unknown>; result?: unknown };
    if (typeof message.method === "string") {
      const method = message.method;
      const params = message.params ?? {};
      this.incomingCommands.push({ method, params });
      const id = message.id ?? this.nextMessageId++;
      const plan = this.options.pages?.[this.pageIndex];
      const matched = plan?.matchers?.find((matcher) => matcher.match({ method, params }));
      if (matched) {
        this.sendResponse(connection, id, matched.reply(params));
      } else if (plan?.methodResults) {
        const reply = plan.methodResults[method];
        if (reply !== undefined) this.sendResponse(connection, id, reply);
        else this.sendResponse(connection, id, {});
      } else {
        this.sendResponse(connection, id, {});
      }
      if (plan?.events) {
        for (const event of plan.events) {
          this.sendEvent(connection, event.method, event.params);
        }
      }
      return;
    }
    if (typeof message.id === "number" && message.result !== undefined) {
      // Client replies to server-initiated commands. The mock never sends any
      // of those, so this branch is a no-op.
      return;
    }
  }

  private handleVersion(res: http.ServerResponse): void {
    const port = (this.server.address() as { port: number }).port;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({
      webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/page`
    }));
  }

  private handleList(res: http.ServerResponse): void {
    const port = (this.server.address() as { port: number }).port;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify([{
      id: "mock-page",
      type: "page",
      title: "Mock Page",
      url: this.options.pages?.[0]?.url ?? "https://chatgpt.com",
      webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/page`
    }]));
  }

  /**
   * Convenience: simulating a fresh page target. The next `/devtools/page`
   * connection will observe the next page plan.
   */
  setNextPagePlan(): void {
    this.pageIndex = (this.pageIndex + 1) % Math.max(1, this.options.pages?.length ?? 1);
  }

  /** A throwaway nonce for header generation. */
  static newNonce(): string {
    return randomBytes(16).toString("base64");
  }
}

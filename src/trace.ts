import fs from "node:fs";
import path from "node:path";

/**
 * One line in a CDP trace file. Traces are JSON Lines so a broken run can be
 * inspected with ordinary tools (`tail -f`, `grep`) while the session is
 * still alive.
 */
export interface CdpTraceEntry {
  /** Epoch milliseconds. */
  ts: number;
  kind: "command" | "result" | "error" | "event";
  method: string;
  /** CDP message id for command/result/error entries. */
  id?: number;
  /** Serialized payload, truncated — expressions and screenshots are megabytes. */
  detail?: string;
}

export interface CdpTraceSink {
  record(entry: CdpTraceEntry): void;
  close(): Promise<void>;
}

const MAX_DETAIL_CHARS = 2_000;

/**
 * Serializes a payload for the trace, cutting anything oversized. The suffix
 * says how much was dropped so a missing tail is never mistaken for the whole
 * message.
 */
export function truncateTraceDetail(value: unknown, maxLength = MAX_DETAIL_CHARS): string | undefined {
  if (value === undefined) return undefined;
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch {
    return "[unserializable]";
  }
  if (serialized === undefined) return undefined;
  if (serialized.length <= maxLength) return serialized;
  return `${serialized.slice(0, maxLength)}…[+${serialized.length - maxLength} chars]`;
}

/**
 * Appends trace entries to a JSON Lines file. Debug aid, off unless the
 * backend runs with `debug: true`; a recorder that is never created costs
 * nothing on the normal path.
 */
export class CdpTraceRecorder implements CdpTraceSink {
  private readonly stream: fs.WriteStream;
  private closed = false;

  constructor(readonly filePath: string) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    this.stream = fs.createWriteStream(filePath, { flags: "a" });
  }

  record(entry: CdpTraceEntry): void {
    if (this.closed) return;
    this.stream.write(`${JSON.stringify(entry)}\n`);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await new Promise<void>((resolve, reject) => {
      this.stream.end((error: Error | null) => (error ? reject(error) : resolve()));
    });
  }
}

/** One trace file per run: timestamp plus pid keeps parallel runs apart. */
export function defaultTraceFilePath(traceDir: string): string {
  return path.join(traceDir, `cdp-trace-${Date.now()}-${process.pid}.jsonl`);
}

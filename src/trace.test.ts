import { describe, expect, test } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { CdpTraceRecorder, defaultTraceFilePath, truncateTraceDetail } from "./trace.js";

describe("truncateTraceDetail", () => {
  test("serializes small payloads in full", () => {
    expect(truncateTraceDetail({ value: 1 })).toBe('{"value":1}');
  });

  test("truncates oversized payloads with a marker", () => {
    const big = "x".repeat(5_000);
    const truncated = truncateTraceDetail({ payload: big });
    expect(truncated).toBeDefined();
    expect(truncated!.length).toBeLessThanOrEqual(2_200);
    expect(truncated).toMatch(/…\[\+\d+ chars\]$/);
  });

  test("returns undefined for undefined", () => {
    expect(truncateTraceDetail(undefined)).toBeUndefined();
  });

  test("reports unserializable payloads", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(truncateTraceDetail(circular)).toBe("[unserializable]");
  });
});

describe("CdpTraceRecorder", () => {
  test("appends JSON Lines and closes cleanly", async () => {
    const tmp = path.join("target", `trace-${Date.now()}-${Math.random()}.jsonl`);
    const recorder = new CdpTraceRecorder(tmp);
    recorder.record({ ts: 1, kind: "command", method: "Runtime.enable", id: 1 });
    recorder.record({ ts: 2, kind: "result", method: "Runtime.enable", id: 1 });
    await recorder.close();
    const content = await fs.readFile(tmp, "utf8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!)).toEqual({ ts: 1, kind: "command", method: "Runtime.enable", id: 1 });
    expect(JSON.parse(lines[1]!)).toMatchObject({ kind: "result", id: 1 });
    await fs.unlink(tmp);
  });

  test("is a no-op after close", async () => {
    const tmp = path.join("target", `trace-closed-${Date.now()}.jsonl`);
    const recorder = new CdpTraceRecorder(tmp);
    await recorder.close();
    recorder.record({ ts: 1, kind: "command", method: "Page.enable", id: 5 });
    recorder.record({ ts: 2, kind: "result", method: "Page.enable", id: 5 });
    await recorder.close();
    const content = await fs.readFile(tmp, "utf8");
    expect(content).toBe("");
    await fs.unlink(tmp);
  });
});

describe("defaultTraceFilePath", () => {
  test("lays the file under the given directory with a pid and timestamp", () => {
    const filePath = defaultTraceFilePath("target/traces");
    expect(filePath.startsWith("target/traces/cdp-trace-")).toBe(true);
    expect(filePath.endsWith(`-${process.pid}.jsonl`)).toBe(true);
  });
});

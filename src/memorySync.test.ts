import { describe, expect, it } from "vitest";
import { buildMemorySyncPrompt, createMemorySnapshot, planMemorySync } from "./memorySync.js";

describe("memory sync", () => {
  it("does not resend an unchanged snapshot", () => {
    const snapshot = createMemorySnapshot(["Prefer concise answers", "Use TypeScript"]);
    expect(planMemorySync(snapshot, createMemorySnapshot(["Use TypeScript", "Prefer concise answers"])).mode).toBe("noop");
  });
  it("sends only additions and removals as a delta", () => {
    const plan = planMemorySync(createMemorySnapshot(["old", "keep"]), createMemorySnapshot(["new", "keep"]));
    expect(plan.mode).toBe("delta");
    expect(plan.added).toEqual(["new"]);
    expect(plan.removed).toEqual(["old"]);
    expect(buildMemorySyncPrompt(plan)).toContain("apply_delta");
  });
  it("sends all entries for an initial sync", () => {
    const plan = planMemorySync(undefined, createMemorySnapshot(["one"]));
    expect(plan.mode).toBe("initial");
    expect(buildMemorySyncPrompt(plan)).toContain("replace_baseline");
  });
});

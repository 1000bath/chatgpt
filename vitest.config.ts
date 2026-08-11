import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // The composer tests drive retry loops that are budgeted in real seconds —
    // `clearComposerAttachments` alone spends its full 10s default before it
    // gives up on an uncooperative composer — so the 5s default reports them as
    // hangs. The ceiling still catches a genuinely stuck test.
    testTimeout: 30_000,
    hookTimeout: 30_000
  }
});

#!/usr/bin/env node
/**
 * Command-line front end for the browser backend.
 *
 * The commands mirror the order a first run actually needs them: `login` to
 * get a signed-in profile past Cloudflare, `doctor` to confirm the page still
 * looks the way the selectors expect, then `ask` for real work. Splitting
 * login out matters — it launches Chrome *without* a debugger port, which is
 * the difference between reaching the sign-in form and sitting on a
 * "Verify you are human" interstitial.
 *
 * Zero runtime dependencies, so argument parsing is `node:util`'s `parseArgs`.
 */

import { parseArgs } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ChatGptBrowserBackend } from "./backend.js";
import { closeActiveManagedChrome, openChatGptForManualLogin } from "./chrome.js";
import {
  BrowserDiagnostics,
  checkChatGptSelectors,
  checkLiveChatGptAuthentication
} from "./diagnostics.js";
import { ChatGptBrowserError, serializeChatGptBrowserError } from "./errors.js";
import { detectImageMime } from "./imageArtifacts.js";
import type { ChatGptBrowserConfig, ChatGptComposerTool } from "./types.js";
import type { DoctorCheck } from "./port.js";

const USAGE = `chatgpt — drive ChatGPT's web UI from the command line

Usage
  chatgpt <command> [options]

Commands
  login              Open Chrome on the profile to sign in (and clear any
                     Cloudflare challenge). Run this once per profile.
  doctor             Check platform, Chrome, profile, selectors, and sign-in.
  ask <prompt>       Send a prompt and print the answer. "-" reads stdin.
  memory             List the signed-in account's saved memories.
  close              Close the managed Chrome for this profile.

Options
  --profile <dir>    Chrome user-data directory to drive.
                     Default: $CHATGPT_PROFILE_DIR, else ~/.chatgpt-cli/profile
  --model <id>       Model to select for the turn (default: gpt-4o)
  --system <text>    System prompt for the turn
  --tool <name>      web-search | deep-research | create-image
  --image <path>     Attach an image (repeatable)
  --artifacts <dir>  Directory to persist generated images into
  --timeout <ms>     Turn budget (default: 180000)
  --headless         Run Chrome headless (default is headed)
  --json             Emit machine-readable JSON instead of prose
  --verbose          Stream lifecycle events to stderr
  --help, -h         Show this help

Notes
  Running this CLI is itself the opt-in for browser automation, so
  experimental browser mode is always enabled here.

  Point --profile at a dedicated directory, never your everyday Chrome
  profile: the backend opens a debugger port and manages windows on it.

Examples
  chatgpt login
  chatgpt doctor
  chatgpt ask "summarize the CDP handshake in three sentences"
  git diff | chatgpt ask - --system "You review diffs."
  chatgpt ask "a fox in the snow" --tool create-image --artifacts ./out
`;

interface GlobalOptions {
  config: ChatGptBrowserConfig;
  json: boolean;
  verbose: boolean;
}

const COMPOSER_TOOLS: readonly string[] = ["web-search", "deep-research", "create-image"];

function defaultProfileDir(): string {
  return process.env.CHATGPT_PROFILE_DIR
    ?? path.join(os.homedir(), ".chatgpt-cli", "profile");
}

/** stdout carries the answer; everything else goes to stderr so pipes stay clean. */
function note(message: string): void {
  process.stderr.write(`${message}\n`);
}

function formatChecks(checks: DoctorCheck[]): string {
  return checks
    .map((check) => `${check.ok ? "ok  " : "FAIL"}  ${check.name}\n        ${check.detail}`)
    .join("\n");
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

async function loadImages(
  paths: string[]
): Promise<Array<{ base64: string; mimeType: string; fileName: string }>> {
  const images = [];
  for (const imagePath of paths) {
    const data = await fs.readFile(imagePath);
    const mimeType = detectImageMime(data);
    if (!mimeType) {
      throw new ChatGptBrowserError(
        "CHATGPT_INVALID_REQUEST",
        `Could not determine an image type for ${imagePath}.`,
        "Attach a PNG, JPEG, or WebP file."
      );
    }
    images.push({
      base64: data.toString("base64"),
      mimeType,
      fileName: path.basename(imagePath)
    });
  }
  return images;
}

async function commandLogin(options: GlobalOptions): Promise<number> {
  const { pid } = await openChatGptForManualLogin(options.config);
  if (options.json) {
    process.stdout.write(`${JSON.stringify({ ok: true, profileDir: options.config.profileDir, pid })}\n`);
    return 0;
  }
  note(`Chrome is opening on ${options.config.profileDir}.`);
  note("");
  note("In that window:");
  note("  1. Complete the Cloudflare check if one appears.");
  note("  2. Sign in to ChatGPT.");
  note("  3. Wait until the message composer is visible, then close the window.");
  note("");
  note("The profile keeps the session, so later runs attach to it. Verify with:");
  note("  chatgpt doctor");
  return 0;
}

async function commandDoctor(options: GlobalOptions): Promise<number> {
  const checks = await new BrowserDiagnostics().runDoctor(options.config);
  // The live checks drive a real page, so they are only worth attempting once
  // the local prerequisites hold; otherwise they fail for a reason already
  // reported above.
  if (checks.every((check) => check.ok)) {
    checks.push(...await checkChatGptSelectors(options.config));
    checks.push(await checkLiveChatGptAuthentication(options.config));
  }

  const ok = checks.every((check) => check.ok);
  if (options.json) {
    process.stdout.write(`${JSON.stringify({ ok, checks }, null, 2)}\n`);
  } else {
    process.stdout.write(`${formatChecks(checks)}\n`);
    if (!ok) {
      note("");
      note("Some checks failed. If sign-in or a challenge is the blocker, run:");
      note("  chatgpt login");
    }
  }
  return ok ? 0 : 1;
}

async function commandAsk(
  options: GlobalOptions,
  positionals: string[],
  values: Record<string, unknown>
): Promise<number> {
  const rawPrompt = positionals[0];
  if (rawPrompt === undefined) {
    note("chatgpt ask needs a prompt. Pass one as an argument, or \"-\" to read stdin.");
    return 2;
  }
  const userPrompt = rawPrompt === "-" ? (await readStdin()).trim() : rawPrompt;
  if (!userPrompt) {
    note("The prompt is empty.");
    return 2;
  }

  const tool = values["tool"] as string | undefined;
  if (tool !== undefined && !COMPOSER_TOOLS.includes(tool)) {
    note(`Unknown --tool ${tool}. Expected one of: ${COMPOSER_TOOLS.join(", ")}`);
    return 2;
  }

  const imagePaths = (values["image"] as string[] | undefined) ?? [];
  const images = imagePaths.length > 0 ? await loadImages(imagePaths) : undefined;

  const backend = new ChatGptBrowserBackend(options.config);
  if (options.verbose) {
    backend.onEvent((event) => note(`[${event.type}] ${JSON.stringify(event)}`));
  }

  const result = await backend.run({
    model: (values["model"] as string | undefined) ?? "gpt-4o",
    systemPrompt: (values["system"] as string | undefined) ?? "",
    userPrompt,
    cwd: process.cwd(),
    ...(tool ? { tool: tool as ChatGptComposerTool } : {}),
    ...(images ? { images } : {}),
    ...(values["artifacts"] ? { artifactsDir: values["artifacts"] as string } : {})
  });

  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  }

  process.stdout.write(`${result.text}\n`);
  for (const warning of result.artifactWarnings ?? []) note(`warning: ${warning}`);
  for (const image of result.images ?? []) note(`image: ${image.path}`);
  return 0;
}

async function commandMemory(options: GlobalOptions): Promise<number> {
  const snapshot = await new ChatGptBrowserBackend(options.config).listAccountMemories();
  if (options.json) {
    process.stdout.write(`${JSON.stringify(snapshot, null, 2)}\n`);
    return snapshot.known ? 0 : 1;
  }
  if (!snapshot.known) {
    note(`Saved memory could not be read: ${snapshot.reason}`);
    return 1;
  }
  if (snapshot.entries.length === 0) {
    process.stdout.write("(no saved memories)\n");
    return 0;
  }
  process.stdout.write(`${snapshot.entries.map((entry) => `- ${entry}`).join("\n")}\n`);
  return 0;
}

async function commandClose(options: GlobalOptions): Promise<number> {
  const closed = await closeActiveManagedChrome(options.config.profileDir);
  if (options.json) {
    process.stdout.write(`${JSON.stringify({ closed })}\n`);
  } else {
    note(closed ? "Closed the managed Chrome." : "No managed Chrome was running for this profile.");
  }
  return 0;
}

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      profile: { type: "string" },
      model: { type: "string" },
      system: { type: "string" },
      tool: { type: "string" },
      image: { type: "string", multiple: true },
      artifacts: { type: "string" },
      timeout: { type: "string" },
      headless: { type: "boolean" },
      json: { type: "boolean" },
      verbose: { type: "boolean" },
      help: { type: "boolean", short: "h" }
    }
  });

  const command = positionals[0];
  if (values.help === true || command === undefined || command === "help") {
    process.stdout.write(USAGE);
    return command === undefined && values.help !== true ? 2 : 0;
  }

  const timeoutMs = values.timeout === undefined ? undefined : Number(values.timeout);
  if (timeoutMs !== undefined && !Number.isFinite(timeoutMs)) {
    note(`--timeout expects milliseconds, got ${values.timeout}`);
    return 2;
  }

  const options: GlobalOptions = {
    config: {
      profileDir: path.resolve(values.profile ?? defaultProfileDir()),
      // Reaching this code path is the opt-in the config flag exists to record.
      enabled: true,
      headed: values.headless !== true,
      ...(timeoutMs === undefined ? {} : { timeoutMs })
    },
    json: values.json === true,
    verbose: values.verbose === true
  };

  const rest = positionals.slice(1);
  switch (command) {
    case "login":
      return commandLogin(options);
    case "doctor":
      return commandDoctor(options);
    case "ask":
      return commandAsk(options, rest, values);
    case "memory":
      return commandMemory(options);
    case "close":
      return commandClose(options);
    default:
      note(`Unknown command: ${command}`);
      process.stdout.write(USAGE);
      return 2;
  }
}

try {
  process.exitCode = await main();
} catch (error) {
  if (error instanceof ChatGptBrowserError) {
    note(`${error.code}: ${error.message}`);
    if (error.suggestion) note(error.suggestion);
  } else {
    note(JSON.stringify(serializeChatGptBrowserError(error)));
  }
  process.exitCode = 1;
}

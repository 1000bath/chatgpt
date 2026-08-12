/**
 * dek-chatgpt — drive ChatGPT's web UI over the Chrome DevTools Protocol.
 *
 * The entry point most callers want is {@link ChatGptBrowserBackend}, which
 * implements the {@link ExecutionBackend} contract in `port.ts`. Everything
 * below it (the CDP session, the Chrome launcher, the response monitor) is
 * exported too, so a caller can drive Chrome directly without the backend's
 * turn-taking policy.
 */

export { ChatGptBrowserBackend, classifyBrowserError } from "./backend.js";

export {
  ChatGptBrowserEventEmitter,
  type ChatGptBrowserEvent,
  type ChatGptBrowserEventListener
} from "./events.js";

export {
  CdpTraceRecorder,
  defaultTraceFilePath,
  truncateTraceDetail,
  type CdpTraceEntry,
  type CdpTraceSink
} from "./trace.js";

export {
  ChatGptBrowserMetricsCollector,
  formatChatGptBrowserMetrics,
  type ChatGptBrowserMetrics
} from "./metrics.js";

export {
  HealthWatcher,
  type HealthReport,
  type HealthWatcherOptions
} from "./watcher.js";

export {
  ChatGptBrowserError,
  serializeChatGptBrowserError,
  type ChatGptBrowserErrorCode,
  type SerializedChatGptBrowserError
} from "./errors.js";

export type {
  AccountMemoryVerification,
  DoctorCheck,
  ExecutionBackend,
  ExecutionBackendCapabilities,
  ExecutionBackendRequest,
  ExecutionBackendResponse,
  ImageArtifact,
  SupportedImageMimeType,
  TokenUsage
} from "./port.js";

export {
  COMPOSER_TOOL_LABELS,
  COMPOSER_TOOL_MIN_TIMEOUT_MS,
  COMPOSER_TOOLS_WITHOUT_STALL_RELOAD,
  type BrowserImagePayload,
  type ChatGptBrowserConfig,
  type ChatGptComposerTool,
  type ChromeProcessInfo,
  type ChromeTarget,
  type DiagnosticResult,
  type SelectorMap,
  type StreamStatus
} from "./types.js";

export {
  ChromeLauncher,
  closeActiveManagedChrome,
  closeWindowTarget,
  conversationLockKey,
  createDedicatedWindowTarget,
  ensureWindowNotMinimized,
  findChromeExecutable,
  findOrCreatePageTarget,
  getWebSocketDebuggerUrl,
  openChatGptForManualLogin,
  openChatGptInManagedChrome,
  withConversationLock,
  withLaunchLock
} from "./chrome.js";

export {
  CdpSession,
  ResponseMonitor,
  normalizeChatGptConversationUrl,
  type CdpClient,
  type CdpEvent,
  type CdpEventClient,
  type ChatGptAuthenticationStatus,
  type ResponseBaseline
} from "./response.js";

export {
  ChatGptStreamReader,
  SseFrameParser,
  type ChatGptStreamReaderOptions,
  type ChatGptStreamResult,
  type StreamUsage
} from "./stream.js";

export {
  BrowserDiagnostics,
  checkChatGptSelectors,
  checkLiveChatGptAuthentication
} from "./diagnostics.js";

export {
  ACCOUNT_MEMORY_EMPTY_MARKER,
  ACCOUNT_MEMORY_FORGOTTEN_MARKER,
  ACCOUNT_MEMORY_LIST_BEGIN,
  ACCOUNT_MEMORY_LIST_END,
  ACCOUNT_MEMORY_SAVED_MARKER,
  MAX_ACCOUNT_MEMORY_CHARS,
  buildAccountMemoryForgetPrompt,
  buildAccountMemoryPrompt,
  buildAccountMemoryRecallPrompt,
  isAccountMemoryForgetConfirmed,
  isAccountMemorySaveConfirmed,
  parseAccountMemoryRecall,
  validateAccountMemory,
  type AccountMemoryRecall
} from "./accountMemory.js";

export {
  readAccountMemories,
  snapshotContains,
  verifyAccountMemoryWrite,
  type AccountMemorySnapshot,
  type AccountMemorySnapshotOk,
  type AccountMemorySnapshotUnknown,
  type PageEvaluator,
  type WriteVerification
} from "./accountMemoryApi.js";

export {
  MAX_BROWSER_IMAGE_BYTES,
  MAX_BROWSER_OUTPUT_IMAGES,
  MAX_BROWSER_OUTPUT_IMAGE_BYTES,
  SUPPORTED_BROWSER_IMAGE_MIMES,
  detectImageMime,
  persistBrowserImages,
  validateBrowserImage
} from "./imageArtifacts.js";

export { CHATGPT_SELECTORS } from "./selectors.js";
export { RATE_LIMIT_PATTERNS, detectRateLimit } from "./limits.js";
export { estimateTokens } from "./tokens.js";

export { createMemorySnapshot, planMemorySync, buildMemorySyncPrompt, MEMORY_SYNC_BEGIN, MEMORY_SYNC_END, MAX_MEMORY_SYNC_CHARS, type MemorySnapshot, type MemorySyncPlan } from "./memorySync.js";

export type ChatGptBrowserErrorCode =
  | "CHATGPT_INVALID_REQUEST"
  | "CHATGPT_INPUT_TOO_LARGE"
  | "CHATGPT_BROWSER_UNSUPPORTED_PLATFORM"
  | "CHATGPT_BROWSER_MODE_DISABLED"
  | "CHATGPT_BROWSER_RATE_LIMITED"
  | "CHATGPT_BROWSER_CHALLENGE_REQUIRED"
  | "CHATGPT_BROWSER_EXECUTION_FAILED"
  | "CHATGPT_ACCOUNT_MEMORY_INVALID"
  | "CHATGPT_ACCOUNT_MEMORY_NOT_CONFIRMED"
  | "CHATGPT_INTERNAL_ERROR";

/**
 * Every failure this package raises deliberately carries a `suggestion`: the
 * browser backend fails for reasons the caller can usually act on (not logged
 * in, Chrome not installed, a Cloudflare challenge waiting on screen), and a
 * bare message leaves them guessing which one it was.
 */
export class ChatGptBrowserError extends Error {
  constructor(
    readonly code: ChatGptBrowserErrorCode,
    message: string,
    readonly suggestion: string,
    readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "ChatGptBrowserError";
  }
}

export interface SerializedChatGptBrowserError {
  code: ChatGptBrowserErrorCode;
  message: string;
  suggestion: string;
  details?: Record<string, unknown>;
}

export function serializeChatGptBrowserError(error: unknown): SerializedChatGptBrowserError {
  if (error instanceof ChatGptBrowserError) {
    return {
      code: error.code,
      message: error.message,
      suggestion: error.suggestion,
      ...(error.details ? { details: error.details } : {})
    };
  }
  return {
    code: "CHATGPT_INTERNAL_ERROR",
    message: "The ChatGPT browser backend encountered an unexpected error.",
    suggestion: "Run the diagnostics helper and inspect the Chrome session."
  };
}

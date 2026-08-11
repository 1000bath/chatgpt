/**
 * The browser backend never sees real usage numbers — ChatGPT's web UI does not
 * report them — so token counts are approximated from text length and reported
 * as estimates rather than measurements.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

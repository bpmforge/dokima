export interface McpVerbOptions {
  /** Injectable clock for deterministic fixtures (TESTING.md §2). */
  now?: () => string;
}

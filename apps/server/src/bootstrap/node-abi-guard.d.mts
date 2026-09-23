/**
 * Types for node-abi-guard.mjs, so TypeScript callers (W23-45: `dokima
 * doctor`) reuse the bootstrap's wording instead of keeping a second copy.
 * The module stays plain .mjs because the CLI entry loads it before anything
 * TypeScript-built exists.
 */
export declare function supportedMajors(engines: string | undefined): string[];
export declare function checkNodeSupported(
  engines: string | undefined,
  running?: string,
): string | null;
export declare function describeAbiMismatch(
  err: unknown,
  ctx?: { engines?: string; running?: string },
): string | null;
export declare function nativeModuleProblem(
  load: () => unknown,
  engines: string | undefined,
  running?: string,
): string | null;

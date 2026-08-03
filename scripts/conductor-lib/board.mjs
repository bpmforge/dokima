// conductor-lib/board.mjs — chapter of the conductor's pure helper library.
// Split out of the 590-line scripts/conductor-lib.mjs under the 400-line
// CODE_BOOK_PROTOCOL cap (W10-46). Extraction only: same exported names, same
// behaviour. scripts/conductor-lib.mjs remains the barrel every caller imports,
// so no call site moved.

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ---------- board load / serialize ----------
/** Resolves the on-disk board path: `boardPath` (project-relative, default 'plan.json') under `dir`. */
export const planPath = (dir, boardPath = 'plan.json') => resolve(dir, boardPath);

/** Loads and parses the board at `boardPath` (default 'plan.json') from `dir`. */
export function loadPlanFrom(dir, boardPath = 'plan.json') {
  return JSON.parse(readFileSync(planPath(dir, boardPath), 'utf8'));
}

/**
 * Whether every character in `text` is ASCII (code point <= 0x7f). Used to
 * detect a board file's own non-ASCII convention: the real plan.json is
 * entirely ASCII bytes on disk -- any non-ASCII content it carries
 * (section signs, em dashes, etc.) is JSON-escaped as \uXXXX rather than
 * written as literal UTF-8.
 */
function isAsciiOnly(text) {
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) > 0x7f) return false;
  }
  return true;
}

/**
 * Re-escapes every non-ASCII UTF-16 code unit in `json` as a lowercase,
 * zero-padded \uXXXX sequence -- the convention the real plan.json uses on
 * disk (equivalent to Python's `json.dumps(..., ensure_ascii=True)`). Safe
 * to apply across the whole JSON.stringify output unconditionally:
 * non-ASCII characters can only occur inside quoted string literals, never
 * in JSON's structural syntax ({}[]:,), so there is nothing else in the
 * text this could corrupt. The match range (\u0080-\uffff) deliberately
 * starts above the ASCII control-character range (\x00-\x1f, \x7f) so it
 * never trips the no-control-regex lint rule -- see globToRegex's \x01
 * sentinel above for the same concern.
 */
function asciiEscapeNonAscii(json) {
  return json.replace(/[\u0080-\uffff]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

/**
 * Serializes a plan object back to the on-disk board format: 2-space
 * indent, plus whatever convention the file being replaced already uses.
 * W9-11: a naive `JSON.stringify(plan, null, 2) + '\n'` diverges from the
 * real plan.json by thousands of bytes on every write -- it emits literal
 * UTF-8 where the file uses ASCII-escaping, and adds a trailing newline
 * the file doesn't have -- turning every status change into an
 * unreviewable ~400-line diff.
 *
 * `original` is the raw text of the file this write is about to replace.
 * When given, its two conventions are detected and preserved instead of
 * imposed:
 *   - non-ASCII escaping: only applied when `original` is itself pure
 *     ASCII (the real plan.json's convention). A file that already
 *     contains literal UTF-8 keeps that convention untouched -- this never
 *     forces ASCII-escaping on a file that wasn't already ASCII-only.
 *   - trailing newline: present in the output iff `original` had one.
 * Without `original` (e.g. writing a brand-new board), falls back to the
 * pre-W9-11 default: literal UTF-8, trailing newline.
 */
export function serializePlan(plan, original) {
  const json = JSON.stringify(plan, null, 2);
  const body = original !== undefined && isAsciiOnly(original) ? asciiEscapeNonAscii(json) : json;
  const trailingNewline = original === undefined || original.endsWith('\n');
  return trailingNewline ? `${body}\n` : body;
}

/**
 * Writes `plan` to the board at `boardPath` under `dir` -- the ONE place a
 * conductor board write happens, so byte-preservation (W9-11) is guaranteed
 * for every call site rather than relying on each one to remember to pass
 * `original` to serializePlan itself. Reads the file's current on-disk
 * bytes immediately before overwriting it (not e.g. bytes captured at
 * `loadPlan` time earlier in the same function) so the convention detected
 * is always the one actually being replaced. The file must already exist
 * -- both conductor.mjs call sites write only after a prior successful
 * `loadPlan` of this same path, so a missing file here would itself be a
 * bug worth throwing on, not one to paper over.
 */
export function writePlan(dir, plan, boardPath = 'plan.json') {
  const file = planPath(dir, boardPath);
  writeFileSync(file, serializePlan(plan, readFileSync(file, 'utf8')));
}

/** The gate-check message when a ticket's board row isn't 'done' after a session — names the configured boardPath, not a hardcoded 'plan.json'. */

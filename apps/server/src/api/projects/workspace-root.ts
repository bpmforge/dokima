/**
 * projects/workspace-root.ts — where a NEW project goes when nobody said.
 *
 * W12-41. Found by the founder on the first screen of the first supervised
 * run, which it blocked: "New project" asked for the absolute path of a
 * directory that does not exist yet — and that `registerProject` then creates
 * itself (`fs.mkdir` + `ensureGitRepo`). The form dictated a location for
 * something the server was about to make anyway, and derived the project's
 * NAME from that path, when for a new project the name is the thing the user
 * knows and the path is the thing they do not care about.
 *
 * The reason the form had to ask is that Dokima had no concept of where
 * projects live. `DOKIMA_HOME` (~/.dokima) holds config, token and packs;
 * nothing held projects. This is that concept.
 *
 * RESOLUTION IS SERVER-SIDE ON PURPOSE. A browser cannot know the home
 * directory, so a client that computed this would be guessing — and an API
 * that demands a path its caller cannot compute is the same defect one layer
 * down.
 */
import os from 'node:os';
import path from 'node:path';

/** The settings key a user overrides to keep projects somewhere else (e.g. ~/Code). */
export const WORKSPACE_ROOT_SETTINGS_KEY = 'workspaceRoot';

/** Default when nothing is configured: visible, obvious, and not hidden under a dotdir. */
export function defaultWorkspaceRoot(home: string = os.homedir()): string {
  return path.join(home, 'Dokima');
}

export function resolveWorkspaceRoot(
  configured: unknown,
  home: string = os.homedir(),
  env: NodeJS.ProcessEnv = process.env,
): string {
  /**
   * W13-64: the operator/test override, same mechanism DOKIMA_HOME is. It
   * exists because the guided sample used to hardcode /tmp — volatile,
   * shared — and the e2e suite glob-deleted every such folder on the
   * machine, which destroyed a REAL walkthrough's project during a test
   * run. With this, every harness pins its own workspace and can never
   * write into (or delete from) a real home. It beats the configured
   * setting on purpose: when it is set, an operator is sandboxing the
   * process, and a stored setting must not escape the sandbox.
   */
  const fromEnv = env.DOKIMA_WORKSPACE_ROOT;
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') {
    return fromEnv.trim();
  }
  if (typeof configured !== 'string' || configured.trim() === '') {
    return defaultWorkspaceRoot(home);
  }
  const trimmed = configured.trim();
  // `~` is what a person types in a settings field, and it is not a path any
  // fs call understands — expanding it here is cheaper than a support answer.
  const expanded = trimmed.startsWith('~')
    ? path.join(home, trimmed.slice(1))
    : trimmed;
  return path.resolve(expanded);
}

/**
 * A directory name from a project name.
 *
 * Deliberately conservative rather than clever: lowercase, ASCII-ish, single
 * dashes, no leading/trailing punctuation. A directory name is a durable
 * thing that will be typed into shells and appear in git remotes, so the goal
 * is a name that survives those, not one that preserves every character.
 */
export function slugForProjectName(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/, '');
  return slug;
}

export class ProjectNameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectNameError';
  }
}

/**
 * The directory a new project gets, given only its name.
 *
 * Throws rather than inventing a fallback when a name has no usable
 * characters: silently creating `<root>/project-1` for an emoji-only name is
 * the kind of helpfulness that produces a directory nobody can find again.
 */
export function newProjectPath(name: string, workspaceRoot: string): string {
  const slug = slugForProjectName(name);
  if (slug === '') {
    throw new ProjectNameError(
      `"${name}" has no characters usable in a folder name. Use letters or numbers, ` +
        `or choose the location yourself.`,
    );
  }
  return path.join(workspaceRoot, slug);
}

/**
 * W12-41. Found by the founder on the first screen of the first supervised
 * run: "New project" required the absolute path of a directory that does not
 * exist yet — and that `registerProject` creates itself.
 */
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import {
  defaultWorkspaceRoot,
  newProjectPath,
  ProjectNameError,
  resolveWorkspaceRoot,
  slugForProjectName,
} from './workspace-root.js';

describe('workspace root (W12-41)', () => {
  it('defaults somewhere a person can find, not under a dotdir', () => {
    // DOKIMA_HOME (~/.dokima) holds config, token and packs. Projects are the
    // user's own work and belong somewhere they would think to look.
    expect(defaultWorkspaceRoot('/Users/x')).toBe(path.join('/Users/x', 'Dokima'));
    expect(resolveWorkspaceRoot(undefined, '/Users/x')).toBe('/Users/x/Dokima');
    expect(resolveWorkspaceRoot('   ', '/Users/x')).toBe('/Users/x/Dokima');
  });

  it(
    'expands a leading ~, because that is what a person types into a settings ' +
      'field and no fs call understands it',
    () => {
      expect(resolveWorkspaceRoot('~/Code', '/Users/x')).toBe('/Users/x/Code');
    },
  );

  it('an explicit root wins and is resolved absolute', () => {
    expect(resolveWorkspaceRoot('/srv/projects', '/Users/x')).toBe('/srv/projects');
  });
});

describe('slugging a project name into a folder name (W12-41)', () => {
  it('produces something that survives a shell and a git remote', () => {
    expect(slugForProjectName('My App')).toBe('my-app');
    expect(slugForProjectName('  Recipe Box!!  ')).toBe('recipe-box');
    expect(slugForProjectName('API v2 — the rewrite')).toBe('api-v2-the-rewrite');
  });

  it('strips diacritics rather than emitting them into a path', () => {
    expect(slugForProjectName('Café Résumé')).toBe('cafe-resume');
  });

  it('never emits leading, trailing or doubled dashes', () => {
    expect(slugForProjectName('--weird--name--')).toBe('weird-name');
    expect(slugForProjectName('a  /  b')).toBe('a-b');
  });

  it(
    'REFUSES a name with no usable characters instead of inventing one. ' +
      'Silently creating `project-1` for an emoji-only name produces a ' +
      'directory nobody can find again',
    () => {
      expect(() => newProjectPath('🎉🎉', '/Users/x/Dokima')).toThrow(ProjectNameError);
      expect(() => newProjectPath('   ', '/Users/x/Dokima')).toThrow(/usable in a folder name/);
    },
  );

  it('resolves a name to a path under the configured root', () => {
    expect(newProjectPath('My App', '/Users/x/Code')).toBe('/Users/x/Code/my-app');
  });
});

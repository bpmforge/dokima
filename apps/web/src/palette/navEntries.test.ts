import { describe, expect, it } from 'vitest';
import { paletteNavEntries, searchNav } from './navEntries.js';
import { paletteShortcutLabel } from './shortcuts.js';

const projects = Array.from({ length: 12 }, (_, i) => ({
  id: `p${i}`,
  name: `Project ${i}`,
  available: true,
}));

describe('paletteNavEntries', () => {
  it('with no project open: Fleet, global screens and projects — no project-scoped screens', () => {
    const ids = paletteNavEntries({
      projectId: null,
      projects: projects.slice(0, 1),
    }).map((e) => e.id);
    expect(ids).toEqual(['fleet', 'roster', 'notifications', 'settings', 'project:p0']);
  });

  it('with a project open: adds the board and project screens, and leaves out the open project', () => {
    const ids = paletteNavEntries({
      projectId: 'p0',
      projects: projects.slice(0, 2),
    }).map((e) => e.id);
    expect(ids).toEqual([
      'fleet',
      'board',
      'team',
      'interview',
      'plans',
      'decisions',
      'lessons',
      'roster',
      'notifications',
      'settings',
      'project:p1',
    ]);
  });

  it('leaves out a project whose folder is gone', () => {
    const entries = paletteNavEntries({
      projectId: null,
      projects: [{ id: 'gone', name: 'Gone', available: false }],
    });
    expect(entries.some((e) => e.id === 'project:gone')).toBe(false);
  });
});

describe('searchNav', () => {
  const entries = paletteNavEntries({ projectId: null, projects });

  it('with nothing typed lists every screen but caps the projects', () => {
    const result = searchNav(entries, '  ');
    expect(result.filter((e) => e.target.kind !== 'project')).toHaveLength(4);
    expect(result.filter((e) => e.target.kind === 'project')).toHaveLength(8);
  });

  it('filters by title, case-insensitively', () => {
    expect(searchNav(entries, 'MORNING').map((e) => e.id)).toEqual(['notifications']);
    expect(searchNav(entries, 'project 11').map((e) => e.id)).toEqual(['project:p11']);
  });
});

describe('paletteShortcutLabel', () => {
  it('spells the shortcut the way the platform does', () => {
    expect(paletteShortcutLabel('MacIntel')).toBe('⌘K');
    expect(paletteShortcutLabel('iPhone')).toBe('⌘K');
    expect(paletteShortcutLabel('Win32')).toBe('Ctrl+K');
    expect(paletteShortcutLabel('Linux x86_64')).toBe('Ctrl+K');
  });
});

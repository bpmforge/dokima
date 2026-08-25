/**
 * W20-01 (D-028): personas are presentation over real actor ids — never
 * identity, never a claim. The two fixtures that matter are the ones that
 * would let a face lie: inventing a person for an unknown actor, and a
 * persona asserting a state the ledger never recorded.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadRosterExperts } from './roster-content.js';
import { displayNameFor, personaFor, PERSONAS, wirePersona } from './personas.js';

const REPO = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../..');

describe('personas (W20-01, D-028)', () => {
  it('RED FIXTURE: an unknown actor id resolves to NO persona and renders as ITSELF — a fabricated person is worse than a slug', () => {
    expect(personaFor('some-unmapped-specialist')).toBeNull();
    expect(personaFor('agent:not-a-real-role')).toBeNull();
    expect(displayNameFor('some-unmapped-specialist')).toBe('some-unmapped-specialist');
    expect(personaFor(undefined)).toBeNull();
    expect(personaFor('')).toBeNull();
  });

  it('resolves a bare role and a scoped actor id to the same face, without rewriting the id', () => {
    const bare = personaFor('coding-agent');
    expect(bare?.displayName).toBe('Sam');
    expect(personaFor('agent:coding-agent')?.avatarKey).toBe(bare?.avatarKey);
    expect(personaFor('berth-2:coding-agent')?.displayName).toBe('Sam');
    // the lookup never mutates the id it was given
    expect(displayNameFor('berth-2:coding-agent')).toBe('Sam');
    expect(displayNameFor('berth-2:unknown-role')).toBe('berth-2:unknown-role');
  });

  it('no persona asserts a STATE — a face says who someone is, never what they are doing (UX_SPEC §10 owns state)', () => {
    const stateWords =
      /\b(working|idle|busy|running|blocked|waiting|reviewing|shipped|done|typing)\b/i;
    for (const p of PERSONAS) {
      expect(p.jobLine, `${p.displayName} job line`).not.toMatch(stateWords);
      expect(p.jobLine.length).toBeGreaterThan(10);
      expect(p.displayName).not.toBe(p.role);
    }
  });

  it('every persona role is a REAL roster expert or the chief of staff — no faces for roles that do not exist', async () => {
    const experts = await loadRosterExperts(path.join(REPO, 'content', 'experts'));
    const ids = new Set(experts.map((e) => e.id));
    // phase-gate-runner and chief-of-staff are machine identities, not content packs
    const machineOnly = new Set(['phase-gate-runner', 'chief-of-staff']);
    for (const p of PERSONAS) {
      if (machineOnly.has(p.role)) continue;
      expect(ids.has(p.role), `${p.displayName} -> ${p.role} must be a real expert`).toBe(
        true,
      );
    }
  });

  it('ids, names and avatar keys are unique — two members can never collide into one face', () => {
    const uniq = (xs: string[]) => new Set(xs).size === xs.length;
    expect(uniq(PERSONAS.map((p) => p.role))).toBe(true);
    expect(uniq(PERSONAS.map((p) => p.displayName))).toBe(true);
    expect(uniq(PERSONAS.map((p) => p.avatarKey))).toBe(true);
  });

  it('the wire shape is snake_case and carries no state field', () => {
    const wire = wirePersona(PERSONAS[0]!);
    expect(Object.keys(wire).sort()).toEqual(['avatar_key', 'display_name', 'job_line']);
  });

  it('the web mirror lists the same roles — a persona added here without a seat over there fails loudly, not silently (W20-12)', async () => {
    const mirror = await fs.readFile(
      path.join(REPO, 'apps', 'web', 'src', 'team', 'roles.ts'),
      'utf8',
    );
    for (const p of PERSONAS) {
      expect(mirror, `${p.role} missing from apps/web roles.ts`).toContain(`'${p.role}'`);
    }
    const mirrored = [...mirror.matchAll(/'([a-z-]+)',/g)].map((m2) => m2[1]);
    expect(new Set(mirrored)).toEqual(new Set(PERSONAS.map((p) => p.role)));
  });

  it('the code table and docs/design/PERSONAS.md name the same people — the doc is the spec, this is it executable', async () => {
    const doc = await fs.readFile(
      path.join(REPO, 'docs', 'design', 'PERSONAS.md'),
      'utf8',
    );
    for (const p of PERSONAS) {
      expect(doc, `${p.displayName} missing from PERSONAS.md`).toContain(
        `**${p.displayName}**`,
      );
      expect(doc, `${p.avatarKey} missing from PERSONAS.md`).toContain(p.avatarKey);
    }
  });
});

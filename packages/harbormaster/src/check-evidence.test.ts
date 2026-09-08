/**
 * W23-08. Every case here is a way a result about one world gets presented as
 * true about another.
 */

import { describe, expect, it } from 'vitest';
import {
  decideReuse,
  evidenceKeyOf,
  invalidatedDescendants,
  keyIsComplete,
  type EvidenceKeyParts,
  type StoredEvidence,
} from './check-evidence.js';

const PARTS: EvidenceKeyParts = {
  checkId: 'tool-sast',
  sourceDigest: 'sha256:tree-1',
  commandDigest: 'sha256:cmd-1',
  toolVersion: '1.2.3',
  ruleDigest: 'sha256:rules-1',
  configDigest: 'sha256:config-1',
  predecessorDigests: [],
};

const stored = (over: Partial<StoredEvidence> = {}): StoredEvidence => ({
  key: evidenceKeyOf(PARTS),
  parts: PARTS,
  origin: 'tool',
  status: 'passed',
  artifactDigest: 'sha256:artifact-1',
  ...over,
});

const artifact = { present: true, digest: 'sha256:artifact-1' };

describe('a key covers everything that could change the answer', () => {
  it.each([
    ['the source tree', { sourceDigest: 'sha256:tree-2' }],
    ['the command', { commandDigest: 'sha256:cmd-2' }],
    ['the tool version', { toolVersion: '1.2.4' }],
    ['the rule set', { ruleDigest: 'sha256:rules-2' }],
    ['the configuration', { configDigest: 'sha256:config-2' }],
    ['a predecessor result', { predecessorDigests: ['sha256:pred-1'] }],
  ])('changing %s makes the stored evidence unusable', (_what, change) => {
    const decision = decideReuse(stored(), { ...PARTS, ...change }, artifact);
    expect(decision.reusable).toBe(false);
    expect(decision.reason).toMatch(/key changed/);
  });

  it('the reason names the component that differed, not merely that something did', () => {
    const decision = decideReuse(stored(), { ...PARTS, toolVersion: '9.9.9' }, artifact);
    expect(decision.reason).toContain('tool=1.2.3');
    expect(decision.reason).toContain('tool=9.9.9');
  });

  it('an identical key with its artifact intact IS reusable', () => {
    expect(decideReuse(stored(), PARTS, artifact)).toEqual({
      reusable: true,
      reason: 'same key, artifact present and unchanged',
    });
  });
});

describe('unknown is not a wildcard', () => {
  it.each([['toolVersion'], ['ruleDigest'], ['configDigest']])(
    'a null %s makes the key incomplete and the evidence unreusable',
    (field) => {
      const incomplete = { ...PARTS, [field]: null } as EvidenceKeyParts;
      expect(keyIsComplete(incomplete)).toBe(false);
      const decision = decideReuse(
        stored({ key: evidenceKeyOf(incomplete), parts: incomplete }),
        incomplete,
        artifact,
      );
      expect(decision.reusable).toBe(false);
      expect(decision.reason).toMatch(/unknown/);
    },
  );
});

describe('what may never be reused', () => {
  it('RED FIXTURE: model prose is never a scanner pass', () => {
    const decision = decideReuse(stored({ origin: 'model' }), PARTS, artifact);
    expect(decision.reusable).toBe(false);
    expect(decision.reason).toMatch(/model prose is never a scanner pass/);
  });

  it.each([['error'], ['unavailable'], ['not_applicable']])(
    'a %s result is not reused as a pass',
    (status) => {
      const decision = decideReuse(
        stored({ status: status as StoredEvidence['status'] }),
        PARTS,
        artifact,
      );
      expect(decision.reusable).toBe(false);
    },
  );

  it('a missing artifact, or one that no longer hashes the same, blocks reuse', () => {
    expect(decideReuse(stored(), PARTS, { present: false, digest: null }).reason).toMatch(
      /artifact is gone/,
    );
    expect(
      decideReuse(stored(), PARTS, { present: true, digest: 'sha256:other' }).reason,
    ).toMatch(/no longer hashes/);
  });

  it('no previous evidence is a plain miss, not an error', () => {
    expect(decideReuse(undefined, PARTS, artifact).reusable).toBe(false);
  });
});

describe('invalidation is transitive', () => {
  const graph = [
    { id: 'tool-sast', dependsOn: [] },
    { id: 'security-sast', dependsOn: ['tool-sast'] },
    { id: 'security-cloud', dependsOn: ['tool-sast'] },
    { id: 'tool-secrets', dependsOn: [] },
    { id: 'security-secrets', dependsOn: ['tool-secrets'] },
    {
      id: 'security-attack-chains',
      dependsOn: ['security-sast', 'security-secrets', 'security-cloud'],
    },
    { id: 'threat-model-refresh', dependsOn: ['security-attack-chains'] },
  ];

  it('RED FIXTURE: re-running one tool invalidates the synthesis AND the refresh, not just one hop', () => {
    const invalid = invalidatedDescendants(graph, ['tool-sast']);
    expect([...invalid].sort()).toEqual([
      'security-attack-chains',
      'security-cloud',
      'security-sast',
      'threat-model-refresh',
    ]);
  });

  it('unrelated independent work is NOT invalidated', () => {
    const invalid = invalidatedDescendants(graph, ['tool-sast']);
    expect(invalid.has('tool-secrets')).toBe(false);
    expect(invalid.has('security-secrets')).toBe(false);
  });

  it('the changed node itself is not in the set — re-running it and being invalidated are different reasons', () => {
    expect(invalidatedDescendants(graph, ['security-sast']).has('security-sast')).toBe(
      false,
    );
  });

  it('a leaf invalidates nothing', () => {
    expect([...invalidatedDescendants(graph, ['threat-model-refresh'])]).toEqual([]);
  });
});

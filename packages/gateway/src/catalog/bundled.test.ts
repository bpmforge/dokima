import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BundledCatalogError, loadBundledModelsForKind } from './bundled.js';

describe('loadBundledModelsForKind (the real content/model-catalog/catalog.v1.json)', () => {
  it('returns the bundled ollama models', () => {
    const models = loadBundledModelsForKind('ollama');
    expect(models).toBeDefined();
    expect(models!.length).toBeGreaterThan(0);
    expect(models!.every((m) => typeof m.id === 'string' && m.id.length > 0)).toBe(true);
  });

  it('returns the bundled lm-studio models, matching the recorded fixture style', () => {
    const models = loadBundledModelsForKind('lm-studio');
    expect(models).toBeDefined();
    expect(models!.map((m) => m.id)).toContain('qwen2.5-coder-7b-instruct');
  });

  it('returns undefined (honest absence) for a kind with no bundled entry, e.g. oai-compat', () => {
    expect(loadBundledModelsForKind('oai-compat')).toBeUndefined();
  });

  it('is deterministic across calls', () => {
    expect(loadBundledModelsForKind('ollama')).toEqual(
      loadBundledModelsForKind('ollama'),
    );
  });
});

describe('loadBundledModelsForKind parsing against a synthetic file', () => {
  let dir: string;

  function withFile<T>(contents: string, run: (filePath: string) => T): T {
    dir = mkdtempSync(path.join(tmpdir(), 'model-catalog-'));
    const filePath = path.join(dir, 'catalog.v1.json');
    writeFileSync(filePath, contents, 'utf8');
    try {
      return run(filePath);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it('throws BundledCatalogError on invalid JSON', () => {
    withFile('{ not valid json', (filePath) => {
      expect(() => loadBundledModelsForKind('ollama', filePath)).toThrow(
        BundledCatalogError,
      );
    });
  });

  it('throws BundledCatalogError when version or provenance is missing', () => {
    withFile(JSON.stringify({ providers: { ollama: [{ id: 'x' }] } }), (filePath) => {
      expect(() => loadBundledModelsForKind('ollama', filePath)).toThrow(
        BundledCatalogError,
      );
    });
  });

  it('throws BundledCatalogError when an entry has no id', () => {
    withFile(
      JSON.stringify({
        version: 'v1',
        provenance: 'test',
        providers: { ollama: [{ contextLength: 4096 }] },
      }),
      (filePath) => {
        expect(() => loadBundledModelsForKind('ollama', filePath)).toThrow(
          BundledCatalogError,
        );
      },
    );
  });

  it('throws BundledCatalogError when contextLength is not a positive number', () => {
    withFile(
      JSON.stringify({
        version: 'v1',
        provenance: 'test',
        providers: { ollama: [{ id: 'x', contextLength: -1 }] },
      }),
      (filePath) => {
        expect(() => loadBundledModelsForKind('ollama', filePath)).toThrow(
          BundledCatalogError,
        );
      },
    );
  });

  it('parses a well-formed synthetic file and carries contextLength through when present', () => {
    withFile(
      JSON.stringify({
        version: 'v1',
        provenance: 'test',
        providers: { ollama: [{ id: 'a' }, { id: 'b', contextLength: 8192 }] },
      }),
      (filePath) => {
        expect(loadBundledModelsForKind('ollama', filePath)).toEqual([
          { id: 'a' },
          { id: 'b', contextLength: 8192 },
        ]);
      },
    );
  });

  it('returns undefined for a kind absent from a well-formed synthetic file', () => {
    withFile(
      JSON.stringify({
        version: 'v1',
        provenance: 'test',
        providers: { ollama: [{ id: 'a' }] },
      }),
      (filePath) => {
        expect(loadBundledModelsForKind('lm-studio', filePath)).toBeUndefined();
      },
    );
  });
});

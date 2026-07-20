/**
 * Optional local embeddings (FR-M1: "optional local embeddings ... BM25
 * fallback when embeddings are unavailable"). Offline-honest: the default
 * provider is a no-op that always returns null, so retrieval degrades to
 * pure BM25 rather than fabricating a vector (US-604 AC-1 — the full
 * retrieval suite must pass with embeddings disabled). A real local
 * embedding model (e.g. via the gateway) is wired by a future ticket
 * through this same interface; `memory` never imports a provider SDK
 * itself (ARCHITECTURE.md §4 law 2).
 */

export interface EmbeddingProvider {
  /** Returns a float vector, or null when no local embed model is configured. */
  embed(text: string): Promise<Float32Array | null>;
}

export class NoopEmbeddingProvider implements EmbeddingProvider {
  async embed(_text: string): Promise<Float32Array | null> {
    return null;
  }
}

export function floatsToBuffer(vector: Float32Array): Buffer {
  return Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength);
}

export function bufferToFloats(buffer: Buffer): Float32Array {
  return new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4);
}

/** Cosine similarity in [-1, 1]; 0 when either vector has zero magnitude. */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new RangeError(`vector length mismatch: ${a.length} vs ${b.length}`);
  }
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const ai = a[i] as number;
    const bi = b[i] as number;
    dot += ai * bi;
    magA += ai * ai;
    magB += bi * bi;
  }
  if (magA === 0 || magB === 0) {
    return 0;
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

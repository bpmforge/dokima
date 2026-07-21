/**
 * Provider-sticky embeddings for the code index (FR-M4/NFR-1). Reuses the
 * facts engine's float32<->Buffer/cosine primitives (`../store/embeddings.js`)
 * — same engine as facts, per the ticket. Net-new here is `providerId`:
 * `store/embeddings.ts`'s `EmbeddingProvider` has no notion of *which*
 * provider produced a vector, because facts never needed to compare vectors
 * across providers. Code-index chunks are embedded once at index time and
 * queried later, possibly under a different configured provider (a model
 * swap, or embeddings disabled offline) — two providers' vector spaces are
 * not comparable even at equal dimensionality, so `search.ts` must be able
 * to tell "different provider" apart from "same provider, no vector yet"
 * and fall back to BM25 rather than silently cosine-comparing nonsense.
 */
export { bufferToFloats, cosineSimilarity, floatsToBuffer } from '../store/embeddings.js';

export interface CodeEmbeddingProvider {
  /** Stable id for the embedding model/provider, persisted per chunk. */
  readonly providerId: string;
  /** Returns a float vector, or null when no local embed model is configured. */
  embed(text: string): Promise<Float32Array | null>;
}

export class NoopCodeEmbeddingProvider implements CodeEmbeddingProvider {
  readonly providerId = 'noop';
  async embed(_text: string): Promise<Float32Array | null> {
    return null;
  }
}

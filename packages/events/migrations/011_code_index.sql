-- Per-project code index (DATABASE.md §5 style, BLUEPRINT §3.8, FR-M4/R-J1,
-- W7-06). Same engine as facts (009_memory.sql): external-content FTS5 for
-- BM25, an optional float32 embedding BLOB per row. `code_chunks` lives in
-- packages/memory/src/code-index/**, which operates on an already-open
-- handle (ARCHITECTURE §4 law 4) the same way store/** does.
--
-- Added via the same numbered-migration mechanism as 009_memory.sql/
-- 010_playbook.sql: packages/events/migrations/** is conductor.config.json
-- alwaysOk shared infra (L-04/W4-06), out of this ticket's declared
-- write_scope (packages/memory/src/code-index/**) but explicitly allowlisted
-- for exactly this class of change.
--
-- `embed_provider` is net-new versus `facts.embedding` (which has no
-- provider tag): FR-M4 requires embeddings be "provider-sticky" — a query
-- embedded by a different provider than the one that produced a chunk's
-- vector must never be cosine-compared against it (two providers' vector
-- spaces are not comparable even at equal dimensionality), only fall back to
-- BM25. Recording the provider id per row is what lets the search layer
-- detect that mismatch instead of silently comparing incomparable vectors.
CREATE TABLE code_chunks (
  id INTEGER PRIMARY KEY,
  path TEXT NOT NULL,
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  content TEXT NOT NULL,
  embedding BLOB,
  embed_provider TEXT,
  indexed_at TEXT NOT NULL
);

CREATE INDEX idx_code_chunks_path ON code_chunks (path);

-- code_chunks_fts — external-content FTS5 index (BM25 retrieval baseline,
-- mirrors facts_fts). Triggers keep it in sync on every write; `content_rowid`
-- ties fts rows back to `code_chunks.id` for the join in search.ts.
CREATE VIRTUAL TABLE code_chunks_fts USING fts5(
  content,
  content = 'code_chunks',
  content_rowid = 'id'
);

CREATE TRIGGER code_chunks_fts_ai AFTER INSERT ON code_chunks BEGIN
  INSERT INTO code_chunks_fts (rowid, content) VALUES (new.id, new.content);
END;

CREATE TRIGGER code_chunks_fts_ad AFTER DELETE ON code_chunks BEGIN
  INSERT INTO code_chunks_fts (code_chunks_fts, rowid, content) VALUES ('delete', old.id, old.content);
END;

CREATE TRIGGER code_chunks_fts_au AFTER UPDATE ON code_chunks BEGIN
  INSERT INTO code_chunks_fts (code_chunks_fts, rowid, content) VALUES ('delete', old.id, old.content);
  INSERT INTO code_chunks_fts (rowid, content) VALUES (new.id, new.content);
END;

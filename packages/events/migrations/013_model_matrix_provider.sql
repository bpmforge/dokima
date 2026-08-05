-- model_matrix gains a structured provider binding (W10-68). A slash in a
-- single string cannot tell a providerId prefix from a vendor-namespaced
-- model id -- `ghost/model` and `qwen/qwen3-coder-next` are the same shape,
-- and no parsing rule distinguishes them (W10-60 had to guess). A row now
-- says which provider it means directly. NULL keeps today's meaning: bind
-- to the single enabled provider, ambiguous if several -- nothing existing
-- has to be requalified by hand.
ALTER TABLE model_matrix ADD COLUMN provider_id TEXT;

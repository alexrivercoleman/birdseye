-- AI species summary per walk (docs/CONTRACT_CHANGES.md, 2026-09-26): one paragraph about the bird and how rare it
-- is at that place, season and time, written by the LLM in the walk finish pipeline.

alter table public.walk_species add column summary text;

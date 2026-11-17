-- Remove rows inserted by the original 0006 draft, if it was applied.
-- Refreshed catalog rows carry provider metadata and are retained.
delete from provider_models
where metadata = '{}'::jsonb
  and (provider, model_id) in (
    ('google', 'gemini-3.8-flash'),
    ('google', 'gemini-3.6-flash'),
    ('google', 'gemini-3.5-flash-lite'),
    ('google', 'gemini-4-argon'),
    ('groq', 'openai/gpt-oss-120b'),
    ('groq', 'openai/gpt-oss-20b'),
    ('groq', 'qwen/qwen3.8-27b'),
    ('openrouter', 'google/gemini-3.8-flash'),
    ('openrouter', 'qwen/qwen3.8-27b:free')
  );

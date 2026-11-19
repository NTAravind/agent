-- 0013: widen the provider allow-list to the four new LLM providers.
--
-- Mistral, DeepSeek, Hugging Face and Cohere join Google, Groq and
-- OpenRouter in the model catalog (see apps/api/lib/models/). The inline
-- check from 0006 is replaced with the same constraint over all seven
-- providers. Postgres names inline checks <table>_<column>_check.

alter table provider_models drop constraint if exists provider_models_provider_check;
alter table provider_models add constraint provider_models_provider_check
  check (provider in ('google','groq','openrouter','mistral','deepseek','huggingface','cohere'));

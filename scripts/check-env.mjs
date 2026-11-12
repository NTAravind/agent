#!/usr/bin/env node
/**
 * Prints which server env vars are missing. Never fails the install:
 * a missing key is a setup step, not a broken checkout.
 */
const required = [
  ["SUPABASE_URL", "apps/api"],
  ["SUPABASE_ANON_KEY", "apps/api"],
  ["SUPABASE_SERVICE_ROLE_KEY", "apps/api"],
  ["ALLOWED_USER_ID", "apps/api"],
  ["INNGEST_EVENT_KEY", "apps/api"],
  ["INNGEST_SIGNING_KEY", "apps/api"],
  ["GOOGLE_GENERATIVE_AI_API_KEY", "apps/api"],
  ["GROQ_API_KEY", "apps/api"],
  ["OPENROUTER_API_KEY", "apps/api"],
];

const missing = required.filter(([name]) => !process.env[name]);

if (missing.length > 0) {
  console.warn("\n[check-env] Missing server env vars (set them in apps/api/.env.local and Vercel):");
  for (const [name, scope] of missing) console.warn(`  - ${name}  (${scope})`);
  console.warn("");
}

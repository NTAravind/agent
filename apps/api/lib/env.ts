/**
 * Env access helpers. Server-only: never import from client components.
 */

export function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. See docs/runbook-phase-0.md for setup.`,
    );
  }
  return value;
}

export function optionalEnv(name: string): string | undefined {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
}

export function isConfigured(name: string): boolean {
  return optionalEnv(name) !== undefined;
}

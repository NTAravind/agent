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

/**
 * HMAC secret used to sign inline tool-approval requests.
 *
 * Ordinary chat must fail closed when an approval-required MCP tool is
 * exposed without this secret. The value stays server-side and is never sent
 * to the mobile client.
 */
export function toolApprovalSecret(): string | undefined {
  return optionalEnv("TOOL_APPROVAL_SECRET");
}

export function isConfigured(name: string): boolean {
  return optionalEnv(name) !== undefined;
}

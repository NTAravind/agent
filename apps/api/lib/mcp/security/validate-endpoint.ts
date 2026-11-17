import { lookup } from "node:dns/promises";
import net from "node:net";

/**
 * SSRF protection for remote MCP endpoints (Phase 6 plan §5.6).
 *
 * Every endpoint the server connects to — catalog entries and any future
 * user-supplied URL — must pass this check first:
 *   1. HTTPS only (no http:, no other schemes).
 *   2. Hostname not obviously local (localhost, *.local, *.internal, …).
 *   3. DNS resolves to only public addresses (blocks cloud metadata,
 *      loopback, RFC1918, link-local, CGNAT, multicast, reserved ranges).
 *
 * The transport is also configured with `redirect: "error"` so a public
 * endpoint cannot 302 us into the private network after validation.
 *
 * DNS rebinding: we re-resolve on every validation (each connect/discover/
 * execute), which closes the long-window attack; a sub-millisecond TOCTOU
 * between our lookup and the transport's own lookup remains theoretically
 * possible and is accepted for a single-user, admin-seeded catalog.
 */

export type EndpointValidation =
  | { ok: true; url: URL }
  | { ok: false; reason: string };

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "ip6-localhost",
  "ip6-loopback",
  "metadata",
  "metadata.google.internal",
  "instance-data",
]);

const BLOCKED_SUFFIXES = [".local", ".internal", ".lan", ".home", ".corp", ".intranet"];

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isInteger(n) && (n < 0 || n > 255))) {
    return true; // unparseable → treat as unsafe
  }
  const [a, b] = parts;
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local incl. 169.254.169.254 metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 192 && b === 0) return true; // 192.0.0.0/24 + documentation
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 benchmarking
  if (a >= 224) return true; // multicast + reserved + broadcast
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (normalized === "::" || normalized === "::1") return true;
  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible forms.
  const mapped = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIPv4(mapped[1]);
  if (/^f[cd]/.test(normalized)) return true; // fc00::/7 unique local
  if (/^fe[89ab]/.test(normalized)) return true; // fe80::/10 link-local
  if (normalized.startsWith("ff")) return true; // multicast
  return false;
}

export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) return isPrivateIPv4(ip);
  if (net.isIPv6(ip)) return isPrivateIPv6(ip);
  return true; // unknown format → unsafe
}

/** Validates a candidate MCP endpoint. Returns the parsed URL when safe. */
export async function validateEndpoint(rawUrl: string): Promise<EndpointValidation> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: "Not a valid URL." };
  }

  if (url.protocol !== "https:") {
    return { ok: false, reason: "Only https:// endpoints are allowed." };
  }
  if (url.username || url.password) {
    return { ok: false, reason: "Credentials in the URL are not allowed." };
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    return { ok: false, reason: "This host is not allowed." };
  }
  if (BLOCKED_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) {
    return { ok: false, reason: "This host is not allowed." };
  }

  // Literal IP in the URL: check it directly (no DNS involved).
  if (net.isIP(hostname)) {
    if (isPrivateAddress(hostname)) {
      return { ok: false, reason: "This address is not allowed." };
    }
    return { ok: true, url };
  }

  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    return { ok: false, reason: "Could not resolve this host." };
  }
  if (addresses.length === 0) {
    return { ok: false, reason: "Could not resolve this host." };
  }
  for (const { address } of addresses) {
    if (isPrivateAddress(address)) {
      return { ok: false, reason: "This host resolves to a blocked address." };
    }
  }

  return { ok: true, url };
}

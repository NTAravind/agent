import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isPrivateAddress, validateEndpoint } from "@/lib/mcp/security/validate-endpoint";

describe("SSRF endpoint validation", () => {
  it("accepts a normal public https URL", async () => {
    const result = await validateEndpoint("https://mcp.context7.com/mcp");
    assert.equal(result.ok, true);
    assert.ok(result.url instanceof URL);
    assert.equal(result.url.protocol, "https:");
  });

  it("rejects non-https protocols", async () => {
    for (const url of [
      "http://example.com/mcp",
      "ftp://example.com/mcp",
      "file:///etc/passwd",
      "ws://example.com/mcp",
    ]) {
      const result = await validateEndpoint(url);
      assert.equal(result.ok, false, `should reject ${url}`);
    }
  });

  it("rejects URLs with embedded credentials", async () => {
    const result = await validateEndpoint("https://user:pass@example.com/mcp");
    assert.equal(result.ok, false);
  });

  it("rejects localhost / loopback hostnames", async () => {
    for (const url of [
      "https://localhost/mcp",
      "https://localhost:8443/mcp",
      "https://127.0.0.1/mcp",
      "https://127.0.0.53/mcp",
      "https://[::1]/mcp",
    ]) {
      const result = await validateEndpoint(url);
      assert.equal(result.ok, false, `should reject ${url}`);
    }
  });

  it("rejects private and link-local IPv4 ranges", () => {
    const blocked = [
      "10.0.0.1",
      "10.255.255.255",
      "172.16.0.1",
      "172.31.255.254",
      "192.168.1.1",
      "169.254.169.254", // cloud metadata
      "127.0.0.1",
      "0.0.0.0",
      "100.64.0.1", // CGNAT
    ];
    for (const ip of blocked) {
      assert.equal(isPrivateAddress(ip), true, `${ip} must be private`);
    }
  });

  it("allows public IPv4 addresses", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "104.16.0.1", "93.184.216.34"]) {
      assert.equal(isPrivateAddress(ip), false, `${ip} must be public`);
    }
  });

  it("rejects IPv6 private ranges and IPv4-mapped IPv6", () => {
    const blocked = [
      "fe80::1",
      "fc00::1",
      "fd00::1",
      "::1",
      "::",
      "::ffff:127.0.0.1",
      "::ffff:169.254.169.254",
      "::ffff:192.168.1.1",
    ];
    for (const ip of blocked) {
      assert.equal(isPrivateAddress(ip), true, `${ip} must be private`);
    }
    assert.equal(isPrivateAddress("2606:4700:4700::1111"), false);
  });

  it("rejects internal-looking hostnames", async () => {
    for (const url of [
      "https://metadata.google.internal/mcp",
      "https://db.internal/mcp",
      "https://api.local/mcp",
      "https://service.corp/mcp",
      "https://intranet/mcp",
      "https://docker.internal/mcp",
    ]) {
      const result = await validateEndpoint(url);
      assert.equal(result.ok, false, `should reject ${url}`);
    }
  });

  it("rejects URLs without a hostname", async () => {
    const result = await validateEndpoint("not a url");
    assert.equal(result.ok, false);
  });
});

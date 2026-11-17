import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { describe, it } from "node:test";

import { decryptJson, encryptJson } from "@/lib/mcp/encryption";

// The key is read lazily by encryptJson/decryptJson (not at module load),
// so setting it here — before any test runs — is sufficient.
process.env.ENCRYPTION_KEY = randomBytes(32).toString("hex");

describe("MCP credential encryption", () => {
  it("round-trips a credential payload", () => {
    const payload = {
      apiKey: "sk-super-secret-value",
      oauth: { access_token: "at_123", refresh_token: "rt_456", expires_at: 123456789 },
    };

    const encrypted = encryptJson(payload);

    // The database only ever sees ciphertext — never the plaintext.
    assert.ok(!encrypted.ciphertext.includes("super-secret"));
    assert.ok(!encrypted.ciphertext.includes("at_123"));
    assert.equal(encrypted.keyVersion, "v1");
    assert.ok(encrypted.iv.length > 0);
    assert.ok(encrypted.tag.length > 0);

    const decrypted = decryptJson<typeof payload>(encrypted);
    assert.deepEqual(decrypted, payload);
  });

  it("uses a fresh IV per encryption (same payload ≠ same ciphertext)", () => {
    const payload = { apiKey: "same-value-every-time" };
    const a = encryptJson(payload);
    const b = encryptJson(payload);
    assert.notEqual(a.ciphertext, b.ciphertext);
    assert.notEqual(a.iv, b.iv);
  });

  it("rejects tampered ciphertext", () => {
    const encrypted = encryptJson({ apiKey: "value" });
    const bytes = Buffer.from(encrypted.ciphertext, "base64");
    bytes[0] ^= 0xff;
    const tampered = { ...encrypted, ciphertext: bytes.toString("base64") };

    assert.throws(() => decryptJson(tampered), /decrypt|auth|tag|cipher/i);
  });

  it("rejects a swapped GCM tag", () => {
    const encrypted = encryptJson({ apiKey: "value" });
    const tagBytes = Buffer.from(encrypted.tag, "base64");
    tagBytes[0] ^= 0xff;
    const tampered = { ...encrypted, tag: tagBytes.toString("base64") };

    assert.throws(() => decryptJson(tampered));
  });

  it("rejects a wrong key", () => {
    const encrypted = encryptJson({ apiKey: "value" });
    const original = process.env.ENCRYPTION_KEY;
    process.env.ENCRYPTION_KEY = randomBytes(32).toString("hex");
    try {
      assert.throws(() => decryptJson(encrypted));
    } finally {
      process.env.ENCRYPTION_KEY = original;
    }
  });
});

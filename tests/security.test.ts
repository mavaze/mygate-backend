import { describe, expect, it } from "vitest";
import { createInstallationHash, hashPassword, verifyPassword } from "../src/security";

describe("security primitives", () => {
  it("creates a deterministic installation hash", async () => {
    const a = await createInstallationHash("1234567890123456");
    const b = await createInstallationHash("1234567890123456");
    const c = await createInstallationHash("1234567890123457");
    expect(a).toHaveLength(64);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it("hashes and verifies watchman passwords without storing plaintext", async () => {
    const encoded = await hashPassword("correct horse battery staple");
    expect(encoded).toMatch(/^pbkdf2_sha256\$120000\$/);
    expect(encoded).not.toContain("correct horse");
    expect(await verifyPassword("correct horse battery staple", encoded)).toBe(true);
    expect(await verifyPassword("wrong password", encoded)).toBe(false);
  });
});

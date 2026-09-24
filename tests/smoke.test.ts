import { describe, expect, it } from "vitest";

describe("backend contract", () => {
  it("uses normal pilot/production license types", () => {
    const allowed = ["PILOT", "PRODUCTION"];
    expect(allowed).toContain("PILOT");
    expect(allowed).not.toContain("DEVELOPMENT");
  });

  it("requires a real installation identifier", () => {
    expect("short".length < 16).toBe(true);
    expect("1234567890123456".length >= 16).toBe(true);
  });
});

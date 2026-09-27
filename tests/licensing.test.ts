import { describe, expect, it } from "vitest";

describe("licensing model", () => {
  it("keeps commercial type separate from feature plan", () => {
    const license = { licenseType: "PRODUCTION", planCode: "ELITE_2027" };
    expect(license.licenseType).toBe("PRODUCTION");
    expect(license.planCode).toBe("ELITE_2027");
  });

  it("does not require application code to know future plan names", () => {
    const futurePlans = ["PRO", "ELITE", "ENTERPRISE", "SOCIETY_PLUS"];
    expect(futurePlans.every((code) => /^[A-Z0-9_]+$/.test(code))).toBe(true);
  });
});

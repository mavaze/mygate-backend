import type { Env } from "./env";
import { ApiError } from "./errors";

export interface LicenseCapability {
  code: string;
  displayName: string;
  description: string | null;
  config: Record<string, unknown>;
}

export interface LicensePlan {
  code: string;
  displayName: string;
  description: string | null;
  status: "ACTIVE" | "RETIRED";
  capabilities: LicenseCapability[];
}

function parseConfig(value: unknown): Record<string, unknown> {
  if (typeof value !== "string" || !value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

export async function getLicensePlan(
  env: Env,
  planCode: string
): Promise<LicensePlan> {
  const rows = await env.DB.prepare(`
    SELECT
      p.code plan_code,
      p.display_name plan_display_name,
      p.description plan_description,
      p.status plan_status,
      c.code capability_code,
      c.display_name capability_display_name,
      c.description capability_description,
      pc.config_json
    FROM license_plans p
    LEFT JOIN license_plan_capabilities pc ON pc.plan_code = p.code
    LEFT JOIN capabilities c ON c.code = pc.capability_code AND c.status = 'ACTIVE'
    WHERE p.code = ?
  `).bind(planCode).all<any>();

  const first = rows.results[0];
  if (!first) {
    throw new ApiError(500, "LICENSE_PLAN_NOT_FOUND", `License plan '${planCode}' does not exist`);
  }

  return {
    code: first.plan_code,
    displayName: first.plan_display_name,
    description: first.plan_description ?? null,
    status: first.plan_status,
    capabilities: rows.results
      .filter((row: any) => row.capability_code)
      .map((row: any) => ({
        code: row.capability_code,
        displayName: row.capability_display_name,
        description: row.capability_description ?? null,
        config: parseConfig(row.config_json)
      }))
  };
}

export async function getActivePlanCapabilities(
  env: Env,
  planCode: string
): Promise<LicenseCapability[]> {
  const plan = await getLicensePlan(env, planCode);
  if (plan.status !== "ACTIVE") {
    throw new ApiError(403, "LICENSE_PLAN_INACTIVE", "The license plan is not active");
  }
  return plan.capabilities;
}

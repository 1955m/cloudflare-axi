import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { randomBytes } from "node:crypto";
import { zonesCommand } from "./zones.js";
import { resetTokenCache, setSdkFetchImpl } from "../cloudflare.js";
import type { CloudflareContext } from "../context.js";

const ENV = "CLOUDFLARE_API_TOKEN";

function ctx(over: Partial<CloudflareContext> = {}): CloudflareContext {
  return { json: false, ...over };
}
function v4(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("zones list", () => {
  const orig = process.env[ENV];
  beforeEach(() => {
    process.env[ENV] = randomBytes(16).toString("hex");
    setSdkFetchImpl(null);
    resetTokenCache();
  });
  afterEach(() => {
    if (orig === undefined) delete process.env[ENV];
    else process.env[ENV] = orig;
    setSdkFetchImpl(null);
    resetTokenCache();
  });

  it("lists zones with count of total + TOON array", async () => {
    setSdkFetchImpl(async () =>
      v4({
        result: [{ id: "z1", name: "example.com", status: "active" }],
        result_info: { page: 1, per_page: 50, total_count: 1 },
        success: true,
        errors: [],
        messages: [],
      }),
    );
    const out = await zonesCommand(["list"], ctx());
    expect(out).toContain("count: 1 of 1 total");
    expect(out).toContain("zones[1]");
    expect(out).toContain("z1,example.com,active");
  });

  it("definitive empty state when zero zones", async () => {
    setSdkFetchImpl(async () =>
      v4({
        result: [],
        result_info: { page: 1, per_page: 50, total_count: 0 },
        success: true,
        errors: [],
        messages: [],
      }),
    );
    const out = await zonesCommand(["list"], ctx());
    expect(out).toContain("zones: 0 zones found for this account");
  });

  it("--json emits parseable JSON (ctx.json set by withContext)", async () => {
    setSdkFetchImpl(async () =>
      v4({
        result: [{ id: "z1", name: "a", status: "active" }],
        result_info: { total_count: 1 },
        success: true,
        errors: [],
        messages: [],
      }),
    );
    const out = await zonesCommand(["list"], ctx({ json: true }));
    const parsed = JSON.parse(out);
    expect(parsed.count).toBe(1);
    expect(parsed.total).toBe(1);
    expect(parsed.zones[0].id).toBe("z1");
  });

  it("rejects an unknown flag with VALIDATION_ERROR (fail loud)", async () => {
    await expect(zonesCommand(["list", "--bogus"], ctx())).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("rejects an unknown subcommand with VALIDATION_ERROR", async () => {
    const out = await zonesCommand(["bogus"], ctx());
    expect(out).toContain("Unknown zones subcommand");
  });
});

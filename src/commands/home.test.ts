import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { homeCommand } from "./home.js";
import { resetTokenCache, setSdkFetchImpl } from "../cloudflare.js";
import { resetProfilesCache } from "../profiles.js";
import type { CloudflareContext } from "../context.js";

const ENV = "CLOUDFLARE_API_TOKEN";
const CFG_DIR = "CLOUDFLARE_AXI_CONFIG_DIR";

function ctx(over: Partial<CloudflareContext> = {}): CloudflareContext {
  return { json: false, ...over };
}
function v4(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("home digest", () => {
  const origToken = process.env[ENV];
  const origCfg = process.env[CFG_DIR];
  let dir: string;

  beforeEach(() => {
    delete process.env[ENV];
    dir = mkdtempSync(join(tmpdir(), "cfaxi-home-"));
    process.env[CFG_DIR] = dir;
    setSdkFetchImpl(null);
    resetTokenCache();
    resetProfilesCache();
  });
  afterEach(() => {
    if (origToken === undefined) delete process.env[ENV];
    else process.env[ENV] = origToken;
    if (origCfg === undefined) delete process.env[CFG_DIR];
    else process.env[CFG_DIR] = origCfg;
    setSdkFetchImpl(null);
    resetTokenCache();
    resetProfilesCache();
    rmSync(dir, { recursive: true, force: true });
  });

  it("--json emits a parseable degraded digest when no token is present", async () => {
    const out = await homeCommand([], ctx({ json: true }));
    const parsed = JSON.parse(out);
    expect(parsed.account).toBe("none");
    expect(parsed.token).toBe("no");
    expect(parsed.reachable).toBe("no");
    expect(Array.isArray(parsed.help)).toBe(true);
  });

  it("--json emits the full digest shape with zones, r2, and images", async () => {
    process.env[ENV] = randomBytes(16).toString("hex");
    setSdkFetchImpl(async (url: string) => {
      if (url.includes("/user/tokens/verify")) {
        return v4({
          result: { id: "tok-1", status: "active" },
          success: true,
          errors: [],
          messages: [],
        });
      }
      if (url.includes("/r2/buckets")) {
        return v4({
          result: { buckets: [{ name: "bucket-1" }] },
          success: true,
          errors: [],
          messages: [],
        });
      }
      if (url.includes("/images/v1/stats")) {
        return v4({
          result: { count: { allowed: 100, current: 5 } },
          success: true,
          errors: [],
          messages: [],
        });
      }
      if (url.includes("/zones")) {
        return v4({
          result: [{ id: "z1", name: "example.com", status: "active" }],
          result_info: { page: 1, per_page: 50, total_count: 1 },
          success: true,
          errors: [],
          messages: [],
        });
      }
      return v4({ result: null, success: false, errors: [], messages: [] }, 404);
    });
    const out = await homeCommand([], ctx({ json: true, accountId: "acct-1" }));
    const parsed = JSON.parse(out);
    expect(parsed.token).toBe("yes");
    expect(parsed.reachable).toBe("yes");
    expect(parsed.account_id).toBe("acct-1");
    expect(parsed.zones).toEqual([{ id: "z1", name: "example.com", status: "active" }]);
    expect(parsed.r2).toEqual({ count: 1 });
    expect(parsed.images).toEqual({ current: 5, allowed: 100 });
    expect(Array.isArray(parsed.help)).toBe(true);
  });

  it("--json surfaces an unresolved account_id as an error field, not a throw", async () => {
    process.env[ENV] = randomBytes(16).toString("hex");
    setSdkFetchImpl(async (url: string) => {
      if (url.includes("/user/tokens/verify")) {
        return v4({
          result: { id: "tok-1", status: "active" },
          success: true,
          errors: [],
          messages: [],
        });
      }
      if (url.includes("/zones")) {
        return v4({
          result: [],
          result_info: { page: 1, per_page: 50, total_count: 0 },
          success: true,
          errors: [],
          messages: [],
        });
      }
      return v4({ result: null, success: false, errors: [], messages: [] }, 404);
    });
    const out = await homeCommand([], ctx({ json: true }));
    const parsed = JSON.parse(out);
    expect(parsed.r2.error).toContain("no account_id resolved");
    expect(parsed.images.error).toContain("no account_id resolved");
  });

  it("plain (non-JSON) digest is unaffected — still renders TOON", async () => {
    const out = await homeCommand([], ctx());
    expect(out).toContain("account: none");
    expect(out).toContain("token: no");
    expect(out).toContain("reachable: no");
  });
});

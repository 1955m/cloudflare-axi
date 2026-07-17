import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { randomBytes } from "node:crypto";
import { imagesCommand } from "./images.js";
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

describe("images stats", () => {
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

  it("renders the stored meter + transformations: not wired", async () => {
    setSdkFetchImpl(async () =>
      v4({
        result: { count: { allowed: 100000, current: 1000 } },
        success: true,
        errors: [],
        messages: [],
      }),
    );
    const out = await imagesCommand(["stats"], ctx({ accountId: "acct-1" }));
    expect(out).toContain("1000");
    expect(out).toContain("100000");
    expect(out).toContain("not wired");
    expect(out).toContain("stored");
  });

  it("transformation quota 9422 → RATE_LIMITED (the wire-point seam)", async () => {
    setSdkFetchImpl(async () =>
      v4(
        {
          success: false,
          errors: [{ code: 9422, message: "quota exceeded" }],
          messages: [],
          result: null,
        },
        400,
      ),
    );
    await expect(imagesCommand(["stats"], ctx({ accountId: "acct-1" }))).rejects.toMatchObject({
      code: "RATE_LIMITED",
    });
  });

  it("requires an account_id (VALIDATION_ERROR when none)", async () => {
    await expect(imagesCommand(["stats"], ctx())).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("--json emits the stored + not-wired shape", async () => {
    setSdkFetchImpl(async () =>
      v4({
        result: { count: { allowed: 100000, current: 1000 } },
        success: true,
        errors: [],
        messages: [],
      }),
    );
    const out = await imagesCommand(["stats"], ctx({ accountId: "acct-1", json: true }));
    const parsed = JSON.parse(out);
    expect(parsed.stored).toEqual({ current: 1000, allowed: 100000 });
    expect(parsed.transformations).toBe("not wired");
  });

  it("rejects an unknown subcommand", async () => {
    const out = await imagesCommand(["bogus"], ctx());
    expect(out).toContain("Unknown images subcommand");
  });
});

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseContextArgs, resolveCloudflareContext } from "./context.js";
import { resetProfilesCache } from "./profiles.js";

const CFG_DIR = "CLOUDFLARE_AXI_CONFIG_DIR";
const ACCT_ENV = "CLOUDFLARE_ACCOUNT_ID";
const ZONE_ENV = "CLOUDFLARE_ZONE_ID";

describe("parseContextArgs", () => {
  it("strips --account/--zone (space + equals) and --json", () => {
    const r = parseContextArgs([
      "list",
      "--account",
      "example",
      "--zone=z1",
      "--json",
      "--limit",
      "5",
    ]);
    expect(r.accountFlag).toBe("example");
    expect(r.zoneFlag).toBe("z1");
    expect(r.jsonFlag).toBe(true);
    expect(r.strippedArgs).toEqual(["list", "--limit", "5"]);
  });
  it("leaves non-context args untouched", () => {
    const r = parseContextArgs(["list", "--limit", "5"]);
    expect(r.strippedArgs).toEqual(["list", "--limit", "5"]);
    expect(r.jsonFlag).toBe(false);
  });
});

describe("resolveCloudflareContext", () => {
  let dir: string;
  const origAcct = process.env[ACCT_ENV];
  const origZone = process.env[ZONE_ENV];
  const origCfg = process.env[CFG_DIR];
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "cfaxi-ctx-"));
    process.env[CFG_DIR] = dir;
    delete process.env[ACCT_ENV];
    delete process.env[ZONE_ENV];
    resetProfilesCache();
  });
  afterEach(() => {
    if (origAcct === undefined) delete process.env[ACCT_ENV];
    else process.env[ACCT_ENV] = origAcct;
    if (origZone === undefined) delete process.env[ZONE_ENV];
    else process.env[ZONE_ENV] = origZone;
    if (origCfg === undefined) delete process.env[CFG_DIR];
    else process.env[CFG_DIR] = origCfg;
    resetProfilesCache();
    rmSync(dir, { recursive: true, force: true });
  });

  it("trailing flags win over leading; leading is the fallback", () => {
    writeFileSync(
      join(dir, "profiles.yaml"),
      'default: example\nprofiles:\n  example:\n    account_id: "acct-example"\n    zone_id: "zone-example"\n',
    );
    resetProfilesCache();
    const trailing = parseContextArgs(["--account", "personal"]);
    const leading = parseContextArgs(["--account", "example"]);
    // trailing personal wins over leading example
    let ctx = resolveCloudflareContext(trailing, leading);
    expect(ctx.profileName).toBe("personal");
    // no trailing → leading wins
    ctx = resolveCloudflareContext(parseContextArgs([]), leading);
    expect(ctx.profileName).toBe("example");
    expect(ctx.accountId).toBe("acct-example");
    expect(ctx.zoneId).toBe("zone-example");
  });

  it("json is true if either leading or trailing sets it", () => {
    expect(
      resolveCloudflareContext(parseContextArgs(["--json"]), { jsonFlag: false, strippedArgs: [] })
        .json,
    ).toBe(true);
    expect(
      resolveCloudflareContext(parseContextArgs([]), { jsonFlag: true, strippedArgs: [] }).json,
    ).toBe(true);
    expect(
      resolveCloudflareContext(parseContextArgs([]), { jsonFlag: false, strippedArgs: [] }).json,
    ).toBe(false);
  });

  it("falls back to env for account_id/zone_id when no profile", () => {
    process.env[ACCT_ENV] = "acct-env";
    process.env[ZONE_ENV] = "zone-env";
    const ctx = resolveCloudflareContext(parseContextArgs([]), undefined);
    expect(ctx.accountId).toBe("acct-env");
    expect(ctx.zoneId).toBe("zone-env");
    expect(ctx.profileName).toBeUndefined();
  });
});

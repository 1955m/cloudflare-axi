import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import {
  accountFilePath,
  configJsonPath,
  isReadonlyEnforced,
  readonlyFilePath,
  requireToken,
  resetReadonlyCache,
  resolveAccountId,
  resolveProfileName,
  resolveZoneId,
  tokenFilePath,
} from "./config.js";
import { resetProfilesCache, setExternalResolver } from "./profiles.js";

function newConfigDir(): string {
  return mkdtempSync(join(tmpdir(), "cfaxi-config-"));
}

const ENV = "CLOUDFLARE_API_TOKEN";
const ACCT_ENV = "CLOUDFLARE_ACCOUNT_ID";
const ZONE_ENV = "CLOUDFLARE_ZONE_ID";
const CFG_DIR = "CLOUDFLARE_AXI_CONFIG_DIR";
const RDONLY_ENV = "CLOUDFLARE_AXI_READONLY";

function snapshotEnv(): Record<string, string | undefined> {
  return {
    [ENV]: process.env[ENV],
    [ACCT_ENV]: process.env[ACCT_ENV],
    [ZONE_ENV]: process.env[ZONE_ENV],
    [CFG_DIR]: process.env[CFG_DIR],
    [RDONLY_ENV]: process.env[RDONLY_ENV],
  };
}
function restoreEnv(snap: Record<string, string | undefined>): void {
  for (const [k, v] of Object.entries(snap)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

describe("isReadonlyEnforced", () => {
  let dir: string;
  let snap: Record<string, string | undefined>;
  beforeEach(() => {
    snap = snapshotEnv();
    dir = newConfigDir();
    process.env[CFG_DIR] = dir;
    delete process.env[RDONLY_ENV];
    resetReadonlyCache();
  });
  afterEach(() => {
    restoreEnv(snap);
    resetReadonlyCache();
    rmSync(dir, { recursive: true, force: true });
  });

  it("is off on a clean box", () => {
    expect(isReadonlyEnforced()).toBe(false);
  });
  it("turns on via CLOUDFLARE_AXI_READONLY=1", () => {
    process.env[RDONLY_ENV] = "1";
    resetReadonlyCache();
    expect(isReadonlyEnforced()).toBe(true);
  });
  it("turns on via CLOUDFLARE_AXI_READONLY=true (case-insensitive)", () => {
    process.env[RDONLY_ENV] = "TRUE";
    resetReadonlyCache();
    expect(isReadonlyEnforced()).toBe(true);
  });
  it("turns on via the readonly marker file", () => {
    writeFileSync(readonlyFilePath(), "");
    resetReadonlyCache();
    expect(isReadonlyEnforced()).toBe(true);
  });
  it("turns on via config.json readonly:true", () => {
    writeFileSync(configJsonPath(), JSON.stringify({ readonly: true }));
    resetReadonlyCache();
    expect(isReadonlyEnforced()).toBe(true);
  });
  it("paths resolve under the config dir", () => {
    expect(readonlyFilePath()).toBe(join(dir, "readonly"));
    expect(tokenFilePath()).toBe(join(dir, "token"));
    expect(accountFilePath()).toBe(join(dir, "account"));
    expect(configJsonPath()).toBe(join(dir, "config.json"));
  });
});

describe("resolveAccountId / resolveZoneId / resolveProfileName", () => {
  let dir: string;
  let snap: Record<string, string | undefined>;
  beforeEach(() => {
    snap = snapshotEnv();
    dir = newConfigDir();
    process.env[CFG_DIR] = dir;
    delete process.env[ENV];
    delete process.env[ACCT_ENV];
    delete process.env[ZONE_ENV];
    resetProfilesCache();
  });
  afterEach(() => {
    restoreEnv(snap);
    resetProfilesCache();
    rmSync(dir, { recursive: true, force: true });
  });

  it("resolveProfileName: flag > profiles.default", () => {
    writeFileSync(
      join(dir, "profiles.yaml"),
      'default: example\nprofiles:\n  example:\n    account_id: "a-example"\n',
    );
    resetProfilesCache();
    expect(resolveProfileName()).toBe("example");
    expect(resolveProfileName("personal")).toBe("personal");
    expect(resolveProfileName(undefined)).toBe("example");
  });

  it("resolveAccountId: profile.account_id > env > account file", () => {
    writeFileSync(
      join(dir, "profiles.yaml"),
      'default: example\nprofiles:\n  example:\n    account_id: "from-profile"\n',
    );
    resetProfilesCache();
    expect(resolveAccountId("example")).toBe("from-profile");
    expect(resolveAccountId(undefined)).toBe("from-profile"); // default profile fallback
    process.env[ACCT_ENV] = "from-env";
    expect(resolveAccountId("no-such-profile")).toBe("from-env"); // profile not found → env
    delete process.env[ACCT_ENV];
    writeFileSync(join(dir, "account"), "from-file");
    expect(resolveAccountId("no-such-profile")).toBe("from-file"); // no profile, no env → file
  });

  it("resolveZoneId: flag > profile.zone_id > env", () => {
    writeFileSync(
      join(dir, "profiles.yaml"),
      'default: example\nprofiles:\n  example:\n    zone_id: "z-profile"\n',
    );
    resetProfilesCache();
    expect(resolveZoneId(undefined, "example")).toBe("z-profile");
    expect(resolveZoneId("z-flag", "example")).toBe("z-flag");
    process.env[ZONE_ENV] = "z-env";
    expect(resolveZoneId(undefined, "example")).toBe("z-profile"); // profile.zone_id wins over env
    expect(resolveZoneId(undefined, "no-such-profile")).toBe("z-env"); // no profile → env
    expect(resolveZoneId(undefined, undefined)).toBe("z-profile"); // default profile fallback
  });
});

describe("requireToken precedence (env > profile > token file > AUTH_REQUIRED)", () => {
  let dir: string;
  let snap: Record<string, string | undefined>;
  beforeEach(() => {
    snap = snapshotEnv();
    dir = newConfigDir();
    process.env[CFG_DIR] = dir;
    delete process.env[ENV];
    resetProfilesCache();
  });
  afterEach(() => {
    restoreEnv(snap);
    resetProfilesCache();
    setExternalResolver(null);
    rmSync(dir, { recursive: true, force: true });
  });

  it("env wins over the profile token_source", async () => {
    const envTok = "cf-env-" + randomBytes(8).toString("hex");
    process.env[ENV] = envTok;
    writeFileSync(
      join(dir, "profiles.yaml"),
      'default: p\nprofiles:\n  p:\n    account_id: "a"\n    token_source:\n      type: plain-file\n      path: "/nonexistent"\n',
    );
    resetProfilesCache();
    expect(await requireToken("p")).toBe(envTok);
  });

  it("profile token_source (env-file) resolves when no env", async () => {
    const tok = "cf-envfile-" + randomBytes(8).toString("hex");
    const envFile = join(dir, "token.env");
    writeFileSync(envFile, `CLOUDFLARE_API_TOKEN=${tok}\n`);
    writeFileSync(
      join(dir, "profiles.yaml"),
      `default: p\nprofiles:\n  p:\n    account_id: "a"\n    token_source:\n      type: env-file\n      path: "${envFile}"\n      key: "CLOUDFLARE_API_TOKEN"\n`,
    );
    resetProfilesCache();
    expect(await requireToken("p")).toBe(tok);
    expect(await requireToken(undefined)).toBe(tok); // default profile
  });

  it("falls back to the flat token file when no env and no profile source", async () => {
    const tok = "cf-flat-" + randomBytes(8).toString("hex");
    writeFileSync(tokenFilePath(), tok);
    resetProfilesCache();
    expect(await requireToken()).toBe(tok);
  });

  it("throws AUTH_REQUIRED when nothing resolves", async () => {
    resetProfilesCache();
    await expect(requireToken()).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
  });

  it("aws-secrets-manager CLI-missing surfaces AUTH_REQUIRED (via the resolver seam)", async () => {
    writeFileSync(
      join(dir, "profiles.yaml"),
      'default: p\nprofiles:\n  p:\n    account_id: "a"\n    token_source:\n      type: aws-secrets-manager\n      secret_id: "arn:test"\n      region: "ap-northeast-2"\n',
    );
    resetProfilesCache();
    // Inject a resolver that throws a CLI-missing-shaped error (no real shell-out).
    setExternalResolver(async () => {
      throw new Error("spawn aws ENOENT: command not found");
    });
    await expect(requireToken("p")).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
  });

  it("a generic resolver failure surfaces VALIDATION_ERROR (misconfigured)", async () => {
    writeFileSync(
      join(dir, "profiles.yaml"),
      'default: p\nprofiles:\n  p:\n    account_id: "a"\n    token_source:\n      type: vaultwarden\n      item: "example-cf"\n      field: "password"\n',
    );
    resetProfilesCache();
    setExternalResolver(async () => {
      throw new Error("unexpected JSON shape from bw");
    });
    await expect(requireToken("p")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

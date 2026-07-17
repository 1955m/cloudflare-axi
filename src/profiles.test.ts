import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import {
  getProfile,
  listProfileNames,
  loadProfiles,
  normalizeProfiles,
  parseProfilesYaml,
  resetProfilesCache,
  resolveTokenFromSource,
  setExternalResolver,
} from "./profiles.js";

const PROFILES_YAML = `# cloudflare-axi profiles (test fixture — placeholder ids, no real tokens)
default: example
profiles:
  example:
    account_id: "example-account-id"
    zone_id: "example-default-zone"
    token_source:
      type: aws-secrets-manager
      secret_id: "arn:aws:secretsmanager:ap-northeast-2:000000000000:secret:cf-test"
      region: "ap-northeast-2"
      json_key: "token"
  personal:
    account_id: "personal-account-id"
    token_source:
      type: env-file
      path: PLACEHOLDER_ENV_FILE
      key: "CLOUDFLARE_API_TOKEN"
`;

describe("parseProfilesYaml + normalizeProfiles", () => {
  it("parses default + profiles map + nested token_source", () => {
    const parsed = parseProfilesYaml(PROFILES_YAML);
    const norm = normalizeProfiles(parsed);
    expect(norm.default).toBe("example");
    expect(Object.keys(norm.profiles ?? {})).toEqual(["example", "personal"]);
    const example = norm.profiles!.example;
    expect(example.account_id).toBe("example-account-id");
    expect(example.zone_id).toBe("example-default-zone");
    expect(example.token_source?.type).toBe("aws-secrets-manager");
    expect((example.token_source as { secret_id: string }).secret_id).toMatch(
      /arn:aws:secretsmanager/,
    );
    const personal = norm.profiles!.personal;
    expect(personal.token_source?.type).toBe("env-file");
    expect((personal.token_source as { key: string }).key).toBe("CLOUDFLARE_API_TOKEN");
  });

  it("strips # comments and quoted values", () => {
    const norm = normalizeProfiles(
      parseProfilesYaml('default: "x" # the default\nprofiles:\n  x:\n    account_id: "a1"\n'),
    );
    expect(norm.default).toBe("x");
    expect(norm.profiles!.x.account_id).toBe("a1");
  });

  it("returns empty for a missing profiles key", () => {
    expect(normalizeProfiles(parseProfilesYaml("# just a comment\n")).profiles).toBeUndefined();
  });
});

describe("profile accessors", () => {
  beforeEach(() => {
    process.env.CLOUDFLARE_AXI_CONFIG_DIR = mkdtempSync(join(tmpdir(), "cfaxi-profiles-"));
    resetProfilesCache();
  });
  afterEach(() => {
    const dir = process.env.CLOUDFLARE_AXI_CONFIG_DIR;
    delete process.env.CLOUDFLARE_AXI_CONFIG_DIR;
    resetProfilesCache();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("loads profiles from disk and caches", () => {
    writeFileSync(join(process.env.CLOUDFLARE_AXI_CONFIG_DIR!, "profiles.yaml"), PROFILES_YAML);
    expect(loadProfiles().default).toBe("example");
    expect(getProfile("personal")?.account_id).toBe("personal-account-id");
    expect(listProfileNames()).toEqual(["example", "personal"]);
  });

  it("returns an empty file when profiles.yaml is absent", () => {
    expect(loadProfiles().default).toBeUndefined();
    expect(listProfileNames()).toEqual([]);
  });
});

describe("resolveTokenFromSource", () => {
  it("env-file reads KEY=value and strips quotes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cfaxi-env-"));
    const tok = "cf-test-" + randomBytes(8).toString("hex");
    writeFileSync(join(dir, "token.env"), `CLOUDFLARE_API_TOKEN="${tok}"\n`);
    const src = {
      type: "env-file" as const,
      path: join(dir, "token.env"),
      key: "CLOUDFLARE_API_TOKEN",
    };
    try {
      expect(await resolveTokenFromSource(src)).toBe(tok);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("plain-file reads + trims", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cfaxi-plain-"));
    const tok = "cf-plain-" + randomBytes(8).toString("hex");
    writeFileSync(join(dir, "token"), `${tok}\n`);
    const src = { type: "plain-file" as const, path: join(dir, "token") };
    try {
      expect(await resolveTokenFromSource(src)).toBe(tok);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("aws-secrets-manager + vaultwarden route through the external resolver seam", async () => {
    const tok = "cf-aws-" + randomBytes(8).toString("hex");
    setExternalResolver(async () => tok);
    try {
      const aws = await resolveTokenFromSource({
        type: "aws-secrets-manager",
        secret_id: "arn:test",
        region: "ap-northeast-2",
        json_key: "token",
      });
      expect(aws).toBe(tok);
      const bw = await resolveTokenFromSource({
        type: "vaultwarden",
        item: "example-cf",
        field: "password",
      });
      expect(bw).toBe(tok);
    } finally {
      setExternalResolver(null);
    }
  });

  it("returns undefined for an unknown source type", async () => {
    expect(await resolveTokenFromSource({ type: "bogus" } as never)).toBeUndefined();
  });
});

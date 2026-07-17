import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { main, DESCRIPTION } from "./cli.js";
import { createSkillMarkdown } from "./skill.js";
import { resetTokenCache, setSdkFetchImpl } from "./cloudflare.js";
import { resetProfilesCache } from "./profiles.js";

const ENV = "CLOUDFLARE_API_TOKEN";
const CFG_DIR = "CLOUDFLARE_AXI_CONFIG_DIR";

function capture(): { chunks: string[]; stdout: { write: (c: string) => unknown } } {
  const chunks: string[] = [];
  return { chunks, stdout: { write: (c: string) => chunks.push(c) } };
}

function v4(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("main (in-process, no network)", () => {
  let dir: string;
  let origToken: string | undefined;
  let origCfg: string | undefined;

  beforeEach(() => {
    origToken = process.env[ENV];
    origCfg = process.env[CFG_DIR];
    delete process.env[ENV];
    dir = mkdtempSync(join(tmpdir(), "cfaxi-int-"));
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

  it("prints version for -v", async () => {
    const out = capture();
    await main({ argv: ["-v"], stdout: out.stdout });
    expect(out.chunks.join("")).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("prints --version for --version", async () => {
    const out = capture();
    await main({ argv: ["--version"], stdout: out.stdout });
    expect(out.chunks.join("")).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("prints top-level help for --help", async () => {
    const out = capture();
    await main({ argv: ["--help"], stdout: out.stdout });
    const text = out.chunks.join("");
    expect(text).toContain("usage:");
    expect(text).toContain("commands[7]:");
    expect(text).toContain("--account");
    expect(text).toContain("zones list");
  });

  it("prints SKILL.md for --skill", async () => {
    const out = capture();
    await main({ argv: ["--skill"], stdout: out.stdout });
    const text = out.chunks.join("");
    expect(text).toContain("name: cloudflare-axi");
    expect(text).toContain("user-invocable: false");
    expect(text).toContain("## Commands");
    expect(text).toContain("commands[7]:");
  });

  it("renders the home digest header + token: no on an empty box (never throws)", async () => {
    const out = capture();
    await main({ argv: [], stdout: out.stdout });
    const text = out.chunks.join("");
    expect(text).toContain("bin:");
    expect(text).toContain(DESCRIPTION);
    expect(text).toContain("account: none");
    expect(text).toContain("token: no");
    expect(text).toContain("reachable: no");
  });

  it("leading --account <name> selects the profile for the home digest", async () => {
    const out = capture();
    await main({ argv: ["--account", "personal"], stdout: out.stdout });
    const text = out.chunks.join("");
    expect(text).toContain("account: personal");
    expect(text).toContain("token: no");
  });

  it("rejects a leading non-context flag with VALIDATION_ERROR", async () => {
    const out = capture();
    await main({ argv: ["--bogus"], stdout: out.stdout });
    const text = out.chunks.join("");
    expect(text).toContain("VALIDATION_ERROR");
    expect(text).toContain("after the command");
  });

  it("reports an unknown command", async () => {
    const out = capture();
    await main({ argv: ["bogus"], stdout: out.stdout });
    const text = out.chunks.join("");
    expect(text).toContain("Unknown command: bogus");
  });

  it("zones list with a stubbed fetch renders TOON + count", async () => {
    process.env[ENV] = randomBytes(16).toString("hex");
    setSdkFetchImpl(async () =>
      v4({
        result: [{ id: "z1", name: "example.com", status: "active" }],
        result_info: { page: 1, per_page: 50, total_count: 1 },
        success: true,
        errors: [],
        messages: [],
      }),
    );
    const out = capture();
    await main({ argv: ["zones", "list"], stdout: out.stdout });
    const text = out.chunks.join("");
    expect(text).toContain("count: 1 of 1 total");
    expect(text).toContain("zones[1]");
    expect(text).toContain("z1,example.com,active");
  });

  it("zones list --bogus fails loud with VALIDATION_ERROR", async () => {
    process.env[ENV] = randomBytes(16).toString("hex");
    setSdkFetchImpl(async () => v4({ result: [], success: true, errors: [], messages: [] }));
    const out = capture();
    await main({ argv: ["zones", "list", "--bogus"], stdout: out.stdout });
    const text = out.chunks.join("");
    expect(text).toContain("VALIDATION_ERROR");
    expect(text).toContain("unknown flag --bogus");
  });

  it("dns records list without --zone fails with VALIDATION_ERROR", async () => {
    process.env[ENV] = randomBytes(16).toString("hex");
    setSdkFetchImpl(async () => v4({ result: [], success: true, errors: [], messages: [] }));
    const out = capture();
    await main({ argv: ["dns", "records", "list"], stdout: out.stdout });
    const text = out.chunks.join("");
    expect(text).toContain("VALIDATION_ERROR");
    expect(text).toContain("--zone");
  });

  it("accounts whoami with a stubbed fetch renders token_id + status", async () => {
    process.env[ENV] = randomBytes(16).toString("hex");
    setSdkFetchImpl(async (url: string) => {
      if (url.includes("/user/tokens/verify")) {
        return v4({
          result: { id: "tok-1", status: "active", expires_on: "2027-01-01T00:00:00Z" },
          success: true,
          errors: [],
          messages: [],
        });
      }
      if (url.includes("/accounts")) {
        return v4({
          result: [{ id: "acct-1", name: "example", type: "standard" }],
          result_info: { total_count: 1 },
          success: true,
          errors: [],
          messages: [],
        });
      }
      return v4({ result: null, success: false, errors: [], messages: [] }, 404);
    });
    const out = capture();
    await main({ argv: ["accounts", "whoami"], stdout: out.stdout });
    const text = out.chunks.join("");
    expect(text).toContain("token_id: tok-1");
    expect(text).toContain("status: active");
    expect(text).toContain("accounts[1]");
  });
});

describe("createSkillMarkdown", () => {
  it("includes frontmatter, the commands block, and the not-wired note", () => {
    const md = createSkillMarkdown();
    expect(md).toContain("---\nname: cloudflare-axi");
    expect(md).toContain("category: cloud");
    expect(md).toContain("commands[7]:");
    expect(md).toContain("npx -y cloudflare-axi");
    expect(md).toContain("not wired");
    expect(md).toContain("--dry-run");
  });
});

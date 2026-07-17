import { existsSync, readFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { AxiError } from "./errors.js";

/**
 * Multi-account profile resolution (design §5). Each profile points at a
 * *token-source descriptor* + a default `account_id` + optional default
 * `zone_id`. The profiles file NEVER holds a token literal.
 *
 * The profiles.yaml subset parsed here is small: a top-level `default:` scalar
 * and a `profiles:` map whose entries are scalars + one nested `token_source:`
 * map. `parseProfilesYaml()` is a minimal indent-based parser for THIS subset
 * (not a general YAML parser) — kept dep-light per the design. Tested with a
 * fixture profiles.yaml (placeholder ids, never a real token).
 */

// ── token-source descriptor types (design §5.3) ─────────────────────────────

export interface AwsSecretsManagerSource {
  type: "aws-secrets-manager";
  secret_id: string;
  region?: string;
  json_key?: string;
}
export interface EnvFileSource {
  type: "env-file";
  path: string;
  key: string;
}
export interface VaultwardenSource {
  type: "vaultwarden";
  item: string;
  field: string;
}
export interface PlainFileSource {
  type: "plain-file";
  path: string;
}
export type TokenSource =
  AwsSecretsManagerSource | EnvFileSource | VaultwardenSource | PlainFileSource;

export interface ProfileConfig {
  account_id?: string;
  zone_id?: string;
  token_source?: TokenSource;
}
export interface ProfilesFile {
  default?: string;
  profiles?: Record<string, ProfileConfig>;
}

// ── paths ────────────────────────────────────────────────────────────────────

/** Config dir override (mirrors config.ts; the same env, no cross-import). */
function profilesConfigDir(): string {
  return process.env["CLOUDFLARE_AXI_CONFIG_DIR"] ?? join(homedir(), ".config", "cloudflare-axi");
}

/** Path to the profiles file (~/.config/cloudflare-axi/profiles.yaml). */
export function profilesFilePath(): string {
  return join(profilesConfigDir(), "profiles.yaml");
}

// ── minimal YAML-subset parser ───────────────────────────────────────────────

function stripComment(line: string): string {
  // Naive `#`-to-EOL strip; the profiles.yaml subset carries no `#` in values.
  const hash = line.indexOf("#");
  return (hash === -1 ? line : line.slice(0, hash)).replace(/\s+$/, "");
}

function parseScalar(raw: string): string {
  const v = raw.trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  return v;
}

/**
 * Parse the profiles.yaml subset into a nested object. Handles indentation,
 * `key: value` scalars (quoted or bare), `key:` nested maps, and `#` comments.
 * Not a general YAML parser — only the profiles.yaml shape.
 */
export function parseProfilesYaml(text: string): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  const stack: { indent: number; node: Record<string, unknown> }[] = [{ indent: -1, node: root }];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = stripComment(rawLine);
    if (line.trim() === "") continue;
    const indent = line.match(/^[ \t]*/)?.[0].length ?? 0;
    const content = line.slice(indent).trimEnd();
    const colon = content.indexOf(":");
    if (colon === -1) continue;
    const key = content.slice(0, colon).trim();
    const valueRaw = content.slice(colon + 1).trim();
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    const parent = stack[stack.length - 1].node;
    if (valueRaw === "" || valueRaw === "|" || valueRaw === ">") {
      const child: Record<string, unknown> = {};
      parent[key] = child;
      stack.push({ indent, node: child });
    } else {
      parent[key] = parseScalar(valueRaw);
    }
  }
  return root;
}

function normalizeTokenSource(ts: unknown): TokenSource | undefined {
  if (!ts || typeof ts !== "object") return undefined;
  const rec = ts as Record<string, unknown>;
  const type = typeof rec["type"] === "string" ? rec["type"] : undefined;
  switch (type) {
    case "aws-secrets-manager":
      return {
        type,
        secret_id: String(rec["secret_id"] ?? ""),
        region: typeof rec["region"] === "string" ? rec["region"] : undefined,
        json_key: typeof rec["json_key"] === "string" ? rec["json_key"] : undefined,
      };
    case "env-file":
      return {
        type,
        path: String(rec["path"] ?? ""),
        key: String(rec["key"] ?? ""),
      };
    case "vaultwarden":
      return {
        type,
        item: String(rec["item"] ?? ""),
        field: String(rec["field"] ?? ""),
      };
    case "plain-file":
      return { type, path: String(rec["path"] ?? "") };
    default:
      return undefined;
  }
}

function normalizeProfile(rec: Record<string, unknown>): ProfileConfig {
  const profile: ProfileConfig = {};
  if (typeof rec["account_id"] === "string") profile.account_id = rec["account_id"];
  if (typeof rec["zone_id"] === "string") profile.zone_id = rec["zone_id"];
  const ts = normalizeTokenSource(rec["token_source"]);
  if (ts) profile.token_source = ts;
  return profile;
}

export function normalizeProfiles(parsed: Record<string, unknown>): ProfilesFile {
  const def = typeof parsed["default"] === "string" ? parsed["default"] : undefined;
  const profiles: Record<string, ProfileConfig> = {};
  const profilesRaw = parsed["profiles"];
  if (profilesRaw && typeof profilesRaw === "object") {
    for (const [name, val] of Object.entries(profilesRaw as Record<string, unknown>)) {
      if (val && typeof val === "object") {
        profiles[name] = normalizeProfile(val as Record<string, unknown>);
      }
    }
  }
  return {
    default: def,
    ...(Object.keys(profiles).length > 0 ? { profiles } : {}),
  };
}

// ── load + access ────────────────────────────────────────────────────────────

let cachedProfiles: ProfilesFile | null = null;

/** Load + cache the profiles file (sync; the file is small). */
export function loadProfiles(force = false): ProfilesFile {
  if (cachedProfiles && !force) return cachedProfiles;
  const file = profilesFilePath();
  if (!existsSync(file)) {
    cachedProfiles = {};
    return cachedProfiles;
  }
  try {
    const text = readFileSync(file, "utf8");
    cachedProfiles = normalizeProfiles(parseProfilesYaml(text));
  } catch {
    cachedProfiles = {};
  }
  return cachedProfiles;
}

/** Reset the profiles cache (tests / setup). */
export function resetProfilesCache(): void {
  cachedProfiles = null;
}

/** The default profile name from profiles.yaml, or undefined. */
export function defaultProfileName(): string | undefined {
  return loadProfiles().default;
}

/** Look up a profile by name. */
export function getProfile(name: string): ProfileConfig | undefined {
  return loadProfiles().profiles?.[name];
}

/** List available profile names (for error hints). */
export function listProfileNames(): string[] {
  return Object.keys(loadProfiles().profiles ?? {});
}

// ── token-source resolution ───────────────────────────────────────────────────

/** A pluggable resolver for the external (aws/bw) token sources — the test seam. */
export type ExternalResolver = (src: TokenSource) => Promise<string>;

let externalResolver: ExternalResolver | null = null;

/**
 * Inject an external resolver (tests) so aws/vaultwarden sources don't shell
 * out. Pass `null` to restore the default (real aws/bw CLI invocation).
 */
export function setExternalResolver(impl: ExternalResolver | null): void {
  externalResolver = impl;
}

function execFileText(bin: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { maxBuffer: 1024 * 1024 }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout);
    });
  });
}

/** Default external resolver: shells out to `aws` or `bw` as the descriptor requires. */
async function defaultExternalResolver(src: TokenSource): Promise<string> {
  if (src.type === "aws-secrets-manager") {
    const args = [
      "secretsmanager",
      "get-secret-value",
      "--secret-id",
      src.secret_id,
      "--query",
      "SecretString",
      "--output",
      "text",
    ];
    if (src.region) {
      args.push("--region", src.region);
    }
    const out = (await execFileText("aws", args)).trim();
    if (!out) return "";
    if (src.json_key) {
      const parsed = JSON.parse(out) as Record<string, unknown>;
      const v = parsed[src.json_key];
      return typeof v === "string" ? v : "";
    }
    return out;
  }
  if (src.type === "vaultwarden") {
    const out = await execFileText("bw", ["get", "item", src.item]);
    const parsed = JSON.parse(out) as {
      login?: { password?: string };
      fields?: Array<{ name?: string; value?: string }>;
    };
    if (src.field === "password") return parsed.login?.password ?? "";
    const f = parsed.fields?.find((x) => x.name === src.field);
    return f?.value ?? "";
  }
  return "";
}

/** Resolve a token from a token-source descriptor. Returns undefined when the source has nothing. */
export async function resolveTokenFromSource(
  src: TokenSource | undefined,
): Promise<string | undefined> {
  if (!src) return undefined;
  switch (src.type) {
    case "env-file":
      return resolveEnvFile(src);
    case "plain-file":
      return resolvePlainFile(src);
    case "aws-secrets-manager":
    case "vaultwarden":
      return (externalResolver ?? defaultExternalResolver)(src);
    default:
      return undefined;
  }
}

/** env-file: read the file, regex-parse `^KEY=...` (the tg-axi .env pattern), strip quotes. */
function resolveEnvFile(src: EnvFileSource): string | undefined {
  if (!existsSync(src.path)) return undefined;
  const content = readFileSync(src.path, "utf8");
  const re = new RegExp(`^${escapeRegex(src.key)}\\s*=\\s*(.+?)\\s*$`, "m");
  const match = content.match(re);
  if (!match) return undefined;
  return match[1].replace(/^["']|["']$/g, "");
}

/** plain-file: read a flat file (mode 600), trim. The clickup/figma single-account shape. */
function resolvePlainFile(src: PlainFileSource): string | undefined {
  if (!existsSync(src.path)) return undefined;
  const t = readFileSync(src.path, "utf8").trim();
  return t || undefined;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Validate a profile name is known; throw NOT_FOUND listing available profiles.
 * Used by commands that received an explicit --account that doesn't resolve.
 */
export function requireProfile(name: string): ProfileConfig {
  const profile = getProfile(name);
  if (profile) return profile;
  const known = listProfileNames();
  throw new AxiError(
    `Profile '${name}' not found in ~/.config/cloudflare-axi/profiles.yaml`,
    "NOT_FOUND",
    known.length
      ? [`Available profiles: ${known.join(", ")}`]
      : ["Create ~/.config/cloudflare-axi/profiles.yaml with a `profiles:` map"],
  );
}

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { AxiError, mapTokenSourceError, noTokenError } from "./errors.js";
import { defaultProfileName, getProfile, resolveTokenFromSource } from "./profiles.js";

export { AxiError };

// ── paths ────────────────────────────────────────────────────────────────────

/** Directory for tool-specific config (~/.config/cloudflare-axi by default). */
export function configDir(): string {
  return process.env["CLOUDFLARE_AXI_CONFIG_DIR"] ?? join(homedir(), ".config", "cloudflare-axi");
}

/** Path to the flat token file (~/.config/cloudflare-axi/token). */
export function tokenFilePath(): string {
  return join(configDir(), "token");
}

/** Path to the optional readonly-gate marker (~/.config/cloudflare-axi/readonly). */
export function readonlyFilePath(): string {
  return join(configDir(), "readonly");
}

/** Path to the optional JSON config (~/.config/cloudflare-axi/config.json). */
export function configJsonPath(): string {
  return join(configDir(), "config.json");
}

/** Path to the optional default-account file (~/.config/cloudflare-axi/account). */
export function accountFilePath(): string {
  return join(configDir(), "account");
}

// ── readonly gate (defense-in-depth, design §4.3 + §11.3) ─────────────────────

let cachedReadonly: boolean | null = null;

/**
 * Enforced when ANY: `CLOUDFLARE_AXI_READONLY` env is `1`/`true`,
 * ~/.config/cloudflare-axi/readonly marker exists, or config.json `readonly:true`.
 * When enforced, `--execute` refuses mutating calls. Shipped DOCUMENTED, not
 * created by default — the dry-run-by-default guard is the primary safety.
 */
export function isReadonlyEnforced(): boolean {
  if (cachedReadonly !== null) return cachedReadonly;
  const envFlag = (process.env["CLOUDFLARE_AXI_READONLY"] ?? "").trim().toLowerCase();
  if (envFlag === "1" || envFlag === "true") {
    cachedReadonly = true;
    return true;
  }
  if (existsSync(readonlyFilePath())) {
    cachedReadonly = true;
    return true;
  }
  const cfg = configJsonPath();
  if (existsSync(cfg)) {
    try {
      const data = JSON.parse(readFileSync(cfg, "utf8"));
      if (data?.readonly === true) {
        cachedReadonly = true;
        return true;
      }
    } catch {
      // ignore malformed config
    }
  }
  cachedReadonly = false;
  return false;
}

/** Reset the cached readonly flag (tests / setup). */
export function resetReadonlyCache(): void {
  cachedReadonly = null;
}

// ── profile + account + zone resolution (sync) ────────────────────────────────

/**
 * Resolve the active profile name: `--account` flag > profiles.yaml `default:`.
 * Sync (reads profiles.yaml). Does not validate the profile exists — that happens
 * in requireToken/requireAccountId where a missing profile surfaces clearly.
 */
export function resolveProfileName(flag?: string): string | undefined {
  if (flag && flag.length > 0) return flag;
  return defaultProfileName();
}

/**
 * Resolve the active account_id (design §5.2, sync subset — the live
 * `accounts.list()` probe fallback is a documented post-MVP seam):
 * `--account` profile's `account_id` > `CLOUDFLARE_ACCOUNT_ID` env >
 * ~/.config/cloudflare-axi/account file > undefined. Falls back to the default
 * profile when no name is passed (the active profile = flag or default).
 */
export function resolveAccountId(profileName?: string): string | undefined {
  const name = profileName ?? defaultProfileName();
  if (name) {
    const profile = getProfile(name);
    if (profile?.account_id) return profile.account_id;
  }
  const envAccount = (process.env["CLOUDFLARE_ACCOUNT_ID"] ?? "").trim();
  if (envAccount) return envAccount;
  const file = accountFilePath();
  if (existsSync(file)) {
    const t = readFileSync(file, "utf8").trim();
    if (t) return t;
  }
  return undefined;
}

/**
 * Resolve the active zone_id: `--zone` flag > the active profile's `zone_id` >
 * `CLOUDFLARE_ZONE_ID` env > undefined. Name-to-id resolution is a documented
 * post-MVP seam (the clickup custom-fields-by-name discipline); for MVP `--zone`
 * accepts a zone_id directly.
 */
export function resolveZoneId(flag?: string, profileName?: string): string | undefined {
  if (flag && flag.length > 0) return flag;
  const name = profileName ?? defaultProfileName();
  if (name) {
    const profile = getProfile(name);
    if (profile?.zone_id) return profile.zone_id;
  }
  const envZone = (process.env["CLOUDFLARE_ZONE_ID"] ?? "").trim();
  if (envZone) return envZone;
  return undefined;
}

// ── token resolution (async — aws/vaultwarden shell out) ─────────────────────

/**
 * Resolve the Cloudflare API token (design §5.2 precedence):
 *   1. CLOUDFLARE_API_TOKEN env (single-account fast path; overrides profiles)
 *   2. --account profile (or default profile) → its token_source descriptor
 *   3. ~/.config/cloudflare-axi/token flat file (the clickup/figma shape)
 *   4. AUTH_REQUIRED (noTokenError)
 *
 * The token is never logged, printed, or written to any file in this repo.
 * Profile token-source failures (aws/bw CLI missing/locked) surface as
 * AUTH_REQUIRED via mapTokenSourceError; the home digest catches and reports
 * `token: no` without throwing.
 */
export async function requireToken(profileName?: string): Promise<string> {
  const envToken = (process.env["CLOUDFLARE_API_TOKEN"] ?? "").trim();
  if (envToken) return envToken;

  const effectiveName = profileName ?? defaultProfileName();
  if (effectiveName) {
    const profile = getProfile(effectiveName);
    if (profile?.token_source) {
      try {
        const tok = await resolveTokenFromSource(profile.token_source);
        if (tok) return tok;
      } catch (err) {
        throw mapTokenSourceError(effectiveName, profile.token_source.type, err);
      }
    }
  }

  const tf = tokenFilePath();
  if (existsSync(tf)) {
    const t = readFileSync(tf, "utf8").trim();
    if (t) return t;
  }

  throw noTokenError();
}

/** Re-export so commands/tests can reset the profiles cache alongside the token cache. */
export { loadProfiles, resetProfilesCache } from "./profiles.js";

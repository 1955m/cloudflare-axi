import { resolveAccountId, resolveProfileName, resolveZoneId } from "./config.js";
import { AxiError } from "./errors.js";
import { field, type FieldDef } from "./toon.js";

/**
 * Resolved context passed to every cloudflare-axi command handler. The profile
 * name, account_id, and zone_id are resolved SYNC at context-build time (from
 * flags, profiles.yaml, env, and the account file — all sync reads). The API
 * token is NOT here — it is resolved async by `requireToken()` inside each
 * command (aws/vaultwarden shell out), so context resolution stays synchronous
 * (matching the house `resolveContext` contract).
 */
export interface CloudflareContext {
  profileName?: string;
  accountId?: string;
  zoneId?: string;
  /** --json: emit pure JSON for jq/firstmate instead of TOON. */
  json: boolean;
}

export interface ParsedContextArgs {
  accountFlag?: string;
  zoneFlag?: string;
  jsonFlag: boolean;
  strippedArgs: string[];
}

const CONTEXT_FLAGS = ["--account", "--zone"];

/**
 * Strip --account/--zone (space or equals form) and the boolean --json from
 * args without mutating the input semantics. Used both by resolveContext (to
 * read trailing context flags) and by withContext (to strip them from the
 * command's positional args). Mirrors clickup-axi's parseContextArgs.
 */
export function parseContextArgs(args: string[]): ParsedContextArgs {
  const stripped: string[] = [];
  let accountFlag: string | undefined;
  let zoneFlag: string | undefined;
  let jsonFlag = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--json") {
      jsonFlag = true;
      continue;
    }
    let handled = false;
    for (const flag of CONTEXT_FLAGS) {
      const equalsPrefix = `${flag}=`;
      if (arg === flag) {
        const value = args[i + 1];
        assignFlag(flag, value);
        i++;
        handled = true;
        break;
      }
      if (arg.startsWith(equalsPrefix)) {
        assignFlag(flag, arg.slice(equalsPrefix.length));
        handled = true;
        break;
      }
    }
    if (!handled) stripped.push(arg);
  }
  return { accountFlag, zoneFlag, jsonFlag, strippedArgs: stripped };

  function assignFlag(flag: string, value: string | undefined): void {
    if (flag === "--account") accountFlag = value;
    else if (flag === "--zone") zoneFlag = value;
  }
}

/**
 * Build a CloudflareContext from parsed (trailing) flags merged over any leading
 * flags stripped by main(). Trailing wins over leading; leading is the fallback
 * for the home view (where the SDK passes args=[]).
 */
export function resolveCloudflareContext(
  parsed: ParsedContextArgs,
  leading?: ParsedContextArgs,
): CloudflareContext {
  const accountFlag = parsed.accountFlag ?? leading?.accountFlag;
  const zoneFlag = parsed.zoneFlag ?? leading?.zoneFlag;
  const json = parsed.jsonFlag || leading?.jsonFlag === true;
  const profileName = resolveProfileName(accountFlag);
  const accountId = resolveAccountId(profileName);
  const zoneId = resolveZoneId(zoneFlag, profileName);
  const ctx: CloudflareContext = { json };
  if (profileName) ctx.profileName = profileName;
  if (accountId) ctx.accountId = accountId;
  if (zoneId) ctx.zoneId = zoneId;
  return ctx;
}

// ── per-command flag validation helpers (AXI principle 6: fail loud on unknown flags) ─

const GLOBAL_FLAGS = new Set(["--account", "--zone", "--json", "--help"]);

/**
 * Reject unknown flags before any dependency call (exit 2). Globals
 * (--account/--zone/--json, already stripped by withContext, plus --help) are
 * always allowed. Lists the command's valid flags inline so the agent
 * self-corrects in one turn.
 */
export function rejectUnknownFlags(args: string[], known: string[], commandPath: string): void {
  for (const arg of args) {
    if (!arg.startsWith("--")) continue;
    const name = arg.includes("=") ? arg.slice(0, arg.indexOf("=")) : arg;
    if (known.includes(name) || GLOBAL_FLAGS.has(name)) continue;
    throw new AxiError(`unknown flag ${name} for \`${commandPath}\``, "VALIDATION_ERROR", [
      `valid flags for \`${commandPath}\`: ${[...known, "--help"].join(", ")}`,
      "(--help always allowed; --account/--zone/--json are global selectors)",
    ]);
  }
}

/** Parse + validate `--limit <1-max>`. Defaults to defaultLimit when absent. */
export function parseLimit(
  raw: string | undefined,
  defaultLimit: number,
  maxLimit: number,
  commandPath: string,
): number {
  if (raw === undefined) return defaultLimit;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1 || n > maxLimit) {
    throw new AxiError(`--limit must be 1-${maxLimit}, got: ${raw}`, "VALIDATION_ERROR", [
      `Run \`cloudflare-axi ${commandPath} --limit ${defaultLimit}\``,
    ]);
  }
  return n;
}

/**
 * Build a TOON field schema from a `--fields a,b,c` CSV or a default list. Every
 * requested field maps to a plain `field()` extractor (special transforms like
 * relativeTime are opt-in post-MVP); unknown field names pass through as null.
 */
export function listSchema(fieldsCsv: string | undefined, defaults: string[]): FieldDef<any>[] {
  const names = fieldsCsv
    ? fieldsCsv
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : defaults;
  return names.map((n) => field<any>(n));
}

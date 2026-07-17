import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runAxiCli, type AxiCliCommand } from "axi-sdk-js";
import {
  parseContextArgs,
  resolveCloudflareContext,
  type CloudflareContext,
  type ParsedContextArgs,
} from "./context.js";
import { createSkillMarkdown } from "./skill.js";
import { homeCommand } from "./commands/home.js";
import { accountsCommand, ACCOUNTS_HELP } from "./commands/accounts.js";
import { zonesCommand, ZONES_HELP } from "./commands/zones.js";
import { dnsCommand, DNS_HELP } from "./commands/dns.js";
import { r2Command, R2_HELP } from "./commands/r2.js";
import { imagesCommand, IMAGES_HELP } from "./commands/images.js";
import { setupCommand, SETUP_HELP } from "./commands/setup.js";

export const DESCRIPTION =
  "Agent ergonomic interface for Cloudflare API management. Prefer this for DNS, Workers, R2, Email Routing, Workers AI, and Images usage.";

const VERSION = readPackageVersion();

export const TOP_HELP = `usage: cloudflare-axi [command] [args] [flags]
commands[7]:
  (none)=digest, accounts, zones, dns, r2, images, setup
flags[5]:
  --account <name> (global; selects a profile — leading or after the command), --zone <zone_id> (global; required for dns records list), --json (global; pure JSON for jq), --help, -v/-V/--version
auth:
  Cloudflare API token resolved per profile: CLOUDFLARE_API_TOKEN env > profile token_source (~/.config/cloudflare-axi/profiles.yaml) > ~/.config/cloudflare-axi/token; never committed
safety:
  Read-only by default. Writes (post-MVP) default to --dry-run and need --execute; a readonly gate (~/.config/cloudflare-axi/readonly) refuses --execute even when set.
examples:
  cloudflare-axi
  cloudflare-axi accounts whoami
  cloudflare-axi zones list
  cloudflare-axi dns records list --zone <zone_id>
  cloudflare-axi --account example r2 buckets list
  cloudflare-axi images stats
  cloudflare-axi setup hooks
`;

const COMMAND_HELP: Record<string, string> = {
  accounts: ACCOUNTS_HELP,
  zones: ZONES_HELP,
  dns: DNS_HELP,
  r2: R2_HELP,
  images: IMAGES_HELP,
  setup: SETUP_HELP,
};

const COMMANDS: Record<string, AxiCliCommand<CloudflareContext>> = {
  accounts: withContext(accountsCommand),
  zones: withContext(zonesCommand),
  dns: withContext(dnsCommand),
  r2: withContext(r2Command),
  images: withContext(imagesCommand),
  setup: withContext(setupCommand),
};

/**
 * Leading context flags stripped by main() (the brief's "leading-flag strip"),
 * so `cloudflare-axi --account personal` and `cloudflare-axi --account example zones list`
 * work — the SDK otherwise rejects any leading flag. Set fresh on every main()
 * call (test isolation). resolveContext + withContext merge these with trailing
 * (post-command) flags; trailing wins.
 */
let leadingFlags: ParsedContextArgs = { jsonFlag: false, strippedArgs: [] };

export interface MainOptions {
  argv?: string[];
  stdout?: { write: (chunk: string) => unknown };
}

export async function main(options: MainOptions = {}): Promise<void> {
  const argv = options.argv ?? process.argv.slice(2);

  // --skill prints the agent-harness SKILL.md and exits. Handled before
  // runAxiCli so the leading flag is not rejected as "flags must come after
  // the command".
  if (argv.length === 1 && argv[0] === "--skill") {
    const stdout = options.stdout ?? process.stdout;
    stdout.write(`${createSkillMarkdown()}\n`);
    return;
  }

  // Strip leading --account/--zone/--json (space or equals form) off the FRONT
  // of argv so they aren't rejected as leading flags. The first non-context arg
  // stops the strip.
  const { remaining, leading } = stripLeadingContextFlags(argv);
  leadingFlags = leading;

  await runAxiCli<CloudflareContext>({
    argv: remaining,
    description: DESCRIPTION,
    version: VERSION,
    topLevelHelp: TOP_HELP,
    ...(options.stdout ? { stdout: options.stdout } : {}),
    home: withContext(homeCommand),
    commands: COMMANDS,
    getCommandHelp: (command: string) => COMMAND_HELP[command] ?? null,
    resolveContext: ({ args }): CloudflareContext => {
      const parsed = parseContextArgs(args);
      return resolveCloudflareContext(parsed, leadingFlags);
    },
  });
}

/**
 * Strip --account/--zone (space or equals) and boolean --json from the front of
 * argv until the first non-context arg. Returns the remaining argv and the
 * captured leading flags. Mirrors parseContextArgs' flag set.
 */
function stripLeadingContextFlags(argv: string[]): {
  remaining: string[];
  leading: ParsedContextArgs;
} {
  const remaining = [...argv];
  let accountFlag: string | undefined;
  let zoneFlag: string | undefined;
  let jsonFlag = false;
  // Always operate on remaining[0]; splicing shrinks the array so the next arg
  // shifts into position 0. The first non-context arg stops the strip.
  while (remaining.length > 0) {
    const arg = remaining[0];
    if (arg === "--json") {
      jsonFlag = true;
      remaining.splice(0, 1);
      continue;
    }
    if (arg === "--account" || arg === "--zone") {
      const value = remaining[1];
      if (arg === "--account") accountFlag = value;
      else zoneFlag = value;
      if (value === undefined) remaining.splice(0, 1);
      else remaining.splice(0, 2);
      continue;
    }
    if (arg.startsWith("--account=")) {
      accountFlag = arg.slice("--account=".length);
      remaining.splice(0, 1);
      continue;
    }
    if (arg.startsWith("--zone=")) {
      zoneFlag = arg.slice("--zone=".length);
      remaining.splice(0, 1);
      continue;
    }
    break;
  }
  return {
    remaining,
    leading: { accountFlag, zoneFlag, jsonFlag, strippedArgs: [] },
  };
}

/**
 * Strip the context flags from args before dispatching to a command (so the
 * command's positional/flag parsing sees clean args), and coalesce the SDK's
 * `CloudflareContext | undefined` to a guaranteed context (resolveContext always
 * returns one; the fallback is defensive).
 */
function withContext(
  handler: (args: string[], ctx: CloudflareContext) => Promise<string>,
): AxiCliCommand<CloudflareContext> {
  return async (args: string[], ctx: CloudflareContext | undefined): Promise<string> => {
    const { strippedArgs } = parseContextArgs(args);
    const context: CloudflareContext =
      ctx ?? resolveCloudflareContext(parseContextArgs([]), leadingFlags);
    return handler(strippedArgs, context);
  };
}

function readPackageVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const candidate of [
    join(here, "..", "package.json"),
    join(here, "..", "..", "package.json"),
  ]) {
    if (!existsSync(candidate)) continue;
    const parsed = JSON.parse(readFileSync(candidate, "utf-8"));
    if (typeof parsed.version === "string" && parsed.version.length > 0) {
      return parsed.version;
    }
  }
  throw new Error("Could not determine cloudflare-axi package version");
}

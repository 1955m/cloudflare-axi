import { getClient, requireAccountId, safeCall, withAccount } from "../cloudflare.js";
import { listSchema, parseLimit, rejectUnknownFlags } from "../context.js";
import { takeFlag } from "../args.js";
import { renderError, renderHelp, renderList, renderOutput } from "../toon.js";
import type { CloudflareContext } from "../context.js";

export const R2_HELP = `usage: cloudflare-axi r2 <subcommand>
R2 buckets (account-scoped).
  r2 buckets list             list R2 buckets in the active account
flags for buckets list: --limit <1-1000> (default 100, maps to per_page), --fields <a,b,c> (default name,location,storage_class), --help
global: --account/--zone/--json (after the command)
examples:
  cloudflare-axi r2 buckets list
  cloudflare-axi --account example r2 buckets list
  cloudflare-axi r2 buckets list --fields name,location,jurisdiction,creation_date`;

interface CfBucket {
  name?: string;
  location?: string;
  storage_class?: string;
  jurisdiction?: string;
  creation_date?: string;
}

export async function r2Command(args: string[], ctx: CloudflareContext): Promise<string> {
  const sub = args[0];
  if (sub === "buckets") {
    const sub2 = args[1];
    if (sub2 === "list") return r2BucketsList(args.slice(2), ctx);
    return renderError(`Unknown r2 buckets subcommand: ${sub2 ?? "(none)"}`, "VALIDATION_ERROR", [
      "Subcommands: list",
      "Run `cloudflare-axi r2 buckets --help`",
    ]);
  }
  return renderError(`Unknown r2 subcommand: ${sub ?? "(none)"}`, "VALIDATION_ERROR", [
    "Subcommands: buckets",
    "Run `cloudflare-axi r2 --help`",
  ]);
}

async function r2BucketsList(args: string[], ctx: CloudflareContext): Promise<string> {
  rejectUnknownFlags(args, ["--limit", "--fields"], "r2 buckets list");
  const accountId = requireAccountId(ctx.accountId);
  const limit = parseLimit(takeFlag(args, "--limit"), 100, 1000, "r2 buckets list");
  const schema = listSchema(takeFlag(args, "--fields"), ["name", "location", "storage_class"]);
  const client = await getClient(ctx.profileName);
  const resp = await safeCall(() =>
    client.r2.buckets.list(withAccount({ per_page: limit }, accountId)),
  );
  const buckets = (resp.buckets ?? []) as unknown as CfBucket[];
  if (ctx.json) {
    return JSON.stringify({ account_id: accountId, count: buckets.length, buckets }, null, 2);
  }
  const hints: string[] = [
    "R2 list is cursor-paginated; --cursor for the next page ships post-MVP",
    "Writes (create/delete) ship post-MVP, dry-run-by-default behind --execute",
  ];
  return renderOutput([
    `count: ${buckets.length}`,
    buckets.length
      ? renderList("r2_buckets", buckets, schema)
      : `r2 buckets: 0 buckets in account ${accountId}`,
    renderHelp(hints),
  ]);
}

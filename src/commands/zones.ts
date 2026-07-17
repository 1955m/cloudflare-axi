import { getClient, readTotalCount, safeCall } from "../cloudflare.js";
import { listSchema, parseLimit, rejectUnknownFlags } from "../context.js";
import { takeFlag } from "../args.js";
import { renderError, renderHelp, renderList, renderOutput } from "../toon.js";
import type { CloudflareContext } from "../context.js";

export const ZONES_HELP = `usage: cloudflare-axi zones <subcommand>
List zones accessible to the active token.
  zones list                 list zones (global; one call covers the common case)
flags for list: --limit <1-1000> (default 50), --fields <a,b,c> (default id,name,status), --help
global: --account/--zone/--json (after the command)
examples:
  cloudflare-axi zones list
  cloudflare-axi zones list --limit 100
  cloudflare-axi zones list --fields id,name,status,account`;

interface CfZone {
  id: string;
  name: string;
  status?: string;
}

export async function zonesCommand(args: string[], ctx: CloudflareContext): Promise<string> {
  const sub = args[0];
  if (sub === "list") return zonesList(args.slice(1), ctx);
  return renderError(`Unknown zones subcommand: ${sub ?? "(none)"}`, "VALIDATION_ERROR", [
    "Subcommands: list",
    "Run `cloudflare-axi zones --help`",
  ]);
}

async function zonesList(args: string[], ctx: CloudflareContext): Promise<string> {
  rejectUnknownFlags(args, ["--limit", "--fields"], "zones list");
  const limit = parseLimit(takeFlag(args, "--limit"), 50, 1000, "zones list");
  const schema = listSchema(takeFlag(args, "--fields"), ["id", "name", "status"]);
  const client = await getClient(ctx.profileName);
  const page = await safeCall(() => client.zones.list({ per_page: limit }));
  const zones = (page.result ?? []) as unknown as CfZone[];
  const total = readTotalCount(page.result_info);
  if (ctx.json) {
    return JSON.stringify(
      { count: zones.length, ...(total != null ? { total } : {}), zones },
      null,
      2,
    );
  }
  const countLine =
    total != null ? `count: ${zones.length} of ${total} total` : `count: ${zones.length}`;
  const hints: string[] = [];
  if (zones.length === 0) {
    hints.push("Run `cloudflare-axi accounts whoami` to verify the token reaches any account");
  }
  hints.push(
    "Run `cloudflare-axi dns records list --zone <zone_id>` to list DNS records for a zone",
  );
  return renderOutput([
    countLine,
    zones.length ? renderList("zones", zones, schema) : "zones: 0 zones found for this account",
    renderHelp(hints),
  ]);
}

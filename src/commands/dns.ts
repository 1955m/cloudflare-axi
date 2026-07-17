import { getClient, readTotalCount, safeCall } from "../cloudflare.js";
import { listSchema, parseLimit, rejectUnknownFlags } from "../context.js";
import { AxiError } from "../errors.js";
import { takeFlag } from "../args.js";
import { renderError, renderHelp, renderList, renderOutput } from "../toon.js";
import type { CloudflareContext } from "../context.js";

export const DNS_HELP = `usage: cloudflare-axi dns <subcommand>
DNS records (zone-scoped).
  dns records list            list DNS records for a zone (--zone <zone_id> required)
flags for records list: --limit <1-1000> (default 100), --fields <a,b,c> (default id,name,type,ttl), --help
global: --zone <zone_id> (required), --account/--json (after the command)
examples:
  cloudflare-axi dns records list --zone 023e105f4ecef8ad9ca31a8372d0c353
  cloudflare-axi dns records list --zone <id> --fields id,name,type,content,proxied
  cloudflare-axi --account example dns records list --zone <id> --json`;

interface CfRecord {
  id?: string;
  name?: string;
  type?: string;
  content?: string;
  ttl?: number;
  proxied?: boolean;
}

export async function dnsCommand(args: string[], ctx: CloudflareContext): Promise<string> {
  const sub = args[0];
  if (sub === "records") {
    const sub2 = args[1];
    if (sub2 === "list") return dnsRecordsList(args.slice(2), ctx);
    return renderError(`Unknown dns records subcommand: ${sub2 ?? "(none)"}`, "VALIDATION_ERROR", [
      "Subcommands: list",
      "Run `cloudflare-axi dns records --help`",
    ]);
  }
  return renderError(`Unknown dns subcommand: ${sub ?? "(none)"}`, "VALIDATION_ERROR", [
    "Subcommands: records",
    "Run `cloudflare-axi dns --help`",
  ]);
}

async function dnsRecordsList(args: string[], ctx: CloudflareContext): Promise<string> {
  rejectUnknownFlags(args, ["--limit", "--fields"], "dns records list");
  if (!ctx.zoneId) {
    throw new AxiError("--zone <zone_id> is required for `dns records list`", "VALIDATION_ERROR", [
      "Run `cloudflare-axi zones list` to find a zone_id",
      "Name-to-id resolution ships post-MVP; pass the 32-char hex zone_id directly",
    ]);
  }
  const limit = parseLimit(takeFlag(args, "--limit"), 100, 1000, "dns records list");
  const schema = listSchema(takeFlag(args, "--fields"), ["id", "name", "type", "ttl"]);
  const zoneId = ctx.zoneId;
  const client = await getClient(ctx.profileName);
  const page = await safeCall(() => client.dns.records.list({ zone_id: zoneId, per_page: limit }));
  const records = (page.result ?? []) as unknown as CfRecord[];
  const total = readTotalCount(page.result_info);
  if (ctx.json) {
    return JSON.stringify(
      { zone_id: ctx.zoneId, count: records.length, ...(total != null ? { total } : {}), records },
      null,
      2,
    );
  }
  const countLine =
    total != null ? `count: ${records.length} of ${total} total` : `count: ${records.length}`;
  const hints: string[] = [];
  if (records.length === 0) {
    hints.push("Run `cloudflare-axi zones list` to confirm this zone_id is correct");
  }
  hints.push("Writes (create/update/delete) ship post-MVP, dry-run-by-default behind --execute");
  return renderOutput([
    countLine,
    records.length
      ? renderList("dns_records", records, schema)
      : `dns records: 0 records found for zone ${ctx.zoneId}`,
    renderHelp(hints),
  ]);
}

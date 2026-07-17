import { encode } from "@toon-format/toon";
import { getClient, requireAccountId, safeCall, withAccount } from "../cloudflare.js";
import { rejectUnknownFlags } from "../context.js";
import { renderError, renderHelp, renderOutput } from "../toon.js";
import type { CloudflareContext } from "../context.js";

export const IMAGES_HELP = `usage: cloudflare-axi images <subcommand>
Cloudflare Images usage (account-scoped).
  images stats                stored-count meter + transformation-quota status
flags for stats: --help (no flags); --account/--zone/--json (global, after the command)
examples:
  cloudflare-axi images stats
  cloudflare-axi --account example images stats
  cloudflare-axi images stats --json`;

interface CfStat {
  count?: { allowed?: number; current?: number };
}

export async function imagesCommand(args: string[], ctx: CloudflareContext): Promise<string> {
  const sub = args[0];
  if (sub === "stats") return imagesStats(args.slice(1), ctx);
  return renderError(`Unknown images subcommand: ${sub ?? "(none)"}`, "VALIDATION_ERROR", [
    "Subcommands: stats",
    "`images list` ships post-MVP",
  ]);
}

async function imagesStats(args: string[], ctx: CloudflareContext): Promise<string> {
  rejectUnknownFlags(args, [], "images stats");
  const accountId = requireAccountId(ctx.accountId);
  const client = await getClient(ctx.profileName);
  const stat = (await safeCall(() =>
    client.images.v1.stats.get(withAccount({}, accountId)),
  )) as unknown as CfStat;
  const current = stat.count?.current ?? 0;
  const allowed = stat.count?.allowed ?? 0;
  const pct = allowed > 0 ? Math.round((current / allowed) * 100) : 0;
  if (ctx.json) {
    return JSON.stringify(
      { account_id: accountId, stored: { current, allowed }, transformations: "not wired" },
      null,
      2,
    );
  }
  return renderOutput([
    encode({
      images: {
        stored_current: current,
        stored_allowed: allowed,
        stored_pct: `${pct}%`,
        transformations: "not wired",
      },
    }),
    renderHelp([
      "stored = the Images-stored meter (GET /images/v1/stats); NOT the transformation quota",
      "The transformation quota (reel thumbnail target) has no documented REST endpoint — surfaced `not wired` until the GraphQL Analytics dataset is confirmed (design §3.5/§11.5)",
      "Run `cloudflare-axi` for the full session digest",
    ]),
  ]);
}

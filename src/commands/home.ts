import { encode } from "@toon-format/toon";
import type Cloudflare from "cloudflare";
import { buildClient, getToken, getSdkFetch, withAccount } from "../cloudflare.js";
import { field, renderHelp, renderList, renderOutput } from "../toon.js";
import type { CloudflareContext } from "../context.js";

export const HOME_HELP = "";

interface CfZone {
  id: string;
  name: string;
  status?: string;
}
interface CfStat {
  count?: { allowed?: number; current?: number };
}

const zoneSchema = [field("id"), field("name"), field("status", "status")];

/**
 * No-args session digest (design §4.1). The SDK prepends `bin:` + `description:`.
 * cloudflare-axi adds: active profile + account_id, token present y/n,
 * reachable, a small zones list, and (when an account_id is resolvable) R2 /
 * Images counts. Never throws: every sub-call degrades gracefully (the clickup
 * home safeGet pattern).
 */
export async function homeCommand(_args: string[], ctx: CloudflareContext): Promise<string> {
  let token: string | undefined;
  try {
    token = await getToken(ctx.profileName);
  } catch {
    token = undefined;
  }
  const tokenPresent = token !== undefined;

  let reachable = false;
  if (tokenPresent) {
    const client = buildClient(token!, getSdkFetch());
    try {
      await client.user.tokens.verify();
      reachable = true;
    } catch {
      reachable = false;
    }
  }

  const digest = {
    account: ctx.profileName ?? "none",
    account_id: ctx.accountId ?? "none",
    token: tokenPresent ? "yes" : "no",
    reachable: reachable ? "yes" : "no",
  };

  if (!tokenPresent || !reachable) {
    const hints = homeHints(ctx, tokenPresent, reachable);
    if (ctx.json) {
      return JSON.stringify({ ...digest, help: hints }, null, 2);
    }
    return renderOutput([encode(digest), renderHelp(hints)]);
  }

  const client = buildClient(token!, getSdkFetch());
  let zones: CfZone[] = [];
  try {
    const page = await client.zones.list({ per_page: 50 });
    zones = (page.result ?? []) as unknown as CfZone[];
  } catch {
    // zones stays []
  }
  const zoneDigest = zones.slice(0, 5);

  const r2Result = ctx.accountId ? await safeR2Count(client, ctx.accountId) : undefined;
  const imagesResult = ctx.accountId ? await safeImagesStats(client, ctx.accountId) : undefined;
  const hints = homeHints(ctx, tokenPresent, reachable);

  if (ctx.json) {
    return JSON.stringify(
      {
        ...digest,
        zones: zoneDigest,
        r2: r2Result ?? { error: "no account_id resolved (pass --account <name>)" },
        images: imagesResult ?? { error: "no account_id resolved (pass --account <name>)" },
        help: hints,
      },
      null,
      2,
    );
  }

  const blocks: (string | undefined)[] = [encode(digest)];
  blocks.push(
    zoneDigest.length
      ? renderList("zones", zoneDigest, zoneSchema)
      : "zones: 0 zones found for this account",
  );
  if (r2Result && imagesResult) {
    blocks.push(formatR2Line(ctx.accountId!, r2Result));
    blocks.push(formatImagesBlock(imagesResult));
  } else {
    blocks.push("r2: no account_id resolved (pass --account <name>)");
    blocks.push("images: no account_id resolved (pass --account <name>)");
  }
  blocks.push(renderHelp(hints));
  return renderOutput(blocks);
}

interface R2Result {
  count?: number;
  error?: string;
}

async function safeR2Count(client: Cloudflare, accountId: string): Promise<R2Result> {
  try {
    const resp = await client.r2.buckets.list(withAccount({}, accountId));
    return { count: (resp.buckets ?? []).length };
  } catch {
    return { error: "unreachable" };
  }
}

function formatR2Line(accountId: string, result: R2Result): string {
  if (result.error) return `r2: ${result.error}`;
  const count = result.count ?? 0;
  return `r2: ${count} bucket${count === 1 ? "" : "s"} in account ${accountId}`;
}

interface ImagesResult {
  current?: number;
  allowed?: number;
  error?: string;
}

async function safeImagesStats(client: Cloudflare, accountId: string): Promise<ImagesResult> {
  try {
    const stat = (await client.images.v1.stats.get(
      withAccount({}, accountId),
    )) as unknown as CfStat;
    return { current: stat.count?.current ?? 0, allowed: stat.count?.allowed ?? 0 };
  } catch {
    return { error: "unreachable" };
  }
}

function formatImagesBlock(result: ImagesResult): string {
  if (result.error) return `images: ${result.error}`;
  return encode({
    images: {
      stored: `${result.current ?? 0} of ${result.allowed ?? 0} allowed`,
      transformations: "not wired",
    },
  });
}

function homeHints(ctx: CloudflareContext, tokenPresent: boolean, reachable: boolean): string[] {
  const hints: string[] = [];
  if (!tokenPresent) {
    hints.push("Create ~/.config/cloudflare-axi/profiles.yaml with a profile token_source");
    hints.push("Or export CLOUDFLARE_API_TOKEN=<token>");
  } else if (!reachable) {
    hints.push("Run `cloudflare-axi accounts whoami` to diagnose the token");
  }
  hints.push("Run `cloudflare-axi zones list` to see all zones");
  hints.push("Run `cloudflare-axi images stats` for the Images usage meter");
  if (ctx.profileName) {
    hints.push(
      `Run \`cloudflare-axi --account ${ctx.profileName} <command>\` to target this profile`,
    );
  }
  return hints;
}

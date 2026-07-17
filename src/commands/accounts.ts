import { encode } from "@toon-format/toon";
import { getClient, safeCall } from "../cloudflare.js";
import { rejectUnknownFlags } from "../context.js";
import { field, renderError, renderHelp, renderList, renderOutput } from "../toon.js";
import type { CloudflareContext } from "../context.js";

export const ACCOUNTS_HELP = `usage: cloudflare-axi accounts <subcommand>
Confirm the active token + the accounts it can reach.
  accounts whoami           verify the active token + list accessible accounts
flags: --help (always); --account/--zone/--json (global, after the command)
examples:
  cloudflare-axi accounts whoami
  cloudflare-axi --account personal accounts whoami
  cloudflare-axi accounts whoami --json`;

interface VerifyResponse {
  id: string;
  status: string;
  expires_on?: string;
  not_before?: string;
}
interface CfAccount {
  id: string;
  name: string;
  type?: string;
}

const accountSchema = [field("id"), field("name"), field("type", "type")];

export async function accountsCommand(args: string[], ctx: CloudflareContext): Promise<string> {
  const sub = args[0];
  if (sub === "whoami") return whoami(args.slice(1), ctx);
  return renderError(`Unknown accounts subcommand: ${sub ?? "(none)"}`, "VALIDATION_ERROR", [
    "Subcommands: whoami",
    "Run `cloudflare-axi accounts --help`",
  ]);
}

async function whoami(args: string[], ctx: CloudflareContext): Promise<string> {
  rejectUnknownFlags(args, [], "accounts whoami");
  const client = await getClient(ctx.profileName);
  const verify = await safeCall(() => client.user.tokens.verify() as Promise<VerifyResponse>);
  let accounts: CfAccount[] = [];
  try {
    const page = await client.accounts.list();
    accounts = (page.result ?? []) as unknown as CfAccount[];
  } catch {
    // accounts stays []
  }
  if (ctx.json) {
    return JSON.stringify(
      {
        token_id: verify.id,
        status: verify.status,
        expires_on: verify.expires_on ?? null,
        accounts,
      },
      null,
      2,
    );
  }
  const blocks: (string | undefined)[] = [
    encode({
      token_id: verify.id,
      status: verify.status,
      expires_on: verify.expires_on ?? "unknown",
      account_id: ctx.accountId ?? "none",
    }),
    accounts.length
      ? renderList("accounts", accounts.slice(0, 10), accountSchema)
      : "accounts: 0 accessible accounts",
  ];
  blocks.push(
    renderHelp([
      "Run `cloudflare-axi zones list` to list zones in the active account",
      "Run `cloudflare-axi` for the session digest",
    ]),
  );
  return renderOutput(blocks);
}

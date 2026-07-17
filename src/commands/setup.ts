import { installSessionStartHooks } from "axi-sdk-js";
import { rejectUnknownFlags } from "../context.js";
import { renderError, renderHelp, renderOutput } from "../toon.js";
import type { CloudflareContext } from "../context.js";

export const SETUP_HELP = `usage: cloudflare-axi setup <action>
Install agent SessionStart hooks for ambient context.
  setup hooks               install/repair Claude Code, Codex, and OpenCode hooks
flags: --help (always); --account/--zone/--json (global, after the command)
examples:
  cloudflare-axi setup hooks`;

export async function setupCommand(args: string[], _ctx?: CloudflareContext): Promise<string> {
  const action = args[0];
  if (action === "hooks") {
    rejectUnknownFlags(args.slice(1), [], "setup hooks");
    installSessionStartHooks();
    return renderOutput([
      "hooks:\n  status: installed\n  integrations: Claude Code, Codex, OpenCode",
      renderHelp(["Restart your agent session to receive cloudflare-axi ambient context"]),
    ]);
  }
  return renderError(`Unknown setup action: ${action ?? "(none)"}`, "VALIDATION_ERROR", [
    "Run `cloudflare-axi setup hooks` to install SessionStart hooks",
    "More setup actions (token, account, profile) ship post-MVP",
  ]);
}

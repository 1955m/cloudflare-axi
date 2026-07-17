import { DESCRIPTION, TOP_HELP } from "./cli.js";

/**
 * Trigger string agents match against to auto-load this skill. Written as a
 * trigger — terse and outcome-focused — so the agent loads it on Cloudflare
 * management intent.
 */
export const SKILL_DESCRIPTION =
  "Manage Cloudflare over the cloudflare-axi CLI - list zones, DNS records, R2 buckets, " +
  "Cloudflare Images usage, and confirm the active account/token. Use whenever a task needs " +
  "to inspect Cloudflare state: enumerate zones, list DNS records for a zone, list R2 buckets " +
  "in an account, read the Images stored-count meter, or verify which account a profile token " +
  "reaches. Multi-account by named profile (--account), token-efficient TOON output, " +
  "--json for jq, and read-only by default (writes ship post-MVP behind --execute).";

export const SKILL_AUTHOR = "AXI Suite";

export const HERMES_TAGS = ["cloudflare", "dns", "workers", "r2", "images"];

export const HERMES_CATEGORY = "cloud";

function yamlDoubleQuote(value: string): string {
  return JSON.stringify(value);
}

/** Extract the `commands[N]:` block from the top-level help. */
export function extractCommandsBlock(): string {
  const match = TOP_HELP.match(/^(commands\[\d+\]:\n(?: {2}.*\n)+)/m);
  if (!match) {
    throw new Error("Could not find commands block in TOP_HELP");
  }
  return match[1].trimEnd();
}

/** Render the installable SKILL.md for the cloudflare-axi skill. */
export function createSkillMarkdown(): string {
  return `---
name: cloudflare-axi
description: ${yamlDoubleQuote(SKILL_DESCRIPTION)}
user-invocable: false
author: ${SKILL_AUTHOR}
metadata:
  hermes:
    tags: [${HERMES_TAGS.join(", ")}]
    category: ${HERMES_CATEGORY}
---

# cloudflare-axi

${DESCRIPTION}

You do not need cloudflare-axi installed globally - invoke it with \`npx -y cloudflare-axi <command>\`.
If cloudflare-axi output shows a follow-up command starting with \`cloudflare-axi\`, run it as \`npx -y cloudflare-axi ...\` instead.

cloudflare-axi wraps the official \`cloudflare\` TypeScript SDK (REST-backed, Stainless-generated). It resolves the API token per named profile:
\`CLOUDFLARE_API_TOKEN\` env > the selected profile's \`token_source\` descriptor in \`~/.config/cloudflare-axi/profiles.yaml\` > \`~/.config/cloudflare-axi/token\`.
The token is never logged or committed. Profiles carry their own default \`account_id\` (and optional \`zone_id\`); account-scoped calls inject it.

## When to use

Use cloudflare-axi whenever a task needs to inspect Cloudflare state: list zones, list DNS records for a zone, list R2 buckets in an account, read the Cloudflare Images stored-count meter, or verify which account a profile token reaches.

## Workflow

1. Run \`npx -y cloudflare-axi\` with no arguments for a session digest - active profile + account_id, token present, reachable, a small zones list, and R2/Images counts.
2. Confirm the token: \`npx -y cloudflare-axi accounts whoami\` (verifies the token + lists accessible accounts).
3. List zones: \`npx -y cloudflare-axi zones list\` (global; \`count: N of M total\`).
4. List DNS records for a zone: \`npx -y cloudflare-axi dns records list --zone <zone_id>\` (pass the 32-char hex zone_id; name resolution ships post-MVP).
5. List R2 buckets: \`npx -y cloudflare-axi r2 buckets list\` (account-scoped; needs an account_id from the active profile or \`CLOUDFLARE_ACCOUNT_ID\`).
6. Read Images usage: \`npx -y cloudflare-axi images stats\` (the stored-count meter; transformation quota is surfaced \`not wired\`).
7. Install session hooks: \`npx -y cloudflare-axi setup hooks\` (Claude Code / Codex / OpenCode ambient context).
8. Switch profile: place \`--account <name>\` BEFORE the command (\`npx -y cloudflare-axi --account example zones list\`) or after it; both work.
9. \`--json\` emits pure JSON for jq: \`npx -y cloudflare-axi zones list --json\`.
10. Every response ends with contextual next-step hints under \`help:\` - follow them.

## Commands

\`\`\`
${extractCommandsBlock()}
\`\`\`

Installed copies also inherit the SDK built-in \`update\` command.
Run \`cloudflare-axi update --check\` to compare the installed version with npm, or \`cloudflare-axi update\` to upgrade.
When using \`npx -y cloudflare-axi\`, npx already resolves the package on demand.

Run \`npx -y cloudflare-axi --help\` for global flags, or \`npx -y cloudflare-axi <command> --help\` for per-command usage.

## Tips

- Output is TOON-encoded and token-efficient; use \`--json\` for machine-readable JSON.
- The Images stored meter (\`images stats\`) is NOT the transformation quota (reel thumbnail target); the transformation quota has no documented REST endpoint and is surfaced \`not wired\` until the GraphQL Analytics wire-point is confirmed.
- Writes (DNS/R2 create-update-delete, Workers delete) ship post-MVP, dry-run-by-default behind \`--dry-run\`/\`--execute\`; a readonly gate (~/.config/cloudflare-axi/readonly) refuses \`--execute\` even when set.
- The token resolves per profile; \`aws-secrets-manager\`, \`env-file\`, \`vaultwarden\`, and \`plain-file\` token_source types are supported.
`;
}

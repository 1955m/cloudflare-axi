# cloudflare-axi

AXI-compliant Cloudflare CLI — read-first REST management over the official `cloudflare` TypeScript SDK. Token-efficient TOON output, multi-account by named profile, dry-run-by-default writes (post-MVP), and a defense-in-depth readonly gate. Wrangler stays the deploy tool; `cloudflare-axi` inspects, it does not deploy.

```sh
cloudflare-axi                                       # session digest: account, token, reachable, zones, r2, images
cloudflare-axi accounts whoami                       # verify the active token + list accessible accounts
cloudflare-axi zones list                             # list zones (count: N of M total)
cloudflare-axi dns records list --zone <zone_id>      # list DNS records for a zone
cloudflare-axi r2 buckets list                         # list R2 buckets in the active account
cloudflare-axi images stats                           # Images stored meter + transformation-quota status
cloudflare-axi setup hooks                            # install Claude Code / Codex / OpenCode session hooks
```

## Why

This is the read-first Cloudflare inspection surface for agents: enumerate zones, list DNS records, list R2 buckets, read the Cloudflare Images usage meter (the reel thumbnail-quota diagnosis primitive), and confirm which account a profile token reaches — all in the compact, agent-ergonomic shape the `*-axi` tools established (no-args digest, TOON output, contextual `help[N]:` hints, structured `AxiError` codes, `--json` for jq, `--skill` generator). It wraps the official `cloudflare` TypeScript SDK (Stainless-generated, REST-backed, `fetch` injection test seam) so the surface tracks the Cloudflare OpenAPI spec 1:1.

## Install

```sh
npm install -g cloudflare-axi        # when published
# or run on demand:
npx -y cloudflare-axi <command>
```

Resolves the Cloudflare API token per named profile: `CLOUDFLARE_API_TOKEN` env > the selected profile's `token_source` in `~/.config/cloudflare-axi/profiles.yaml` > `~/.config/cloudflare-axi/token`. The token is read at runtime and never committed. Profiles carry their own default `account_id` (and optional `zone_id`); account-scoped calls inject it.

Example `~/.config/cloudflare-axi/profiles.yaml` (600; never a token literal):

```yaml
default: example
profiles:
  example:
    account_id: "<example account id>"
    token_source:
      type: aws-secrets-manager
      secret_id: "arn:aws:secretsmanager:..."
      region: "ap-northeast-2"
      json_key: "token"
  personal:
    account_id: "<personal account id>"
    token_source:
      type: env-file
      path: "/absolute/path/to/cf.env"
      key: "CLOUDFLARE_API_TOKEN"
```

Supported `token_source` types: `aws-secrets-manager` (shells out to `aws`), `env-file` (reads `KEY=value`), `vaultwarden` (shells out to `bw`), `plain-file` (flat 600-perm file).

## Commands

```
(none)=digest, accounts, zones, dns, r2, images, setup
```

| Command            | Flags                                                                                     | Notes                                                                                             |
| ------------------ | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `accounts whoami`  | `--json`                                                                                  | `client.user.tokens.verify()` + `client.accounts.list()` — confirm the token + reachable accounts |
| `zones list`       | `--limit <1-1000>` (default 50), `--fields <a,b>` (default id,name,status), `--json`      | `client.zones.list()`; `count: N of M total`                                                      |
| `dns records list` | `--zone <zone_id>` (required), `--limit`, `--fields` (default id,name,type,ttl), `--json` | `client.dns.records.list({ zone_id })`; zone-scoped                                               |
| `r2 buckets list`  | `--limit`, `--fields` (default name,location,storage_class), `--json`                     | `client.r2.buckets.list({ account_id })`; account-scoped                                          |
| `images stats`     | `--json`                                                                                  | `client.images.v1.stats.get({ account_id })` — stored meter; `transformations: not wired`         |
| `setup hooks`      | —                                                                                         | install/repair Claude Code, Codex, OpenCode `SessionStart` hooks                                  |
| `(none)`           | `--account <name>`, `--zone`, `--json`                                                    | session digest (account, token, reachable, zones, r2, images)                                     |

Plus the SDK built-in `update` / `update --check`.

`--account <name>` selects the profile — leading (`cloudflare-axi --account example zones list`) or trailing (`zones list --account example`); both work. `--json` emits pure JSON for jq. Every mutation (post-MVP) defaults to `--dry-run` and needs `--execute` (`FM_CLOUDFLARE_EXECUTE=1`); a readonly gate (`~/.config/cloudflare-axi/readonly`) refuses `--execute` even when set.

## Output

All output is [TOON](https://www.npmjs.com/package/@toon-format/toon)-encoded: `label:` key-value blocks for details, a trailing `help[N]:` block of runnable next-step hints, and `count: N of M total` aggregates. `--json` switches to parseable JSON. Errors render as `{ error, code, help[] }` with codes `AUTH_REQUIRED`, `FORBIDDEN`, `NOT_FOUND`, `RATE_LIMITED`, `VALIDATION_ERROR`, `TIMEOUT`, `NETWORK_ERROR`, `UNKNOWN`. Unknown flags fail loud (exit 2) with the valid flags listed inline.

## Images usage — honest

`images stats` reports the **Images-stored** meter (`count: { allowed, current }`), **not** the Image-Transformation quota. The transformation quota (the reel thumbnail target; Free 5,000/mo, Paid 5,000 + $0.50/1k; over-limit returns CF error code `9422`) has no documented Images REST endpoint — it is surfaced via the dashboard and/or the GraphQL Analytics API. `cloudflare-axi` surfaces `transformations: not wired` until a live probe confirms the exact GraphQL dataset name, then activates headroom math without reshaping the command surface.

<!-- generated:catalog:start -->

This repo is the PASS-all-CONTRIBUTING template for the `1955m/*-axi` family: it ships release-please, prettier `format:check`, the corrected CI gate order (`install --frozen-lockfile → format:check → lint → build → test → build:skill → git diff --exit-code -- skills/`), and a generated-skill drift guard — the four areas the five sibling repos FAIL/PARTIAL. The drafted `kunchenguid/axi` catalog entry lives at `docs/catalog-entry.yaml` (captain-gated; not opened upstream by this repo).
<!-- generated:catalog:end -->

## Develop

```sh
pnpm install
pnpm build            # tsc -> dist/ (+ chmod +x dist/bin/cloudflare-axi.js)
pnpm test             # vitest (colocated *.test.ts; fully offline — stubs the SDK fetch)
pnpm lint             # eslint --max-warnings=0
pnpm format:check     # prettier --check .
pnpm build:skill      # regenerate skills/cloudflare-axi/SKILL.md from source
pnpm dev <args>       # run via tsx without building
```

Tests inject a fake transport through the SDK's `fetch` option (`setSdkFetchImpl`) and use runtime-random tokens — no network, no real token. The generated `skills/cloudflare-axi/SKILL.md` is `--check`'d in CI (`build:skill && git diff --exit-code -- skills/`).

## Architecture

Built on [`axi-sdk-js`](https://www.npmjs.com/package/axi-sdk-js) (`runAxiCli` routing/help, `AxiError`/`exitCodeForError`, the `update` built-in, `installSessionStartHooks`) and [`@toon-format/toon`](https://www.npmjs.com/package/@toon-format/toon). The file layout mirrors `tg-axi`/`clickup-axi`:

```
bin/cloudflare-axi.ts          entrypoint
src/cli.ts                     runAxiCli wiring, TOP_HELP, --skill, leading-flag strip, withContext
src/context.ts                 CloudflareContext, parseContextArgs (--account/--zone/--json), flag validation helpers
src/config.ts                  paths, isReadonlyEnforced, resolveProfileName/AccountId/ZoneId, requireToken
src/profiles.ts                profiles.yaml load (minimal YAML-subset parser), 4 token-source descriptors, setExternalResolver seam
src/cloudflare.ts              SDK wrapper: buildClient + setSdkFetchImpl + withAccount + safeCall + readTotalCount
src/errors.ts                  mapCloudflareError (status→code, 9422, connection errors), noTokenError, mapTokenSourceError
src/toon.ts / args.ts / stdin.ts   replicated verbatim from clickup-axi
src/writeGuard.ts              resolveWriteGate + FM_CLOUDFLARE_EXECUTE + readonly gate (defense-in-depth)
src/skill.ts                   createSkillMarkdown()
src/commands/*.ts              home, accounts, zones, dns, r2, images, setup
skills/cloudflare-axi/SKILL.md shipped skill file (generated by build:skill; --check'd in CI)
```

See `NOTES.md` for the SDK sharp edges (no `tail`, images stats vs transformations, per-call `account_id`, API-token-only auth) and `AGENTS.md` for the durable build/test/release mechanics.

License: MIT.

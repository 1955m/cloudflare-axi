# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

- Add durable project-specific notes here as they are discovered through real work.

## Build / test / lint

- `pnpm install` (or `pnpm install --frozen-lockfile` in CI), then local bins: `node_modules/.bin/tsc -p tsconfig.json`, `node_modules/.bin/vitest run`, `node_modules/.bin/eslint . --max-warnings=0`, `node_modules/.bin/prettier --check .`.
- The `build` script is `tsc && chmod +x dist/bin/cloudflare-axi.js` — **`chmod +x` is wired into build** because tsc drops the executable bit on `dist/bin/cloudflare-axi.js`; without it the live symlink 403s.
- `tsconfig.json` is `strict` + `noUnusedLocals`/`noUnusedParameters`; `module: node16` → relative imports MUST use the `.js` extension (e.g. `./context.js`) even for `.ts` files.
- Tests are colocated `src/**/*.test.ts`, fully offline: they inject a fake transport via `setSdkFetchImpl` (the SDK's `fetch` ClientOptions) — **never** the network, **never** a real token. Tokens in tests are runtime-random (`randomBytes`); no token literal is committed.

## CI gate order (CONTRIBUTING.md — the corrected sequence)

`.github/workflows/ci.yml` runs, in order: `pnpm install --frozen-lockfile` → `format:check` → `lint` → `build` → `test` → `build:skill` → `git diff --exit-code -- skills/`. The last two are the generated-skill drift guard (E). This is the order the sibling `*-axi` repos get WRONG (they run `install → build → test → lint` with no `--frozen-lockfile`/`format:check`); do not regress it.

## SDK contract + fetch seam

- Wraps the official `cloudflare` TS SDK (`import Cloudflare from "cloudflare"`; default export). `ClientOptions` has `apiToken` + `fetch` + `timeout` + `maxRetries` — **no `accountId`**; `account_id` is a per-call path param injected per profile via `withAccount()` (src/cloudflare.ts).
- `client.ai` is top-level (not `client.workers.ai`); Email Routing is `client.emailRouting.*` (not `client.email.*`). Irrelevant to the MVP but the wrapper shape is correct for post-MVP.
- `mapCloudflareError` (src/errors.ts) maps the SDK `APIError` subclasses by `.status` (401→AUTH_REQUIRED, 403→FORBIDDEN, 429→RATE_LIMITED, 404→NOT_FOUND, 400/422/409→VALIDATION_ERROR, ≥500→UNKNOWN) and `APIConnectionError`/`APIConnectionTimeoutError` (via `Cloudflare.APIConnection*` static props) → NETWORK_ERROR/TIMEOUT. Images error code **9422** (in the v4 `errors[]` body, not an HTTP status) → RATE_LIMITED "transformation quota exceeded".
- v4 `result_info` is typed `{page?, per_page?}` by the SDK but the live envelope carries `total_count`/`total_pages`; `readTotalCount()` reads it defensively for the "count: N of M total" aggregate.

## Multi-account profiles + token resolution

- `~/.config/cloudflare-axi/profiles.yaml` (600; `CLOUDFLARE_AXI_CONFIG_DIR` override) holds a `default:` + `profiles:` map; each profile has `account_id`, optional `zone_id`, and a `token_source` descriptor. **Never holds a token literal.**
- `parseProfilesYaml` (src/profiles.ts) is a minimal indent-based parser for THIS subset only (scalars + one nested `token_source` map, `#` comments, quoted values) — not a general YAML parser. Documented in NOTES.md.
- Token-source types: `aws-secrets-manager` + `vaultwarden` route through `setExternalResolver` (the test seam; default shells out to `aws`/`bw`); `env-file` + `plain-file` read inline. `requireToken` precedence (src/config.ts): `CLOUDFLARE_API_TOKEN` env > selected profile's token_source > `~/.config/cloudflare-axi/token` > AUTH_REQUIRED.
- The token is never logged/printed/written. `home` reports `token: no` without throwing; API commands funnel through `requireToken`.

## Leading-flag strip (cli.ts)

The SDK rejects any leading flag in `argv[0]`. `main()` strips leading `--account`/`--zone`/`--json` off the FRONT of argv before `runAxiCli` (so `cloudflare-axi --account example zones list` works); `resolveContext` + `withContext` merge them with trailing (post-command) flags (trailing wins). Globals are always-allowed and never reported as unknown.

## Readonly gate (defense-in-depth)

`writeGuard.ts` + `isReadonlyEnforced()` ship from day one (§11.3) even though no write command ships in the MVP. `--execute`/`FM_CLOUDFLARE_EXECUTE=1` is refused with FORBIDDEN when the gate is enforced (`CLOUDFLARE_AXI_READONLY=1` env, `~/.config/cloudflare-axi/readonly` marker, or `config.json` `readonly:true`). Dry-run stays the default.

## Release

`release-please` (manifest mode) on `main`: `.release-please-manifest.json` `{"." : "0.1.0"}` + `release-please-config.json` + `.github/workflows/release-please.yml`. `CHANGELOG.md` is release-please-generated and never hand-edited. Conventional-commit messages (`feat:`/`fix:`/`docs:`/`chore:`) feed it.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.

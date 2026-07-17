import Cloudflare from "cloudflare";
import { AxiError, mapCloudflareError } from "./errors.js";
import { requireToken } from "./config.js";

/**
 * SDK client wrapper (design §5.4). The official `cloudflare` TS SDK accepts a
 * `fetch` option in `ClientOptions` (verified from client.d.ts) — that is the
 * clean test seam the house pattern already uses as `setFetchImpl`. All tests
 * inject a fake transport here; NO live network, NO real token.
 *
 * There is NO `accountId` in `ClientOptions` — `account_id` is a per-call path
 * param. The tool resolves + injects it per profile via `withAccount()`.
 */
export type CloudflareFetch = typeof fetch;

let injectedFetch: CloudflareFetch | undefined;

/** Inject a fetch implementation (tests). Pass `null` to restore the SDK default. */
export function setSdkFetchImpl(impl: CloudflareFetch | null): void {
  injectedFetch = impl ?? undefined;
}

/** Resolve the active fetch implementation (undefined = let the SDK use global fetch). */
export function getSdkFetch(): CloudflareFetch | undefined {
  return injectedFetch;
}

let cachedToken: string | null = null;
let cachedProfileKey: string | null = null;

/** Resolve + cache the API token for the active profile (process lifetime). */
export async function getToken(profileName: string | undefined): Promise<string> {
  const key = profileName ?? "<token-file>";
  if (cachedToken && cachedProfileKey === key) return cachedToken;
  const token = await requireToken(profileName);
  cachedToken = token;
  cachedProfileKey = key;
  return token;
}

/** Reset the cached token (tests / setup). */
export function resetTokenCache(): void {
  cachedToken = null;
  cachedProfileKey = null;
}

/**
 * Build a Cloudflare SDK client from a resolved token. The optional fetchImpl
 * overrides the injected seam (used by tests that build a client inline).
 */
export function buildClient(token: string, fetchImpl?: CloudflareFetch): Cloudflare {
  const fetchOpt = fetchImpl ?? injectedFetch;
  return new Cloudflare({
    apiToken: token,
    ...(fetchOpt ? { fetch: fetchOpt } : {}),
    timeout: 30_000,
    maxRetries: 2,
  });
}

/**
 * Resolve a client for the active profile: load the token (cached) and build
 * the client with the active fetch seam. Commands call this to get a typed
 * `Cloudflare` instance.
 */
export async function getClient(profileName: string | undefined): Promise<Cloudflare> {
  const token = await getToken(profileName);
  return buildClient(token);
}

/**
 * Inject the profile's default `account_id` into a call's params. The caller
 * passes a guaranteed account_id (from `requireAccountId`); the spread sets it
 * so the returned object satisfies the SDK's `{ account_id: string, ... }` param
 * types. Used by account-scoped calls (r2/images/workers); zone-scoped calls
 * take `{ zone_id }` instead and don't go through here.
 */
export function withAccount<P extends Record<string, unknown>>(
  params: P,
  accountId: string,
): P & { account_id: string } {
  return { ...params, account_id: accountId };
}

/**
 * Surface a clear AxiError when an account-scoped command is invoked without a
 * resolvable account_id (no --account profile account_id, no env, no account file).
 * The live `client.accounts.list()` probe fallback (design §5.2) is a documented
 * post-MVP seam; for now we fail loudly with guidance rather than guess.
 */
export function requireAccountId(accountId: string | undefined): string {
  if (accountId && accountId.length > 0) return accountId;
  throw new AxiError(
    "No Cloudflare account_id resolved — account-scoped commands need one",
    "VALIDATION_ERROR",
    [
      "Pass --account <name> with a profile that has an account_id in ~/.config/cloudflare-axi/profiles.yaml",
      "Or export CLOUDFLARE_ACCOUNT_ID=<account_id>",
      "Or write the account id to ~/.config/cloudflare-axi/account",
    ],
  );
}

/**
 * Run an SDK call and translate any thrown Cloudflare error into an AxiError
 * via mapCloudflareError. Read-only commands funnel through this so the agent
 * always gets a structured { error, code, help[] } on stdout.
 */
export async function safeCall<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    throw mapCloudflareError(err);
  }
}

/**
 * The SDK types `result_info` as `{ page?, per_page? }`, but the live Cloudflare
 * v4 envelope carries `count`/`total_count`/`total_pages` too (the SDK assigns
 * the raw body object through). Read `total_count` defensively for the §4
 * pre-computed aggregate ("count: N of M total"); undefined when absent.
 */
interface V4ResultInfo {
  count?: number;
  page?: number;
  per_page?: number;
  total_count?: number;
  total_pages?: number;
}
export function readTotalCount(resultInfo: unknown): number | undefined {
  if (resultInfo && typeof resultInfo === "object") {
    const tc = (resultInfo as V4ResultInfo).total_count;
    return typeof tc === "number" ? tc : undefined;
  }
  return undefined;
}

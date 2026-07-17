import { AxiError, exitCodeForError } from "axi-sdk-js";
import Cloudflare from "cloudflare";

export { AxiError, exitCodeForError };

/**
 * A normalized view of a thrown Cloudflare SDK error. The SDK's `APIError`
 * exposes `status` (HTTP), `error` (parsed body), and `errors[]` (the v4
 * `errors[]` array, where CF-specific codes like 9422 live). Connection
 * failures carry `status: undefined`.
 */
export interface CloudflareSdkError {
  status?: number;
  errors?: Array<{ code?: number; message?: string }>;
  message?: string;
  name?: string;
}

/** Pull the most human-readable message out of a Cloudflare error. */
export function cloudflareErrorMessage(e: CloudflareSdkError): string {
  const first = e.errors?.[0];
  if (first?.message) return first.message;
  if (e.message) return e.message;
  return `HTTP ${e.status ?? "?"}`;
}

interface ErrorPattern {
  match: (e: CloudflareSdkError) => boolean;
  code: string;
  message: (e: CloudflareSdkError) => string;
  suggestions?: (e: CloudflareSdkError) => string[];
}

const patterns: ErrorPattern[] = [
  // Images transformation-quota over-limit surfaces as CF error code 9422 in
  // the v4 `errors[]` body (not as an HTTP status). Surfaced `not wired` until
  // the GraphQL Analytics dataset is confirmed (design §3.5/§11.5); when an
  // `ai run` / transformation endpoint hits it, map to RATE_LIMITED.
  {
    match: (e) => e.errors?.some((x) => x.code === 9422) ?? false,
    code: "RATE_LIMITED",
    message: () => "Cloudflare Images transformation quota exceeded for this month",
    suggestions: () => [
      "Transformation usage is metered monthly (Free 5,000/mo, Paid 5,000 + $0.50/1k)",
      "The over-limit surfaces as Cloudflare error code 9422; retry next billing cycle",
    ],
  },
  {
    match: (e) => e.status === 401,
    code: "AUTH_REQUIRED",
    message: () => "Cloudflare auth required — the API token is missing, invalid, or expired",
    suggestions: () => [
      "Run `cloudflare-axi accounts whoami` to verify the active token",
      "Check the profile token_source in ~/.config/cloudflare-axi/profiles.yaml",
      "Or export CLOUDFLARE_API_TOKEN=<token>",
    ],
  },
  {
    match: (e) => e.status === 403,
    code: "FORBIDDEN",
    message: (e) => `Insufficient Cloudflare token permissions: ${cloudflareErrorMessage(e)}`,
    suggestions: () => [
      "The token lacks the permission group this endpoint needs (see NOTES.md §minimal token scope)",
      "List live permission groups with `cloudflare-axi` once `user tokens permission-groups` ships (post-MVP)",
    ],
  },
  {
    match: (e) => e.status === 429,
    code: "RATE_LIMITED",
    message: () => "Cloudflare API rate limit hit (the SDK retried 2x with exponential backoff)",
    suggestions: () => ["Wait briefly before retrying", "Reduce page size with --limit"],
  },
  {
    match: (e) => e.status === 404,
    code: "NOT_FOUND",
    message: (e) => cloudflareErrorMessage(e),
    suggestions: () => [
      "Verify the id; Cloudflare ids are opaque 32-char hex (zones) or names (R2 buckets, Workers)",
      "Run `cloudflare-axi zones list` / `r2 buckets list` to browse",
    ],
  },
  {
    match: (e) => e.status === 409,
    code: "VALIDATION_ERROR",
    message: (e) => `Conflict: ${cloudflareErrorMessage(e)}`,
  },
  {
    match: (e) => e.status === 400 || e.status === 422,
    code: "VALIDATION_ERROR",
    message: (e) => cloudflareErrorMessage(e),
  },
  {
    match: (e) => (e.status ?? 0) >= 500,
    code: "UNKNOWN",
    message: (e) => `Cloudflare server error (HTTP ${e.status}): ${cloudflareErrorMessage(e)}`,
    suggestions: () => ["Retry later — the Cloudflare API is likely transient"],
  },
  {
    match: (e) => (e.status ?? 0) >= 400,
    code: "VALIDATION_ERROR",
    message: (e) => cloudflareErrorMessage(e),
  },
];

function toSdkError(err: unknown): CloudflareSdkError {
  if (err && typeof err === "object") {
    const rec = err as Record<string, unknown>;
    return {
      status: typeof rec["status"] === "number" ? rec["status"] : undefined,
      errors: Array.isArray(rec["errors"]) ? rec["errors"] : undefined,
      message: typeof rec["message"] === "string" ? rec["message"] : undefined,
      name: typeof rec["name"] === "string" ? rec["name"] : undefined,
    };
  }
  return { message: String(err) };
}

/**
 * Map a thrown Cloudflare SDK error into a structured AxiError. Connection
 * failures (no HTTP status) are detected via the SDK's APIConnection*
 * subclasses (referenced through the default export's static props so this
 * stays a single CJS import); HTTP-status errors flow through the pattern
 * array (the clickup-axi errors.ts shape).
 */
export function mapCloudflareError(err: unknown): AxiError {
  if (err instanceof AxiError) return err;
  // APIConnectionTimeoutError extends APIConnectionError, so check timeout first.
  if (err instanceof Cloudflare.APIConnectionTimeoutError) {
    return new AxiError("Cloudflare API request timed out", "TIMEOUT", [
      "Check network connectivity and Cloudflare API reachability",
    ]);
  }
  if (err instanceof Cloudflare.APIConnectionError) {
    return new AxiError(
      `Cloudflare API connection failed: ${err.message ?? "unknown"}`,
      "NETWORK_ERROR",
      ["Check network connectivity and that api.cloudflare.com is reachable"],
    );
  }
  const e = toSdkError(err);
  for (const { match, code, message, suggestions } of patterns) {
    if (match(e)) {
      return new AxiError(message(e), code, suggestions?.(e) ?? []);
    }
  }
  return new AxiError(cloudflareErrorMessage(e), "UNKNOWN");
}

/** Returned when no token can be resolved from any source. */
export function noTokenError(): AxiError {
  return new AxiError(
    "No Cloudflare API token found (CLOUDFLARE_API_TOKEN env > profile token_source > ~/.config/cloudflare-axi/token)",
    "AUTH_REQUIRED",
    [
      "Create ~/.config/cloudflare-axi/profiles.yaml with a profile token_source (see docs/catalog-entry.yaml region)",
      "Or run `cloudflare-axi setup token` to write a flat token to ~/.config/cloudflare-axi/token",
      "Or export CLOUDFLARE_API_TOKEN=<token>",
    ],
  );
}

/** Map a token-source resolution failure (aws/bw CLI missing/locked, misconfig). */
export function mapTokenSourceError(
  profileName: string,
  type: string | undefined,
  err: unknown,
): AxiError {
  const message = err instanceof Error ? err.message : String(err);
  const isMissingCli = /not found|ENOENT|command not found/i.test(message);
  if (type === "aws-secrets-manager" && isMissingCli) {
    return new AxiError(
      `Profile '${profileName}' needs the aws CLI to resolve its token, but aws is missing or not on PATH`,
      "AUTH_REQUIRED",
      [
        "Install/configure the aws CLI (`aws configure`)",
        "Or switch the profile token_source to env-file/plain-file",
      ],
    );
  }
  if (type === "vaultwarden" && isMissingCli) {
    return new AxiError(
      `Profile '${profileName}' needs the bw CLI to resolve its Vaultwarden item, but bw is missing or not on PATH`,
      "AUTH_REQUIRED",
      [
        "Install the bw CLI and unlock your Vaultwarden session (`bw unlock`)",
        "Or switch the profile token_source to env-file/plain-file",
      ],
    );
  }
  if (/lock|unlock|session/i.test(message)) {
    return new AxiError(`Profile '${profileName}' Vaultwarden session is locked`, "AUTH_REQUIRED", [
      "Unlock your Vaultwarden session (`bw unlock`) and export BW_SESSION",
    ]);
  }
  return new AxiError(
    `Profile '${profileName}' token_source (${type ?? "?"}) is misconfigured: ${message}`,
    "VALIDATION_ERROR",
    ["Check the token_source descriptor in ~/.config/cloudflare-axi/profiles.yaml"],
  );
}

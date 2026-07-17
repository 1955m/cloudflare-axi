import { AxiError } from "./errors.js";
import { isReadonlyEnforced } from "./config.js";

/**
 * Write guardrail (design §4.3 + §11.3): all mutations default to DRY-RUN. They
 * print exactly what they WOULD do and require `--execute` (or
 * `FM_CLOUDFLARE_EXECUTE=1`) to actually hit the Cloudflare API. Mirrors
 * clickup-axi's writeGuard.ts.
 *
 * Read-only commands (the entire MVP surface) never call this.
 *
 * Defense-in-depth (captain ruling, production account): when the readonly gate
 * is enforced (`~/.config/cloudflare-axi/readonly` present, config.json
 * `readonly:true`, or `CLOUDFLARE_AXI_READONLY=1`), `--execute` itself is
 * refused with FORBIDDEN — these profiles touch a real production CF account.
 * Shipped + tested from day one even though no write command ships in the MVP;
 * the gate and pattern are present for the first post-MVP write.
 */

export interface WriteGateResult {
  /** True when the operation should proceed against the API. */
  execute: boolean;
  /** True when this invocation is a dry-run preview. */
  dryRun: boolean;
}

/** Resolve whether a write operation should execute or stay a dry-run. */
export function resolveWriteGate(executeFlag: boolean, dryRunFlag: boolean): WriteGateResult {
  if (dryRunFlag && executeFlag) {
    throw new AxiError("Cannot combine --dry-run and --execute — choose one", "VALIDATION_ERROR", [
      "--dry-run (default) previews the mutation; --execute applies it to Cloudflare",
    ]);
  }
  const envExecute = (process.env["FM_CLOUDFLARE_EXECUTE"] ?? "").trim() === "1";
  const execute = executeFlag || envExecute;
  if (execute && isReadonlyEnforced()) {
    throw new AxiError(
      "Read-only mode is enforced; captain approval + removing the readonly gate required. --execute refused against the Cloudflare account.",
      "FORBIDDEN",
      [
        "Obtain the captain's explicit permission before ANY --execute against the production account",
        "Remove the readonly gate to allow mutations: delete ~/.config/cloudflare-axi/readonly (or set readonly=false in ~/.config/cloudflare-axi/config.json)",
        "Dry-run previews (the default) remain available without the gate",
      ],
    );
  }
  return { execute, dryRun: !execute };
}

/** Annotate every write output so an agent/reviewer can tell if CF actually changed. */
export function writeGateLabel(gate: WriteGateResult): string {
  return gate.execute ? "executed" : "dry-run";
}

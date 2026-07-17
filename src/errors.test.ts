import { describe, expect, it } from "vitest";
import Cloudflare from "cloudflare";
import { AxiError, mapCloudflareError, noTokenError } from "./errors.js";

/** A duck-typed SDK error (mapCloudflareError reads status/errors/message). */
function sdkErr(
  status: number | undefined,
  errors: Array<{ code?: number; message?: string }> = [],
  message = "boom",
) {
  return { status, errors, message, name: "APIError" };
}

describe("mapCloudflareError — HTTP status → code", () => {
  it("401 → AUTH_REQUIRED", () => {
    const e = mapCloudflareError(sdkErr(401, [{ code: 1003, message: "unauthorized" }]));
    expect(e.code).toBe("AUTH_REQUIRED");
    expect(e.suggestions.length).toBeGreaterThan(0);
  });
  it("403 → FORBIDDEN", () => {
    expect(mapCloudflareError(sdkErr(403)).code).toBe("FORBIDDEN");
  });
  it("429 → RATE_LIMITED", () => {
    expect(mapCloudflareError(sdkErr(429)).code).toBe("RATE_LIMITED");
  });
  it("404 → NOT_FOUND", () => {
    expect(mapCloudflareError(sdkErr(404, [{ message: "not found" }])).code).toBe("NOT_FOUND");
  });
  it("400 → VALIDATION_ERROR", () => {
    expect(mapCloudflareError(sdkErr(400)).code).toBe("VALIDATION_ERROR");
  });
  it("422 → VALIDATION_ERROR", () => {
    expect(mapCloudflareError(sdkErr(422)).code).toBe("VALIDATION_ERROR");
  });
  it("409 → VALIDATION_ERROR (conflict)", () => {
    expect(mapCloudflareError(sdkErr(409)).code).toBe("VALIDATION_ERROR");
  });
  it("500 → UNKNOWN", () => {
    expect(mapCloudflareError(sdkErr(503)).code).toBe("UNKNOWN");
  });
  it("unmapped 4xx → VALIDATION_ERROR", () => {
    expect(mapCloudflareError(sdkErr(418)).code).toBe("VALIDATION_ERROR");
  });
  it("no status → UNKNOWN", () => {
    expect(mapCloudflareError(sdkErr(undefined)).code).toBe("UNKNOWN");
  });
});

describe("mapCloudflareError — special cases", () => {
  it("Images error code 9422 → RATE_LIMITED (transformation quota)", () => {
    const e = mapCloudflareError(sdkErr(400, [{ code: 9422, message: "quota exceeded" }]));
    expect(e.code).toBe("RATE_LIMITED");
    expect(e.message).toMatch(/transformation quota/i);
  });
  it("9422 wins over the 400 VALIDATION_ERROR pattern", () => {
    expect(mapCloudflareError(sdkErr(400, [{ code: 9422 }])).code).toBe("RATE_LIMITED");
  });
  it("passes an existing AxiError through untouched", () => {
    const orig = new AxiError("custom", "NOT_FOUND", ["x"]);
    expect(mapCloudflareError(orig)).toBe(orig);
  });
});

describe("mapCloudflareError — connection failures (real SDK subclasses)", () => {
  it("APIConnectionTimeoutError → TIMEOUT", () => {
    const err = new Cloudflare.APIConnectionTimeoutError({ message: "timed out" });
    expect(mapCloudflareError(err).code).toBe("TIMEOUT");
  });
  it("APIConnectionError → NETWORK_ERROR", () => {
    const err = new Cloudflare.APIConnectionError({ message: "network down" });
    expect(mapCloudflareError(err).code).toBe("NETWORK_ERROR");
  });
  it("timeout is not mis-mapped as a generic connection error (order matters)", () => {
    const err = new Cloudflare.APIConnectionTimeoutError({ message: "t" });
    expect(mapCloudflareError(err).code).toBe("TIMEOUT");
    expect(mapCloudflareError(err).code).not.toBe("NETWORK_ERROR");
  });
});

describe("noTokenError", () => {
  it("is AUTH_REQUIRED with actionable suggestions", () => {
    const e = noTokenError();
    expect(e.code).toBe("AUTH_REQUIRED");
    expect(e.suggestions.some((s) => s.includes("profiles.yaml"))).toBe(true);
  });
});

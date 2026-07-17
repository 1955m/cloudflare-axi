import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { resolveWriteGate, writeGateLabel } from "./writeGuard.js";
import { isReadonlyEnforced, resetReadonlyCache } from "./config.js";

const EXEC_ENV = "FM_CLOUDFLARE_EXECUTE";
const RDONLY_ENV = "CLOUDFLARE_AXI_READONLY";

describe("resolveWriteGate", () => {
  beforeEach(() => {
    delete process.env[EXEC_ENV];
    delete process.env[RDONLY_ENV];
    resetReadonlyCache();
  });
  afterEach(() => {
    delete process.env[EXEC_ENV];
    delete process.env[RDONLY_ENV];
    resetReadonlyCache();
  });

  it("defaults to dry-run when neither flag is set", () => {
    const gate = resolveWriteGate(false, false);
    expect(gate.execute).toBe(false);
    expect(gate.dryRun).toBe(true);
  });
  it("executes when --execute is passed", () => {
    const gate = resolveWriteGate(true, false);
    expect(gate.execute).toBe(true);
    expect(gate.dryRun).toBe(false);
  });
  it("executes when FM_CLOUDFLARE_EXECUTE=1", () => {
    process.env[EXEC_ENV] = "1";
    const gate = resolveWriteGate(false, false);
    expect(gate.execute).toBe(true);
  });
  it("rejects combining --dry-run and --execute", () => {
    expect(() => resolveWriteGate(true, true)).toThrow();
  });
  it("stays dry-run when only --dry-run is passed", () => {
    const gate = resolveWriteGate(false, true);
    expect(gate.execute).toBe(false);
    expect(gate.dryRun).toBe(true);
  });
  it("refuses --execute when the readonly gate is enforced", () => {
    process.env[RDONLY_ENV] = "1";
    expect(() => resolveWriteGate(true, false)).toThrowError(/Read-only mode is enforced/);
  });
  it("refuses FM_CLOUDFLARE_EXECUTE=1 when the readonly gate is enforced", () => {
    process.env[RDONLY_ENV] = "1";
    process.env[EXEC_ENV] = "1";
    expect(() => resolveWriteGate(false, false)).toThrowError(/captain/);
  });
  it("still allows dry-run previews when the readonly gate is enforced", () => {
    process.env[RDONLY_ENV] = "1";
    const gate = resolveWriteGate(false, false);
    expect(gate.execute).toBe(false);
    expect(gate.dryRun).toBe(true);
  });
});

describe("writeGateLabel", () => {
  it("labels dry-run vs executed", () => {
    expect(writeGateLabel({ execute: false, dryRun: true })).toBe("dry-run");
    expect(writeGateLabel({ execute: true, dryRun: false })).toBe("executed");
  });
});

describe("isReadonlyEnforced (gate backing)", () => {
  beforeEach(() => {
    delete process.env[RDONLY_ENV];
    resetReadonlyCache();
  });
  afterEach(() => {
    delete process.env[RDONLY_ENV];
    resetReadonlyCache();
  });
  it("is off by default", () => {
    expect(isReadonlyEnforced()).toBe(false);
  });
  it("turns on via CLOUDFLARE_AXI_READONLY=1", () => {
    process.env[RDONLY_ENV] = "1";
    resetReadonlyCache();
    expect(isReadonlyEnforced()).toBe(true);
  });
});

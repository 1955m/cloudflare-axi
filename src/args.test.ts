import { describe, expect, it } from "vitest";
import {
  getAllFlags,
  getFlag,
  getPositional,
  hasFlag,
  requireNumber,
  takeBoolFlag,
  takeFlag,
  takeNumber,
} from "./args.js";

describe("getFlag/takeFlag", () => {
  it("reads --flag value", () => {
    expect(getFlag(["--zone", "z1"], "--zone")).toBe("z1");
  });
  it("reads --flag=value", () => {
    expect(getFlag(["--zone=z1"], "--zone")).toBe("z1");
  });
  it("takeFlag removes the flag and value", () => {
    const a = ["list", "--zone", "z1", "--limit", "5"];
    expect(takeFlag(a, "--zone")).toBe("z1");
    expect(a).toEqual(["list", "--limit", "5"]);
  });
  it("takeFlag handles --flag=value", () => {
    const a = ["list", "--zone=z1"];
    expect(takeFlag(a, "--zone")).toBe("z1");
    expect(a).toEqual(["list"]);
  });
  it("returns undefined when absent", () => {
    expect(getFlag(["list"], "--zone")).toBeUndefined();
    expect(takeFlag(["list"], "--zone")).toBeUndefined();
  });
});

describe("hasFlag/takeBoolFlag", () => {
  it("hasFlag detects presence", () => {
    expect(hasFlag(["--json"], "--json")).toBe(true);
    expect(hasFlag([], "--json")).toBe(false);
  });
  it("takeBoolFlag removes the flag", () => {
    const a = ["--json", "list"];
    expect(takeBoolFlag(a, "--json")).toBe(true);
    expect(a).toEqual(["list"]);
  });
});

describe("getAllFlags", () => {
  it("collects repeated values", () => {
    expect(getAllFlags(["--field", "a", "--field", "b"], "--field")).toEqual(["a", "b"]);
    expect(getAllFlags(["--field=a", "--field=b"], "--field")).toEqual(["a", "b"]);
  });
});

describe("getPositional", () => {
  it("returns the first non-dash arg from startIndex (naive — does not consume flag values)", () => {
    expect(getPositional(["send", "123456789", "--json"], 1)).toBe("123456789");
  });
  it("returns undefined when all remaining args start with -", () => {
    expect(getPositional(["--limit", "--json"], 0)).toBeUndefined();
  });
});

describe("requireNumber/takeNumber", () => {
  it("requireNumber parses", () => {
    expect(requireNumber("42", "limit")).toBe(42);
    expect(() => requireNumber(undefined, "limit")).toThrow();
    expect(() => requireNumber("x", "limit")).toThrow();
  });
  it("takeNumber finds and removes the numeric arg", () => {
    const a = ["list", "50"];
    expect(takeNumber(a, "limit")).toBe(50);
    expect(a).toEqual(["list"]);
  });
});

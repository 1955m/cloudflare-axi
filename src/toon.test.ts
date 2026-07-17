import { describe, expect, it } from "vitest";
import {
  boolYesNo,
  custom,
  extract,
  field,
  joinArray,
  lower,
  mapEnum,
  pluck,
  relativeTime,
  renderDetail,
  renderError,
  renderHelp,
  renderList,
  renderOutput,
} from "./toon.js";

describe("extract", () => {
  it("reads a plain field", () => {
    expect(extract({ id: "1", name: "x" }, [field("id")])).toEqual({ id: "1" });
  });

  it("renames via as", () => {
    expect(extract({ status: "active" }, [field("status", "state")])).toEqual({
      state: "active",
    });
  });

  it("plucks a nested key", () => {
    expect(extract({ account: { id: "a1" } }, [pluck("account", "id")])).toEqual({
      account: "a1",
    });
  });

  it("joins an array of strings", () => {
    expect(extract({ tags: ["a", "b"] }, [joinArray("tags", null, "tags")])).toEqual({
      tags: "a,b",
    });
  });

  it("joins an array of objects by subkey", () => {
    expect(
      extract({ ns: [{ name: "x" }, { name: "y" }] }, [joinArray("ns", "name", "names")]),
    ).toEqual({ names: "x,y" });
  });

  it("joinArray falls back to the empty token", () => {
    expect(extract({ tags: [] }, [joinArray("tags", null, "tags", "none")])).toEqual({
      tags: "none",
    });
  });

  it("boolYesNo maps true/false", () => {
    expect(extract({ proxied: true }, [boolYesNo("proxied")])).toEqual({ proxied: "yes" });
    expect(extract({ proxied: false }, [boolYesNo("proxied")])).toEqual({ proxied: "no" });
  });

  it("mapEnum maps known values and falls back", () => {
    const def = mapEnum("s", { active: "ok", moved: "gone" }, "other");
    expect(extract({ s: "active" }, [def])).toEqual({ s: "ok" });
    expect(extract({ s: "unknown" }, [def])).toEqual({ s: "other" });
  });

  it("lower lowercases strings", () => {
    expect(extract({ name: "ABC" }, [lower("name")])).toEqual({ name: "abc" });
  });

  it("custom runs the fn", () => {
    expect(extract({ n: 5 }, [custom("doubled", (x: { n: number }) => x.n * 2)])).toEqual({
      doubled: 10,
    });
  });

  it("relativeTime handles ISO 8601 and epoch-ms (the clickup-axi epoch+ISO variant)", () => {
    const iso = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(); // 3h ago
    expect(extract({ created_on: iso }, [relativeTime("created_on")])).toEqual({
      created_on: "3h ago",
    });
    const epochMs = Date.now() - 2 * 60 * 1000; // 2m ago, as a number
    expect(extract({ ts: epochMs }, [relativeTime("ts")])).toEqual({ ts: "2m ago" });
    const epochStr = String(Date.now() - 45 * 1000); // 45s ago, numeric string
    expect(extract({ ts: epochStr }, [relativeTime("ts")])).toEqual({ ts: "just now" });
  });

  it("relativeTime returns unknown for garbage", () => {
    expect(extract({ ts: "not-a-date" }, [relativeTime("ts")])).toEqual({ ts: "unknown" });
    expect(extract({ ts: undefined }, [relativeTime("ts")])).toEqual({ ts: "unknown" });
  });
});

describe("renderers", () => {
  it("renderList emits a TOON array block", () => {
    const out = renderList(
      "zones",
      [{ id: "z1", name: "a", status: "active" }],
      [field("id"), field("name")],
    );
    expect(out).toContain("zones[1]");
    expect(out).toContain("z1,a");
  });

  it("renderDetail emits a single object", () => {
    const out = renderDetail("zone", { id: "z1", name: "a" }, [field("id"), field("name")]);
    expect(out).toContain("zone:");
    expect(out).toContain("z1");
  });

  it("renderHelp indents N lines", () => {
    expect(renderHelp(["a", "b"])).toBe("help[2]:\n  a\n  b");
    expect(renderHelp([])).toBe("");
  });

  it("renderError emits error + code + optional help", () => {
    const out = renderError("no token", "AUTH_REQUIRED", ["run setup"]);
    expect(out).toContain("error: no token");
    expect(out).toContain("code: AUTH_REQUIRED");
    expect(out).toContain("help[1]:");
  });

  it("renderOutput joins truthy blocks", () => {
    expect(renderOutput(["a", undefined, "b"])).toBe("a\nb");
  });
});

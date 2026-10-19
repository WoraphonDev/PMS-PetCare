import { describe, expect, it } from "vitest";
import base from "../../../tsconfig.base.json" with { type: "json" };
import node from "../tsconfig.node.json" with { type: "json" };
import react from "../tsconfig.react.json" with { type: "json" };

describe("tsconfig presets", () => {
  it("base keeps the strict flags every package relies on", () => {
    expect(base.compilerOptions).toMatchObject({ strict: true, noUncheckedIndexedAccess: true, noImplicitOverride: true, noEmit: true });
  });

  it("node preset extends base without DOM types", () => {
    expect(node.extends).toBe("../../tsconfig.base.json");
    expect(node.compilerOptions.lib).toEqual(["ES2023"]);
  });

  it("react preset extends base with DOM types and the automatic JSX runtime", () => {
    expect(react.extends).toBe("../../tsconfig.base.json");
    expect(react.compilerOptions.lib).toEqual(expect.arrayContaining(["DOM", "DOM.Iterable"]));
    expect(react.compilerOptions.jsx).toBe("react-jsx");
  });
});

import { describe, expect, expectTypeOf, it } from "vitest";
import { createTranslator, t } from "../src/i18n";
import { th } from "../src/i18n/th";

const fixture = {
  common: { hello: "สวัสดี", hi: "สวัสดี {name}" },
  "scr-x": { usage: "ใช้ {used} จาก {limit} สาขา", plain: "ไม่มีตัวแปร" },
} as const;
const tx = createTranslator(fixture);

describe("t (T-0022-01 A)", () => {
  it("returns the Thai text of a key in the app's messages", () => {
    expect(t("common.appName")).toBe(th.common.appName);
    expect(t("common.updateAvailable")).toBe("มีเวอร์ชันใหม่");
    expect(t("common.update")).toBe("อัปเดต");
  });

  it("interpolates every {placeholder} with strings and numbers", () => {
    expect(tx("common.hi", { name: "สมชาย" })).toBe("สวัสดี สมชาย");
    expect(tx("scr-x.usage", { used: 1, limit: 3 })).toBe("ใช้ 1 จาก 3 สาขา");
    expect(tx("scr-x.plain")).toBe("ไม่มีตัวแปร");
  });

  it("checks keys and placeholders at compile time", () => {
    // Type-level only: the closure is never called.
    const typeChecks = () => {
      expectTypeOf(tx("common.hello")).toEqualTypeOf<string>();
      tx("scr-x.usage", { used: 1, limit: "3" });
      // @ts-expect-error unknown key
      tx("common.missing");
      // @ts-expect-error misspelled namespace
      tx("scr-y.usage", { used: 1, limit: 3 });
      // @ts-expect-error missing placeholder value
      tx("scr-x.usage", { used: 1 });
      // @ts-expect-error extra placeholder value
      tx("scr-x.usage", { used: 1, limit: 3, extra: 1 });
      // @ts-expect-error wrong placeholder name
      tx("common.hi", { nam: "x" });
      // @ts-expect-error wrong value type
      tx("common.hi", { name: true });
      // @ts-expect-error values passed to a text without placeholders
      tx("common.hello", { name: "x" });
      // @ts-expect-error values missing for a text with placeholders
      tx("common.hi");
      // @ts-expect-error unknown key in the app's own messages
      t("common.nope");
      const withExtra = { used: 1, limit: 3, extra: 1 };
      // @ts-expect-error extra placeholder value passed through a variable
      tx("scr-x.usage", withExtra);
      const base = { used: 1, limit: 3 };
      // @ts-expect-error extra placeholder value added by a spread
      tx("scr-x.usage", { ...base, ...{ extra: "x" } });
      const exact = { used: 1, limit: 3 };
      tx("scr-x.usage", exact);
      const missing = { used: 1 };
      // @ts-expect-error missing placeholder value passed through a variable
      tx("scr-x.usage", missing);
    };
    expect(typeChecks).toBeTypeOf("function");
  });
});

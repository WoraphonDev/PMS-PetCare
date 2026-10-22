import { describe, expect, it } from "vitest";
import { BranchPaymentSettingsUpdateRequest } from "../index";

// docs/spec/features/foundation.md#contract-branch-payment-settings · #rule-branch-promptpay-format (F08)
const parse = (body: unknown) => BranchPaymentSettingsUpdateRequest.safeParse(body);
const fieldsOf = (result: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) =>
  (result.error?.issues ?? []).map((i) => i.path.join(".") || "_");

// 13-digit vectors per docs/questions/T-0014-02.md: expected results are copied from python-stdnum @ 006192e
// (secondary source), never computed by the helper under test.
const THIRTEEN_DIGIT_VECTORS: ReadonlyArray<[value: string, valid: boolean, source: string]> = [
  ["1234545678781", true, "stdnum/th/pin.py docstring (validate)"],
  ["3100600445635", true, "stdnum/th/pin.py docstring (validate)"],
  ["0994000617721", true, "stdnum/th/moa.py docstring (validate), leading 0"],
  ["0105530041751", true, "tests/test_th_moa.doctest found-online list, DBD 010…"],
  ["0105556000751", true, "tests/test_th_moa.doctest found-online list, DBD 010…"],
  ["0103541017375", true, "tests/test_th_moa.doctest found-online list (0-10-3-541-01737-5)"],
  ["0992001001446", true, "tests/test_th_moa.doctest found-online list, RD 099…"],
  ["1234545678789", false, "stdnum/th/pin.py docstring (InvalidChecksum)"],
  ["0994000617723", false, "stdnum/th/moa.py docstring (InvalidChecksum), leading 0"],
  ["0994000617728", false, "tests/test_th_moa.doctest (InvalidChecksum)"],
];

describe("BranchPaymentSettingsUpdateRequest accepts", () => {
  it("a mobile number, trimmed", () => {
    expect(parse({ promptpayId: "  0812345678\t" })).toEqual({ success: true, data: { promptpayId: "0812345678" } });
  });

  it("null to clear", () => {
    expect(parse({ promptpayId: null })).toEqual({ success: true, data: { promptpayId: null } });
  });

  for (const [value, , source] of THIRTEEN_DIGIT_VECTORS.filter(([, valid]) => valid)) {
    it(`13-digit ${value} (${source})`, () => {
      expect(parse({ promptpayId: value })).toEqual({ success: true, data: { promptpayId: value } });
    });
  }
});

describe("BranchPaymentSettingsUpdateRequest rejects at details.fields.promptpayId", () => {
  const invalid = [
    ...THIRTEEN_DIGIT_VECTORS.filter(([, valid]) => !valid).map(([value]) => value),
    "081234567", // 9-digit mobile
    "08123456789", // 11-digit mobile
    "1812345678", // mobile not starting with 0
    "123454567878", // 12 digits
    "12345456787811", // 14 digits
    "08123456ab",
    "abcdefghijklm",
    "081-234-5678",
    "081 234 5678",
    "0-99-4-000-61772-1", // the source's dashed form: dashes are not stripped
    "0994 000617721",
    "+66812345678",
    "66812345678",
    "",
    "   ",
    "０８１２３４５６７８", // full-width digits are not \d
  ];
  for (const value of invalid) {
    it(JSON.stringify(value), () => {
      const result = parse({ promptpayId: value });
      expect(result.success).toBe(false);
      expect(fieldsOf(result)).toEqual(["promptpayId"]);
    });
  }

  it("never echoes the submitted value in the issue message", () => {
    const result = parse({ promptpayId: "1234545678789" });
    expect(JSON.stringify(result.error?.issues.map((i) => i.message))).not.toContain("1234545678789");
  });
});

describe("BranchPaymentSettingsUpdateRequest body shape", () => {
  it("requires the promptpayId key", () => {
    expect(fieldsOf(parse({}))).toEqual(["promptpayId"]);
  });

  it("reports every other key by name", () => {
    for (const key of ["version", "name", "orgId", "id", "isActive", "timezone", "unknown"]) {
      const result = parse({ promptpayId: "0812345678", [key]: "x" });
      expect(result.success, key).toBe(false);
      expect(fieldsOf(result), key).toContain(key);
    }
  });

  it("rejects non-object bodies and wrong value types", () => {
    for (const body of [null, "0812345678", 812345678, [], [{ promptpayId: "0812345678" }], true]) {
      expect(parse(body).success, JSON.stringify(body)).toBe(false);
    }
    for (const promptpayId of [812345678, 1234545678781, true, false, {}, ["0812345678"]]) {
      const result = parse({ promptpayId });
      expect(result.success, JSON.stringify(promptpayId)).toBe(false);
      expect(fieldsOf(result)).toEqual(["promptpayId"]);
    }
  });
});

import { ApiError } from "@app/api-client";
import { describe, expect, it } from "vitest";
import { errorMessage, formErrors } from "../../src/lib/form-errors";

describe("form-errors", () => {
  it("maps VALIDATION_FAILED details.fields onto the form's own fields", () => {
    const e = new ApiError(400, "VALIDATION_FAILED", "x", { fields: { email: ["Invalid"], orgSlug: ["Bad"] } });
    expect(formErrors(e, ["email", "orgSlug", "password"])).toEqual({
      fields: { email: "ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบ", orgSlug: "ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบ" },
    });
  });

  it("a field the form does not show becomes a form-level message", () => {
    const e = new ApiError(400, "VALIDATION_FAILED", "x", { fields: { _: ["Unknown key"], email: ["Invalid"] } });
    expect(formErrors(e, ["email"])).toEqual({ fields: { email: "ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบ" }, form: "ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบ" });
  });

  it("VALIDATION_FAILED without field details is a form-level message", () => {
    expect(formErrors(new ApiError(400, "VALIDATION_FAILED", "x"), ["email"])).toEqual({ fields: {}, form: "ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบ" });
  });

  it("other errors use the errors.ts text; no HTTP response → the network text", () => {
    expect(formErrors(new ApiError(429, "RATE_LIMITED", "x"), ["email"])).toEqual({ fields: {}, form: "ทำรายการบ่อยเกินไป กรุณารอสักครู่" });
    expect(errorMessage(new ApiError(500, "INTERNAL", "x"))).toBe("เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง");
    expect(errorMessage(new ApiError(0, "INTERNAL", "Network error"))).toBe("เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่");
    expect(errorMessage(new Error("boom"))).toBe("เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง");
  });
});

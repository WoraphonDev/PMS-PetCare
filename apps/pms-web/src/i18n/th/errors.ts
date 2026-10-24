import type { ErrorCode } from "@app/contracts";

// Generic Thai text per error code (T-0023 copy); screens override where the spec needs a specific message.
export const errors = {
  VALIDATION_FAILED: "ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบ",
  UNAUTHENTICATED: "กรุณาเข้าสู่ระบบ",
  FORBIDDEN: "คุณไม่มีสิทธิ์ทำรายการนี้",
  NOT_FOUND: "ไม่พบข้อมูล",
  CONFLICT: "ข้อมูลซ้ำกับที่มีอยู่แล้ว",
  ORG_SUSPENDED: "ร้านนี้ถูกระงับ ทำได้เฉพาะการดูข้อมูล",
  PLAN_LIMIT_REACHED: "ถึงขีดจำกัดของแพ็กเกจแล้ว",
  LAST_OWNER: "ร้านต้องมีเจ้าของอย่างน้อย 1 คน",
  BRANCH_REQUIRED: "ตำแหน่งนี้ต้องเลือกสาขาอย่างน้อย 1 สาขา",
  INVITATION_INVALID: "คำเชิญนี้ใช้ไม่ได้แล้ว",
  ALREADY_MEMBER: "คุณเป็นสมาชิกของร้านนี้อยู่แล้ว",
  RATE_LIMITED: "ทำรายการบ่อยเกินไป กรุณารอสักครู่",
  INTERNAL: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง",
  PASSWORD_CHANGE_REQUIRED: "กรุณาเปลี่ยนรหัสผ่านก่อนใช้งาน",
  MANAGED_ACCOUNT_ONLY: "ทำได้เฉพาะบัญชีที่ร้านสร้างให้",
  TWO_FACTOR_REQUIRED: "กรุณายืนยันตัวตนสองขั้นตอนก่อน",
  network: "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่",
} as const satisfies Record<ErrorCode | "network", string>;

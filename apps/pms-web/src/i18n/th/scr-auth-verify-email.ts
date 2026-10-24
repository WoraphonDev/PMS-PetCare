// foundation#scr-auth-verify-email — copy approved with T-0023 (never claims delivery or account existence).
export const scrAuthVerifyEmail = {
  pending: "กำลังยืนยันอีเมล…",
  success: "ยืนยันอีเมลแล้ว เข้าสู่ระบบได้เลย",
  toLogin: "ไปหน้าเข้าสู่ระบบ",
  invalid: "ลิงก์นี้ใช้ไม่ได้แล้ว (อาจหมดอายุ ถูกใช้ไปแล้ว หรือมีลิงก์ใหม่กว่า) ขอลิงก์ใหม่ได้ด้านล่าง",
  network: "ยืนยันไม่สำเร็จเพราะการเชื่อมต่อมีปัญหา ลองอีกครั้ง",
  retry: "ลองอีกครั้ง",
  resendTitle: "ขอลิงก์ยืนยันอีเมลใหม่",
  email: "อีเมล",
  resendSubmit: "ส่งลิงก์ใหม่",
  resendAck: "หากอีเมลนี้มีบัญชีที่ยังไม่ได้ยืนยัน เราจะส่งลิงก์ใหม่ให้ กรุณาตรวจกล่องจดหมาย (รวมถึงจดหมายขยะ)",
} as const;

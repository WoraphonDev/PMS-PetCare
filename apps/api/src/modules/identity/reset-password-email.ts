import type { EmailMessage } from "../notification/email";

/** Reset link for the web app (#ep-auth.password_forgot). The token is never logged — only emailed. */
export function resetPasswordEmail(appOrigin: string, to: string, token: string): EmailMessage {
  const link = `${appOrigin}/reset-password?token=${encodeURIComponent(token)}`;
  return {
    to,
    subject: "ตั้งรหัสผ่านใหม่",
    text: `มีคำขอตั้งรหัสผ่านใหม่สำหรับบัญชีของคุณ เปิดลิงก์นี้ภายใน 1 ชั่วโมง (ใช้ได้ครั้งเดียว):\n${link}\n\nถ้าคุณไม่ได้ขอ ไม่ต้องทำอะไร รหัสผ่านเดิมยังใช้ได้`,
  };
}

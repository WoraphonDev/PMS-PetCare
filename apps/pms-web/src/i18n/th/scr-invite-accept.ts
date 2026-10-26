// foundation#scr-invite-accept — copy approved with T-0047. Form labels reuse `scr-auth-signup.*` / `scr-auth-change-password.*`.
export const scrInviteAccept = {
  title: "คำเชิญเข้าร่วมร้าน",
  summary: "ร้าน {shop} เชิญคุณในตำแหน่ง {role}",
  forEmail: "คำเชิญนี้สำหรับ {email} · หมดอายุ {date}",
  acceptAs: "รับคำเชิญในชื่อ {account}",
  wrongAccount: "คุณเข้าสู่ระบบด้วยบัญชีอื่น คำเชิญนี้ต้องรับด้วยบัญชีของ {email}",
  accept: "รับคำเชิญ",
  haveAccount: "มีบัญชีแล้ว — เข้าสู่ระบบ",
  noAccount: "ยังไม่มีบัญชี — สมัคร",
  signUp: "สร้างบัญชีและเข้าร่วมร้าน",
  signedUp: "สร้างบัญชีและเข้าร่วมร้านแล้ว เข้าสู่ระบบเพื่อเริ่มใช้งาน",
  accountExists: "อีเมลนี้มีบัญชีอยู่แล้ว กรุณาเข้าสู่ระบบแล้วรับคำเชิญ",
  invalid: "คำเชิญนี้ใช้ไม่ได้แล้ว (อาจหมดอายุ ถูกใช้ หรือถูกยกเลิก) กรุณาขอคำเชิญใหม่จากร้าน",
  acceptInvalid: "รับคำเชิญไม่ได้ ตรวจสอบว่าเข้าสู่ระบบด้วยบัญชีอีเมลที่ได้รับคำเชิญ",
  alreadyMember: "คุณเป็นสมาชิกของร้านนี้อยู่แล้ว",
  suspended: "ร้านนี้ถูกระงับการใช้งาน รับคำเชิญไม่ได้ในขณะนี้",
} as const;

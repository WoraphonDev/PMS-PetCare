// foundation#scr-staff row actions — copy approved with T-0047. Shared labels (display name, show password) are `scr-staff.*`.
export const scrStaffManage = {
  edit: "แก้ไข",
  remove: "นำออกจากร้าน",
  resetPassword: "รีเซ็ตรหัสผ่าน",
  confirmRemove: "นำ {name} ออกจากร้าน?",
  managedRemoveNote: "บัญชีนี้ร้านเป็นผู้สร้าง เมื่อนำออกแล้วจะเข้าสู่ระบบไม่ได้อีก",
  lastOwner: "ร้านต้องมีเจ้าของอย่างน้อย 1 คน จึงทำรายการนี้ไม่ได้",
  newTempPassword: "รหัสผ่านชั่วคราวใหม่ (10–128 ตัวอักษร)",
  resetDone: "รีเซ็ตแล้ว พนักงานถูกออกจากระบบทุกอุปกรณ์ และต้องเปลี่ยนรหัสผ่านเมื่อเข้าสู่ระบบครั้งถัดไป",
  managedOnly: "รีเซ็ตได้เฉพาะบัญชีที่ร้านสร้างให้",
  save: "บันทึก",
} as const;

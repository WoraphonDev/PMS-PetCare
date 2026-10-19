# Questions

Agent เขียนคำถามที่นี่เมื่อ spec/ADR เงียบ ขัดกัน หรือต้องแตะไฟล์นอก `allowed_paths` — แล้วหยุดส่วนนั้นไว้
มนุษย์ตอบใต้คำถาม แล้วเปลี่ยนสถานะเป็น `answered` (ถ้าต้องแก้ spec/ADR ให้ทำในการ์ด `spec` แยก)

รูปแบบ:

```
## Q-NNNN · <หัวข้อสั้น>
- Status: open | answered | wontfix
- Raised by: <agent/คน> · T-NNNN · YYYY-MM-DD
- Context: …
- Question: …
- Options: (ก) … (ข) … — แนะนำ: …
- Answer:
```

---

## Q-0001 · เก็บค่า subscription จากร้านเมื่อไร
- Status: answered
- Raised by: Claude · ADR-0003 · 2026-10-19
- Question: MVP ให้ร้านใช้ฟรี/เปิดสิทธิ์ด้วยมือ หรือเก็บเงินผ่าน payment gateway ตั้งแต่แรก
- Answer (WoraphonDev · 2026-10-19): MVP ฟรี / platform admin เปิด-ปิดแพ็กเกจเอง; สร้างตาราง plan / subscription / usage_event ไว้ตั้งแต่แรก → ADR-0005

## Q-0002 · ขอบเขต consent การแชร์ข้อมูลสัตว์ข้ามร้าน
- Status: answered
- Raised by: Claude · ADR-0003 · 2026-10-19
- Question: ลูกค้าที่มีบัญชีแพลตฟอร์มแชร์ข้อมูลอะไรให้ร้านที่จองได้บ้าง
- Answer (WoraphonDev · 2026-10-19): แชร์โปรไฟล์สัตว์ + วัคซีน เมื่อจอง หลังลูกค้ายินยอมครั้งแรกต่อร้าน; ประวัติจากร้านอื่นไม่แชร์ → ADR-0003

## Q-0003 · เงินค่าจองผ่าน Marketplace
- Status: answered (out of scope)
- Raised by: Claude · ADR-0005 · 2026-10-19
- Question: Marketplace จะรับเงินแทนร้านหรือไม่
- Answer (WoraphonDev · 2026-10-19): repo นี้พัฒนา **PMS เท่านั้น** — ลูกค้าจ่ายเงินเข้าร้านโดยตรง, รายได้ของเราคือ subscription plan ของร้าน
  Marketplace เป็นโปรเจกต์แยกในอนาคต (เฟสแรกของมันทำหน้าที่ booking เท่านั้น) และเชื่อม PMS ผ่าน Channel API → ADR-0004
- Note (Claude): ไอเดีย "ขาย token ให้ลูกค้าเติมแล้วใช้จ่ายกับหลายร้าน" น่าจะเข้าข่าย **เงินอิเล็กทรอนิกส์ (e-Money)** ตาม พ.ร.บ.ระบบการชำระเงิน พ.ศ. 2560
  ที่ต้องได้รับอนุญาตจาก ธปท. (ข้อยกเว้นมักครอบคลุมเฉพาะใช้กับสินค้า/บริการของผู้ออกเอง) — ต้องปรึกษาผู้เชี่ยวชาญกฎหมายก่อนโปรเจกต์ Marketplace

## Q-0004 · ใครอนุมัติ production deploy และ PR ที่แตะเงิน/สิทธิ์/tenant
- Status: answered
- Raised by: Claude · ADR-0006 · 2026-10-19
- Answer (WoraphonDev · 2026-10-19): มนุษย์อนุมัติ **production release** ทุกครั้ง และ review **เฉพาะ PR ที่เกี่ยวกับเงิน**;
  PR อื่น merge ได้เมื่อ CI ผ่าน + agent อีกตัว review → ADR-0006 (ชดเชยด้าน tenant/สิทธิ์ด้วย gate อัตโนมัติ)

## Q-0005 · limit ของแพ็กเกจ `mvp_free`
- Status: open
- Raised by: Claude · features/foundation.md · 2026-10-19
- Question: ร้านในช่วง MVP ได้กี่สาขา / พนักงานกี่คน
- Options: (ก) 1 สาขา / 5 คน (ข) 3 สาขา / 15 คน (ค) ไม่จำกัด — แนะนำ: (ก) ร้านขนาดเล็กส่วนใหญ่พอ และ platform admin ปรับรายร้านได้
- Answer:

## Q-0006 · พนักงานที่ไม่มี email login อย่างไร
- Status: open
- Raised by: Claude · features/foundation.md · 2026-10-19
- Question: groomer/caretaker บางคนไม่มีหรือไม่ใช้ email
- Options: (ก) email เท่านั้น (ข) username + รหัสผ่านที่ owner ตั้งให้ (ค) LINE Login สำหรับพนักงาน — แนะนำ: (ข) ใน MVP (ไม่มีค่าใช้จ่าย, owner reset รหัสให้ได้) แล้วเพิ่ม (ค) ภายหลัง
- Answer:

## Q-0007 · 2FA ใน MVP
- Status: open
- Raised by: Claude · features/foundation.md · 2026-10-19
- Question: บังคับ 2FA (TOTP) สำหรับ owner และ platform admin ตั้งแต่ MVP หรือไม่
- Options: (ก) บังคับ platform admin, owner เปิดเองได้ (ข) ไม่มีใน MVP (ค) บังคับทั้งคู่ — แนะนำ: (ก)
- Answer:

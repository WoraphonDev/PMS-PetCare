# Spec

spec เป็นสัญญาระหว่างเจ้าของผลิตภัณฑ์กับ agent — ภาษาไทย, identifier ภาษาอังกฤษ

## หลักการ (ต่างจาก PetBooking)

- **เขียนทีละ feature** ให้พอสำหรับการ์ดถัดไป ไม่ล็อกทั้งระบบล่วงหน้า
- 1 feature = 1 ไฟล์ `features/<feature>.md` ที่รวม: เรื่องราวผู้ใช้, ข้อมูล (ตาราง/คอลัมน์), endpoint, หน้าจอ, กฎธุรกิจ, error code, ตัวอย่างทดสอบ
- ทุกหัวข้อที่การ์ดอ้างถึงมี anchor `<a id="…"></a>` เช่น `tbl-booking`, `ep-booking.create`, `scr-pms-booking-list`, `rule-cancel-fee`
- ของที่ใช้ร่วมทุก feature อยู่ไฟล์กลาง: `00-overview.md` (ขอบเขต + คำศัพท์), `glossary.md`, `enum-labels.th.json`

## สถานะ

| ไฟล์ | สถานะ |
|---|---|
| [`00-overview.md`](00-overview.md) | accepted (2026-10-19) |

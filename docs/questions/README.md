# Questions

Agent เขียนคำถามเมื่อ spec/ADR เงียบ ขัดกัน หรือต้องแตะไฟล์นอก `allowed_paths` — แล้วหยุดส่วนนั้นไว้
มนุษย์ตอบใต้คำถาม แล้วเปลี่ยนสถานะเป็น `answered` (ถ้าต้องแก้ spec/ADR ให้ทำในการ์ด `spec` แยก)

**1 คำถาม = 1 ไฟล์** `docs/questions/<card-or-topic>-<nn>.md` เช่น `T-0007-01.md`, `ADR-0006-01.md`
— id มาจากการ์ดของ branch เอง จึงไม่มีสอง branch ที่ได้เลขเดียวกัน และไม่มีไฟล์ร่วมให้ conflict
(`Q-0001` … `Q-0017` คือคำถามเดิมก่อนแยกไฟล์ — ใช้ id เดิมต่อ)

ดูรายการคำถาม: `node scripts/questions-index.mjs` (ทั้งหมด) · `--open` (เฉพาะที่ยังเปิด) · `--check` (ตรวจรูปแบบ — CI รัน)
ไม่มีไฟล์ index ที่ commit ไว้ เพื่อไม่ให้ทุก PR แก้ไฟล์เดียวกัน

## รูปแบบ

```
# T-NNNN-NN · <หัวข้อสั้น>
- Status: open | answered | answered (…) | wontfix
- Raised by: <agent/คน> · T-NNNN · YYYY-MM-DD
- Context: …
- Question: …
- Options: (ก) … (ข) … — แนะนำ: …
- Answer:
```

# Task cards

การ์ด 1 ใบ = งาน 1 ชิ้นที่ agent ทำจบใน 1 PR (< 600 บรรทัดไม่นับ test) ไฟล์ชื่อ `T-NNNN.md` คัดลอกจาก [`_template.md`](_template.md)

## Front matter

| field | ความหมาย |
|---|---|
| `id` | `T-NNNN` (เลขต่อเนื่อง ไม่ใช้ซ้ำ) |
| `title` | สั้น ภาษาอังกฤษ |
| `lane` | `infra` · `db` · `api` · `domain` · `pms-web` · `liff` · `test` · `spec` · `release` |
| `size` | `S` (≤ 1 ชม.) · `M` · `L` (ต้องเขียนแผนใน PR ก่อนเขียนโค้ด) |
| `owner` | `agent` · `human` (agent ห้ามเปิด PR ให้การ์ด human) |
| `depends_on` | การ์ดที่ต้อง merge ก่อน |
| `human_review` | `true` เมื่อแตะเงิน (ราคา, บิล, การชำระ, มัดจำ/คืนเงิน, subscription, รายงานยอดขาย) — ADR-0006 |
| `allowed_paths` | glob ของไฟล์ที่แก้ได้ (`*` = ภายในโฟลเดอร์เดียว, `**` = ลึกได้) |

## กติกา

- การ์ดเขียนโดยมนุษย์ หรือ agent ในการ์ดประเภท `spec` ที่มนุษย์อนุมัติ
- ไฟล์การ์ดเขียนโดยมนุษย์เท่านั้น — agent ห้ามแก้ (แม้แต่ Status log) เพื่อให้มนุษย์แก้การ์ดบน main ได้โดยไม่ conflict กับ branch ที่ทำอยู่
- agent บันทึกความคืบหน้าใน `docs/tasks/log/T-NNNN.md` (ไฟล์ของการ์ดตัวเอง) และเขียนคำถามเป็น `docs/questions/T-NNNN-NN.md`
- `## Status log` ในการ์ดเก่า (T-0001 … T-0031) เป็นประวัติก่อนเปลี่ยนกติกา — คงไว้
- CI ตรวจขอบเขตไฟล์ด้วย `scripts/check-task-scope.mjs` จากชื่อ branch `t-NNNN-slug` — id ต้องเป็นตัวเลข 4 หลักเสมอ (ไม่มีต่อท้ายเช่น `b`) ไม่งั้น scope check จะถูกข้าม
- การ์ด lane `api` ต้องมี `packages/contracts/src/<module>/**` ใน `allowed_paths` เสมอ (Q-0011)
- ผู้เขียนการ์ดประเมินขนาดโค้ด (ไม่นับ test) ให้ < 600 บรรทัด จากจำนวน endpoint / ตาราง / หน้าจอ (Q-0012)

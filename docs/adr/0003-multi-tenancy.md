# ADR-0003 — Multi-tenancy

- **Status:** Accepted
- **Date:** 2026-10-19

## Context

SaaS ที่หลายร้านใช้ระบบเดียว ร้านอาจมีหลายสาขา พนักงานอาจอยู่หลายร้าน
ลูกค้า (เจ้าของสัตว์) อาจใช้หลายร้าน และในอนาคตจองผ่าน LINE/LIFF หรือ channel ภายนอก

## Decision

### รูปแบบการแยกข้อมูล

- **Shared database, shared schema** — ทุกตารางของร้านมีคอลัมน์ `org_id` (และ `branch_id` เมื่อข้อมูลเป็นของสาขา)
- **สองชั้นป้องกัน:**
  1. application: repository ทุกตัวรับ `TenantContext` และเติม `org_id` ให้เสมอ (ห้าม query ตารางของร้านโดยไม่ผ่าน helper นี้)
  2. database: **Postgres Row-Level Security** — ทุก request ตั้ง `SET LOCAL app.org_id = …` ใน transaction; policy บังคับ `org_id = current_setting('app.org_id')`
- role ของแอปเป็น non-superuser ที่ไม่มี `BYPASSRLS`; งานข้ามร้าน (platform admin, Marketplace read model) ใช้ role/connection แยกและเขียน `audit_log`
- ทดสอบทุก endpoint: เข้าถึงข้อมูลร้านอื่น → `NOT_FOUND`

### ลำดับชั้น

```
platform
 └─ organization   (บริษัท/แบรนด์ — หน่วยคิดเงิน subscription)
     └─ branch     (สาขา — หน่วยที่มีห้อง/คิว/พนักงาน/LINE OA)
```

ทุกร้านมีอย่างน้อย 1 branch ตั้งแต่สมัคร แม้จะมีสาขาเดียว

### ผู้ใช้

- `user` — บัญชีระดับแพลตฟอร์ม (Better Auth) สำหรับพนักงาน และลูกค้าที่ login (LINE Login ในเฟส LIFF)
- `membership(user, org, role)` + การจำกัดสาขา — พนักงานอยู่ได้หลายร้าน/หลายบทบาท
- `customer` — โปรไฟล์ลูกค้า **ต่อร้าน** (`org_id`) มี `user_id` แบบ nullable
  - ร้านสร้างลูกค้า walk-in ได้โดยไม่ต้องมีบัญชี
  - เมื่อลูกค้าผูก LINE / login จะผูก `customer` ของร้านนั้นเข้ากับ `user` ของเขา
- **การแชร์ข้อมูลข้ามร้าน (Q-0002):** เมื่อลูกค้าที่มีบัญชีจองร้านใด ร้านนั้นเห็น **โปรไฟล์สัตว์ + วัคซีน** ที่ลูกค้าเก็บไว้ในบัญชี
  หลังลูกค้ากดยินยอมครั้งแรกต่อร้าน (`consent(user, org, scope, granted_at, revoked_at)`) — ประวัติการใช้บริการของร้านอื่นไม่แชร์

### Tenant ของ request

- PMS web: จาก session + org ที่เลือก (header `X-Org-Id` ตรวจกับ membership)
- LIFF: จาก LIFF ID → branch → org
- Channel API: จาก credential ของ channel ที่ผูกกับร้าน (ADR-0004)

## Consequences

- เพิ่มร้านใหม่ = insert แถว ไม่ต้องสร้าง DB/schema
- RLS ทำให้ทุก query ต้องอยู่ใน transaction ที่ตั้ง `app.org_id` — helper ต้องบังคับเรื่องนี้
- ร้านขนาดใหญ่มากในอนาคตย้ายไป DB แยกได้ เพราะทุกแถวมี `org_id`
- export/ลบข้อมูลรายร้าน (PDPA, ยกเลิกบริการ) ทำได้ด้วย `org_id`
- **ทุก endpoint ต้องมี test "ข้อมูลของ org อื่น → NOT_FOUND"** และ CI มี test ตรวจว่าทุกตารางที่มี `org_id` เปิด RLS —
  เป็นการชดเชยที่ PR ด้าน tenant ไม่บังคับให้มนุษย์ review (ADR-0006)

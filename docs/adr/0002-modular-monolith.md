# ADR-0002 — Modular monolith + monorepo layout

- **Status:** Accepted
- **Date:** 2026-10-19

## Context

PMS มีหลายโดเมน (ลูกค้า/สัตว์, grooming, ห้องพัก/daycare, การชำระเงิน, subscription, แจ้งเตือน, LINE, Channel API)
การเริ่มด้วย microservices แพงเกินไป แต่ต้องแยกขอบเขตชัดตั้งแต่วันแรกเพื่อแยก service ได้ภายหลัง

## Decision

**Deploy เป็น API ตัวเดียว (`apps/api`) แต่แบ่งเป็น NestJS module ตามโดเมน** มีกฎขอบเขตเข้มงวด

```
apps/
  api/          NestJS (process `api` + process `worker` จาก codebase เดียว)
  pms-web/      React + Vite PWA (เจ้าของร้าน/พนักงาน + platform admin)
  liff/         React + Vite (เฟสถัดไป)
packages/
  contracts/    zod schemas + endpoint definitions
  domain/       กฎธุรกิจล้วน (ราคา, ช่วงเวลา/ห้องว่าง, นโยบายยกเลิก, เงิน) — ไม่มี I/O, ไม่ import package ภายใน
  db/           Drizzle schema + migrations (โฟลเดอร์ตาม module เจ้าของตาราง)
  api-client/   typed client จาก contracts (ใช้โดย pms-web, liff)
  ui/           shadcn components ที่ใช้ร่วม
  config/       tsconfig / biome presets
```

### Modules ใน `apps/api`

| module | เป็นเจ้าของ |
|---|---|
| `identity` | user, session, การ login (Better Auth) |
| `org` | organization, branch, membership, role, ตั้งค่าร้าน (เวลาเปิด, วันหยุด) |
| `customer` | ลูกค้า, สัตว์เลี้ยง, วัคซีน, consent |
| `catalog` | บริการ, ราคาตามขนาด/สายพันธุ์/ขน, แพ็กเกจ |
| `grooming` | นัดหมาย grooming, ตาราง groomer, สถานะงาน, รูปก่อน-หลัง |
| `lodging` | ห้อง/ความจุ, hotel stay, daycare, check-in/out, บันทึกการดูแล |
| `sales` | บิล, มัดจำ, บันทึกการชำระ, PromptPay QR, ใบเสร็จ |
| `report` | รายงานยอดขาย/การใช้งาน (อ่านอย่างเดียว) |
| `subscription` | plan, subscription ของร้าน, usage, โควตา |
| `notification` | เลือกช่องทาง + template + คิวส่ง |
| `line` | LINE OA ต่อ branch, webhook, การผูกบัญชีลูกค้า |
| `channel` | Channel API ให้ OTA ภายนอก (ADR-0004) |
| `audit` | audit_log |
| `platform` | platform admin (จัดการร้าน/แพ็กเกจ) |

### กฎขอบเขต

1. module เรียก module อื่น **ผ่าน public service ที่ export จาก `index.ts` เท่านั้น** — ห้าม import ไฟล์ภายในหรือ query ตารางของ module อื่น
2. งาน async ข้าม module (เช่น นัดยืนยันแล้ว → แจ้งเตือน, ห้องว่างเปลี่ยน → Channel) ผ่าน **domain event (outbox)**
3. ทุกตารางมี module เจ้าของเดียว
4. ทิศทาง: `apps/*-web` → `api-client`/`contracts`/`ui` · `apps/api` → `db`, `domain`, `contracts` · `domain` → ไม่มี
5. ขอบเขตบังคับด้วย lint rule / architecture test (สร้างในการ์ดแรก ๆ)

## Consequences

- deploy/observe ง่ายในช่วงแรก
- แยก module ที่โหลดสูง (worker, channel) ออกเป็น service ได้โดยเปลี่ยนแค่ transport ของ event

# 01 — Conventions (ชื่อไฟล์แบบกลไก)

ทุกการ์ดอ้างตำแหน่งไฟล์ตามกฎนี้ — agent ไม่ต้องเลือกเอง

## Endpoint key → ไฟล์

endpoint key ในรูป `<module>.<action>` หรือ `<module>.<sub>.<action>` (เช่น `staff.invitation.revoke`)
`<file>` = key ทั้งหมดเป็น kebab-case คั่นด้วย `.` (เช่น `staff.invitation.revoke`)

| ชั้น | path |
|---|---|
| contract (zod request/response) | `packages/contracts/src/<module>/<file>.ts` + export ใน `packages/contracts/src/<module>/index.ts` |
| use case (business logic, 1 ไฟล์ต่อ endpoint) | `apps/api/src/modules/<module>/use-cases/<file>.ts` export `async function <camelKey>(ctx, input)` |
| controller (route บาง ๆ เรียก use case) | `apps/api/src/modules/<module>/<module>.controller.ts` |
| integration test | `apps/api/test/<module>/<file>.test.ts` |
| repository (query ตารางของ module) | `apps/api/src/modules/<module>/<module>.repository.ts` |
| public API ของ module (ให้ module อื่นเรียก) | `apps/api/src/modules/<module>/index.ts` |

`<camelKey>`: `staff.invitation.revoke` → `staffInvitationRevoke`

## Database

| อะไร | path |
|---|---|
| schema ของตาราง | `packages/db/src/schema/<module>/<table>.ts` (ชื่อไฟล์ = ชื่อตาราง snake_case) |
| enum | ไฟล์เดียวกับตารางแรกที่ใช้ |
| migration ที่ generate | `packages/db/migrations/NNNN_<slug>.sql` (+ `meta/`) — ห้ามแก้หลัง merge |
| RLS / constraint ที่ Drizzle ทำไม่ได้ | custom migration ใน `packages/db/migrations/` |

## Web (PMS)

| อะไร | path |
|---|---|
| หน้าจอ | `apps/pms-web/src/routes/<route-path>.tsx` (TanStack Router file-based) |
| ข้อความไทย | `apps/pms-web/src/i18n/th/<screen-id>.json` |
| component ของหน้าจอ | `apps/pms-web/src/features/<module>/` |

## RequestContext (`ctx`)

use case ทุกตัวรับ `ctx` ที่มีอย่างน้อย:
`requestId`, `now: Date` (จาก clock — ห้าม `new Date()` ใน use case), `user` (หรือ null), `org` / `membership` (เมื่อเป็น endpoint ในร้าน), `db` (tenant-scoped ตาม ADR-0003)

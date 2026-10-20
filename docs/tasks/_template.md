---
id: T-NNNN
title: "<short English title>"
lane: api
size: M
owner: agent
depends_on: []
human_review: false
allowed_paths:
  - "apps/api/src/modules/<module>/**"
  - "apps/api/test/<module>/**"
---

# T-NNNN · <title>

## Goal

ผลลัพธ์ที่ผู้ใช้/ระบบได้ใน 1–2 ประโยค

## Read first (อ่านเฉพาะ anchor เหล่านี้)

- `docs/spec/<file>.md#<anchor>`
- `docs/adr/000N-….md` (ถ้าเกี่ยว)

## Deliverables

- `<path>`: `<export / function signature>`

## Tests (เขียนก่อน)

- happy path
- ทุก error code ของ endpoint
- role ที่ไม่มีสิทธิ์ → `FORBIDDEN`
- ข้อมูลของ org อื่น → `NOT_FOUND`

## Dependencies

ไม่มี (ถ้ามี: ชื่อ package + เวอร์ชัน + license)

## Done when

```bash
pnpm --filter <package> test -- <pattern>
pnpm verify
```

## Status log

agent บันทึกใน `docs/tasks/log/T-NNNN.md` (บรรทัดละ `YYYY-MM-DD · <agent> · ทำอะไร · คำถามที่เปิด`) — ห้ามแก้ไฟล์การ์ดนี้

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
- Status: answered
- Raised by: Claude · features/foundation.md · 2026-10-19
- Question: ร้านในช่วง MVP ได้กี่สาขา / พนักงานกี่คน
- Options: (ก) 1 สาขา / 5 คน (ข) 3 สาขา / 15 คน (ค) ไม่จำกัด — แนะนำ: (ก) ร้านขนาดเล็กส่วนใหญ่พอ และ platform admin ปรับรายร้านได้
- Answer (WoraphonDev · 2026-10-19): 1 สาขา / 5 พนักงาน → foundation.md tbl-plan

## Q-0006 · พนักงานที่ไม่มี email login อย่างไร
- Status: answered
- Raised by: Claude · features/foundation.md · 2026-10-19
- Question: groomer/caretaker บางคนไม่มีหรือไม่ใช้ email
- Options: (ก) email เท่านั้น (ข) username + รหัสผ่านที่ owner ตั้งให้ (ค) LINE Login สำหรับพนักงาน — แนะนำ: (ข) ใน MVP (ไม่มีค่าใช้จ่าย, owner reset รหัสให้ได้) แล้วเพิ่ม (ค) ภายหลัง
- Answer (WoraphonDev · 2026-10-19): (ข) บัญชี managed: username + รหัสผ่านที่ owner/manager ตั้ง, บังคับเปลี่ยนรหัสครั้งแรก; LINE Login ภายหลัง → foundation.md F09

## Q-0007 · 2FA ใน MVP
- Status: answered
- Raised by: Claude · features/foundation.md · 2026-10-19
- Question: บังคับ 2FA (TOTP) สำหรับ owner และ platform admin ตั้งแต่ MVP หรือไม่
- Options: (ก) บังคับ platform admin, owner เปิดเองได้ (ข) ไม่มีใน MVP (ค) บังคับทั้งคู่ — แนะนำ: (ก)
- Answer (WoraphonDev · 2026-10-19): (ก) บังคับ platform admin, role อื่นเปิดเองได้ → foundation.md F10

## Q-0008 · turbo กรอง env ของ Testcontainers ออก (Colima ในเครื่อง)
- Status: answered
- Raised by: claude · T-0003 · 2026-10-20
- Context: Turbo 2 (strict env mode) ไม่ส่ง `TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE` ให้ task `test` → `pnpm verify` ในเครื่องที่ใช้ Colima fail (Ryuk mount socket ไม่ได้); CI ไม่กระทบเพราะใช้ `/var/run/docker.sock`. `turbo.json` อยู่นอก allowed_paths ของ T-0003
- Question: เพิ่ม `"globalPassThroughEnv": ["DOCKER_HOST", "TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE", "TESTCONTAINERS_RYUK_DISABLED", "TESTCONTAINERS_HOST_OVERRIDE"]` ใน `turbo.json` ได้ไหม
- Options: (ก) เพิ่มใน PR โครงสร้าง (#4) (ข) ให้ทุกเครื่องทำ symlink `/var/run/docker.sock` แทน — แนะนำ: (ก) passThrough ไม่กระทบ cache key
- Answer (2026-10-20): (ก) — `globalPassThroughEnv` merged in PR #4; `pnpm verify` now passes locally on Colima

## Q-0009 · T-0003 เกิน 400 บรรทัด (502)
- Status: answered
- Raised by: claude · T-0003 · 2026-10-20
- Context: ไม่นับ lockfile / migration ที่ generate / snapshot — โค้ดจริง ~200 บรรทัด, test ~255 (tenancy 9, RLS gate 1, constraints 18), README ~45. ส่วนที่เกินมาจาก test ที่ Codex review รอบ 1–2 ขอ
- Question: รับ PR ขนาดนี้ หรือแยก
- Options: (ก) รับตามนี้ — test อยู่กับ constraint ที่มันตรวจ (ข) แยก `constraints.test.ts` + README เป็น PR ถัดไป — CHECK constraint จะ merge ไปก่อนโดยไม่มี test 1 รอบ — แนะนำ: (ก)
- Answer (2026-10-20): (ก) — PR #5 merged as is

## Q-0010 · T-0002: Dockerfile ต้องมีขั้น build — แยกเป็นการ์ดใหม่
- Status: answered
- Raised by: claude · T-0002 · 2026-10-20
- Context: workspace packages export `./src/*.ts` และ Nest ใช้ decorator metadata → Node รัน TS ตรง ๆ ไม่ได้ (type stripping ไม่รองรับ decorators). Dockerfile จึงต้องมีขั้น build (compile apps/api + packages เป็น JS พร้อม import extension) ซึ่งการ์ดไม่ได้ระบุเครื่องมือ และ T-0002 จะเกิน 400 บรรทัดถ้ารวม
- Question: แยก "Dockerfile + build" เป็นการ์ดใหม่ (เช่น T-0002b) และเลือกเครื่องมือ build
- Options: (ก) `tsdown` (Rolldown, MIT) bundle `apps/api` + workspace packages เป็นไฟล์เดียว (ข) `@swc/cli` compile ทีละไฟล์ + `resolveFully` (ค) `esbuild` (MIT) bundle — แนะนำ: (ก) หรือ (ค) เพราะ bundle workspace packages ได้โดยไม่ต้องให้แต่ละ package มี build ของตัวเอง; ใน T-0002 ทำ docker-compose + `.env.example` แล้ว ส่วน Dockerfile ยังไม่ได้ทำ
- Answer (WoraphonDev · 2026-10-20): (ก) แยกการ์ดใหม่ **T-0031** (Dockerfile + tsdown) — PR #7

## Q-0011 · contract ของ endpoint ที่ไม่มี path ใน allowed_paths
- Status: answered
- Raised by: claude · T-0002 · 2026-10-20
- Context: `01-conventions.md` กำหนด contract ที่ `packages/contracts/src/<module>/<file>.ts` แต่ T-0002 ไม่มี path นี้ใน allowed_paths → `SystemHealthResponse` อยู่ใน use case ชั่วคราว (มี TODO อ้าง Q-0011)
- Question: การ์ด API ต่อจากนี้ให้ใส่ `packages/contracts/src/<module>/**` ใน allowed_paths เสมอ และย้าย health contract ในการ์ดถัดไปที่แตะ contracts
- Options: (ก) ใช่ — ผู้เขียนการ์ดเติม path ให้ทุกการ์ด API (ข) ให้ check-task-scope อนุญาต contracts ของ module เดียวกันอัตโนมัติ — แนะนำ: (ก) ชัดเจนกว่า
- Answer (WoraphonDev · 2026-10-20): (ก) การ์ด lane `api` ต้องมี `packages/contracts/src/<module>/**` ใน allowed_paths — PR #7; health contract ย้ายในการ์ดถัดไปที่แตะ `packages/contracts/src/system/`

## Q-0012 · เกณฑ์ PR < 400 บรรทัด ควรไม่นับ test
- Status: answered
- Raised by: claude · T-0002 · 2026-10-20
- Context: T-0003 (502) และ T-0002 (545, ไม่รวม Dockerfile) เกิน 400 เพราะ test — T-0002: โค้ด ~330, test ~190, compose/config ~30. การนับ test ทำให้เกิดแรงจูงใจเขียน test น้อยลง ขัดกับ golden rule 4
- Question: แก้ AGENTS.md rule 10 เป็น "< 400 changed lines excluding tests, generated migrations/snapshots and lockfile"
- Options: (ก) แก้ตามนี้ (ข) คงเดิม และผู้เขียนการ์ดแบ่งการ์ดให้เล็กลง (ค) คงเดิมแต่เพิ่มเป็น 600 — แนะนำ: (ก) + ผู้เขียนการ์ดประเมินขนาดโค้ดให้ดีขึ้น
- Answer (WoraphonDev · 2026-10-20): (ก) AGENTS.md rule 10: < 400 บรรทัด **ไม่นับ test**, migration ที่ generate, lockfile — PR #7

- Answer:

## Q-0013 · index ของ outbox_event: spec กับ T-0004 ไม่ตรงกัน
- Status: answered
- Raised by: claude · T-0004 · 2026-10-20
- Context: spec `#tbl-outbox_event` = index (`published_at`) where `published_at is null`; การ์ด T-0004 = index (`occurred_at`) where `published_at is null`. ทำตาม spec (สัญญา) ไปก่อน: `outbox_event_unpublished_idx`
- Question: worker จะดึง event ที่ยังไม่ส่ง **ตามลำดับเวลา** (`where published_at is null order by occurred_at limit N`) — index บน `occurred_at` ใช้ได้ทั้งกรองและเรียง ส่วน index บน `published_at` (ค่า null ทั้งหมด) ช่วยแค่กรอง แล้วต้อง sort เพิ่ม
- Options: (ก) แก้ spec เป็น `(occurred_at) where published_at is null` แล้วการ์ด outbox relay (T-0020) เปลี่ยน index ด้วย migration ใหม่ (ข) คงตาม spec — แนะนำ: (ก)
- Answer (WoraphonDev · 2026-10-20): (ก) index `(occurred_at) where published_at is null` — แก้ใน T-0004 (migration ยังไม่ merge) + spec แก้ใน PR #7

## Q-0014 · ตารางที่มี branch_id ควรใช้ composite FK กันอ้างสาขาของร้านอื่น
- Status: answered
- Raised by: claude · T-0004 (Codex review) · 2026-10-20
- Context: FK `branch_id → branch.id` ตรวจแค่ว่าสาขามีอยู่ — RI check ไม่ผ่าน RLS จึงใส่สาขาของร้าน B ในแถวของร้าน A ได้ (ทดสอบแล้ว). T-0004 ใส่ guard ใน helper (`assertBranchOfOrg`) ชั่วคราว เพราะการแก้ระดับ DB ต้องแตะ `branch.ts` ซึ่งอยู่นอก allowed_paths
- Question: ใช้มาตรฐาน "ทุกตารางที่มีทั้ง `org_id` และ `branch_id` ใช้ FK `(org_id, branch_id) → branch(org_id, id)`" ไหม
- Options: (ก) ใช่ — เพิ่ม `unique (org_id, id)` ใน branch + เปลี่ยน FK ของ outbox_event / usage_event ในการ์ดถัดไปที่แตะ db (เช่น T-0005) และเขียนกฎนี้ใน 01-conventions (ข) ใช้ guard ใน application อย่างเดียว — แนะนำ: (ก) เป็นชั้นที่สองตาม ADR-0003
- Answer (WoraphonDev · 2026-10-20): (ก) มาตรฐาน: ทุกตารางที่มี `org_id` + `branch_id` ใช้ FK `(org_id, branch_id) → branch(org_id, id)` — กฎใน 01-conventions (PR #7); ทำใน T-0005 พร้อมเปลี่ยน FK ของ outbox_event / usage_event; guard `assertBranchOfOrg` ใน helper คงไว้

## Q-0015 · `.env.example` ตั้ง `BUILD_SHA=dev` ทับค่าที่ฝังใน image
- Status: open
- Raised by: claude · T-0031 · 2026-10-20
- Context: T-0031 *Done when* รัน image ด้วย `--env-file .env.example` แล้วคาดว่า `/health` ตอบ `version: t0031` แต่ `.env.example` มี `BUILD_SHA=dev` ซึ่ง runtime env ทับ `ENV BUILD_SHA` ของ image → ได้ `dev`. Image ถูกต้อง (ทดสอบด้วย env file ที่ไม่มี `BUILD_SHA` → ได้ `t0031`). `.env.example` อยู่นอก allowed_paths ของ T-0031
- Question: ลบ `BUILD_SHA` ออกจาก `.env.example` (config มี default `dev` อยู่แล้ว) ในการ์ด/PR ถัดไปที่แตะไฟล์นี้
- Options: (ก) ลบออก — ค่าระบุตัว build ควรมาจาก build เท่านั้น (ข) คงไว้และแก้คำสั่ง smoke ของการ์ด — แนะนำ: (ก)
- Answer:

## Q-0016 · T-0007 ต้องแก้ `apps/api/test/config.test.ts` ซึ่งไม่อยู่ใน allowed_paths
- Status: open
- Raised by: claude · T-0007 · 2026-10-20
- Context: การ์ดเพิ่ม `DATABASE_PLATFORM_URL` และ `BETTER_AUTH_SECRET` เป็น key บังคับใน `config.ts` → fixture ใน `config.test.ts` (จาก T-0002) ต้องมี 2 key นี้ ไม่งั้น test เดิมล้ม; การ์ดลืมใส่ path นี้ (ผู้เขียนการ์ดพลาด) — `pnpm verify` ผ่าน แต่ task scope check ไม่ผ่าน
- Question: เพิ่ม `apps/api/test/config.test.ts` ใน allowed_paths ของ T-0007
- Options: (ก) เพิ่ม (PR กระบวนการแยก) (ข) ทำให้ key ใหม่เป็น optional — ไม่ควร เพราะ session secret ต้องบังคับ — แนะนำ: (ก)
- Answer:

## Q-0017 · T-0007 โค้ด 450 บรรทัด (เกิน 400, ไม่นับ test)
- Status: open
- Raised by: claude · T-0007 · 2026-10-20
- Context: identity module ต้องมี Better Auth config, guard, controller, repository, limiter, infra providers, contracts พร้อมกัน — ถ้าแยก `me.get` ออก guard จะไม่มี endpoint ให้ทดสอบ
- Question: รับ PR ขนาดนี้ หรือแยก
- Options: (ก) รับ (ข) แยก infra providers (`common/db.ts`) + config เป็น PR ก่อน — แนะนำ: (ก); ผู้เขียนการ์ดจะแบ่งการ์ด API ต่อจากนี้ให้เล็กลง
- Answer:

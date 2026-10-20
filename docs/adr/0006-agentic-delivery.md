# ADR-0006 — Agentic delivery (Dev · Test · Deploy by AI agents)

- **Status:** Accepted
- **Date:** 2026-10-19

## Context

งานพัฒนา ทดสอบ และ deploy ทั้งหมดทำโดย AI agent (Claude Code, Codex) มนุษย์เป็นเจ้าของผลิตภัณฑ์
และผู้ตัดสินใจ ไม่ใช่ผู้เขียนโค้ดประจำ

ความเสี่ยงหลักของงานที่ agent ทำเอง: แก้นอกขอบเขต, แก้ test ให้ผ่านแทนแก้โค้ด, เดา business rule,
รั่ว secret, ทำลายข้อมูล production และ "ผ่าน CI" แต่ผิด spec
ดังนั้นความปลอดภัยต้องมาจาก **ระบบ** (CI, สิทธิ์, pipeline) ไม่ใช่จากคำสั่งใน prompt อย่างเดียว

## Decision

### 1. แหล่งคำสั่งเดียว

- `AGENTS.md` = กฎของทุก agent (Codex อ่านโดยตรง, `CLAUDE.md` import ด้วย `@AGENTS.md`)
- งานทุกชิ้นเริ่มจาก **การ์ด** `docs/tasks/T-NNNN.md` ที่มี `allowed_paths`, *Read first*, *Done when*
- spec และ ADR (`docs/spec/**`, `docs/adr/**`) เป็น read-only สำหรับ agent ที่ทำการ์ด; การแก้ spec เป็นการ์ดประเภท `spec` ที่มนุษย์อนุมัติ

### 2. บทบาท agent

| บทบาท | ทำอะไร | ห้าม |
|---|---|---|
| **Dev** | ทำการ์ด 1 ใบ = 1 branch = 1 PR, เขียน test ก่อน | แก้นอก `allowed_paths`, merge เอง |
| **Reviewer/Tester** | agent **อีกตัว** (ถ้า Dev เป็น Claude → review ด้วย Codex และกลับกัน) ตรวจ PR เทียบ spec, รัน E2E, เขียน test เพิ่มในการ์ด test แยก | แก้โค้ดใน PR ของคนอื่นตรง ๆ (comment แทน) |
| **Release** | ทำงานผ่าน pipeline เท่านั้น: สร้าง release PR, tag, สั่ง deploy staging, ตรวจ smoke test | ถือ credential ของ production, รันคำสั่งกับ DB production ตรง |

### 2.1 Review loop อัตโนมัติ (เพิ่ม 2026-10-20)

มนุษย์ไม่ต้องส่งต่อข้อความระหว่าง agent: Dev agent เรียก reviewer เอง

1. Dev agent เปิด PR และรอ CI ผ่าน
2. รัน `scripts/codex-review.sh T-NNNN <round>` (Codex CLI `codex exec --sandbox read-only` อ่าน `git diff origin/main...HEAD`) — ผลต้องจบด้วย `VERDICT: CLEAN` หรือ `VERDICT: CHANGES_REQUESTED`
3. โพสต์ผล review ลง PR (ตรวจย้อนหลังได้)
4. แก้ finding P0–P2 หรือตอบเหตุผลที่ไม่เห็นด้วยใน PR → push → review รอบถัดไป
5. สูงสุด 3 รอบ; ไม่จบ / ขัดแย้งกัน / เป็นคำถาม spec → หยุดและถามมนุษย์
6. `CLEAN` + CI ผ่าน → ติด label `agent-approved` (การ์ดที่ไม่ใช่ `human_review`) หรือแจ้งมนุษย์ (การ์ด `human_review`)

### 2.2 Auto-merge (เพิ่ม 2026-10-20 — ตาม Q-0004: มนุษย์ review เฉพาะ PR เรื่องเงิน)

`.github/workflows/auto-merge.yml` ทำงานบน GitHub (ไม่ใช่เครื่อง dev):
- เมื่อติด `agent-approved`: ตรวจเองซ้ำว่า PR มาจาก repo นี้, base = `main`, branch `t-NNNN-*`, การ์ดบน `main` มี `owner: agent` และ `human_review: false`
  → เปิด GitHub auto-merge (squash) ซึ่งยังรอ required check `verify` และ conversation ที่ resolve ครบตาม branch protection
  ไม่ผ่านเงื่อนไข → ถอด label และ comment เหตุผล
- push ใหม่หลังติด label → ถอด label + ยกเลิก auto-merge (commit ใหม่ต้อง review ใหม่)

มนุษย์ merge เอง: การ์ด `human_review: true`, และ PR ที่ไม่ใช่การ์ด (spec / ADR / AGENTS.md / CI / scripts) เพราะเป็นการเปลี่ยนกติกา

ข้อจำกัดที่รู้: merge ด้วย `GITHUB_TOKEN` ไม่ trigger workflow `on: push` ของ `main` — การ์ด pipeline deploy ต้องใช้ `workflow_run` หรือ GitHub App token

ระยะถัดไป (เมื่อ flow นิ่ง): ย้าย review loop ไป GitHub (Codex automatic review + Claude Code GitHub Action) — ต้องมี ADR แก้ไขก่อน

### 3. Gate ที่บังคับด้วยระบบ (ไม่ใช่ด้วยความสมัครใจของ agent)

1. **Branch protection บน `main`:** ต้องผ่าน CI (`verify`), conversation resolve ครบ, ห้าม push ตรง / force-push; cross-agent review เป็น comment (agent ใช้บัญชี GitHub เดียวกับมนุษย์ จึงนับเป็น approval ไม่ได้)
2. **CI (`pnpm verify`):** lint, typecheck, unit + integration test (Postgres จริงผ่าน Testcontainers), contract check, task scope check, license check, ห้าม `.skip/.only` ใหม่, ห้ามแก้ไฟล์ test เดิมให้ assertion อ่อนลงโดยไม่มีการ์ดระบุ
3. **มนุษย์ review เฉพาะการ์ดที่แตะเงิน** (`human_review: true` — ราคา, บิล, การชำระ, มัดจำ/คืนเงิน, subscription, รายงานยอดขาย) — Q-0004
   การ์ดที่แตะสิทธิ์ / tenant / migration ใช้ cross-agent review + gate อัตโนมัติแทน:
   test "org อื่น → NOT_FOUND" ทุก endpoint, test "ทุกตารางที่มี `org_id` เปิด RLS", test สิทธิ์ตาม role, migration lint (ห้าม drop/rename ในขั้นเดียว)
4. **Deploy:**
   - merge เข้า `main` → deploy **staging** อัตโนมัติ → smoke + E2E บน staging
   - **production** = GitHub Environment `production` ที่**มนุษย์กดอนุมัติทุก release** (Q-0004) แล้ว pipeline deploy เอง
   - secret ของ production อยู่ใน GitHub Environment เท่านั้น agent ในเครื่อง dev ไม่มีสิทธิ์เข้าถึง
5. **Migration:** แบบ expand → migrate → contract เท่านั้น (ไม่ drop/rename ในขั้นเดียว), migration ที่ merge แล้วแก้ไม่ได้, backup อัตโนมัติก่อน migrate production
6. **Rollback:** ทุก deploy เป็น image ที่มี tag ตาม commit; rollback = deploy tag ก่อนหน้า (pipeline มีปุ่มเดียว)
7. **Feature flag** สำหรับ feature ที่ยังไม่พร้อม — merge ได้โดยไม่เปิดให้ผู้ใช้เห็น
8. **ลด merge conflict** (เพิ่ม 2026-10-20): ไม่มีไฟล์รวมที่ทุก branch ต่อท้าย — คำถาม 1 ไฟล์ต่อคำถาม (`docs/questions/<card>-NN.md`),
   log ของ agent 1 ไฟล์ต่อการ์ด (`docs/tasks/log/T-NNNN.md`, การ์ดเป็นของมนุษย์อย่างเดียว) — บังคับโดย task scope check;
   CI ตรวจรูปแบบคำถาม (`scripts/questions-index.mjs --check`) และ registry (`schema/index.ts`, `contracts/src/index.ts`, module list ใน `create-app.ts`)
   ต้องเป็น 1 รายการต่อบรรทัด เรียงตามตัวอักษร (`scripts/check-registries.mjs`);
   lockfile / migration ที่ชนกันให้ tool สร้างใหม่ (`scripts/sync-main.sh`) ไม่แก้ด้วยมือ; script ใน `scripts/` มี test (`pnpm test:scripts`)

### 4. Agent ต้องหยุดถาม (เขียน `docs/questions/<card>-NN.md` — 1 คำถาม 1 ไฟล์) เมื่อ

spec เงียบ/ขัดกัน · ต้องแก้ไฟล์นอก `allowed_paths` · test หรือ vector ดูผิด · ต้องเพิ่ม dependency ที่การ์ดไม่ได้ระบุ ·
ต้องแตะ auth / เงิน / tenant ในแบบที่การ์ดไม่ได้บรรยาย

### 5. ขนาดงาน

PR เป้าหมาย < 600 บรรทัด **ไม่นับ test**, migration/snapshot ที่ generate และ lockfile (Q-0012, Q-0017) — ใหญ่กว่านั้นให้เสนอแยกการ์ด

## Consequences

- มนุษย์ใช้เวลาไปกับ: อนุมัติ spec, ตอบคำถามใน `docs/questions/`, review การ์ดเรื่องเงิน, อนุมัติ production release
- ความเสี่ยงด้าน tenant/สิทธิ์ ฝากไว้กับ gate อัตโนมัติ — gate เหล่านี้ต้องสร้างในการ์ดแรก ๆ ก่อน feature ใด ๆ
- CI ต้องเร็วและเชื่อถือได้ — test ที่ flaky ต้องแก้ทันที (มันคือ gate ของทั้งระบบ)
- spec ทำทีละ feature ให้พอสำหรับการ์ดถัดไป ไม่ล็อกทั้งระบบล่วงหน้า (บทเรียนจาก PetBooking ที่ `questions.md` ยาว 1,500+ บรรทัด)

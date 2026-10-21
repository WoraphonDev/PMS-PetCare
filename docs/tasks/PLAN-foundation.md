# Plan — Foundation

แผนแตกการ์ดของ `docs/spec/features/foundation.md` · การ์ดที่มีไฟล์แล้ว = มีรายละเอียด scope; พร้อมทำเมื่อ dependencies/spec merge และ technical gates ของใบนั้นผ่านแล้ว · ที่เหลือจะเขียนละเอียดเมื่อ wave ก่อนหน้า merge
(เพื่อให้การ์ดอ้างโครงไฟล์จริง ไม่ใช่โครงที่เดาไว้)

## Wave 1 — โครงพื้นฐาน (พร้อมทำ)

| card | งาน | depends | ทำขนานได้กับ |
|---|---|---|---|
| [T-0001](T-0001.md) | packages: config, domain (clock), contracts (error envelope) | — | — |
| [T-0002](T-0002.md) | `apps/api` skeleton: Nest + Fastify, config, error filter, health, docker-compose | T-0001 | T-0003 |
| [T-0003](T-0003.md) | `packages/db`: Drizzle, organization/branch, **RLS + test harness + RLS coverage gate** | T-0001 | T-0002 |
| [T-0004](T-0004.md) | audit_log / outbox_event / usage_event + helpers | T-0003 | T-0031 |
| [T-0031](T-0031.md) | Docker image ของ `apps/api`: tsdown bundle + Dockerfile (แยกจาก T-0002 ตาม Q-0010) | T-0002 | T-0004 |

T-0002 กับ T-0003 แก้ `pnpm-lock.yaml` ทั้งคู่ — ใบที่ merge ทีหลังให้ rebase แล้ว `pnpm install` ใหม่

## Wave 2 — identity + tenant context (การ์ดพร้อมทำ)

| card | งาน | depends | human_review |
|---|---|---|---|
| [T-0005](T-0005.md) | ตาราง identity (Better Auth schema, id = uuid) + FK `audit_log.actor_user_id` | T-0004 | |
| [T-0006](T-0006.md) | ตาราง org ที่เหลือ + plan/subscription + seed `mvp_free` + composite branch FK (Q-0014) | T-0005 | ✓ (ราคาแพ็กเกจ) |
| [T-0007](T-0007.md) | identity module: Better Auth, `auth.login` (email/username), `auth.logout`, `me.get`, rate limit (F11) | T-0002, T-0006 | |
| [T-0008](T-0008.md) | `EmailSender` + `auth.passwordForgot` / `auth.passwordReset` / `auth.passwordChange` (F11) | T-0007 | |
| [T-0009](T-0009.md) | RequestContext + guards: org membership, permissions, branch scope, `ORG_SUSPENDED`, `PASSWORD_CHANGE_REQUIRED`, `seedOrg()` | T-0007 | |
| [T-0010](T-0010.md) | 2FA (F10) + platform admin guard | T-0009 | |

T-0008 กับ T-0009 ทำขนานกันได้

## Wave 3 — org / staff API

| card | งาน | human_review |
|---|---|---|
| [T-0011](T-0011.md) | `auth.signup` atomic + verify-first; depends T-0034, T-0035, T-0036, T-0037 | ✓ |
| [T-0038](T-0038.md) | `branch.version` column (aggregate version for branch outbox events) | |
| [T-0012](T-0012.md) | `org.get`, `org.update`, `branch.list`, `branch.create` (F05), `branch.update`; depends T-0038 | |
| [T-0013](T-0013.md) | `branch.hours.put`, `branch.closure.*`; proposed §12 contracts/card — human merge before implementation | |
| T-0014 | `branch.paymentSettings.update` (F08) | ✓ |
| T-0015 | `staff.list`, `staff.invite`, `staff.invitation.revoke`, `invitation.accept` (F03) | |
| T-0016 | `staff.account.create`, `staff.password.reset` (F09) | |
| T-0017 | `staff.update`, `staff.remove` (F01, F02) | |
| T-0018 | `audit.list`, `subscription.get` | |
| T-0019 | `platform.org.list` / `get` / `setStatus` | |
| T-0020 | `platform.org.setPlan` | ✓ |
| T-0021 | outbox relay worker (BullMQ/Valkey) + dead-letter + lag metric | |

## Wave 4 — PMS web

| card | งาน |
|---|---|
| T-0022 | `apps/pms-web` skeleton: Vite + React + TanStack Router/Query + Tailwind/shadcn + PWA + i18n th · `packages/api-client` |
| T-0023 | auth screens + `/verify-email` fragment → clear history → POST JSON; resend/recovery/invalid/expired/replaced; 201 ไม่อ้าง confirmed delivery; depends T-0022, T-0011, T-0035, T-0036; release gate signup |
| T-0024 | app shell: org/branch switcher, nav ตามสิทธิ์, แถบร้านถูกระงับ |
| T-0025 | settings: org, branches, branch (ข้อมูล/เวลา/วันหยุด/การชำระเงิน) |
| T-0026 | staff: list, invite, create account, reset password, edit/remove, invite accept |
| T-0027 | audit, subscription, account security |
| T-0028 | platform admin screens |
| T-0029 | Playwright E2E: signup → verify email → login owner → เชิญพนักงาน → login พนักงาน → ตั้งค่าสาขา |

## Wave 5 — deploy (สร้างร่วมกับมนุษย์: secrets/โฮสต์)

| card | งาน | owner |
|---|---|---|
| T-0030 | เลือกโฮสต์ staging/production (ADR ใหม่) | human |
| T-0032 | pipeline: build image → staging อัตโนมัติ → production ผ่าน environment approval, migration + backup, rollback | human + agent |


## Wave 2.5 — approved signup prerequisites (proposed cards, not implemented)

| card | งาน | depends | human_review |
|---|---|---|---|
| [T-0033](T-0033.md) | persistent verification state + nonce/signing feasibility gate + transaction-bound API | T-0010 | |
| [T-0034](T-0034.md) | existing-tx tenant helper + org/free-subscription public bootstrap services | T-0010 | ✓ |
| [T-0037](T-0037.md) | atomic signup/resend counters + trusted IP | T-0010 | |
| [T-0035](T-0035.md) | verify/resend HTTP + post-commit email | T-0033, T-0037 | |
| [T-0036](T-0036.md) | verified real-email login / managed exception | T-0033, T-0035 | |

ลำดับแนะนำ: T-0033 (เริ่มด้วย isolated pinned token-signing/nonce probe) → T-0037 → T-0035 → T-0036; T-0034 ทำขนานได้หลัง spec merge แล้วจึง T-0011. identity files ทับกันจึงไม่ควรทำ T-0033/35/36/37 ขนานกัน. T-0012 และเลข T-0012…T-0032 คงเดิม; T-0032 เป็น reserved deploy plan แม้ยังไม่มี card file
ทุก PR <600 non-test changed LOC; spec/cards ชุดนี้ต้อง human-reviewed merge ก่อน implementation; ไม่ใช่ user-ready release จน T-0023/T-0029 ผ่าน

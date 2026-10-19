# Plan — Foundation

แผนแตกการ์ดของ `docs/spec/features/foundation.md` · การ์ดที่มีไฟล์แล้ว = พร้อมทำ · ที่เหลือจะเขียนละเอียดเมื่อ wave ก่อนหน้า merge
(เพื่อให้การ์ดอ้างโครงไฟล์จริง ไม่ใช่โครงที่เดาไว้)

## Wave 1 — โครงพื้นฐาน (พร้อมทำ)

| card | งาน | depends | ทำขนานได้กับ |
|---|---|---|---|
| [T-0001](T-0001.md) | packages: config, domain (clock), contracts (error envelope) | — | — |
| [T-0002](T-0002.md) | `apps/api` skeleton: Nest + Fastify, config, error filter, health, docker-compose | T-0001 | T-0003 |
| [T-0003](T-0003.md) | `packages/db`: Drizzle, organization/branch, **RLS + test harness + RLS coverage gate** | T-0001 | T-0002 |
| [T-0004](T-0004.md) | audit_log / outbox_event / usage_event + helpers | T-0003 | — |

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
| T-0011 | `auth.signup` (transaction เดียว: user + org + branch + hours + owner + subscription) | |
| T-0012 | `org.get`, `org.update`, `branch.list`, `branch.create` (F05), `branch.update` | |
| T-0013 | `branch.hours.put`, `branch.closure.*` | |
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
| T-0023 | auth screens: signup, login, 2FA, forgot/reset, change password |
| T-0024 | app shell: org/branch switcher, nav ตามสิทธิ์, แถบร้านถูกระงับ |
| T-0025 | settings: org, branches, branch (ข้อมูล/เวลา/วันหยุด/การชำระเงิน) |
| T-0026 | staff: list, invite, create account, reset password, edit/remove, invite accept |
| T-0027 | audit, subscription, account security |
| T-0028 | platform admin screens |
| T-0029 | Playwright E2E: signup → เชิญพนักงาน → login พนักงาน → ตั้งค่าสาขา |

## Wave 5 — deploy (สร้างร่วมกับมนุษย์: secrets/โฮสต์)

| card | งาน | owner |
|---|---|---|
| T-0030 | เลือกโฮสต์ staging/production (ADR ใหม่) | human |
| T-0032 | pipeline: build image → staging อัตโนมัติ → production ผ่าน environment approval, migration + backup, rollback | human + agent |

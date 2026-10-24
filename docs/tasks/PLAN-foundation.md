# Plan — Foundation

> **Historical roadmap, not a live registry.** Do not append new cards or completion ticks here. Use `node scripts/plan-index.mjs` for the current dependency index generated from individual cards; validate with `node scripts/plan-index.mjs --check`. It does not infer completion/readiness from commit messages. New card = one `T-NNNN.md`, decisions = its question/amendment files. Retain this roadmap for historical context and existing links.

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
| [T-0039](T-0039.md) | per-test timeouts for multi-step 2FA tests (CI flake on main, T-0013-02); test only — merge before T-0013 | |
| [T-0013](T-0013.md) | `branch.hours.put`, `branch.closure.*`; proposed §12 contracts/card — human merge before implementation | |
| [T-0040](T-0040.md) | DELETE bodies without Content-Type reach the route (T-0013-01); depends T-0013 | |
| [T-0041](T-0041.md) | test DB teardown waits for pool clients to close (CI `57P01` unhandled-error flake); test only | |
| [T-0014](T-0014.md) | `branch.paymentSettings.update` (F08) — spec §13; T-0014-01…04 answered (02: check-digit formula is a human-approved PMS policy); human merge of card + §13 before implementation | ✓ |
| [T-0015](T-0015.md) | `staff.list` (F02 branch-scoped), `staff.invite` + re-invite, `staff.invitation.revoke` (F03, F05) + shared pieces (seat count/locks, token, email, identity read API) — spec §14; T-0015-01…07 answered; human merge of card + §14 before implementation | |
| [T-0042](T-0042.md) | `invitation.accept` for logged-in users with a verified email (§14 #contract-invitation-accept) + all accept races; depends T-0015 | |
| [T-0044](T-0044.md) | follow-up of T-0015-06 (number assigned by Zo 2026-10-24): `invitation.preview` + invite-bound signup (user only, no new shop — #rule-invite-signup-followup); T-0044-01, -02 answered (A); spec §19 in PR #66 (human merge first) — never `auth.signup` as a workaround; depends T-0042 | |
| [T-0049](T-0049.md) | `branch.hours.get` (`GET /branches/{branchId}/hours`) for the hours tab — T-0046-01 (A), number assigned 2026-10-24; spec §19 in PR #66; depends T-0013 | |
| [T-0016](T-0016.md) | `staff.account.create`, `staff.password.reset` (F09) — spec §15; T-0016-01…05 answered; human merge of card + §15 before implementation; depends T-0015 | |
| [T-0017](T-0017.md) | `staff.update`, `staff.remove` (F01, F02, F09) — spec §16; T-0017-01…03 answered; caller re-check (#rule-staff-caller-recheck) approved; depends T-0015 (+ §15 roles) | |
| [T-0018](T-0018.md) | `audit.list`, `subscription.get` + `audit_log` index migration — spec §17; T-0018-01…03 answered; depends T-0015 | |
| [T-0019](T-0019.md) | `platform.org.list` / `get` (audit `platform.org_viewed`) / `setStatus` — new `platform` module; spec §18; T-0019-01…04 answered; depends T-0010, T-0015, T-0018 | |
| [T-0020](T-0020.md) | `platform.org.setPlan` + `platform.plan.list` — spec §18; depends T-0019 | ✓ |
| [T-0021](T-0021.md) | outbox relay worker (BullMQ/Valkey) + dead-letter + lag report; T-0021-01…04 answered (A); human merge of the ADR-0003 audit-exemption amendment (T-0021-04) and the card before implementation | |

## Wave 4 — PMS web

| card | งาน |
|---|---|
| [T-0043](T-0043.md) | `packages/api-client` (typed fetch client, `me.get`) + `packages/ui` (`cn`, `Button`) — split out of T-0022 (T-0022-03 A); depends T-0001, T-0007; **merge before T-0022** |
| [T-0022](T-0022.md) | `apps/pms-web` app skeleton: Vite + React + TanStack Router/Query + Tailwind + PWA (API bypass, update prompt) + typed i18n th; T-0022-01…03 answered (A); depends T-0043 |
| [T-0023](T-0023.md) | signup + `/verify-email` fragment → clear history → POST JSON; resend/invalid/network states; login; shared form errors + error copy; 201 ไม่อ้าง confirmed delivery; depends T-0022, T-0011, T-0035, T-0036; **release gate signup** |
| [T-0045](T-0045.md) | 2FA challenge, forced password change, forgot / reset password (split from T-0023); depends T-0023 |
| [T-0024](T-0024.md) | app shell: session guard, org/branch switcher, nav ตามสิทธิ์, แถบร้านถูกระงับ, logout; T-0024-01 answered (A): web imports `@app/domain` — ADR-0002 amendment in PR #66 (human merge first); depends T-0023, T-0045 |
| [T-0025](T-0025.md) | settings: org, branch list + create, branch detail (info tab); depends T-0024 |
| [T-0046](T-0046.md) | branch hours / closures / payment tabs (split from T-0025); T-0046-01 answered (A): hours read via T-0049; human_review ✓ (PromptPay); depends T-0025, T-0049 |
| [T-0026](T-0026.md) | staff: list, invite, revoke, create managed account; depends T-0025 |
| [T-0047](T-0047.md) | staff edit / remove / reset password + `/invite#token=` accept incl. sign-up (split from T-0026); depends T-0026, T-0042, **T-0044** |
| [T-0027](T-0027.md) | audit, subscription; human_review ✓ (price); depends T-0026 (reuses its `staff.list` and T-0025's `subscription.get`) |
| [T-0048](T-0048.md) | account security: change password, 2FA enable (QR + backup codes) / disable (split from T-0027); depends T-0024, T-0045 |
| [T-0028](T-0028.md) | platform admin screens; human_review ✓ (plan change); depends T-0024, T-0027, T-0048 |
| [T-0029](T-0029.md) | Playwright E2E: signup → verify email → login owner → เชิญพนักงาน → พนักงานสมัครจากคำเชิญ + login → ตั้งค่าสาขา; T-0029-01 answered (A): runs locally, result in the PR, CI job added by a human later; depends T-0023…T-0026, T-0044, T-0047 |

T-0045…T-0048 were split out of T-0023 / T-0025 / T-0026 / T-0027 to stay under 600 lines; numbers assigned by Zo on 2026-10-24.
Suggested order: T-0043 → T-0022 → T-0023 → T-0045 → T-0024 → T-0025 → T-0026 → T-0027 → T-0028. In parallel once their dependencies merge: T-0048 (after T-0024 + T-0045), T-0049 (API, after PR #66) → T-0046 (after T-0025 + T-0049), T-0044 (API, after PR #66) → T-0047 (after T-0026 + T-0044). T-0029 last.

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

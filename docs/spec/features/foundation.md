# Feature — Foundation

> สถานะ: **accepted** (PR #1, 2026-10-19) · ADR ที่เกี่ยว: 0002, 0003, 0004, 0005, 0006
> ครอบคลุม: สมัครร้าน, login, organization/branch, พนักงาน+บทบาท, ตั้งค่าร้าน/สาขา, subscription (manual), audit log, outbox, platform admin

## 1. User stories

| id | ในฐานะ | ฉันต้องการ | เพื่อ |
|---|---|---|---|
| US-F01 | เจ้าของร้าน | สมัครและสร้างร้านพร้อมสาขาแรก | เริ่มใช้ระบบได้ทันที |
| US-F02 | พนักงาน | login ด้วย email หรือ username / logout / ลืมรหัสผ่าน | เข้าใช้งานอย่างปลอดภัย |
| US-F02b | owner / manager | สร้างบัญชีให้พนักงานที่ไม่มี email และตั้ง/รีเซ็ตรหัสผ่านให้ | พนักงานทุกคนมีบัญชีของตัวเอง (audit ได้) |
| US-F02c | owner | เปิด 2FA ให้บัญชีตัวเอง | ป้องกันบัญชีที่มีสิทธิ์สูง |
| US-F03 | owner / manager | เชิญพนักงานและกำหนดบทบาท/สาขา | แต่ละคนเห็นและทำเฉพาะงานของตัวเอง |
| US-F04 | owner | ตั้งค่าร้าน (ชื่อ, โลโก้, ข้อมูลใบเสร็จ) | ข้อมูลร้านถูกต้องบนเอกสาร |
| US-F05 | owner / manager | ตั้งค่าสาขา (ที่อยู่, เวลาเปิด-ปิด, วันหยุด, PromptPay) | ระบบจองและการชำระใช้ข้อมูลที่ถูกต้อง |
| US-F06 | พนักงานที่อยู่หลายร้าน | สลับร้าน/สาขา | ใช้บัญชีเดียว |
| US-F07 | owner | ดู audit log | ตรวจสอบย้อนหลังว่าใครทำอะไร |
| US-F08 | platform admin | ดูรายชื่อร้าน, เปลี่ยนแพ็กเกจ, ระงับ/เปิดร้าน | บริหาร subscription ช่วง MVP ด้วยมือ |

## 2. บทบาทและสิทธิ์

<a id="roles"></a>

| role | ขอบเขต | label (th) |
|---|---|---|
| `owner` | ทั้ง org | เจ้าของร้าน |
| `manager` | ทั้ง org | ผู้จัดการ |
| `front_desk` | สาขาที่ได้รับมอบหมาย | พนักงานหน้าร้าน |
| `groomer` | สาขาที่ได้รับมอบหมาย | ช่างตัดขน |
| `caretaker` | สาขาที่ได้รับมอบหมาย | พนักงานดูแลสัตว์ |

ผู้ใช้หนึ่งคนมี **1 role ต่อ org** · role `front_desk` / `groomer` / `caretaker` ต้องมีสาขาอย่างน้อย 1 สาขา

<a id="permissions"></a>
### สิทธิ์ของ feature นี้ (feature อื่นเพิ่มแถวของตัวเอง)

| permission | owner | manager | front_desk | groomer | caretaker |
|---|:-:|:-:|:-:|:-:|:-:|
| `org.settings.read` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `org.settings.update` | ✓ | | | | |
| `branch.create` | ✓ | | | | |
| `branch.update` (ข้อมูล, เวลาเปิด, วันหยุด) | ✓ | ✓ | | | |
| `branch.payment_settings.update` (PromptPay) | ✓ | | | | |
| `staff.read` | ✓ | ✓ | ✓ | | |
| `staff.invite` / `staff.update` / `staff.remove` | ✓ | ✓¹ | | | |
| `audit.read` | ✓ | | | | |
| `subscription.read` | ✓ | ✓ | | | |

¹ manager จัดการ `owner` และ `manager` คนอื่นไม่ได้ และตั้งใครเป็น `owner`/`manager` ไม่ได้

Platform admin ไม่ใช่ role ใน org — เป็น flag `user.is_platform_admin` ใช้ได้เฉพาะ endpoint กลุ่ม `platform.*`

## 3. ข้อมูล

ทุกตารางมี `id uuid pk default gen_random_uuid()`, `created_at timestamptz not null default now()`, `updated_at timestamptz not null default now()` (ยกเว้นระบุ)
ตารางที่มี `org_id` → เปิด RLS ตาม ADR-0003

<a id="tbl-organization"></a>
### `organization` (module `org`)

| column | type | null | หมายเหตุ |
|---|---|---|---|
| `slug` | text | no | unique, `^[a-z0-9-]{3,40}$` |
| `display_name` | text | no | 1–100 ตัวอักษร |
| `legal_name` | text | yes | ชื่อนิติบุคคล/ร้านบนใบเสร็จ |
| `tax_id` | text | yes | 13 หลัก |
| `phone` | text | yes | |
| `logo_file_id` | uuid | yes | อ้างไฟล์ใน storage (feature files) |
| `receipt_footer` | text | yes | ≤ 500 ตัวอักษร |
| `status` | enum `org_status` | no | `active` · `suspended` — default `active` |

<a id="tbl-branch"></a>
### `branch` (module `org`)

| column | type | null | หมายเหตุ |
|---|---|---|---|
| `org_id` | uuid fk | no | |
| `name` | text | no | unique ต่อ org |
| `address` | text | yes | |
| `phone` | text | yes | |
| `latitude` / `longitude` | numeric(9,6) | yes | |
| `timezone` | text | no | MVP = `Asia/Bangkok` เท่านั้น |
| `promptpay_id` | text | yes | เบอร์มือถือ 10 หลัก หรือเลขผู้เสียภาษี 13 หลัก |
| `is_active` | boolean | no | default true |
| `version` | int | no | default 1, `>= 1` · aggregate version ของ outbox — ดู #rule-branch-version (T-0038) |

<a id="tbl-branch_hours"></a>
### `branch_hours` (module `org`)

| column | type | null | หมายเหตุ |
|---|---|---|---|
| `org_id`, `branch_id` | uuid fk | no | |
| `weekday` | smallint | no | 1 = จันทร์ … 7 = อาทิตย์ (ISO) |
| `opens_at` / `closes_at` | time | yes | null ทั้งคู่ = ปิดทั้งวัน; ถ้ามีต้อง `opens_at < closes_at` |

unique (`branch_id`, `weekday`) · สร้างครบ 7 แถวพร้อมสาขา (default 09:00–18:00 ทุกวัน)

<a id="tbl-branch_closure"></a>
### `branch_closure` (module `org`)

| column | type | null | หมายเหตุ |
|---|---|---|---|
| `org_id`, `branch_id` | uuid fk | no | |
| `start_date` / `end_date` | date | no | local date, `start_date <= end_date` |
| `reason` | text | yes | |

<a id="tbl-membership"></a>
### `membership` (module `org`)

| column | type | null | หมายเหตุ |
|---|---|---|---|
| `org_id` | uuid fk | no | |
| `user_id` | uuid fk | no | unique (`org_id`, `user_id`) |
| `role` | enum `staff_role` | no | ดู §2 |
| `display_name` | text | no | ชื่อที่แสดงในร้าน |
| `status` | enum `membership_status` | no | `active` · `removed` |

<a id="tbl-membership_branch"></a>
### `membership_branch` (module `org`)

`org_id`, `membership_id`, `branch_id` — pk (`membership_id`, `branch_id`); ไม่มี `updated_at`

<a id="tbl-invitation"></a>
### `invitation` (module `org`)

| column | type | null | หมายเหตุ |
|---|---|---|---|
| `org_id` | uuid fk | no | |
| `email` | citext | no | |
| `role` | enum `staff_role` | no | |
| `branch_ids` | uuid[] | no | ว่างได้เมื่อ role เป็น owner/manager |
| `token_hash` | text | no | เก็บ hash (SHA-256) ของ token เท่านั้น |
| `expires_at` | timestamptz | no | สร้าง + 7 วัน |
| `accepted_at` / `revoked_at` | timestamptz | yes | |
| `invited_by_user_id` | uuid fk | no | |

<a id="tbl-identity"></a>
### ตารางของ Better Auth (module `identity`)

`user`, `session`, `account`, `verification` ตาม schema ของ Better Auth (สร้างเป็น Drizzle schema + migration ของเรา)
เพิ่มตารางของ plugin: `two_factor` (TOTP + backup codes), และฟิลด์ของ plugin `username`
ตารางเหล่านี้ **ไม่มี** `org_id` และไม่เปิด RLS — เข้าถึงผ่าน module `identity` เท่านั้น

คอลัมน์เพิ่มใน `user`:

| column | type | null | หมายเหตุ |
|---|---|---|---|
| `is_platform_admin` | boolean | no | default false |
| `username` | citext | yes | unique ทั้งแพลตฟอร์ม, `^[a-z0-9._-]{3,40}$` |
| `is_managed` | boolean | no | default false · true = บัญชีที่ร้านสร้างให้ (ไม่มี email จริง) — ดู F09 |
| `managed_by_org_id` | uuid | yes | ต้องมีค่าเมื่อ `is_managed` |
| `must_change_password` | boolean | no | default false |
| `two_factor_enabled` | boolean | no | จาก plugin `twoFactor` |

ถ้า Better Auth บังคับ `email` not null: บัญชี managed เก็บ email ภายในรูปแบบ `<user_id>@managed.invalid`
ซึ่ง **ห้ามส่งอีเมลไปและห้ามแสดงใน UI** (ถ้าทำแบบนี้ไม่ได้ → เขียน `docs/questions.md`)

<a id="tbl-plan"></a>
### `plan` (module `subscription`) — ไม่มี `org_id`

| column | type | null | หมายเหตุ |
|---|---|---|---|
| `code` | text | no | unique, เช่น `mvp_free` |
| `name` | text | no | |
| `max_branches` | int | yes | null = ไม่จำกัด |
| `max_staff` | int | yes | นับ membership `active` |
| `price_satang_per_month` | int | no | MVP = 0 |
| `is_active` | boolean | no | |

seed: `mvp_free` (max_branches 1, max_staff 5, price 0) — Q-0005

<a id="tbl-subscription"></a>
### `subscription` (module `subscription`)

| column | type | null | หมายเหตุ |
|---|---|---|---|
| `org_id` | uuid fk | no | unique (1 subscription ปัจจุบันต่อ org) |
| `plan_id` | uuid fk | no | |
| `started_at` | timestamptz | no | |
| `current_period_end` | timestamptz | yes | null = ไม่หมดอายุ (MVP) |
| `note` | text | yes | บันทึกของ platform admin |

<a id="tbl-usage_event"></a>
### `usage_event` (module `subscription`) — append-only, ไม่มี `updated_at`

`org_id`, `branch_id` (null ได้), `kind` (text, เช่น `line.push`, `email.send`, `file.bytes`), `quantity` int, `unit_cost_satang` int (null ได้), `occurred_at` timestamptz

<a id="tbl-audit_log"></a>
### `audit_log` (module `audit`) — append-only, ไม่มี `updated_at`

| column | type | null | หมายเหตุ |
|---|---|---|---|
| `org_id` | uuid | yes | null = เหตุการณ์ระดับ platform |
| `actor_user_id` | uuid | yes | null = ระบบ |
| `action` | text | no | ดู §6 |
| `entity_type` / `entity_id` | text / uuid | no | |
| `before` / `after` | jsonb | yes | เฉพาะฟิลด์ที่เปลี่ยน; ห้ามมี secret/token |
| `ip` | inet | yes | |
| `user_agent` | text | yes | |
| `occurred_at` | timestamptz | no | |

<a id="tbl-outbox_event"></a>
### `outbox_event` (shared infra) — ไม่มี `updated_at`

| column | type | null | หมายเหตุ |
|---|---|---|---|
| `org_id` | uuid | yes | |
| `branch_id` | uuid | yes | |
| `type` | text | no | เช่น `branch.hours_changed` |
| `aggregate_type` / `aggregate_id` | text / uuid | no | |
| `aggregate_version` | int | no | |
| `payload` | jsonb | no | |
| `occurred_at` | timestamptz | no | |
| `published_at` | timestamptz | yes | null = ยังไม่ส่ง |
| `attempts` | int | no | default 0 |

index (`occurred_at`) where `published_at is null` — worker ดึงตามลำดับเวลา (Q-0013)

### Enums

| enum | values (label th) |
|---|---|
| `org_status` | `active` ใช้งาน · `suspended` ระงับ |
| `staff_role` | ดู §2 |
| `membership_status` | `active` ใช้งาน · `removed` ถูกนำออก |

## 4. กฎธุรกิจ

<a id="rule-F01"></a>**F01 — owner คนสุดท้าย:** org ต้องมี membership `owner` ที่ `active` อย่างน้อย 1 คนเสมอ — ลบ/เปลี่ยน role ของ owner คนสุดท้าย → `LAST_OWNER`

<a id="rule-F02"></a>**F02 — ขอบเขตสาขา:** role `front_desk`/`groomer`/`caretaker` ต้องมีสาขา ≥ 1 (`BRANCH_REQUIRED`) และเห็น/แก้ได้เฉพาะข้อมูลของสาขานั้น; `owner`/`manager` เห็นทุกสาขา

<a id="rule-F03"></a>**F03 — คำเชิญ:** ใช้ได้ครั้งเดียว, หมดอายุ 7 วัน, email ของผู้รับต้องตรงกับ email ในคำเชิญ (`INVITATION_INVALID`); ถ้าเป็นสมาชิกอยู่แล้ว → `ALREADY_MEMBER`; เชิญซ้ำ email เดิมที่ยังไม่หมดอายุ → ยกเลิกใบเก่าออกใบใหม่

<a id="rule-F04"></a>**F04 — ร้านถูกระงับ:** org `suspended` → อ่านได้, ทุกคำสั่งเขียน → `ORG_SUSPENDED` (ยกเว้น `platform.*`); UI แสดงแถบแจ้ง

<a id="rule-F05"></a>**F05 — ขีดจำกัดแพ็กเกจ:** สร้างสาขา/เชิญพนักงานเกิน `max_branches`/`max_staff` → `PLAN_LIMIT_REACHED` (คำเชิญที่ยังค้างนับรวม)

<a id="rule-F06"></a>**F06 — เวลา:** ทุก branch ใช้ `Asia/Bangkok`; วันที่ local เป็น `YYYY-MM-DD`; instant เป็น UTC

<a id="rule-F07"></a>**F07 — tenant:** ทุก query ข้อมูลร้านผ่าน tenant repository ที่ตั้ง `app.org_id` (RLS); id ของ org อื่น → `NOT_FOUND` เสมอ (ไม่ใช่ `FORBIDDEN`)

<a id="rule-F08"></a>**F08 — PromptPay ID:** เบอร์มือถือ `^0\d{9}$` หรือเลขผู้เสียภาษี 13 หลักที่ checksum ถูก (`VALIDATION_FAILED`)

<a id="rule-F09"></a>**F09 — บัญชี managed (Q-0006):** owner/manager สร้างบัญชี username + รหัสผ่านให้พนักงานที่ไม่มี email ได้
- บัญชีผูกกับ org ที่สร้าง (`managed_by_org_id`) เข้าร่วม org อื่นไม่ได้ และไม่มี "ลืมรหัสผ่าน" ทาง email
- รหัสผ่านที่ owner/manager ตั้งให้ → `must_change_password = true`; login แล้วต้องเปลี่ยนรหัสก่อนเรียก endpoint อื่น (`PASSWORD_CHANGE_REQUIRED`)
- owner/manager รีเซ็ตรหัสได้เฉพาะบัญชี managed ของ org ตัวเอง (`MANAGED_ACCOUNT_ONLY`); รีเซ็ตแล้วล้าง session ทั้งหมดของบัญชีนั้น
- นำออกจากร้าน (`staff.remove`) → ปิดบัญชี managed ด้วย (login ไม่ได้)
- manager สร้าง/รีเซ็ตบัญชีที่ role เป็น owner/manager ไม่ได้ (ตาม ¹)
- นับรวมใน `max_staff`

<a id="rule-F10"></a>**F10 — 2FA (Q-0007):** TOTP ผ่าน Better Auth plugin `twoFactor` + backup codes 10 ชุด
- **platform admin บังคับ:** session ที่ยังไม่ผ่าน 2FA เรียก `platform.*` → `TWO_FACTOR_REQUIRED`; ถ้ายังไม่เคยตั้ง 2FA ให้ไปหน้าตั้งค่าก่อน
- **owner และ role อื่น:** เปิด/ปิดเองได้ (ปิดต้องยืนยันรหัสผ่าน + รหัส 2FA)
- เปิด 2FA แล้ว login ต้องยืนยันรหัส 6 หลักทุกครั้ง (จำอุปกรณ์ได้ 30 วัน)
- audit: `auth.two_factor_enabled`, `auth.two_factor_disabled`


<a id="rule-F11"></a>**F11 — รหัสผ่านและการกู้คืน:**
- รหัสผ่านยาว 10–128 ตัวอักษร (ทุก endpoint ที่ตั้งรหัสผ่าน: signup, reset, change, สร้าง/รีเซ็ตบัญชี managed) — ผิด → `VALIDATION_FAILED`
- `auth.login`: นับเฉพาะครั้งที่ **ล้มเหลว** — 5 ครั้ง / 15 นาที / (identifier ตัวพิมพ์เล็ก + IP) → `RATE_LIMITED` จนครบ 15 นาที; login สำเร็จรีเซ็ตตัวนับ
- `auth.passwordForgot`: 3 ครั้ง / ชั่วโมง / (email + IP) → ยังตอบ 204 แต่ไม่ส่งอีเมล
- token รีเซ็ตรหัสผ่าน: ใช้ได้ครั้งเดียว, อายุ 1 ชั่วโมง; ผิด / หมดอายุ / ใช้แล้ว → `VALIDATION_FAILED` + `details.fields.token`
## 5. API

Base: `/api/v1` · JSON · auth ด้วย session cookie (`HttpOnly`, `Secure`, `SameSite=Lax`)
Endpoint ที่อยู่ในร้านต้องส่ง header `X-Org-Id`; ระบบตรวจกับ membership

<a id="errors"></a>
### Error envelope + รหัสกลาง

```json
{ "error": { "code": "NOT_FOUND", "message": "…", "details": { } } }
```

| code | HTTP | ใช้เมื่อ |
|---|---|---|
| `VALIDATION_FAILED` | 400 | input ผิด (`details.fields`) |
| `UNAUTHENTICATED` | 401 | ไม่มี/หมดอายุ session |
| `FORBIDDEN` | 403 | มี membership แต่ไม่มี permission |
| `NOT_FOUND` | 404 | ไม่พบ หรือเป็นของ org อื่น |
| `CONFLICT` | 409 | ข้อมูลชนกัน (เช่น slug ซ้ำ) |
| `ORG_SUSPENDED` | 423 | F04 |
| `PLAN_LIMIT_REACHED` | 402 | F05 |
| `LAST_OWNER` | 409 | F01 |
| `BRANCH_REQUIRED` | 400 | F02 |
| `INVITATION_INVALID` | 410 | F03 |
| `ALREADY_MEMBER` | 409 | F03 |
| `RATE_LIMITED` | 429 | เกิน rate limit |
| `INTERNAL` | 500 | ข้อผิดพลาดที่ไม่คาดคิด — message ทั่วไป ไม่เปิดเผยรายละเอียดภายใน |
| `PASSWORD_CHANGE_REQUIRED` | 403 | F09 |
| `MANAGED_ACCOUNT_ONLY` | 409 | F09 |
| `TWO_FACTOR_REQUIRED` | 403 | F10 |

### Endpoints

| key | method · path | สิทธิ์ | หมายเหตุ |
|---|---|---|---|
| <a id="ep-system.health"></a>`system.health` | `GET /health` | public | `{ status: "ok", version }` (version = git sha ของ build) · ไม่แตะ DB — ใช้เป็น liveness probe |
| <a id="ep-auth.signup"></a>`auth.signup` | `POST /auth/signup` | public | `{ email, password, displayName, orgName, orgSlug, branchName }` → สร้าง user + org + branch + hours + membership owner + subscription `mvp_free` ใน transaction เดียว; verification state + ส่งอีเมลหลัง commit; 201 `{ verificationRequired: true }` ไม่มี session · ดู #rule-signup-input, #rule-email-verification-http · errors: `VALIDATION_FAILED`, `CONFLICT` (email/slug), `RATE_LIMITED`, `INTERNAL` |
| <a id="ep-auth.login"></a>`auth.login` | `POST /auth/login` | public | `{ identifier, password }` (identifier = email หรือ username) · rate limit 5 ครั้ง/15 นาที/identifier+IP · ตอบ `{ twoFactorRequired, mustChangePassword }` · real-email ต้อง verified, managed ยกเว้นเฉพาะ verification ตาม #rule-email-login-policy · errors: `UNAUTHENTICATED`, `RATE_LIMITED` |
| <a id="ep-auth.email.verify"></a>`auth.email.verify` | `POST /auth/email/verify` | public | `{ token }` → 204 ไม่มี body/session/cookie; errors: `VALIDATION_FAILED` + `details.fields.token` (invalid/expired/reused/replaced/wrong-purpose), `INTERNAL` · #rule-email-verification-http |
| <a id="ep-auth.email.verification.resend"></a>`auth.email.verification.resend` | `POST /auth/email/verification/resend` | public | `{ email }` → uniform 204 ตาม #rule-email-verification-http / #rule-signup-abuse; errors: `VALIDATION_FAILED` (schema), `INTERNAL` (non-suppressed infrastructure) |
| <a id="ep-auth.two_factor.verify"></a>`auth.twoFactor.verify` | `POST /auth/2fa/verify` | session รอ 2FA | `{ code, trustDevice? }` (TOTP หรือ backup code) · F10 |
| <a id="ep-auth.two_factor.enable"></a>`auth.twoFactor.enable` | `POST /auth/2fa/enable` | user | `{ password }` → `{ totpUri, backupCodes }`; มีผลหลัง verify ครั้งแรก · audit |
| <a id="ep-auth.two_factor.disable"></a>`auth.twoFactor.disable` | `POST /auth/2fa/disable` | user | `{ password, code }` · platform admin ปิดไม่ได้ (`FORBIDDEN`) · audit |
| <a id="ep-auth.password_change"></a>`auth.passwordChange` | `POST /auth/password/change` | user | `{ currentPassword, newPassword }` · ล้าง `must_change_password` · ล้าง session อื่น |
| <a id="ep-auth.logout"></a>`auth.logout` | `POST /auth/logout` | user | |
| <a id="ep-auth.password_forgot"></a>`auth.passwordForgot` | `POST /auth/password/forgot` | public | ตอบ 204 เสมอ (ไม่บอกว่ามี email หรือไม่) |
| <a id="ep-auth.password_reset"></a>`auth.passwordReset` | `POST /auth/password/reset` | public | `{ token, password }` · ล้าง session อื่นทั้งหมด |
| <a id="ep-me.get"></a>`me.get` | `GET /me` | user | `{ user, memberships: [{ org, role, branches }] }` |
| <a id="ep-org.get"></a>`org.get` | `GET /org` | `org.settings.read` | `Organization` |
| <a id="ep-org.update"></a>`org.update` | `PATCH /org` | `org.settings.update` | ฟิลด์ใน `tbl-organization` ยกเว้น `slug`, `status` · audit `org.updated` |
| <a id="ep-branch.list"></a>`branch.list` | `GET /branches` | `org.settings.read` | role ระดับสาขาเห็นเฉพาะสาขาตัวเอง |
| <a id="ep-branch.create"></a>`branch.create` | `POST /branches` | `branch.create` | F05 · audit `branch.created` · outbox `branch.created` |
| <a id="ep-branch.update"></a>`branch.update` | `PATCH /branches/{branchId}` | `branch.update` | ไม่รวม `promptpay_id` · outbox `branch.updated` |
| <a id="ep-branch.payment_settings.update"></a>`branch.paymentSettings.update` | `PUT /branches/{branchId}/payment-settings` | `branch.payment_settings.update` | `{ promptpayId }` · F08 · audit `branch.payment_settings_updated` · **human_review** |
| <a id="ep-branch.hours.put"></a>`branch.hours.put` | `PUT /branches/{branchId}/hours` | `branch.update` | ครบ 7 วัน · outbox `branch.hours_changed` |
| <a id="ep-branch.closures"></a><a id="ep-branch.closure.create"></a>`branch.closure.create` | `POST /branches/{branchId}/closures` | `branch.update` | 201 Closure · outbox `branch.hours_changed` · #contract-branch-closures |
| <a id="ep-branch.closure.delete"></a>`branch.closure.delete` | `DELETE /branches/{branchId}/closures/{closureId}` | `branch.update` | 204 ไม่มี body · outbox `branch.hours_changed` |
| <a id="ep-branch.closure.list"></a>`branch.closure.list` | `GET /branches/{branchId}/closures` | `org.settings.read` | 200 `{ items: Closure[] }` · ไม่มี event |
| <a id="ep-staff.list"></a>`staff.list` | `GET /staff` | `staff.read` | membership + คำเชิญที่ค้าง · #contract-staff-list |
| <a id="ep-staff.invite"></a>`staff.invite` | `POST /staff/invitations` | `staff.invite` | `{ email, role, branchIds }` · F02, F03, F05 · ส่งอีเมล · audit `staff.invited` · #contract-staff-invite |
| <a id="ep-staff.invitation.revoke"></a>`staff.invitation.revoke` | `DELETE /staff/invitations/{invitationId}` | `staff.invite` | 204 · #contract-staff-invitation-revoke |
| <a id="ep-invitation.accept"></a>`invitation.accept` | `POST /invitations/accept` | user ที่ login แล้ว (สมัครใหม่ใน flow เดียวกัน: follow-up #rule-invite-signup-followup) | `{ token }` · F03 · audit `staff.joined` · #contract-invitation-accept |
| <a id="ep-staff.account.create"></a>`staff.account.create` | `POST /staff/accounts` | `staff.invite` | `{ displayName, username, password, role, branchIds }` · F02, F05, F09 · `CONFLICT` เมื่อ username ซ้ำ · audit `staff.account_created` · #contract-staff-account-create |
| <a id="ep-staff.password.reset"></a>`staff.password.reset` | `PUT /staff/{membershipId}/password` | `staff.update` | `{ newPassword }` · F09 · audit `staff.password_reset` · #contract-staff-password-reset |
| <a id="ep-staff.update"></a>`staff.update` | `PATCH /staff/{membershipId}` | `staff.update` | `{ role?, branchIds?, displayName? }` · F01, F02, ¹ · audit `staff.role_changed` · #contract-staff-update |
| <a id="ep-staff.remove"></a>`staff.remove` | `DELETE /staff/{membershipId}` | `staff.remove` | F01 · ล้าง session ตาม #contract-staff-remove · audit `staff.removed` |
| <a id="ep-audit.list"></a>`audit.list` | `GET /audit-logs?from&to&action&actorUserId&cursor` | `audit.read` | เรียงใหม่ → เก่า, cursor pagination 50/หน้า · #contract-audit-list |
| <a id="ep-subscription.get"></a>`subscription.get` | `GET /subscription` | `subscription.read` | plan + การใช้งานปัจจุบัน (สาขา, พนักงาน) · #contract-subscription-get |
| <a id="ep-platform.org.list"></a>`platform.org.list` | `GET /platform/orgs?q&status&cursor` | platform admin | #contract-platform-org-read |
| <a id="ep-platform.org.get"></a>`platform.org.get` | `GET /platform/orgs/{orgId}` | platform admin | audit `platform.org_viewed` · #contract-platform-org-read |
| <a id="ep-platform.org.set_status"></a>`platform.org.setStatus` | `PUT /platform/orgs/{orgId}/status` | platform admin | `{ status, reason }` · audit `platform.org_status_changed` · #contract-platform-org-status |
| <a id="ep-platform.org.set_plan"></a>`platform.org.setPlan` | `PUT /platform/orgs/{orgId}/subscription` | platform admin | `{ planCode, currentPeriodEnd?, note? }` · audit `platform.plan_changed` · **human_review** · #contract-platform-set-plan |
| <a id="ep-platform.plan.list"></a>`platform.plan.list` | `GET /platform/plans` | platform admin | #contract-platform-plan-list |

Response DTO ใช้ชื่อ camelCase ของคอลัมน์ใน §3 (ไม่ส่ง `token_hash`, `org_id` ภายใน); hours response เป็น projection ที่กำหนดเฉพาะใน #contract-branch-hours ไม่ใช่ row DTO

## 6. Audit actions

`org.updated` · `branch.created` · `branch.updated` · `branch.payment_settings_updated` · `staff.invited` · `staff.joined` · `staff.account_created` · `staff.password_reset` · `staff.role_changed` · `staff.removed` · `auth.password_reset` · `auth.two_factor_enabled` · `auth.two_factor_disabled` · `platform.org_status_changed` · `platform.plan_changed` · `platform.org_viewed` (§18)
— เขียน **ใน transaction เดียวกับการเปลี่ยนข้อมูล**

## 7. หน้าจอ (PMS web)

| id | path | ผู้ใช้ | เนื้อหา |
|---|---|---|---|
| <a id="scr-auth-signup"></a>`scr-auth-signup` | `/signup` | public | ฟอร์ม US-F01: ชื่อ, email, รหัสผ่าน, ชื่อร้าน, slug (สร้างอัตโนมัติจากชื่อ แก้ได้), ชื่อสาขาแรก |
| <a id="scr-auth-login"></a>`scr-auth-login` | `/login` | public | "email หรือชื่อผู้ใช้", รหัสผ่าน, ลิงก์ลืมรหัสผ่าน (สำหรับบัญชี email) |
| <a id="scr-auth-verify-email"></a>`scr-auth-verify-email` | `/verify-email` | public | fragment token → clear history ก่อน analytics → POST JSON; pending/success/invalid/expired/reused/replaced/network failure states; success ให้ไป login ไม่ auto-login; email input + resend/recovery สำหรับลิงก์เสีย/ไม่มีลิงก์และ legacy real-email จาก login; uniform acknowledgement ไม่ยืนยันว่ามีบัญชีหรือส่งสำเร็จ; รายละเอียดข้อความไทย/i18n ต้องกำหนดในการ์ด T-0023 ที่มนุษย์อนุมัติก่อน implementation |
| <a id="scr-auth-2fa"></a>`scr-auth-2fa` | `/login/2fa` | session รอ 2FA | รหัส 6 หลัก หรือ backup code, ☐ จำอุปกรณ์นี้ 30 วัน |
| <a id="scr-auth-change-password"></a>`scr-auth-change-password` | `/change-password` | user | บังคับเมื่อ `mustChangePassword` |
| <a id="scr-account-security"></a>`scr-account-security` | `/account/security` | user | เปลี่ยนรหัสผ่าน, เปิด/ปิด 2FA (QR + backup codes) |
| <a id="scr-auth-forgot"></a>`scr-auth-forgot` / `scr-auth-reset` | `/forgot-password`, `/reset-password` | public | |
| <a id="scr-org-switcher"></a>`scr-org-switcher` | (เมนูบน) | user | เลือก org + สาขา; จำค่าล่าสุด |
| <a id="scr-settings-org"></a>`scr-settings-org` | `/settings/org` | owner | ฟิลด์ `tbl-organization` |
| <a id="scr-settings-branches"></a>`scr-settings-branches` | `/settings/branches` | owner, manager | รายการสาขา + ปุ่มเพิ่ม (ซ่อนเมื่อถึง limit พร้อมข้อความแพ็กเกจ) |
| <a id="scr-settings-branch"></a>`scr-settings-branch` | `/settings/branches/:id` | owner, manager | แท็บ: ข้อมูล · เวลาเปิด-ปิด · วันหยุด · การชำระเงิน (owner) |
| <a id="scr-staff"></a>`scr-staff` | `/settings/staff` | owner, manager, front_desk (อ่าน) | ตารางพนักงาน: ชื่อ, email หรือ username, role, สาขา, สถานะ, 2FA; คำเชิญค้าง; ปุ่ม "เชิญทาง email" และ "สร้างบัญชี (ไม่มี email)"; เมนู "รีเซ็ตรหัสผ่าน" เฉพาะบัญชี managed |
| <a id="scr-invite-accept"></a>`scr-invite-accept` | `/invite#token=<token>` | public/user | token อยู่ใน fragment (#rule-invitation-token) อ่านแล้วล้างออกจาก history แล้ว POST JSON; แสดงชื่อร้าน + role; login แล้วรับคำเชิญ; สมัครแล้วรับคำเชิญ: follow-up #rule-invite-signup-followup |
| <a id="scr-audit"></a>`scr-audit` | `/settings/audit` | owner | ตาราง audit + ตัวกรอง |
| <a id="scr-subscription"></a>`scr-subscription` | `/settings/subscription` | owner, manager | แพ็กเกจปัจจุบัน + การใช้งาน vs limit |
| <a id="scr-platform-orgs"></a>`scr-platform-orgs` | `/platform/orgs` | platform admin | ค้นหาร้าน, สถานะ, แพ็กเกจ; หน้า detail เปลี่ยนแพ็กเกจ/ระงับ |

ทุกหน้าต้องใช้งานได้บนจอมือถือ (PWA) · ข้อความไทยอยู่ในไฟล์ i18n ตาม screen id

## 8. Acceptance tests (ขั้นต่ำ)

- signup สร้างครบทุกแถวใน transaction เดียว; slug ซ้ำ → `CONFLICT` และไม่มีแถวค้าง
- login ผิด 6 ครั้ง → `RATE_LIMITED`
- groomer สาขา A เรียก `branch.update` สาขา A → `FORBIDDEN`; อ่านสาขา B → `NOT_FOUND`
- ผู้ใช้ org X ส่ง `X-Org-Id` = org Y → `FORBIDDEN`; ใช้ id ของ org Y ใน path → `NOT_FOUND`
- ลบ owner คนสุดท้าย → `LAST_OWNER`
- manager ตั้งคนอื่นเป็น owner → `FORBIDDEN`
- คำเชิญหมดอายุ / ใช้ซ้ำ / email ไม่ตรง → `INVITATION_INVALID`
- org `suspended` → ทุก write `ORG_SUSPENDED`, read ผ่าน
- เกิน `max_branches` → `PLAN_LIMIT_REACHED`
- บัญชี managed: login ครั้งแรกเรียก endpoint อื่น → `PASSWORD_CHANGE_REQUIRED`; รีเซ็ตรหัสบัญชี email → `MANAGED_ACCOUNT_ONLY`; ถูกนำออก → login ไม่ได้
- platform admin ที่ยังไม่ผ่าน 2FA เรียก `platform.org.list` → `TWO_FACTOR_REQUIRED`
- **architecture test:** ทุกตารางที่มีคอลัมน์ `org_id` เปิด RLS และมี policy (ADR-0006)
- ทุก write ที่อยู่ใน §6 มีแถว audit ใน transaction เดียวกัน (rollback แล้วไม่มี audit ค้าง)

## 9. Decisions

- Q-0005 → `mvp_free` = 1 สาขา / 5 พนักงาน
- Q-0006 → บัญชี managed (username + รหัสผ่านที่ owner/manager ตั้ง) — F09; LINE Login สำหรับพนักงานเป็นเฟสถัดไป
- Q-0007 → 2FA บังคับ platform admin, role อื่นเปิดเอง — F10


## 10. Signup / verification handoff amendment

สถานะ: business decisions ด้านล่าง **ได้รับอนุมัติแล้ว**; รายละเอียด storage/API ภายในเป็น proposed technical design สำหรับ human-reviewed spec PR ก่อนเริ่ม implementation ไม่ใช่ข้ออ้างว่า Better Auth ทำได้เอง ไม่เพิ่ม error code, schema, grant, dependency, audit action หรือ outbox event โดยปริยาย

<a id="rule-signup-input"></a>
### Signup input และ response

`POST /api/v1/auth/signup` public รับ `{ email, password, displayName, orgName, orgSlug, branchName }` เท่านั้นตาม contract ของระบบ
- password 10–128 ไม่ trim; displayName/orgName/branchName trim ก่อนตรวจ 1–100 ตัวอักษร; orgSlug ตรง `^[a-z0-9-]{3,40}$` ไม่แก้ค่าหรือ lowercase ให้เอง
- email ใช้ canonical lowercase ให้ตรง login ปัจจุบัน; ต้องตรวจ pinned Better Auth normalization และข้อมูลเก่าก่อนประกาศว่ารองรับ uniqueness แบบ case-insensitive ทั้งระบบ ตารางปัจจุบัน `user.email` เป็น text unique ไม่ใช่ citext จึงห้ามอ้างว่า DB บังคับ case-insensitive แล้ว; หากต้องเปลี่ยน schema/data ต้องเปิด pending decision แยกก่อน
- สำเร็จ `201 { verificationRequired: true }`; ไม่ส่ง identity, token, session หรือ Set-Cookie
- duplicate email หรือ orgSlug → `CONFLICT`; schema ผิด → `VALIDATION_FAILED`; เกิน signup quota → `RATE_LIMITED`; infra/DB/Valkey ล้มเหลวก่อน commit → `INTERNAL` ที่ sanitize แล้ว
- การตั้งชื่อข้างต้นเข้ากับ text columns ปัจจุบัน และ orgName 1–100 เข้ากับ organization_display_name_length; ต้องทดสอบ Unicode length ให้ตรง PostgreSQL char_length (ไม่ใช้ UTF-16 .length เป็นหลักฐานว่าตรงแล้ว)

<a id="rule-signup-atomic"></a>
### Atomic bootstrap และ synthetic-success guard

เริ่ม outer transaction บน `app_runtime` ตั้งแต่แรก ตรวจว่า current/session user เป็น runtime non-superuser/non-owner/NOBYPASSRLS; ไม่ใช้ platform start → runtime switch (grants ปัจจุบันปฏิเสธ 42501) และไม่เพิ่ม grants
ใช้ `createAuth(config, tx, ...)` ต่อ operation บน tx เดียว; ห้ามใช้ singleton auth ที่ผูก platformDb หรือเปิด withTenant อีก transaction หนึ่ง
preallocate org UUID, ตั้ง `app.org_id` แบบ transaction-local บน tx เดิมผ่าน reviewed tenant helper แล้วเรียก org/subscription เฉพาะ public `index.ts` services ที่รับ tx/context ไม่ cross-module insert
สร้าง user + credential account + current verification state + organization active + branch active Asia/Bangkok + branch_hours 7 แถว ISO 1–7, 09:00–18:00 + active owner membership + mvp_free subscription (current_period_end null) ทั้งหมดใน commit เดียว ไม่มี signup session และไม่สร้าง membership_branch สำหรับ owner โดยไม่มี requirement

Better Auth เมื่อปิด auto-login/บังคับ verify อาจคืน synthetic success สำหรับ email ซ้ำ: ห้ามเชื่อ returned id หรือ success status แล้วสร้าง tenant
ก่อน signup serialize ด้วย transaction-scoped DB lock ของ canonical email (รวม absent-user race); ตรวจ persisted existing identity หลังได้ lock → CONFLICT จากนั้นเรียก auth และตรวจ returned UUID มี persisted user + credential account ของ email เดียวกันใน tx นี้จริง และไม่มี identity อยู่ก่อน operation จึงอนุญาต bootstrap; synthetic id ที่ไม่มี row ต้อง fail/rollback ไม่สร้าง org
DB unique violations ที่เป็น email/slug collision ต้อง map CONFLICT; infra/unknown constraint ต้องไม่กลบเป็น CONFLICT ทดสอบ simultaneous same-email/different-slug และ same-slug/different-email มีผู้ชนะหนึ่งราย ไม่มี orphan/extra tenant
email lock protocol ต้องใช้กับ signup writer ทุกตัวใน scope; ไม่อ้างว่าป้องกัน writer อื่นที่ไม่ร่วม protocol ด้วยตัวเอง DB uniqueness ยังคงเป็น backstop ตามชนิด column ปัจจุบัน
COMMIT สำเร็จก่อนปล่อย response/email; SQL error/application throw/commit failure ต้องไม่ปล่อย message collector ไม่เพิ่ม idempotency/retry หรือรับประกันผลเมื่อ connection ขาดระหว่าง commit โดยไม่มี decision

<a id="rule-email-verification-state"></a>
### Proposed identity-owned persistent verification state (ไม่เปลี่ยน schema)

ใช้ existing `verification(id, identifier, value, expires_at, created_at, updated_at)` เท่านั้น; namespace นี้แยกจาก reset-password, two-factor และ native Better Auth identifiers:
- identifier = `pms:email-verify:v1:<user UUID>` (purpose signup/real-email verification เท่านั้น)
- value = JSON text `{ "purpose": "email-verify", "version": 1, "digest": "<lowercase SHA-256 hex of complete signed token>" }`; ไม่มี raw token/email/link ใน row หรือ identifier; expires_at = issuance + 24h โดยไม่ยืดอายุเพราะ consume
- created_at/updated_at และ application expiry ใช้ injected CLOCK; signed token exp 86400 วินาทีตาม pinned Better Auth ภายใต้ narrow internal-clock exception เท่านั้น ตรวจทั้ง signed exp และ persisted expires_at; now >= expiry ถือว่าหมดอายุ
- ทุก issue/rotate/consume ต้อง `SELECT user ... FOR UPDATE` ก่อนอ่าน/แก้ namespace rows บน tx เดียวกัน ไม่อาศัย SELECT verification FOR UPDATE อย่างเดียวเพราะ absent-row race; signup lock newly inserted user ได้และ invisible จน commit
- rotation ภายใต้ lock: delete namespace rows เก่าทั้งหมดแล้ว insert current row หนึ่งแถว; ไม่ใช้ ON CONFLICT(identifier) เพราะ existing index ไม่ unique; verify ต้องพบ current state หนึ่งแถวพอดี ถ้ามีหลายแถวผิด invariant ให้ fail closed เป็น INTERNAL และ sanitized diagnostic ไม่เลือกรายการสุ่ม
- consume: validate signed payload/purpose + identify persisted user, lock user, recheck email binding/current eligibility/current digest/expiry แล้ว conditional delete current row และ update user.emailVerified=true ใน transaction เดียว; error rollback ทั้งสอง ไม่มี separate native verify transaction; consumed state แทนด้วย absence ของ current row ไม่ต้องเพิ่ม consumed_at/version column
- JWT ต้องเป็น verification-only: reject updateTo/change-email/requestType branches ที่ไม่ใช่ approved purpose ห้ามให้ token จาก password reset/2FA ใช้แทน; namespace/digest binding เป็น additional purpose guard ไม่เชื่อ decoded unsigned email
- ต้องมี unpredictable per-issuance nonce ใน authenticated signed payload โดยใช้ pinned signing path ที่พิสูจน์ก่อน (ถ้าทำไม่ได้ให้หยุดถาม ไม่ออก bespoke signing protocol เงียบ ๆ) เพื่อให้ same-second resend ได้ token ใหม่จริง ไม่ persist nonce/raw token แยก; native payload ปัจจุบันอาจออก JWT เหมือนเดิมในวินาทีเดียว
- lock order เป็น user ก่อน verification เสมอ; concurrent verify token เดียวสำเร็จ 204 หนึ่งครั้ง ที่เหลือ VALIDATION_FAILED; resend ได้ lock ก่อน → old verify fail, verify ได้ lock ก่อน → verified แล้ว resend ไม่ rotate/send; concurrent allowed resends → state ของ rotation สุดท้ายเท่านั้นใช้ได้ ลำดับส่ง email อาจต่างจากลำดับ lock ไม่รับประกัน delivered-latest
- namespace cleanup: rotate/consume ลบของ user นี้เท่านั้น; expired current row อยู่ได้จน rotate/consume/การล้างที่ได้รับอนุมัติ ไม่เพิ่ม retention SLA หรือ worker; ต้องพิสูจน์ Better Auth cleanup/password-reset ไม่ลบ unexpired app namespace โดยไม่ตั้งใจ
- SQL/row lock/crypto helper อยู่ identity repository หรือ public shared DB primitive ที่ระบุในการ์ดเท่านั้น; ไม่เพิ่ม drizzle-orm dependency ใน api โดยปริยาย

<a id="rule-email-verification-http"></a>
### Verification / resend / delivery

`POST /api/v1/auth/email/verify` public JSON `{ token }` → 204 ไม่มี session/cookie/body; invalid/malformed/expired/reused/replaced/wrong-purpose → VALIDATION_FAILED + details.fields.token; infra failure → INTERNAL ไม่ปลอมเป็น invalid token
`POST /api/v1/auth/email/verification/resend` public JSON `{ email }` → 204 เหมือนกันสำหรับ schema-valid request ทั้ง known-unverified, unknown, verified, managed, throttled, Valkey outage และ provider failure; malformed schema → VALIDATION_FAILED; ไม่รับประกัน 204 เมื่อ DB/infra ที่ไม่ใช่ approved suppression ล้มเหลว ให้ INTERNAL แบบไม่ขึ้นกับการเปิดเผย recipient

capture verification message ใน request-local collector ระหว่าง transaction ห้ามส่งจริงจาก Better Auth callback; หลัง outer commit เท่านั้นจึงส่งผ่าน existing notification/email public EmailSender; rollback discard ทั้ง collector
send ล้มเหลวหลัง commit ยังตอบ signup 201 / resend 204, ไม่ refund quota, ไม่ย้อน verification rotation; เก็บ sanitized error category เท่านั้น ไม่ token/email/link/provider exception; ไม่มี durable queue/outbox/new worker หรือ confirmed-delivery guarantee ใน scope
ปิด autoSignIn, autoSignInAfterVerification, sendOnSignIn และ default sender ที่ bypass collector/state; Better Auth HTTP handler ต้อง unmounted ต่อไป ไม่ forward callbackURL/cookie/query token
web link `/verify-email#token=<encoded>`; web อ่าน fragment แล้ว clear history ก่อน analytics/POST JSON; ไม่ส่ง token ผ่าน URL query/referrer/log/audit/analytics ใช้ contracts/api-client เมื่อ web พร้อม

<a id="rule-signup-abuse"></a>
### Atomic abuse limits (business policy approved)

signup: 5 schema-valid attempts / 3600s / trusted IP, prefix แยก login/forgot/resend; ครั้งที่ 1–5 ผ่าน quota, ครั้งที่ 6 เป็นต้นไป RATE_LIMITED; conflicts นับด้วย; malformed schema ไม่นับ; Valkey outage fail closed INTERNAL ก่อน DB write
resend: 3 schema-valid attempts / 3600s / normalized email **และ** 10 / 3600s / trusted IP; ทุก valid request นับทั้งสอง counter แม้ unknown/verified/managed หรืออีก counter เกินแล้ว; atomic increment/check ทั้งคู่ใน operation เดียวและ expire ตั้งเฉพาะ first attempt ไม่ sliding TTL; over-limit หรือ Valkey outage ไม่ rotate/send และยัง 204; send failure ไม่คืน quota
ห้าม reuse separate check-then-increment; concurrent calls ต้องไม่เกิน quota ใช้ atomic Valkey script/transaction ที่ตรวจ command errors จริง ห้าม fail-open จาก null/error replies; trusted proxy/IP configuration ต้อง explicit ไม่เชื่อ raw X-Forwarded-For; ห้ามเปลี่ยน login/forgot quotas ไปด้วย

<a id="rule-email-login-policy"></a>
### Managed / legacy login และ clock exception

บัญชี real-email ที่ emailVerified=false (รวมข้อมูลเก่า) login ทั้ง email และ username → UNAUTHENTICATED ตาม failure counter เดิม ไม่มี session/cookie; ขอ resend เพื่อ verify ได้ ไม่มี mass auto-verification
บัญชี isManaged=true ยกเว้น real-email verification เท่านั้น ยังคง F09 active owning membership, must-change-password และ F10 2FA; ห้ามส่ง email ไป managed.invalid ทุกกรณี ไม่ใช้ suffix เพียงอย่างเดียวเป็นหลักฐานให้ bypass
บัญชี isManaged=true login ด้วย **username เท่านั้น** (T-0016-05 A, อนุมัติโดยมนุษย์ 2026-10-23): identifier แบบ email (มี `@`) ที่ชี้ไปยังบัญชี managed — รวม `<user_id>@managed.invalid` — ถูกปฏิเสธเหมือนรหัสผ่านผิด: hash รหัสผ่านที่ส่งมาเหมือนเดิม, บันทึก failure counter, ตอบ `UNAUTHENTICATED`, ไม่มี session/cookie; ตัดสินจาก `is_managed` ของบัญชี ไม่ใช่จาก suffix
ห้ามเปิด global requireEmailVerification โดยไม่ implement managed exception หรือ set managed.emailVerified=true เพื่อหลอกว่า verify จริง; app-level guard ต้องไม่ส่ง session ก่อนตรวจ policy และทดสอบทั้ง identifier modes
CLOCK ใช้กับ application timestamps/limiter-facing time; อนุญาตเฉพาะ pinned Better Auth internal signup/verification Date ที่ไม่มี injection API; production ห้าม override global Date, isolated tests restore Date/fake timers เสมอ

<a id="accept-signup-verification"></a>
### Additional acceptance / release gate

ต้องผ่าน tests ตาม T-0033–T-0037 และ T-0011: real Postgres rollback ทุกขั้นรวม branch_hours, persisted current-token atomicity/races; real Valkey parallel quotas/TTL/outage; HTTP envelopes/no session/no cookie; failed send/rollback never-send; managed/legacy/login+reset+2FA regression; token/PII redaction; clock expiry exact boundary; synthetic-success guard; pooled same-PID context cleanup และ wrong-role denial
public auth endpoints ไม่มี org-id resource/role permission จึงไม่ประดิษฐ์ FORBIDDEN/NOT_FOUND endpoint cases; tenant helper/service tests ต้องพิสูจน์ wrong-org isolation และ no-context RLS denial แทน
T-0023 ต้องมี verification fragment landing/resend/recovery/error state และ signup 201 ไม่อ้างว่าส่งสำเร็จแล้ว; ห้ามเปิด signup ให้ผู้ใช้พร้อมใช้งานก่อน web verification พร้อม T-0029 เพิ่ม signup → verify → login → invite flow
การ activate legacy real-email login gate ต้องพร้อม working resend/verification recovery ด้วย ไม่ใช่ deploy T-0036 แล้วตัดทางเข้าบัญชีเก่าโดยยังไม่มี recovery UI; เป็น coordinated release gate ไม่เพิ่ม dependency กลับไป T-0023 จนเกิด cycle และไม่อนุญาต bypass verification

<a id="signup-technical-gates"></a>
### Pending technical gates (ไม่ใช่ business decisions ที่รออนุมัติซ้ำ)

- T-0033: prove pinned public signing/verification extension รองรับ authenticated random nonce และ transaction-bound callbacks บน actual Postgres; public API ไม่พอ → question ก่อนเปลี่ยน token format/library/dependency
- T-0011: prove canonical-email normalization ทุก writer และตรวจ disposable historical mixed-case collision fixture; text unique ไม่พิสูจน์ historical case-insensitive uniqueness. ถ้าจำเป็นต้อง citext/unique lower(email)/แก้ข้อมูลเก่า ต้อง explicit schema/data decision + collision resolution/rollout/migration card แยก ห้ามตรวจหรือแก้ production เอง
- T-0033: prove user-lock rotate/consume protocol ร่วมกับทุก namespace writer/cleanup บน real DB; ถ้าพิสูจน์ไม่ได้หยุดถามก่อน unique identifier/consumed_at/purpose schema change
- T-0034: prove public TxContext ป้องกัน wrong connection; test-harness grants ไม่ใช่ production grants verification; ห้าม platform-start fallback หรือเพิ่ม grants
- T-0037: prove deployed Valkey topology รองรับ atomic dual-key operation; cluster ต้อง resolve key-slot/topology ก่อน ไม่มี permission เปลี่ยน quota; trusted proxy allowlist ต้องอิง deployment ไม่เดา hops
- T-0035/T-0011: delivery ordering/durability/retry และ commit-disconnect ambiguity ยังไม่รับประกัน; latest-token-only ไม่ใช่ delivered-latest guarantee
- T-0035/T-0011: ADR-0005 email usage-cost attribution ยังไม่มี approved event/usage attribution สำหรับ signup/resend; ถ้าจำเป็นต้องเพิ่มให้ question ก่อน ไม่ invent usage_event/outbox action หรืออ้าง cost accounting ครบ
- T-0011: prove Unicode counting ตรง PostgreSQL char_length; ทุกใบ size estimate เป็น budget ไม่ใช่ measured diff; เกิน 600 ต้องหยุดเสนอ split ให้มนุษย์อนุมัติ

หลักฐานเดิมเป็น partial เท่านั้น: runtime-from-start spike 15 tests บน Postgres (ไม่รวม branch_hours/HTTP/races/approved no-session lifecycle); pinned 1.7.11 memory probe พบ JWT reusable/resend ไม่ revoke/duplicate synthetic success. ข้อความนี้ไม่ใช่ผลทดสอบ implementation หรือ full pnpm verify.

## 11. Org / branch API contract amendment (T-0012)

สถานะ: business decisions **อนุมัติโดย Zo ในแชท 2026-10-21** — T-0012-01 (A), T-0012-02 (A: พิกัดเป็น JSON number, `promptpayId` อยู่ใน read DTO), T-0012-03 (A), T-0012-04 (A), T-0012-05 (C: คอลัมน์ `branch.version` ผ่านการ์ด schema แยก ไม่ใช้ค่าคงที่ 1) บันทึกในไฟล์ `docs/questions/T-0012-0N.md` บน PR #35 (ยังไม่ merge). ข้อความนี้เป็น spec text ที่มนุษย์ต้อง merge ก่อนเริ่ม T-0038 / T-0012; ข้อใน #org-branch-technical-gates เป็น proposed technical defaults ให้มนุษย์ยืนยันตอน merge

กติการ่วม: request body เป็น strict JSON object — key ที่ไม่อยู่ในรายการ → `VALIDATION_FAILED` + `details.fields.<key>`; string ถูก trim ก่อนตรวจ และนับความยาวแบบ PostgreSQL `char_length` (code point); field ที่ nullable ส่ง `null` เพื่อล้างค่า, string ว่างหลัง trim → `VALIDATION_FAILED`; PATCH ต้องมีอย่างน้อย 1 field; response ส่ง nullable column เป็น `null` (ไม่ละ key) และ instant เป็น ISO UTC

<a id="contract-org"></a>
### `Organization` DTO และ `org.update`

- `Organization` = `{ id, slug, displayName, legalName, taxId, phone, logoFileId, receiptFooter, status, createdAt, updatedAt }` — `GET /org` และ `PATCH /org` ตอบ 200 ด้วย shape นี้
- `PATCH /org` รับเฉพาะ `displayName` (1–100, ห้าม null) · `legalName` (1–100 หรือ null) · `taxId` (`^[0-9]{13}$` หรือ null, ไม่ตรวจ checksum) · `phone` (1–100 หรือ null, ไม่ตรวจรูปแบบ) · `receiptFooter` (1–500 หรือ null)
- `slug`, `status`, `logoFileId` (read-only จนกว่า feature files กำหนด validation), `id`, `createdAt`, `updatedAt`, `orgId` → `VALIDATION_FAILED` โดยไม่เปลี่ยนข้อมูล
- `updated_at` = `ctx.now`; audit `org.updated` (before/after เฉพาะฟิลด์ที่เปลี่ยน) ใน transaction เดียวกัน; ไม่มี outbox

<a id="contract-branch"></a>
### `Branch` DTO, `branch.create` และ `branch.update`

- `Branch` = `{ id, name, address, phone, latitude, longitude, timezone, promptpayId, isActive, version, createdAt, updatedAt }` (ไม่มี `orgId`); `promptpayId` ส่งให้ทุก role ที่มี `org.settings.read`; `latitude`/`longitude` เป็น JSON number หรือ `null`
- ฟิลด์: `name` 1–100 (ห้าม null; unique ต่อ org ตาม `branch_org_id_name_unique` แบบตรงตัวหลัง trim → ชนกัน `CONFLICT`, ชื่อเดียวกันข้าม org ได้) · `address` 1–500 หรือ null · `phone` 1–100 หรือ null · `latitude` −90…90 · `longitude` −180…180 — ทศนิยมเกิน 6 ตำแหน่ง → `VALIDATION_FAILED` (ไม่ปัด); request ต้องมีทั้งคู่หรือไม่มีทั้งคู่ และเป็น number ทั้งคู่หรือ null ทั้งคู่
- `POST /branches` รับ `{ name, address?, phone?, latitude?, longitude? }` (ละ = null) → 201 `Branch`; server ตั้ง `timezone = 'Asia/Bangkok'`, `isActive = true`, `version = 1`, `promptpayId = null` และสร้าง `branch_hours` 7 แถว (ISO 1–7, 09:00–18:00) ใน transaction เดียว; F05 ตาม #rule-branch-capacity; audit + outbox `branch.created`
- `PATCH /branches/{branchId}` รับ `name`, `address`, `phone`, `latitude`, `longitude`, `isActive` → 200 `Branch`; `promptpayId` (ใช้ #ep-branch.payment_settings.update), `timezone`, `version`, `id`, `orgId`, `createdAt`, `updatedAt` → `VALIDATION_FAILED`; `branchId` ไม่ใช่ UUID → `VALIDATION_FAILED`; ไม่พบหรือเป็นของ org อื่น → `NOT_FOUND` (F07); audit + outbox `branch.updated` ใน transaction เดียวกัน

<a id="rule-branch-list"></a>
### `branch.list`

200 `{ items: Branch[] }` ไม่มี pagination เรียง `createdAt` asc แล้ว `id` asc; รวมสาขา `isActive = false`; owner/manager เห็นทุกสาขาของ org, role ระดับสาขาเห็นเฉพาะสาขาใน `membership_branch` ของตัวเอง (F02)

<a id="rule-branch-capacity"></a>
### F05 สำหรับ `branch.create`

- นับ **ทุกแถว** `branch` ของ org (รวม `is_active = false` — ปิดสาขาไม่คืนโควตา); `max_branches` null = ไม่จำกัด; count ≥ `max_branches` → `PLAN_LIMIT_REACHED` (402) ไม่มี branch/hours/audit/outbox
- อ่านผ่าน public service ของ module `subscription` บน tenant transaction เดียวกัน: `SELECT … FOR UPDATE` แถว `subscription` ของ org **ก่อน** นับและก่อน insert branch — concurrent create และการเปลี่ยนแพ็กเกจในอนาคต (`platform.org.setPlan` ต้อง lock แถวเดียวกัน) จึง serialize กัน
- ไม่มีแถว subscription → `INTERNAL` (fail closed; signup สร้างเสมอ); plan `is_active = false` หรือ `current_period_end` ผ่านไปแล้ว → ยังบังคับ `max_branches` ของ plan นั้น (MVP ไม่มี lifecycle); ไม่เพิ่ม error code

<a id="rule-branch-version"></a>
### `branch.version` — per-aggregate version

- `version int not null default 1 check (version >= 1)`; แถวเดิมทั้งหมดได้ค่า 1 ตอน migrate (T-0038)
- ทุก `UPDATE` แถว branch เพิ่ม `version = version + 1` **ใน statement เดียวกัน** และอ่านค่าใหม่จาก `RETURNING` — row lock ของ UPDATE ทำให้ concurrent update ได้ค่าเรียงกันไม่ซ้ำ; ผู้เขียนแถว branch มีเฉพาะ module `org` (repository) จึงเป็นเจ้าของการ increment รวมถึง `branch.paymentSettings.update`
- `version` เพิ่มขึ้นแบบ strictly monotonic ต่อ branch แต่ **ไม่รับประกันต่อเนื่อง** ใน outbox (update ที่ไม่มี event เช่น PromptPay ทำให้เลขข้าม) — consumer ใช้เพื่อเรียงลำดับ/ทิ้ง event เก่า ไม่ใช่ตรวจว่าครบ

<a id="rule-branch-outbox"></a>
### Outbox `branch.created` / `branch.updated`

`org_id` = org, `branch_id` = `aggregate_id` = branch.id, `aggregate_type = 'branch'`, `aggregate_version` = `branch.version` หลังการเปลี่ยน (create = 1), `occurred_at = ctx.now`; `payload` = `Branch` DTO หลังการเปลี่ยน **ไม่รวม** `promptpayId`; `branch.updated` เพิ่ม `changedFields: string[]` (ชื่อ camelCase ของฟิลด์ที่ค่าเปลี่ยนจริง เรียงตามตัวอักษร); เขียนใน transaction เดียวกับการเปลี่ยนข้อมูลและ audit; request ที่ถูกปฏิเสธไม่มี event/audit

<a id="org-branch-technical-gates"></a>
### Proposed technical defaults (มนุษย์ยืนยันตอน merge — ไม่ใช่ business decision ใหม่)

1. PATCH ที่ทุกค่าเท่าเดิม (no-op): ตอบ 200 DTO ปัจจุบัน ไม่ UPDATE แถว ไม่เพิ่ม `version` ไม่มี audit/outbox
2. พิกัดใน PATCH ใช้กติกา "ทั้งคู่หรือไม่มีทั้งคู่" ระดับ request (ไม่ผสมกับค่าที่บันทึกอยู่)
3. `version` อยู่ใน `Branch` DTO ตามกติกา DTO = คอลัมน์ camelCase
4. increment เป็น application-owned (ไม่มี DB trigger); T-0014 ต้อง increment ด้วย statement เดียวกัน — ถ้าต้องการให้ DB บังคับทุก writer ให้เปลี่ยนเป็น `BEFORE UPDATE` trigger ใน T-0038 แทน


## 12. Branch schedule contract proposal (T-0013)

สถานะ: **proposed — human merge required**. Zo อนุญาตให้จัดทำ spec/card PR ตามคำแนะนำ ไม่ใช่การอนุมัติว่า business decisions ด้านล่าง merge แล้ว. ข้อ G1–G5 เป็นข้อเสนอที่เลือกคำตอบชัดเจนสำหรับ review; ใช้เป็น authoritative contract หลังมนุษย์ merge เท่านั้น. ห้ามเริ่ม implementation/dispatch T-0013 ก่อน merge; ไม่มี runtime/schema change ใน PR นี้.

<a id="contract-branch-schedule-common"></a>
### กติการ่วมของ schedule endpoints

- ใช้ `/api/v1` prefix เดิม; สี่ routes ตามตาราง endpoints เท่านั้น ไม่มี hours GET/closure PATCH. คง guard sequencing, F02/F04/F07/F09 และ permissions เดิม: owner/manager เขียน, ทั้งห้า roles อ่าน closure list ภายใน branch scope; suspended org อ่านได้แต่เขียนไม่ได้. Platform flag ไม่ bypass membership.
- `branchId`/`closureId` ต้อง UUID ตาม contract เดิม; normalize UUID เป็น lowercase หลัง validation. ตรวจ parent branch ภายใน tenant transaction แม้ list ว่าง; missing/foreign/unassigned branch → `NOT_FOUND` สำหรับผู้เรียกที่ผ่าน permission แล้ว. Closure ต้องตรงทั้ง org, branchId และ closureId; same-org wrong-branch/missing/foreign closure → `NOT_FOUND`.
- Body ของ PUT/POST ต้อง strict JSON object ทุกระดับ; unknown/system/tenant keys, missing required fields, wrong types และ invalid path → `VALIDATION_FAILED` (400) พร้อม `details.fields`. ไม่ coerce number/string/null. ใช้ dotted field paths เช่น `items.0.opensAt`, `items` สำหรับจำนวน/weekday ที่ขาด, `items.<index>.weekday` สำหรับซ้ำ/ผิดค่า, `endDate` สำหรับ reversed range; root body ใช้ `_` ตาม pipe เดิม.
- **ไม่มี query parameters ที่รองรับ** ทั้งสี่ routes: query key ใด ๆ (รวม filter/cursor/page/repeated keys) → `VALIDATION_FAILED` พร้อม field ของ key นั้น ไม่ ignore และไม่เพิ่ม pagination/filter โดยปริยาย. GET/DELETE ไม่รับ request body; nonempty body → `VALIDATION_FAILED` ที่ `_` (absent/zero-byte body ยอมรับ). ไม่แก้ common guards เพื่อ enforce กติกานี้.
- Errors ที่ใช้: `UNAUTHENTICATED`, `VALIDATION_FAILED`, `FORBIDDEN`, `PASSWORD_CHANGE_REQUIRED`, `NOT_FOUND`, `INTERNAL`; writes เพิ่ม `ORG_SUSPENDED`. ไม่เพิ่ม `CONFLICT`/plan/rate errors สำหรับ schedule; infra/DB/invariant failure → sanitized `INTERNAL` และ rollback. ใช้ envelope/status เดิมใน #errors.

<a id="contract-branch-hours"></a>
### G1 — hours PUT wire contract และ no-op

- รับ `{ items: [{ weekday, opensAt, closesAt }] }` เท่านั้น: exactly 7 entries, integer weekdays 1–7 อย่างละหนึ่ง; ทั้งสอง time keys required, เป็น null ทั้งคู่ (ปิด) หรือ string ทั้งคู่ที่ opensAt < closesAt. ห้าม equal/reversed/overnight intervals.
- เวลาเป็น ASCII `HH:mm` เท่านั้น (`00:00`–`23:59`); reject seconds/fractions/offset/24:00/whitespace ไม่ trim หรือ round เวลา. Persist ใน existing time columns; canonical output เป็น HH:mm.
- ตอบ **200** `{ items: [{ weekday, opensAt, closesAt }] }` เรียง weekday asc. นี่คือ exact projection: ไม่มี id, branchId, orgId, timestamps, version หรือ field อื่น แม้ §5 จะมีกติกา row DTO ทั่วไป.
- Lock parent ก่อนอ่าน/compare/update week. ต้องมี persisted 7 weekdays ตรง invariant มิฉะนั้น `INTERNAL` ไม่ repair. เทียบ semantic time values (DB อาจคืน HH:mm:ss) ไม่เทียบ raw representation; persisted non-minute precision ที่ไม่ตรง input ต้องถือเป็นการเปลี่ยน ไม่ truncate แล้วปลอม no-op.
- ถ้าเท่ากันทุกวัน: return projection เดิม ไม่ UPDATE children/parent ไม่เปลี่ยน timestamp/version และไม่มี event/audit. ถ้าเปลี่ยน: UPDATE เฉพาะ day rows ที่เปลี่ยน, preserve IDs/createdAt, updatedAt = ctx.now; parent bump/event หนึ่งครั้งตาม G4.

<a id="contract-branch-closures"></a>
### G2 — closure CRUD และ exact DTO

- POST รับ `{ startDate, endDate, reason? }` เท่านั้น; startDate/endDate required ตาม G3. reason omitted หรือ explicit null → null; string trim ด้วย ECMAScript trim แล้วต้องยาว 1–500 Unicode code points (เทียบ PostgreSQL char_length), blank/เกินขอบ → `VALIDATION_FAILED`; reject U+0000 และ lone surrogate ใน reason ก่อน SQL เป็น field validation (PostgreSQL UTF-8 text เก็บไม่ได้).
- POST ตอบ **201** `Closure` โดยตรง. `Closure` exact shape = `{ id, branchId, startDate, endDate, reason, createdAt, updatedAt }`; UUID strings lowercase, local date strings ตาม G3, reason key มีเสมอ (string/null), timestamps canonical UTC ISO `YYYY-MM-DDTHH:mm:ss.sssZ` จาก ctx.now ตอน create. ไม่ส่ง orgId/version/fields อื่น.
- DELETE item route `/branches/{branchId}/closures/{closureId}` เท่านั้น → **204 ไม่มี body**; repeated/absent delete → `NOT_FOUND` ไม่ใช่ idempotent success. ลบเฉพาะ selected record.
- GET collection → **200** `{ items: Closure[] }`, ทุก rows ของ branch รวม past/overlap ไม่มี filter/pagination; เรียง startDate asc, endDate asc, id asc (PostgreSQL UUID ordering). Empty → `{ items: [] }`; no write/version/event/audit. ไม่มี closure update endpoint.

<a id="rule-branch-closure-calendar"></a>
### G3 — calendar, overlap และ booking boundary

- Local dates ต้อง exact ASCII `YYYY-MM-DD`, ปี **0001–9999** เท่านั้น (ไม่รับ 0000, signed/expanded years, BC, infinity, datetime, offset หรือ whitespace). Validate real proleptic Gregorian calendar รวม leap years และ startDate <= endDate; ไม่ใช้ regex อย่างเดียวหรือ JS Date ที่ normalize invalid dates/ปี 00–99. ช่วงนี้อยู่ภายใน PostgreSQL date AD range และ round-trip ได้ด้วย four-digit wire format; ไม่อ้างว่ารองรับ PostgreSQL date ทุกค่าที่ DB เก็บได้.
- start/end เป็น **inclusive** local dates ของ Asia/Bangkok; ไม่ convert ผ่าน UTC midnight. Past, overlapping และ identical ranges ยอมรับเป็น independent records; effective closure เป็น union. ไม่มี overlap check/unique/exclusion constraint หรือ CONFLICT ใหม่; ลบหนึ่ง record ไม่ลบ overlapping records.
- เปลี่ยน settings เท่านั้น: ไม่ cancel/reject/reschedule bookings ที่มีอยู่ย้อนหลัง และไม่ implement availability/booking ในการ์ดนี้. Future booking services ต้องมี approved availability และ concurrent booking-vs-settings protocol ของตัวเอง; ข้อเสนอนี้ไม่อ้างว่าป้องกัน concurrent booking ได้แล้ว.

<a id="rule-branch-schedule-outbox"></a>
### G4 — parent serialization, version และ invalidation event

- ทุก effective hours PUT/closure POST/closure DELETE ใช้ ctx.db.run transaction เดียว: lock parent branch ด้วย existing lockBranch ก่อนอ่าน/แก้ children; child mutation → focused parent `UPDATE ... SET version = version + 1, updated_at = ctx.now ... RETURNING version` → appendOutbox หนึ่ง `branch.hours_changed` → commit. ห้าม rewrite basic/payment fields เพื่อ bump version.
- Schedule writers และ existing branch.update ใช้ parent-first lock order เดียวกัน. Parallel hours replacements ไม่ทิ้ง mixed week; parallel delete หนึ่งสำเร็จอีกคำขอ NOT_FOUND; effective writes ได้ unique monotonic parent versions. ไม่ใช้ constant version, max(outbox)+1 หรือ child counter; #rule-branch-version ยังคงไม่รับประกันเลข event ต่อเนื่อง.
- Outbox: org_id = current org; branch_id = aggregate_id = target branch.id; aggregate_type = `branch`; aggregate_version = returned parent version; occurred_at = ctx.now. **Exact payload `{ branchId, version }`** เป็น invalidation signal ไม่ใช่ Branch DTO/snapshot/changedFields; ไม่รวม reason/PromptPay. #rule-branch-outbox ใช้เฉพาะ branch.created/updated ไม่ขยาย payload มา schedule.
- GET/no-op PUT/rejected request ไม่ bump parent ไม่ enqueue. ทุก failure รวมหลัง child write/ตอน enqueue rollback children, parent timestamps/version และ outbox ทั้งหมด. Child application timestamps ใช้ ctx.now; preserve createdAt ของ existing hours rows. Relay/consumer delivery และ schedule read API สำหรับ future consumers ไม่อยู่ในการ์ดนี้; minimal event ไม่ใช่ promise ว่ามี consumer พร้อมแล้ว.

<a id="rule-branch-schedule-audit"></a>
### G5 — audit และ scope gate

ไม่สร้าง audit entry สำหรับ schedule mutations ใน T-0013 เพราะ §6 ไม่มี action นี้; ห้าม reuse branch.updated audit หรือ invent schedule action. Outbox ยังคง required และต้องทดสอบ rollback. การเพิ่ม audit ต้อง human-approved amendment ระบุ action/entity/before-after/privacy และ tests แยกก่อน.

ขอบเขตหนึ่ง implementation card: สี่ endpoints, existing schema/org module/permissions, no dependencies/migrations/UI/payments/auth changes/booking/relay/new hours read. วางแผนและวัด <600 non-test changed LOC ตาม AGENTS; ถ้าไม่พอหยุดขอ human-assigned split ไม่ mint T-0013A/B หรือใช้ T-0014. Card ที่แนบเป็น proposed จน human spec/card merge; merge ไม่ได้พิสูจน์ runtime tests หรือ dispatch implementation อัตโนมัติ.


## 13. Branch payment settings contract (T-0014)

สถานะ: business decisions **อนุมัติโดยมนุษย์ในแชท 2026-10-22** — T-0014-01 (A), T-0014-02 (A + สูตร check digit เป็น validation policy ของ PMS), T-0014-03 (A), T-0014-04 (B สำหรับ MVP) บันทึกในไฟล์ `docs/questions/T-0014-0N.md`. ข้อความนี้เป็น spec ที่มีผลเมื่อมนุษย์ merge เท่านั้น; ห้ามเริ่ม implementation T-0014 ก่อน merge. ไม่เพิ่ม error code, permission, audit action, outbox event, คอลัมน์ หรือ migration

<a id="contract-branch-payment-settings"></a>
### `branch.paymentSettings.update` wire contract

- `PUT /branches/{branchId}/payment-settings` · สิทธิ์ `branch.payment_settings.update` (owner เท่านั้น ตาม #permissions; manager และ role ระดับสาขา → `FORBIDDEN`)
- ใช้กติการ่วมของ §11: body เป็น strict JSON object `{ promptpayId }` — ต้องมี key `promptpayId`; ค่าเป็น string ที่ผ่าน #rule-branch-promptpay-format หลัง trim หรือ `null` เพื่อล้างค่า (สาขาไม่มี PromptPay); key ขาด, key อื่น (รวม `version`, `orgId`, `id`, ฟิลด์ของ `branch.update`) หรือชนิดผิด → `VALIDATION_FAILED` + `details.fields.<key>`
- `branchId` ไม่ใช่ UUID → `VALIDATION_FAILED`; ไม่พบหรือเป็นของ org อื่น → `NOT_FOUND` (F07); org `suspended` → `ORG_SUSPENDED` (F04); `UNAUTHENTICATED` / `PASSWORD_CHANGE_REQUIRED` ตาม guard เดิม; ข้อผิดพลาดอื่น → `INTERNAL` (rollback ทั้งหมด)
- query string: พฤติกรรมเดียวกับ `branch.update` (ไม่มีกติกาเพิ่ม)
- ตอบ **200** `Branch` DTO (#contract-branch) หลังการเปลี่ยน (หรือ DTO ปัจจุบันเมื่อ no-op) — `promptpayId` ใน DTO เป็นค่าจริง ไม่ mask
- ข้อความ error และ `details` ห้ามมีค่า `promptpayId` ที่ส่งมา

<a id="rule-branch-promptpay-format"></a>
### F08 — รูปแบบ PromptPay ID (รายละเอียด)

- trim เฉพาะ whitespace หัวท้าย; **ไม่** ตัดขีดหรือช่องว่างภายใน, **ไม่** แปลง `+66`; ค่าที่บันทึกคือค่าหลัง trim
- เบอร์มือถือ: ตรง `^0\d{9}$` ตาม F08 (ไม่มีกติกา prefix ผู้ให้บริการเพิ่ม)
- เลข 13 หลัก: `^\d{13}$` ไม่จำกัดเลขหลักแรก (รวม `0` เช่นเลขนิติบุคคล) และ check digit ต้องถูกตามสูตรนี้ — ให้ d1…d13 เป็นตัวเลขแต่ละหลัก, `S = Σ_{i=1..12} d_i × (14 − i)`, `checkDigit = (11 − (S mod 11)) mod 10`, ยอมรับเมื่อ `d13 = checkDigit`
  - ที่มา: **human decision 2026-10-22 (T-0014-02) เป็น validation policy ของ PMS** — ไม่ใช่การรับรองว่าหน่วยงานรัฐยืนยันสูตรหรือขอบเขตแล้ว. แหล่งทางการที่พบ (กรมสรรพากร: เลข `099…` ใช้วิธีเดียวกับเลขของกรมการปกครอง; มาตรฐานข้อมูลกลาง: หลักที่ 13 เป็น check digit) ไม่ระบุสูตร และไม่ระบุว่าเลข DBD `010–096` ใช้วิธีเดียวกัน; สูตรและ test vectors มาจากแหล่งรอง (python-stdnum) — รายละเอียดใน `docs/questions/T-0014-02.md`
  - check digit ที่ถูกต้องตรวจได้แค่การพิมพ์ผิด **ไม่ได้ยืนยัน** ว่าเลขนั้นลงทะเบียน PromptPay แล้ว, ว่ามีบัญชีอยู่จริง หรือว่าบัญชีเป็นของร้าน/ผู้ใช้; PMS ไม่ตรวจสิ่งเหล่านี้ใน MVP และ UI/ข้อความต้องไม่อ้างว่าตรวจแล้ว
- รูปแบบอื่นทั้งหมด (ว่างหลัง trim, 9/11/12/14 หลัก, ตัวอักษร, ขีด, ช่องว่างภายใน, `+66…`) → `VALIDATION_FAILED` ที่ `details.fields.promptpayId`

<a id="rule-branch-payment-settings-write"></a>
### การเขียน, no-op, version

- ใน `ctx.db.run` transaction เดียว: lock แถว branch (เหมือน `branch.update`) แล้วเทียบค่าหลัง trim กับค่าที่บันทึกอยู่
- ค่าเท่าเดิม (รวม `null` → `null`): ตอบ 200 DTO ปัจจุบัน ไม่ UPDATE, ไม่เพิ่ม `version`, ไม่เปลี่ยน `updated_at`, ไม่มี audit
- ค่าเปลี่ยนจริง: `UPDATE` statement เดียวตั้ง `promptpay_id`, `version = version + 1`, `updated_at = ctx.now` แล้วอ่าน `version` จาก `RETURNING` (#rule-branch-version) ไม่แตะคอลัมน์อื่น; เขียน audit ตาม #rule-branch-payment-settings-audit ใน transaction เดียวกัน
- **ไม่มี outbox event** (ตาม #rule-branch-version) — `branch.updated` ไม่ถูกส่งจาก endpoint นี้ และ payload ของ `branch.created`/`branch.updated` ยังไม่รวม `promptpayId` เหมือนเดิม
- request ที่ถูกปฏิเสธ หรือ transaction ล้มเหลว: ไม่มีการเปลี่ยนค่า, version, `updated_at` หรือ audit

<a id="rule-branch-payment-settings-audit"></a>
### Audit `branch.payment_settings_updated` (MVP)

- `action = 'branch.payment_settings_updated'`, `entity_type = 'branch'`, `entity_id = branch.id`, `actor_user_id` = ผู้เรียก, `occurred_at = ctx.now`, `org_id` = org ปัจจุบัน
- `before = { promptpayId: <ค่าเดิมแบบ mask> }`, `after = { promptpayId: <ค่าใหม่แบบ mask> }`
- กติกา mask: แทนทุกหลักก่อน 4 หลักสุดท้ายด้วย `*` — เบอร์ 10 หลัก `0812345678` → `******5678`; เลข 13 หลัก `1234567890123` → `*********0123`; `null` คงเป็น `null`
- ห้ามมีค่าเต็มใน audit payload, application log หรือ error message; การ mask ใช้กับ audit เท่านั้น ไม่เปลี่ยนค่าที่เก็บใน `branch` หรือ `Branch` DTO
- เหตุผล: การเปิดเผยเลขเพื่อรับชำระเงินไม่ได้แปลว่าเก็บสำเนาเต็มใน audit ได้โดยอัตโนมัติ; 4 หลักท้ายพอสำหรับตรวจว่าบัญชีรับเงินถูกเปลี่ยน


## 14. Staff list, invitations and invitation accept contract (T-0015, T-0042)

สถานะ: business decisions **อนุมัติโดยมนุษย์ในแชท 2026-10-22** — T-0015-01 (B), T-0015-02 (A), T-0015-03 (A), T-0015-04 (T1 + L1), T-0015-05 (base contract + V1; ไม่เลือก B/C), T-0015-06 (A), T-0015-07 (A) บันทึกในไฟล์ `docs/questions/T-0015-0N.md`; แบ่ง implementation เป็น T-0015 (list / invite / revoke + โครงสร้างร่วม) และ T-0042 (`invitation.accept`). ข้อความนี้มีผลเมื่อมนุษย์ merge เท่านั้น; ห้ามเริ่ม implementation ก่อน merge. ไม่เพิ่ม error code, permission, audit action, outbox event, คอลัมน์ หรือ migration

<a id="rule-staff-check-and-lock"></a>
### Two-phase check-and-lock (ทุก write ที่เปลี่ยนที่นั่งพนักงาน)

ใช้กับ `staff.invite` (รวม re-invite), `staff.invitation.revoke`, `invitation.accept` และ writer ในอนาคตที่เปลี่ยนที่นั่ง (T-0016 `staff.account.create`, T-0017 `staff.update`/`staff.remove`)

- **Phase 1 — ก่อน tenant lock ใด ๆ, ไม่เขียนข้อมูล:** guard เดิม (session, 2FA session, `PASSWORD_CHANGE_REQUIRED`; route ที่อยู่ในร้านมี `X-Org-Id`, membership, `ORG_SUSPENDED`, permission ตามลำดับ guard เดิม), validation ของ request, กติกาที่ดูจาก request อย่างเดียว; `invitation.accept` เพิ่ม parse token, ตรวจ managed / verified email และ tenant preflight (#contract-invitation-accept)
- **Phase 2 — transaction เดียวของ tenant** (สำหรับ accept คือ transaction เดียวกับ preflight): ล็อกตามลำดับนี้เสมอ ขั้นที่ไม่ใช้ให้ข้าม ห้ามสลับลำดับ
  1. แถว `subscription` ของ org `FOR UPDATE` (แถวเดียวกับ #rule-branch-capacity) — ไม่มีแถว → `INTERNAL` (fail closed)
  2. แถว `invitation` ที่เกี่ยวข้อง `FOR UPDATE` เรียงตาม id
  3. แถว `membership` ของ (org, user) `FOR UPDATE` เมื่อมีอยู่
- หลังได้ lock และก่อนเขียน ตรวจสถานะที่ operation ต้องใช้ใหม่ทั้งหมด (รวมสิ่งที่ phase 1 อ่านไว้แล้ว) — check แรกที่ไม่ผ่านเป็นคำตอบ; ล้มใน phase 2 → rollback ทั้งหมด ไม่มี write, audit หรือ email
- ลำดับ error ของแต่ละ endpoint อยู่ใน contract ของ endpoint นั้น

<a id="rule-staff-capacity"></a>
### F05 สำหรับพนักงาน (`max_staff`)

- จำนวน = `membership` ที่ `status = 'active'` ทุก role (**รวม owner** และบัญชี managed) + `invitation` ที่ `accepted_at` null, `revoked_at` null และ `expires_at > now` — นับใน **SQL statement เดียว** ขณะถือ lock ข้อ 1
- re-invite ที่แทนคำเชิญเดิมของ email เดียวกัน ไม่นับใบเดิม
- จำนวน ≥ `max_staff` → `PLAN_LIMIT_REACHED` (402); `max_staff` null = ไม่จำกัด; plan inactive/หมดอายุยังบังคับ (เหมือน #rule-branch-capacity)
- `invitation.accept` **ไม่ตรวจ limit ซ้ำ** (ที่นั่งถูกจองตอนเชิญแล้ว) แต่ยังถือ lock ข้อ 1 เพื่อ serialize การเปลี่ยน "คำเชิญค้าง → สมาชิก active" กับการนับของ invite และการยกเลิกของ re-invite; การลดแพ็กเกจภายหลังไม่ยกเลิกคำเชิญที่ค้างและไม่บล็อก accept

<a id="rule-invitation-token"></a>
### Token, ลิงก์ และอีเมลคำเชิญ

- token = `<orgId>.<32 random bytes base64url>`; `token_hash` = SHA-256 (hex) ของ token ทั้งชุด; token ไม่ถูกเก็บ, ไม่ส่งใน response, ไม่อยู่ใน audit หรือ application log
- ลิงก์ในอีเมล: `${APP_ORIGIN}/invite#token=<token>` (fragment — ไม่อยู่ใน request path และไม่ไปกับ `Referer`); API รับ token ใน JSON body ของ `invitation.accept` เท่านั้น ไม่รับทาง path/query
- ส่งอีเมลหลัง commit ผ่าน `EmailSender` (ทำงานเบื้องหลัง); ส่งล้มเหลวไม่เปลี่ยน response และไม่ rollback; log เก็บเฉพาะ error category ไม่มี token, ที่อยู่อีเมล หรือลิงก์
- หัวเรื่อง: `คำเชิญเข้าร่วมร้าน <displayName ของร้าน>`
- เนื้อหา: `คุณได้รับคำเชิญให้เข้าร่วมร้าน <displayName> ในตำแหน่ง <label ของ role ตาม #roles>` · `เปิดลิงก์นี้เพื่อรับคำเชิญ (ใช้ได้ครั้งเดียวและหมดอายุใน 7 วัน):` · ลิงก์ · `ถ้าคุณไม่ได้คาดว่าจะได้รับคำเชิญนี้ ไม่ต้องทำอะไร`
- การทดสอบ log ของแอปพิสูจน์ได้แค่ว่าโปรเซสของเราไม่ log token — ไม่ได้รับประกันว่า proxy, ผู้ให้บริการอีเมล หรือ browser จะไม่เผย token

<a id="contract-staff-list"></a>
### `staff.list`

- `GET /staff` · `staff.read` → 200 `{ members: StaffMember[], invitations: PendingInvitation[] }` ไม่มี pagination; query string ไม่มีกติกาเพิ่ม (เหมือน `branch.list`)
- `StaffMember = { membershipId, userId, displayName, email, username, role, branchIds, status, isManaged, twoFactorEnabled, createdAt }` เฉพาะ `status = 'active'`; `email` = null สำหรับบัญชี managed (ห้ามแสดง `@managed.invalid`); `username` = null เมื่อไม่มี
- `PendingInvitation = { id, email, role, branchIds, expiresAt, invitedByUserId, createdAt }` เฉพาะ `accepted_at` null, `revoked_at` null และ `expires_at > now`
- เรียง: members ตาม role (owner → manager → front_desk → groomer → caretaker) แล้ว `displayName` แล้ว `membershipId`; invitations ตาม `createdAt` ใหม่ → เก่า แล้ว `id`
- owner / manager เห็นทุกแถวและทุก `branchIds`
- `front_desk` (F02 — ไม่มีข้อยกเว้น):
  - เห็นสมาชิก role ระดับสาขาที่ `branchIds` ทับกับสาขาของตัวเองอย่างน้อย 1 สาขา และเห็น owner / manager ที่ active ทุกคน (role ทั้ง org แสดง `branchIds: []`)
  - `branchIds` ของทุกแถวแสดงเฉพาะสาขาที่ตัวเองมี (intersection) ไม่เปิดเผยสาขาอื่น
  - เห็นคำเชิญ role ระดับสาขาที่ `branchIds` ทับกับสาขาของตัวเอง (`branchIds` ตัดแบบเดียวกัน); ไม่เห็นคำเชิญ owner / manager
  - คอลัมน์เหมือนกับ owner / manager (`email`, `username`, `twoFactorEnabled`) — F02 จำกัดแถวและสาขา ไม่จำกัดคอลัมน์
- `groomer` / `caretaker` → `FORBIDDEN` (ไม่มี `staff.read`)

<a id="contract-staff-invite"></a>
### `staff.invite` และ re-invite

- `POST /staff/invitations` · `staff.invite` · strict body ตาม §11 `{ email, role, branchIds }`
  - `email`: trim, แปลงเป็นตัวพิมพ์เล็ก, รูปแบบ email, 1–254 ตัวอักษร, ห้ามลงท้าย `@managed.invalid`
  - `role`: `staff_role`
  - `branchIds`: array ของ UUID ไม่ซ้ำ; role ระดับสาขาต้องมี ≥ 1; owner / manager ต้องส่ง `[]`; สาขา `is_active = false` ใช้ได้
- ลำดับ error (check แรกที่ไม่ผ่านเป็นคำตอบ):
  1. guard เดิม (`UNAUTHENTICATED`, `X-Org-Id`, `PASSWORD_CHANGE_REQUIRED`, `ORG_SUSPENDED`, `FORBIDDEN` permission)
  2. body ผิด (รวม UUID ผิดรูปแบบ, id ซ้ำ, owner/manager ส่ง branch) → `VALIDATION_FAILED` + `details.fields.<key>`
  3. manager ขอ role `owner` / `manager` → `FORBIDDEN` (¹)
  4. role ระดับสาขาแต่ `branchIds` ว่าง → `BRANCH_REQUIRED`
  5. phase 2: lock subscription (ไม่มี → `INTERNAL`) → lock คำเชิญค้างของ email นี้
  6. UUID ถูกรูปแบบแต่ไม่พบเป็นสาขาใน tenant ปัจจุบัน (ไม่มีจริงหรือเป็นของ org อื่น — ไม่ค้นข้าม tenant เพื่อแยก) → `NOT_FOUND` (F07)
  7. ผู้เรียกเป็น manager และคำเชิญค้างที่ล็อกไว้ใบใดเป็น `owner` / `manager` → `FORBIDDEN` (¹ — re-invite จะยกเลิกใบนั้น) ใบเดิมไม่เปลี่ยน ไม่มีใบใหม่ ไม่มี audit ไม่มีอีเมล
  8. หา user จาก email (ผ่าน public API ของ module `identity` บน transaction เดียวกัน ไม่ล็อกแถว user) แล้ว lock membership ของ user เหล่านั้นใน org นี้: มี `active` → `ALREADY_MEMBER`; ไม่มี user, ไม่มี membership หรือมีแค่ `removed` → ผ่าน
  9. #rule-staff-capacity → `PLAN_LIMIT_REACHED`
- เขียน: คำเชิญค้างเดิมของ email นี้ได้ `revoked_at = now`, `updated_at = now` (F03 — ไม่มี audit แยก); insert คำเชิญใหม่ `expires_at = now + 7 วัน`; audit `staff.invited` (`entity_type 'invitation'`, `entity_id` = id ใหม่, `before` null, `after { email, role, branchIds, expiresAt }`) ใน transaction เดียวกัน; ส่งอีเมลตาม #rule-invitation-token หลัง commit
- ตอบ **201** `Invitation = { id, email, role, branchIds, expiresAt, invitedByUserId, createdAt }` (ไม่มี token / hash)
- ข้อจำกัด: user ที่สมัครหรือเปลี่ยน email หลังขั้น 8 จะไม่ถูกเห็น — สถานะสมาชิกตัดสินจริงตอน accept

<a id="contract-staff-invitation-revoke"></a>
### `staff.invitation.revoke`

- `DELETE /staff/invitations/{invitationId}` · `staff.invite` · body / query ตามกติกา DELETE ของ #contract-branch-schedule-common · ตอบ **204** ไม่มี body
- ลำดับ error: guard เดิม → `invitationId` ไม่ใช่ UUID → `VALIDATION_FAILED` → phase 2: lock subscription (ไม่มี → `INTERNAL`) → lock คำเชิญ → ไม่พบ, เป็นของ org อื่น, ใช้แล้ว, ยกเลิกแล้ว หรือหมดอายุ → `NOT_FOUND` → ผู้เรียกเป็น manager และคำเชิญเป็น `owner` / `manager` → `FORBIDDEN`
- เขียน `revoked_at = now`, `updated_at = now`; **ไม่มี audit** (§6 ไม่มี action นี้ — การเพิ่มต้องเป็น amendment แยก)
- แข่งกับ accept: ใครได้ lock ก่อนชนะ — revoke ชนะ → accept ได้ `INVITATION_INVALID` ไม่มี membership; accept ชนะ → revoke ได้ `NOT_FOUND` membership คงอยู่

<a id="contract-invitation-accept"></a>
### `invitation.accept` (เฉพาะผู้ที่มีบัญชีและ login แล้ว)

- `POST /invitations/accept` · user ที่ login แล้ว (ไม่ต้องมี `X-Org-Id`) · strict body `{ token }` (string 1–200 ตัวอักษร) · ผู้ที่ยังไม่มีบัญชีดู #rule-invite-signup-followup
- ลำดับการตรวจ (check แรกที่ไม่ผ่านเป็นคำตอบ):
  - Phase 1 (ไม่ล็อก ไม่เขียน):
    1. guard เดิม → `UNAUTHENTICATED` (ไม่มี session / ยังไม่ผ่าน 2FA) หรือ `PASSWORD_CHANGE_REQUIRED`
    2. body ผิด → `VALIDATION_FAILED`
    3. token ผิดรูปแบบ → `INVITATION_INVALID`
    4. user เป็นบัญชี managed → `INVITATION_INVALID` (F09)
    5. `emailVerified = false` → `UNAUTHENTICATED` — ตรวจที่ use case เพราะ guard ไม่ตรวจ ตามความหมายของ #rule-email-login-policy (บัญชี real-email ที่ยังไม่ verify ไม่มี session ที่ใช้ได้)
    6. tenant preflight ใน `withTenant(orgId จาก token)` อ่านคำเชิญด้วย hash แบบไม่ล็อก: ไม่พบ (รวม org ที่ไม่มีจริง), ใช้แล้ว, ยกเลิกแล้ว, หมดอายุ (`expires_at <= now`) หรือ email ไม่ตรงกับ email ของ user (ไม่สนตัวพิมพ์) → `INVITATION_INVALID`
    7. org `suspended` → `ORG_SUSPENDED`
  - Phase 2 (transaction เดียวกับ preflight):
    8. lock subscription — ไม่มีแถว → `INTERNAL` (ถึงขั้นนี้ได้เฉพาะเมื่อ org และคำเชิญมีจริง จึงเป็นข้อมูลผิดปกติ ห้ามแปลงเป็น `INVITATION_INVALID`)
    9. lock คำเชิญแล้วตรวจเงื่อนไขข้อ 6 ซ้ำ → `INVITATION_INVALID`
    10. อ่าน `organization.status` ซ้ำ → `ORG_SUSPENDED`
    11. lock membership ของ (org, user): `active` → `ALREADY_MEMBER` (409) คำเชิญไม่ถูกใช้
    12. เขียน
- ข้อ 3–5 และข้อ 7 ไม่รอ tenant lock ใด ๆ
- เขียน (transaction เดียว):
  - ไม่มี membership → insert membership (`role` จากคำเชิญ, `display_name = user.name`, `status 'active'`) + `membership_branch` ตาม `branchIds`
  - มี membership `removed` → เปิดใช้แถวเดิม: `status = 'active'`, `role` และ `membership_branch` แทนด้วยค่าจากคำเชิญ, `display_name` เดิม, `updated_at = now`
  - คำเชิญ `accepted_at = now`, `updated_at = now`
  - audit `staff.joined`: actor = user, `entity_type 'membership'`, `entity_id` = membership id, `before` null (หรือ `{ status: 'removed' }` เมื่อกลับเข้าร่วม), `after { role, branchIds, invitationId }`
  - ไม่ตรวจ `max_staff` (#rule-staff-capacity); ไม่มี outbox
- ตอบ **200** `{ orgId, membershipId, role, branchIds }`

<a id="rule-invite-signup-followup"></a>
### ผู้รับเชิญที่ยังไม่มีบัญชี (follow-up)

- ข้อความ "หรือสมัครใหม่ใน flow เดียวกัน" ใน #ep-invitation.accept และ "สมัครแล้วรับคำเชิญ" ใน #scr-invite-accept ยัง **ไม่มีผล** จนกว่าจะมี spec amendment สำหรับการสมัครที่ผูกกับ token คำเชิญ (สร้างเฉพาะ user ไม่สร้างร้าน) และการ์ดที่มนุษย์ออกเลขให้
- ห้ามใช้ `auth.signup` (สร้างร้านใหม่เสมอ) เป็นทางแก้ชั่วคราว
- T-0026 ส่ง flow สำหรับผู้ที่ login แล้วได้ก่อน; flow ผู้ที่ยังไม่มีบัญชีขึ้นกับ follow-up นี้


## 15. Managed staff accounts contract (T-0016)

สถานะ: business decisions **อนุมัติโดยมนุษย์ในแชท 2026-10-23** — T-0016-01 (A), T-0016-02 (A), T-0016-03 (A), T-0016-04 (A), T-0016-05 (A) บันทึกในไฟล์ `docs/questions/T-0016-0N.md`. ข้อความนี้มีผลเมื่อมนุษย์ merge เท่านั้น; ห้ามเริ่ม implementation ก่อน merge. ไม่เพิ่ม error code, permission, audit action, คอลัมน์ หรือ migration

<a id="rule-managed-account-roles"></a>
### Role ของบัญชี managed

ตาม F09 และ ¹ ตามที่เขียนไว้: owner สร้างบัญชี managed ได้ทุก role; manager สร้างได้เฉพาะ role ระดับสาขา (`front_desk`, `groomer`, `caretaker`) — ขอ `owner`/`manager` → `FORBIDDEN`. บัญชี managed ไม่มีการกู้รหัสทาง email; การรีเซ็ตทำได้ผ่าน #contract-staff-password-reset เท่านั้น

<a id="rule-managed-account-identity"></a>
### การสร้างแถว identity ของบัญชี managed

- module `identity` มี public function ที่รันบน **tenant transaction เดียวกับ org** และเป็นผู้เขียนตาราง identity ทั้งหมด (ADR-0002; org ห้ามเขียนตาราง identity เอง)
- สร้าง user id เอง แล้ว insert `user`: `name` = displayName, `email = <user_id>@managed.invalid`, `username`, `email_verified = false`, `is_managed = true`, `managed_by_org_id` = org, `must_change_password = true`; และ `account` (`provider_id 'credential'`, `account_id` = user id) ที่ password hash ด้วย hasher เดียวกับ Better Auth (login ด้วย username ทำงานตามเดิม)
- ไม่สร้าง session, ไม่ส่งอีเมล, ห้ามตั้ง `email_verified = true`; ล้มเหลวที่ใด rollback ทั้งบัญชี membership และ audit
- login ด้วย `<user_id>@managed.invalid` (หรือ email ใดที่ชี้ไปยังบัญชี managed) → ปฏิเสธตาม #rule-email-login-policy (T-0016-05 A); `PasswordChangeGuard` ไม่เปลี่ยน

<a id="contract-staff-account-create"></a>
### `staff.account.create`

- `POST /staff/accounts` · `staff.invite` · strict body ตาม §11 `{ displayName, username, password, role, branchIds }`
  - `displayName`: trim, 1–100 ตัวอักษร; ใช้เป็นทั้ง `membership.display_name` และ `user.name`
  - `username`: trim แล้วแปลงเป็นตัวพิมพ์เล็ก แล้วต้องตรง `^[a-z0-9._-]{3,40}$`
  - `password`: 10–128 ตัวอักษร (F11) ไม่ trim
  - `role`, `branchIds`: กติกาเดียวกับ #contract-staff-invite
- ลำดับ error (check แรกที่ไม่ผ่านเป็นคำตอบ):
  1. guard เดิม (รวม `ORG_SUSPENDED`, `FORBIDDEN` permission)
  2. body ผิด → `VALIDATION_FAILED` + `details.fields.<key>`
  3. manager ขอ role `owner`/`manager` → `FORBIDDEN` (#rule-managed-account-roles)
  4. role ระดับสาขาแต่ `branchIds` ว่าง → `BRANCH_REQUIRED`
  5. phase 2 (#rule-staff-check-and-lock): lock subscription (ไม่มี → `INTERNAL`) แล้วอ่าน `organization.status` ซ้ำ → `ORG_SUSPENDED`
  6. branch id ไม่อยู่ใน tenant → `NOT_FOUND` (F07)
  7. #rule-staff-capacity → `PLAN_LIMIT_REACHED`
  8. username ถูกใช้แล้วโดยบัญชีใดก็ได้ (ไม่สนตัวพิมพ์) → `CONFLICT`; unique violation จากการสร้างพร้อมกันก็ map เป็น `CONFLICT`
- เขียนใน transaction เดียว: บัญชีตาม #rule-managed-account-identity, `membership` (`status 'active'`), `membership_branch`, audit `staff.account_created` (`entity_type 'membership'`, `entity_id` = membership id, `before` null, `after { username, displayName, role, branchIds }`)
- ตอบ **201** `StaffMember` (#contract-staff-list; `email` null, `isManaged` true)
- รหัสผ่านและ hash ห้ามอยู่ใน response, audit หรือ application log (รวม query params ของ error)

<a id="contract-staff-password-reset"></a>
### `staff.password.reset`

- `PUT /staff/{membershipId}/password` · `staff.update` · strict body `{ newPassword }` (10–128, ไม่ trim)
- ลำดับ error:
  1. guard เดิม
  2. `membershipId` ไม่ใช่ UUID หรือ body ผิด → `VALIDATION_FAILED`
  3. tenant transaction: lock membership เป้าหมาย (ไม่ lock subscription — การรีเซ็ตไม่เปลี่ยนที่นั่ง) — ไม่พบ, เป็นของ org อื่น หรือ `removed` → `NOT_FOUND`
  4. อ่าน `organization.status` ซ้ำ → `ORG_SUSPENDED`
  5. ผู้เรียกเป็น manager และเป้าหมายเป็น `owner`/`manager` → `FORBIDDEN` (ตรวจก่อนข้อ 6 เพื่อไม่เปิดเผยว่าบัญชีของ owner เป็น managed หรือไม่)
  6. บัญชีเป้าหมายไม่ใช่ managed หรือ managed โดย org อื่น → `MANAGED_ACCOUNT_ONLY`
- เขียนใน transaction เดียว (ผ่าน public function ของ `identity`): password hash ใหม่, `must_change_password = true`, ลบ **ทุก** session ของบัญชีนั้น (รวม 2FA session markers); audit `staff.password_reset` (`entity_type 'membership'`, `entity_id` = membership id, `before`/`after` null)
- ไม่เปลี่ยนการตั้งค่า 2FA; ผู้เรียกรีเซ็ต membership ของตัวเองได้ตามกติกาเดียวกัน (ไม่มีกรณีพิเศษ)
- ตอบ **204** ไม่มี body


## 16. Staff update and remove contract (T-0017)

สถานะ: business decisions **อนุมัติโดยมนุษย์ในแชท 2026-10-23** — T-0017-01 (A), T-0017-02 (A), T-0017-03 (A), T-0017-04 (A) บันทึกในไฟล์ `docs/questions/T-0017-0N.md`. ข้อความนี้มีผลเมื่อมนุษย์ merge เท่านั้น. #rule-staff-caller-recheck และตำแหน่งของมันในลำดับ error ด้านล่าง **อนุมัติโดยมนุษย์ในแชท 2026-10-23** (หลัง review) — ขยายจาก #rule-staff-check-and-lock ไม่เพิ่ม code ใหม่. ไม่เพิ่ม error code, permission, audit action, คอลัมน์ หรือ migration

<a id="rule-staff-caller-recheck"></a>
### ตรวจผู้เรียกซ้ำใน phase 2

- หลังได้ lock subscription และอ่าน `organization.status` ซ้ำ ก่อนอ่าน/lock เป้าหมายและก่อนเขียนใด ๆ: อ่าน membership ของผู้เรียกใน org นี้ใหม่ (ทุก writer ที่เปลี่ยน role/status ของ membership ถือ lock subscription ก่อน จึงค่าที่อ่านได้นิ่งจน commit)
  - ไม่พบ หรือไม่ `active` → `FORBIDDEN` (เหมือน guard เดิม)
  - role ปัจจุบันไม่มี permission ของ endpoint (`staff.update` / `staff.remove`) → `FORBIDDEN`
  - กติกา ¹ ทุกข้อในลำดับ error ใช้ **role ปัจจุบันนี้** ไม่ใช้ role ที่ guard อ่านไว้ใน phase 1
- ล้มที่ขั้นนี้ → rollback ไม่มี write หรือ audit

<a id="contract-staff-update"></a>
### `staff.update`

- `PATCH /staff/{membershipId}` · `staff.update` · strict body ตาม §11 อย่างน้อย 1 ฟิลด์: `displayName` (trim 1–100; เปลี่ยนเฉพาะ `membership.display_name` ไม่แตะ `user.name`), `role` (`staff_role`), `branchIds` (UUID ไม่ซ้ำ)
- สถานะหลังแก้ต้องถูกต้อง: role ระดับสาขาต้องมี ≥ 1 สาขา; owner/manager ไม่มีสาขา — เปลี่ยนเป็น owner/manager โดยไม่ส่ง `branchIds` = ล้างสาขา; เปลี่ยนจาก owner/manager เป็น role ระดับสาขาต้องส่ง `branchIds`
- ลำดับ error:
  1. guard เดิม
  2. id/body ผิด → `VALIDATION_FAILED`
  3. phase 2 (#rule-staff-check-and-lock): lock subscription (ไม่มี → `INTERNAL`), อ่าน `organization.status` ซ้ำ → `ORG_SUSPENDED`, ตรวจผู้เรียกซ้ำ (#rule-staff-caller-recheck) → `FORBIDDEN`, lock membership เป้าหมาย — ไม่พบ, org อื่น หรือ `removed` → `NOT_FOUND`
  4. ผู้เรียก (role ปัจจุบันจากข้อ 3) เป็น manager และ (เป้าหมายเป็น owner/manager หรือ role ใหม่เป็น owner/manager) → `FORBIDDEN` (รวม membership ของตัวเอง)
  5. เป้าหมายเป็น/ยังคงเป็น owner/manager แต่ส่ง `branchIds` ไม่ว่าง (ไม่ได้ส่ง `role`) → `VALIDATION_FAILED` ที่ `details.fields.branchIds` (T-0017-04 A); role ระดับสาขาโดยไม่มีสาขา → `BRANCH_REQUIRED`; branch id ไม่อยู่ใน tenant → `NOT_FOUND`
  6. ลด role ของ owner `active` คนสุดท้าย (รวมตัวเอง) → `LAST_OWNER` (F01; นับภายใต้ lock ข้อ 3)
  7. #rule-managed-account-roles
- ทุกค่าเท่าเดิม → 200 `StaffMember` ไม่เขียนอะไร
- เขียนใน transaction เดียว: role, `display_name`, `updated_at`, แทน `membership_branch`; audit `staff.role_changed` ทุกครั้งที่มีการเปลี่ยนจริง โดย `before`/`after` เฉพาะฟิลด์ที่เปลี่ยน (`role`, `branchIds`, `displayName`)
- ตอบ **200** `StaffMember` (#contract-staff-list)

<a id="contract-staff-remove"></a>
### `staff.remove`

- `DELETE /staff/{membershipId}` · `staff.remove` · body/query ตามกติกา DELETE ของ #contract-branch-schedule-common · ตอบ **204**
- ลำดับ error: guard เดิม → id ไม่ใช่ UUID → `VALIDATION_FAILED` → phase 2: lock subscription, `ORG_SUSPENDED` ซ้ำ, ตรวจผู้เรียกซ้ำ (#rule-staff-caller-recheck) → `FORBIDDEN`, lock เป้าหมาย (ไม่พบ / org อื่น / `removed` แล้ว → `NOT_FOUND`) → ผู้เรียก (role ปัจจุบัน) เป็น manager กับเป้าหมาย owner/manager (รวมตัวเอง) → `FORBIDDEN` → owner `active` คนสุดท้าย → `LAST_OWNER`
- เขียนใน transaction เดียว: `status = 'removed'`, `updated_at`; เก็บแถว `membership_branch` ไว้เป็นประวัติ (เข้าร่วมใหม่ผ่าน #contract-invitation-accept จะแทนที่); audit `staff.removed` (`entity_type 'membership'`, `before { status: 'active', role, branchIds }`, `after { status: 'removed' }`)
- session ("ล้าง session ของผู้ใช้ใน org นี้" มีความหมายดังนี้):
  - บัญชี managed ของ org นี้ → ลบ **ทุก** session ของบัญชีนั้น (บัญชีใช้งานไม่ได้แล้วตาม F09)
  - บัญชี real-email → ไม่ลบ session; guard ของร้านตรวจ `membership.status` ทุก request จึงบล็อกร้านนี้ทันที และร้านอื่นของผู้ใช้ไม่ได้รับผลกระทบ
- การนำออกคืนที่นั่ง (#rule-staff-capacity)


## 17. Audit list and subscription read contract (T-0018)

สถานะ: business decisions **อนุมัติโดยมนุษย์ในแชท 2026-10-23** — T-0018-01 (B), T-0018-02 (A), T-0018-03 (A), T-0018-04 (A), T-0018-05 (A) บันทึกในไฟล์ `docs/questions/T-0018-0N.md`. ข้อความนี้มีผลเมื่อมนุษย์ merge เท่านั้น. เพิ่ม index หนึ่งตัวบน `audit_log` (migration ที่ generate); ไม่เพิ่ม error code, permission หรือ audit action

<a id="contract-audit-list"></a>
### `audit.list`

- `GET /audit-logs` · `audit.read` (owner) · query key ได้เฉพาะ `from`, `to`, `action`, `actorUserId`, `cursor` (key อื่น → `VALIDATION_FAILED`)
  - `from`, `to`: ISO instant (UTC); `from` รวม, `to` ไม่รวม; ไม่บังคับทั้งคู่ ส่งตัวเดียวได้ (T-0018-04 A); เมื่อส่งครบสองตัวต้อง `from < to` และห่างกันไม่เกิน 366 วัน (เทียบความละเอียดระดับ microsecond เหมือน `timestamptz`)
  - `action`: ต้องเป็นหนึ่งใน §6
  - `actorUserId`: UUID (ไม่ตรงกับใคร → หน้าว่าง ไม่ใช่ `NOT_FOUND`)
  - `cursor`: string ทึบจากหน้าก่อน; ผิดรูปแบบหรือถูกแก้ → `VALIDATION_FAILED`
- ตอบ 200 `{ items: AuditEntry[], nextCursor: string | null }` หน้าละ 50 เรียง `occurredAt` ใหม่ → เก่า แล้ว `id` จากมากไปน้อย (keyset)
- `AuditEntry = { id, occurredAt, action, entityType, entityId, actor: { userId, displayName } | null, before, after }`; `actor.displayName` = `membership.display_name` ของผู้ทำในร้านนี้ (รวมสมาชิกที่ถูกนำออก) ถ้าไม่มีใช้ชื่อบัญชี; `actor` null เมื่อ `actor_user_id` null; **ไม่ส่ง** `ip` และ `userAgent`
- RLS: เห็นเฉพาะแถวของร้าน (แถวระดับ platform ที่ `org_id` null ไม่แสดง); อ่านได้แม้ร้านถูกระงับ (F04)
- index: `audit_log (org_id, occurred_at desc, id desc)`

<a id="contract-subscription-get"></a>
### `subscription.get`

- `GET /subscription` · `subscription.read` (owner, manager) → 200 `{ plan: { code, name, maxBranches, maxStaff, priceSatangPerMonth }, startedAt, currentPeriodEnd, usage: { branches, staff: { active, pendingInvitations, total } } }`
- `usage.branches` = การนับของ #rule-branch-capacity; `usage.staff.total` = การนับของ #rule-staff-capacity (`active` + `pendingInvitations`); `maxBranches`/`maxStaff` null = ไม่จำกัด
- ไม่ส่ง `note` และ `is_active` ของแพ็กเกจ; ไม่มีแถว subscription → `INTERNAL`; อ่านได้แม้ร้านถูกระงับ


## 18. Platform admin contract (T-0019, T-0020)

สถานะ: business decisions **อนุมัติโดยมนุษย์ในแชท 2026-10-23** — T-0019-01 (B), T-0019-02 (A), T-0019-03 (B), T-0020-01 (A), T-0020-02 (A) บันทึกในไฟล์ `docs/questions/`. ข้อความนี้มีผลเมื่อมนุษย์ merge เท่านั้น. เพิ่ม audit action `platform.org_viewed` (§6) และ endpoint `platform.plan.list`; T-0019-04 (A) อนุมัติโดยมนุษย์ในแชท 2026-10-23. ไม่เพิ่ม error code, permission, คอลัมน์ หรือ migration

<a id="rule-platform-module"></a>
### โครงสร้างและการเข้าถึง

- ทุก endpoint `platform.*` ใช้ `PlatformAdminGuard` เดิม: ไม่มี session → `UNAUTHENTICATED`; ไม่ใช่ platform admin → `FORBIDDEN`; ยังไม่ผ่าน 2FA → `TWO_FACTOR_REQUIRED`; ไม่ใช้ `X-Org-Id`; ร้านที่ถูกระงับไม่บล็อก `platform.*` (F04)
- module ใหม่ `platform`; การอ่านข้ามร้านทำผ่าน public read function ของ `org` และ `subscription` บน platform connection (ADR-0003) และกรองอย่างชัดเจน; การเขียนทำใน tenant transaction ของร้านนั้น (`withTenant(orgId)` บน runtime connection) ผ่าน public function ของ module เจ้าของตาราง
- audit `platform.org_viewed` ทุกครั้งที่อ่านรายละเอียดร้าน (`platform.org.get`) (T-0019-03 B): `org_id` = ร้านเป้าหมาย (T-0019-04 A) เขียนใน tenant transaction ของร้านนั้นตามกติกาการเขียนข้อด้านบน — เจ้าของร้านเห็นใน #contract-audit-list, actor = admin, `entity_type 'organization'`, `entity_id` = org id, `before`/`after` null; รายการค้นหา (`platform.org.list`) ไม่บันทึก
- usage ทุกจุดใช้การนับของ #rule-branch-capacity และ #rule-staff-capacity

<a id="contract-platform-org-read"></a>
### `platform.org.list` และ `platform.org.get`

- `GET /platform/orgs` query key ได้เฉพาะ `q`, `status`, `cursor`: `q` trim 1–100 ค้นแบบ substring ไม่สนตัวพิมพ์ใน `slug`, `displayName` และ email ของ owner ที่ `active`; `status` ∈ `active`/`suspended`; หน้าละ 50 เรียง `createdAt` ใหม่ → เก่า แล้ว `id`; ตอบ `{ items: PlatformOrgSummary[], nextCursor }` โดย `PlatformOrgSummary = { id, slug, displayName, status, plan: { code, name }, usage: { branches, staff }, createdAt }`
- `GET /platform/orgs/{orgId}`: id ไม่ใช่ UUID → `VALIDATION_FAILED`; ไม่พบ → `NOT_FOUND`; ตอบ `{ organization: Organization (#contract-org), subscription: { plan: { code, name, maxBranches, maxStaff, priceSatangPerMonth, isActive }, startedAt, currentPeriodEnd, note }, usage: { branches, staff: { active, pendingInvitations, total } }, owners: [{ userId, displayName, email, username }] }`; `owners` = membership owner ที่ active; `email` null สำหรับบัญชี managed

<a id="contract-platform-org-status"></a>
### `platform.org.setStatus`

- `PUT /platform/orgs/{orgId}/status` · strict body `{ status: 'active' | 'suspended', reason }` · `reason` trim 1–500 บังคับทั้งสองทิศ; ร้านไม่พบ → `NOT_FOUND`
- ใน tenant transaction ของร้าน (lock แถว organization): สถานะเท่าเดิม → 200 ไม่เขียนอะไร; ไม่เช่นนั้นตั้ง `status`, `updated_at` และ audit `platform.org_status_changed` (`org_id` = ร้านเป้าหมาย — owner เห็นใน #contract-audit-list, actor = admin, `entity_type 'organization'`, `before { status }`, `after { status, reason }`); เหตุผลเก็บใน audit เท่านั้น
- ไม่แตะ session หรือคำเชิญ; ตอบ 200 = รายละเอียดเดียวกับ `platform.org.get`

<a id="contract-platform-set-plan"></a>
### `platform.org.setPlan` (human_review)

- `PUT /platform/orgs/{orgId}/subscription` · strict body: `planCode` (1–50, ต้องเป็นแพ็กเกจที่ `is_active` — ไม่พบหรือปิดใช้ → `VALIDATION_FAILED` ที่ `planCode`), `currentPeriodEnd` (ISO instant หรือ null; **ไม่ส่ง = null**; ค่าในอดีตยอมรับและบังคับตามเดิม), `note` (trim 1–500 หรือ null; **ไม่ส่ง = null**); ร้านไม่พบ → `NOT_FOUND`
- ใน tenant transaction ของร้าน: lock แถว subscription `FOR UPDATE` (แถวเดียวกับ #rule-branch-capacity และ #rule-staff-check-and-lock); ทุกค่าเท่าเดิม → 200 ไม่เขียน; ไม่เช่นนั้นอัปเดต และตั้ง `started_at = now` เฉพาะเมื่อเปลี่ยนแพ็กเกจ
- ลดแพ็กเกจต่ำกว่าการใช้งานได้: สาขา สมาชิก และคำเชิญที่ค้างคงอยู่; การเพิ่มใหม่ถูกบล็อกด้วย F05
- audit `platform.plan_changed` เมื่อ `planCode` หรือ `currentPeriodEnd` เปลี่ยน (`org_id` = ร้านเป้าหมาย, `before`/`after` เฉพาะสองฟิลด์นี้ที่เปลี่ยน); **`note` ไม่อยู่ใน audit** และการแก้ `note` อย่างเดียวไม่มีแถว audit
- ตอบ 200 = รายละเอียดเดียวกับ `platform.org.get`

<a id="contract-platform-plan-list"></a>
### `platform.plan.list`

- `GET /platform/plans` · platform admin → 200 `{ items: [{ code, name, maxBranches, maxStaff, priceSatangPerMonth, isActive }] }` เรียงตาม `code`; รวมแพ็กเกจที่ปิดใช้ (บอกด้วย `isActive`)

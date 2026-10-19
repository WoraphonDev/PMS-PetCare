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
| <a id="ep-auth.signup"></a>`auth.signup` | `POST /auth/signup` | public | `{ email, password, displayName, orgName, orgSlug, branchName }` → สร้าง user + org + branch + hours + membership owner + subscription `mvp_free` ใน transaction เดียว; ส่งอีเมลยืนยัน · errors: `VALIDATION_FAILED`, `CONFLICT` (email/slug), `RATE_LIMITED` |
| <a id="ep-auth.login"></a>`auth.login` | `POST /auth/login` | public | `{ identifier, password }` (identifier = email หรือ username) · rate limit 5 ครั้ง/15 นาที/identifier+IP · ตอบ `{ twoFactorRequired, mustChangePassword }` · errors: `UNAUTHENTICATED`, `RATE_LIMITED` |
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
| <a id="ep-branch.closures"></a>`branch.closure.create` / `.delete` / `.list` | `POST·DELETE·GET /branches/{branchId}/closures` | `branch.update` (list: `org.settings.read`) | outbox `branch.hours_changed` |
| <a id="ep-staff.list"></a>`staff.list` | `GET /staff` | `staff.read` | membership + คำเชิญที่ค้าง |
| <a id="ep-staff.invite"></a>`staff.invite` | `POST /staff/invitations` | `staff.invite` | `{ email, role, branchIds }` · F02, F03, F05 · ส่งอีเมล · audit `staff.invited` |
| <a id="ep-staff.invitation.revoke"></a>`staff.invitation.revoke` | `DELETE /staff/invitations/{invitationId}` | `staff.invite` | |
| <a id="ep-invitation.accept"></a>`invitation.accept` | `POST /invitations/accept` | user (หรือสมัครใหม่ใน flow เดียวกัน) | `{ token }` · F03 · audit `staff.joined` |
| <a id="ep-staff.account.create"></a>`staff.account.create` | `POST /staff/accounts` | `staff.invite` | `{ displayName, username, password, role, branchIds }` · F02, F05, F09 · `CONFLICT` เมื่อ username ซ้ำ · audit `staff.account_created` |
| <a id="ep-staff.password.reset"></a>`staff.password.reset` | `PUT /staff/{membershipId}/password` | `staff.update` | `{ newPassword }` · F09 · audit `staff.password_reset` |
| <a id="ep-staff.update"></a>`staff.update` | `PATCH /staff/{membershipId}` | `staff.update` | `{ role?, branchIds?, displayName? }` · F01, F02, ¹ · audit `staff.role_changed` |
| <a id="ep-staff.remove"></a>`staff.remove` | `DELETE /staff/{membershipId}` | `staff.remove` | F01 · ล้าง session ของผู้ใช้ใน org นี้ · audit `staff.removed` |
| <a id="ep-audit.list"></a>`audit.list` | `GET /audit-logs?from&to&action&actorUserId&cursor` | `audit.read` | เรียงใหม่ → เก่า, cursor pagination 50/หน้า |
| <a id="ep-subscription.get"></a>`subscription.get` | `GET /subscription` | `subscription.read` | plan + การใช้งานปัจจุบัน (สาขา, พนักงาน) |
| <a id="ep-platform.org.list"></a>`platform.org.list` | `GET /platform/orgs?q&status&cursor` | platform admin | |
| <a id="ep-platform.org.get"></a>`platform.org.get` | `GET /platform/orgs/{orgId}` | platform admin | |
| <a id="ep-platform.org.set_status"></a>`platform.org.setStatus` | `PUT /platform/orgs/{orgId}/status` | platform admin | `{ status, reason }` · audit `platform.org_status_changed` |
| <a id="ep-platform.org.set_plan"></a>`platform.org.setPlan` | `PUT /platform/orgs/{orgId}/subscription` | platform admin | `{ planCode, currentPeriodEnd?, note? }` · audit `platform.plan_changed` · **human_review** |

Response DTO ใช้ชื่อ camelCase ของคอลัมน์ใน §3 (ไม่ส่ง `token_hash`, `org_id` ภายใน)

## 6. Audit actions

`org.updated` · `branch.created` · `branch.updated` · `branch.payment_settings_updated` · `staff.invited` · `staff.joined` · `staff.account_created` · `staff.password_reset` · `staff.role_changed` · `staff.removed` · `auth.password_reset` · `auth.two_factor_enabled` · `auth.two_factor_disabled` · `platform.org_status_changed` · `platform.plan_changed`
— เขียน **ใน transaction เดียวกับการเปลี่ยนข้อมูล**

## 7. หน้าจอ (PMS web)

| id | path | ผู้ใช้ | เนื้อหา |
|---|---|---|---|
| <a id="scr-auth-signup"></a>`scr-auth-signup` | `/signup` | public | ฟอร์ม US-F01: ชื่อ, email, รหัสผ่าน, ชื่อร้าน, slug (สร้างอัตโนมัติจากชื่อ แก้ได้), ชื่อสาขาแรก |
| <a id="scr-auth-login"></a>`scr-auth-login` | `/login` | public | "email หรือชื่อผู้ใช้", รหัสผ่าน, ลิงก์ลืมรหัสผ่าน (สำหรับบัญชี email) |
| <a id="scr-auth-2fa"></a>`scr-auth-2fa` | `/login/2fa` | session รอ 2FA | รหัส 6 หลัก หรือ backup code, ☐ จำอุปกรณ์นี้ 30 วัน |
| <a id="scr-auth-change-password"></a>`scr-auth-change-password` | `/change-password` | user | บังคับเมื่อ `mustChangePassword` |
| <a id="scr-account-security"></a>`scr-account-security` | `/account/security` | user | เปลี่ยนรหัสผ่าน, เปิด/ปิด 2FA (QR + backup codes) |
| <a id="scr-auth-forgot"></a>`scr-auth-forgot` / `scr-auth-reset` | `/forgot-password`, `/reset-password` | public | |
| <a id="scr-org-switcher"></a>`scr-org-switcher` | (เมนูบน) | user | เลือก org + สาขา; จำค่าล่าสุด |
| <a id="scr-settings-org"></a>`scr-settings-org` | `/settings/org` | owner | ฟิลด์ `tbl-organization` |
| <a id="scr-settings-branches"></a>`scr-settings-branches` | `/settings/branches` | owner, manager | รายการสาขา + ปุ่มเพิ่ม (ซ่อนเมื่อถึง limit พร้อมข้อความแพ็กเกจ) |
| <a id="scr-settings-branch"></a>`scr-settings-branch` | `/settings/branches/:id` | owner, manager | แท็บ: ข้อมูล · เวลาเปิด-ปิด · วันหยุด · การชำระเงิน (owner) |
| <a id="scr-staff"></a>`scr-staff` | `/settings/staff` | owner, manager, front_desk (อ่าน) | ตารางพนักงาน: ชื่อ, email หรือ username, role, สาขา, สถานะ, 2FA; คำเชิญค้าง; ปุ่ม "เชิญทาง email" และ "สร้างบัญชี (ไม่มี email)"; เมนู "รีเซ็ตรหัสผ่าน" เฉพาะบัญชี managed |
| <a id="scr-invite-accept"></a>`scr-invite-accept` | `/invite/:token` | public/user | แสดงชื่อร้าน + role; login หรือสมัครแล้วรับคำเชิญ |
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

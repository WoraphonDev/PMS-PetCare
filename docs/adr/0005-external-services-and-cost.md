# ADR-0005 — External services & cost at scale

- **Status:** Accepted
- **Date:** 2026-10-19

## Context

ซอฟต์แวร์ทั้งหมดฟรี (ADR-0001) แต่บริการภายนอกบางตัวคิดเงินตามปริมาณ
ถ้าไม่ออกแบบไว้ ต้นทุนจะโตเร็วกว่ารายได้ หรือเปลี่ยนผู้ให้บริการไม่ได้

## Decision

### 1. ทุกบริการภายนอกอยู่หลัง interface ของเรา

`NotificationChannel`, `FileStorage`, `EmailSender`, `PaymentProvider`, `SmsSender`, `PushSender`
— อยู่ในโมดูลของตัวเองใน `apps/api` ห้ามเรียก SDK ของผู้ให้บริการจากที่อื่น
เปลี่ยนผู้ให้บริการ = เขียน adapter ใหม่ 1 ตัว

### 2. ค่าใช้จ่ายที่ผูกกับร้าน ร้านเป็นคนจ่าย

- **LINE OA ต่อร้าน (ต่อ branch)** — credential (channel secret/access token) เก็บเข้ารหัสใน DB; ค่าข้อความอยู่ในบัญชี LINE ของร้าน
- webhook route ตาม branch: `/line/webhook/{branchId}` ตรวจ signature ด้วย secret ของ branch นั้น

### 3. Notification เลือกช่องทางที่ถูกที่สุดก่อน

ลูกค้าของร้าน: **LINE (OA ของร้าน) → email**; พนักงาน: **web push ของ PWA (ฟรี) → email** — เคารพการตั้งค่าของผู้รับ
ใช้ LINE reply message (ไม่นับโควตา) เมื่อเป็นการตอบข้อความลูกค้า; รวบหลายเรื่องเป็นข้อความเดียวได้

### 4. นับการใช้งานทุกอย่างที่มีต้นทุน

ตาราง `usage_event(org_id, branch_id, kind, quantity, unit_cost_satang, occurred_at)`
ใช้สำหรับโควตาตามแพ็กเกจ, คิดเงินส่วนเกิน และ dashboard ต้นทุนต่อร้าน

### 5. ค่าเริ่มต้นของแต่ละบริการ

| บริการ | เริ่มต้น | เมื่อ volume สูง |
|---|---|---|
| Web push (PWA) | `web-push` (VAPID) — ฟรี | — |
| Email | SMTP / free tier | Amazon SES |
| SMS | ไม่ใช้ (LINE Login, Apple/Google, email OTP, passkey) | provider ไทยราคาส่ง เฉพาะจุดจำเป็น |
| Storage | S3-compatible: Cloudflare R2 (ไม่คิด egress) | R2 ต่อ หรือ MinIO self-host |
| รูปภาพ | ย่อ/แปลง WebP + thumbnail ตอนอัปโหลด | — |
| Monitoring | GlitchTip / Sentry free tier, sampling | self-host Grafana + Loki |
| เงินของลูกค้าร้าน | **ไม่ผ่านเรา** — ร้านรับเงินเอง; PMS บันทึกการชำระ + สร้าง PromptPay QR ของร้าน (ฟรี) + แนบสลิป | ร้านเชื่อม gateway ของตัวเอง (ADR ใหม่) |
| ค่า subscription ของร้าน | MVP: platform admin เปิด/ปิดแพ็กเกจเอง (Q-0001) | gateway ไทย (Omise / 2C2P) ตัดรายเดือน |

### 6. Infra ตามระยะ

| ระยะ | รูปแบบ |
|---|---|
| เริ่มต้น (หลักสิบร้าน) | VPS 1 เครื่อง, Docker Compose (api, worker, Postgres, Valkey), backup ขึ้น R2 |
| เติบโต (หลักร้อย–พัน) | managed Postgres, API หลาย instance + load balancer, Cloudflare CDN |
| ใหญ่ (หลักหมื่น+) | read replica, แยก marketplace read side/worker, orchestration, committed-use pricing |

## Consequences

- ราคา subscription plan (ต่อสาขา + โควตา) ต้องคำนวณจาก `usage_event` จริง
- ค่าใช้จ่ายคงที่: โดเมน, เซิร์ฟเวอร์ (ไม่มีค่า App Store/Play เพราะใช้ PWA)
- PMS ไม่ถือเงินของลูกค้าร้าน → ไม่เข้าข่ายธุรกิจระบบการชำระเงิน (ดู Q-0003)
- ราคาของผู้ให้บริการเปลี่ยนได้ — ทบทวน ADR นี้ก่อนประกาศราคาแพ็กเกจ

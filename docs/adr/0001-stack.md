# ADR-0001 — Tech stack

- **Status:** Accepted
- **Date:** 2026-10-19
- **Deciders:** WoraphonDev

## Context

PMS-PetCare คือ **PMS (ระบบบริหารร้าน) แบบ SaaS** สำหรับร้าน Grooming · Pet Hotel · Daycare
รายได้มาจาก subscription plan ของร้าน ลูกค้าของร้านจ่ายเงินให้ร้านโดยตรง

ขอบเขตของ repo นี้:

- **PMS web** (PWA — ใช้บนคอม/แท็บเล็ต/มือถือของพนักงาน)
- **LINE** — แจ้งเตือนผ่าน LINE OA ของแต่ละร้าน (เฟส 1), จองผ่าน LIFF (เฟสถัดไป)
- **Channel API** — ให้ Marketplace/OTA ภายนอกเชื่อมดึงข้อมูลว่างและส่งการจองเข้ามา (ADR-0004)

**นอกขอบเขต** (เป็นโปรเจกต์อื่นในอนาคต): Marketplace web, Mobile app (iOS/Android), การรับเงินแทนร้าน

เกณฑ์เลือก: เสถียร (LTS / ecosystem นิ่ง), เบา, ปลอดภัย, นิยม, รองรับการโต, AI agent พัฒนาได้เร็ว
และ **ทุกชิ้นเป็น OSS ที่ license อนุญาตใช้เชิงพาณิชย์ฟรี**

PetBooking (โปรเจกต์เดิม) ใช้ Next.js เป็นทั้ง web และ backend — ใช้เป็น reference ได้แต่ไม่ลอก
เพราะ backend ที่ผูกกับเว็บตัวเดียวไม่รองรับ Channel API / client อื่นในอนาคต

## Decision

**TypeScript ทั้งระบบ** ใน monorepo เดียว, backend เป็น API แยก (modular monolith — ADR-0002)

| ชั้น | เลือกใช้ | License |
|---|---|---|
| Runtime | Node.js 24 LTS, pnpm 10 workspaces, Turborepo | MIT |
| Backend API | **NestJS** (`apps/api`) + OpenAPI | MIT |
| Validation / contracts | zod v4 (`packages/contracts`) ใช้ร่วม API + web | MIT |
| Database | **PostgreSQL 17** | PostgreSQL |
| ORM / migration | Drizzle ORM + drizzle-kit (SQL migration commit ลง repo) | Apache-2.0 |
| Cache / queue | **Valkey** (แทน Redis) + BullMQ | BSD-3 / MIT |
| Auth | **Better Auth** (self-hosted; plugins `username`, `twoFactor` — organization/membership เป็นตารางของเราตาม spec foundation) | MIT |
| PMS web | **React 19 + Vite** SPA + PWA (`vite-plugin-pwa`), TanStack Router + Query | MIT |
| LIFF (เฟสถัดไป) | React + Vite (`@line/liff`) | MIT / Apache-2.0 |
| UI | Tailwind CSS v4 + shadcn/ui | MIT |
| LINE | `@line/bot-sdk` | Apache-2.0 |
| PromptPay QR | สร้าง payload EMVCo เอง (ไม่ใช้บริการภายนอก) | — |
| Test | Vitest, Testcontainers (Postgres/Valkey จริง), Playwright | MIT / Apache-2.0 |
| Lint / format | Biome | MIT / Apache-2.0 |
| Container | Docker / Docker Compose | Apache-2.0 |

เวอร์ชันจริงถูก pin ใน `package.json` / lockfile; อัปเกรด major ต้องมีการ์ดของตัวเอง

### ไม่ใช้

- **Redis** — license เปลี่ยน (RSAL/SSPL/AGPL) → Valkey (wire-compatible)
- **Next.js** — ไม่จำเป็นสำหรับ PMS (หลัง login ไม่ต้อง SEO) + ประวัติช่องโหว่ middleware/RSC (2025)
- **Hono / .NET** — พิจารณาแล้ว: Hono ไม่มีโครงสร้าง DI/module สำหรับทีมใหญ่; .NET ทำให้มี 2 ภาษา
- **Native mobile** ใน MVP — ใช้ PWA (ไม่มีค่า App Store/Play, deploy ทันที)

### เผื่ออนาคต (ไม่ทำตอนนี้ — ต้องมี ADR ใหม่)

Keycloak (เมื่อต้องเป็น OIDC provider ให้พาร์ทเนอร์), Meilisearch/OpenSearch, Expo (staff app), NATS/Kafka

## Consequences

- type/schema ชุดเดียว (`packages/contracts`) ใช้ทั้ง API และ web — agent ทำ feature ครบทุกชั้นในภาษาเดียว
- ต้องรักษาวินัย modular monolith (ADR-0002)
- เพิ่ม dependency ต้องระบุใน *Dependencies* ของการ์ด และ license อยู่ใน allow-list: MIT, MIT-0, Apache-2.0, BSD-2/3, ISC, PostgreSQL, MPL-2.0 (อื่น ๆ → `docs/questions.md`)

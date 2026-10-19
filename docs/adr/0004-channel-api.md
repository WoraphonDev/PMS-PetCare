# ADR-0004 — Channel API for external marketplaces (OTA)

- **Status:** Accepted
- **Date:** 2026-10-19

## Context

Marketplace/OTA เป็นโปรเจกต์แยก (นอก repo นี้) แต่ PMS ต้องพร้อมให้เชื่อม:
OTA ต้องเห็นบริการ ราคา และช่วงว่างของร้านแบบเกือบ realtime และส่งการจองเข้ามาได้
โดยไม่เกิดการจองซ้อนกับการจองหน้าร้าน/LINE

ลูกค้าจ่ายเงินให้ร้านโดยตรง — PMS ไม่รับเงินแทนร้าน (ดู Q-0003)

## Decision

### PMS เป็นแหล่งความจริงเสมอ

ทุกช่องทาง (หน้าร้าน, LINE/LIFF, OTA) จองผ่าน **booking service ตัวเดียวกัน** ใน module `grooming` / `lodging`

### กันจองซ้อนที่ระดับ database

- constraint ใน Postgres (`EXCLUDE USING gist` บนช่วงเวลา × groomer/ห้อง หรือ counter ความจุที่ lock แถว)
- **hold** ระหว่างลูกค้ากรอกข้อมูล: สถานะ `held` + `hold_expires_at` และ job ปล่อย hold ที่หมดอายุ

### ส่งการเปลี่ยนแปลงออก — transactional outbox

1. การเปลี่ยนที่กระทบการขาย (จอง/ยกเลิก, ปิดห้อง, เปลี่ยนราคา/เวลาเปิด, เปิด/ปิดการขายผ่าน channel)
   เขียน `outbox_event` **ใน transaction เดียวกับการเปลี่ยนข้อมูล**
2. worker อ่าน outbox → ส่งเข้า queue (BullMQ/Valkey) → consumer ภายใน (notification) และ webhook ภายนอก
3. ทุก event มี `event_id` (idempotency), `org_id`, `branch_id`, `occurred_at`, `aggregate_version`

### Channel API (เฟสหลัง MVP — ออกแบบไว้ตอนนี้ ทำทีหลัง)

- ร้านเปิด/ปิดการเชื่อมต่อแต่ละ channel ได้เอง; แต่ละ channel ได้ credential ของตัวเอง (OAuth client credentials / API key ต่อร้าน)
- `GET` บริการ ราคา และช่วงว่าง · `POST` hold / confirm / cancel booking (มี `Idempotency-Key`)
- webhook ออก (ลงลายเซ็น HMAC, retry + dead-letter) เมื่อ availability หรือสถานะการจองเปลี่ยน
- การจองจาก channel บันทึก `source = 'channel:<id>'` สำหรับรายงานและค่าธรรมเนียม

## Consequences

- MVP ต้องมี outbox + constraint กันจองซ้อนตั้งแต่แรก (ราคาถูกเมื่อทำตั้งแต่ต้น แพงเมื่อเติมทีหลัง)
- โปรเจกต์ Marketplace ในอนาคตเป็นแค่ "channel หนึ่ง" — PMS ไม่ต้องรู้จักมันเป็นพิเศษ
- ต้อง monitor ความล่าช้าของ outbox และ dead-letter queue

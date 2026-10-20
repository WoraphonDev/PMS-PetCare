# PMS-PetCare

ระบบบริหารร้าน (PMS) แบบ SaaS สำหรับร้าน Grooming · Pet Hotel · Daycare

- **PMS web (PWA)** — เจ้าของร้านและพนักงาน
- **LINE** — แจ้งเตือนผ่าน LINE OA ของแต่ละร้าน (จองผ่าน LIFF เฟสถัดไป)
- **Channel API** — ให้ Marketplace/OTA ภายนอกเชื่อมต่อ (เฟสถัดไป)

ลูกค้าของร้านจ่ายเงินให้ร้านโดยตรง · รายได้ของแพลตฟอร์มมาจาก subscription plan

พัฒนา ทดสอบ และ deploy โดย AI agent (Claude Code, Codex) ตามกฎใน [AGENTS.md](AGENTS.md)

## เอกสาร

| | |
|---|---|
| [docs/adr/](docs/adr/) | การตัดสินใจเชิงสถาปัตยกรรม (stack, modular monolith, multi-tenancy, sync, ต้นทุน, agentic delivery) |
| [docs/spec/](docs/spec/) | spec ของผลิตภัณฑ์ (เขียนทีละ feature) |
| [docs/tasks/](docs/tasks/) | การ์ดงาน 1 ใบ = 1 PR |
| [docs/questions/](docs/questions/README.md) | คำถามที่รอเจ้าของผลิตภัณฑ์ตอบ |

## เริ่มต้น

```bash
nvm use        # Node 24 LTS
pnpm install
pnpm verify
```

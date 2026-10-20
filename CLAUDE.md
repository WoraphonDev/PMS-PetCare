@AGENTS.md

## Claude Code — เพิ่มเติม

- เริ่มทุก session: อ่านการ์ด `docs/tasks/<ID>.md` → อ่านเฉพาะ anchor ใน *Read first* (ค้นด้วย `grep -n 'id="…"' docs/spec/*.md` แล้วอ่านช่วงนั้น) อย่าโหลด spec ทั้งไฟล์
- การ์ดขนาด L: ใช้ plan mode เขียนแผนก่อนลงมือ (ไฟล์ทั้งหมดต้องอยู่ใน `allowed_paths`)
- ห้ามใช้ subagent หรือเครื่องมือใดแก้ไฟล์นอก `allowed_paths` — เขียนคำถาม `docs/questions/<ID>-NN.md` แทน
- ก่อนบอกว่าเสร็จ: รันทุกบรรทัดใน *Done when* + `pnpm verify` แล้วแปะผลสรุปใน PR
- context ใกล้เต็ม: อัปเดต `docs/tasks/log/<ID>.md` ว่าทำถึงไหนก่อน (ห้ามแก้ไฟล์การ์ด) เพื่อให้ session ถัดไปทำต่อได้

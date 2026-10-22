import type { Role } from "@app/domain";
import type { EmailMessage } from "../notification/email";

/** Org's own BackgroundWork: the invitation email is sent after commit, never inside the transaction. */
export const INVITATION_MAIL_BACKGROUND = Symbol("INVITATION_MAIL_BACKGROUND");

// Labels from docs/spec/features/foundation.md#roles.
const ROLE_LABEL: Record<Role, string> = {
  owner: "เจ้าของร้าน",
  manager: "ผู้จัดการ",
  front_desk: "พนักงานหน้าร้าน",
  groomer: "ช่างตัดขน",
  caretaker: "พนักงานดูแลสัตว์",
};

/** #rule-invitation-token: the token travels in the fragment, so it is not in the request path or `Referer`. */
export function invitationEmail(appOrigin: string, to: string, shopName: string, role: Role, token: string): EmailMessage {
  const link = `${appOrigin}/invite#token=${encodeURIComponent(token)}`;
  return {
    to,
    subject: `คำเชิญเข้าร่วมร้าน ${shopName}`,
    text:
      `คุณได้รับคำเชิญให้เข้าร่วมร้าน ${shopName} ในตำแหน่ง ${ROLE_LABEL[role]}\n` +
      `เปิดลิงก์นี้เพื่อรับคำเชิญ (ใช้ได้ครั้งเดียวและหมดอายุใน 7 วัน):\n${link}\n\n` +
      "ถ้าคุณไม่ได้คาดว่าจะได้รับคำเชิญนี้ ไม่ต้องทำอะไร",
  };
}

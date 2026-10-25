import { BRANCH_1, BRANCH_2 } from "../shell/render";

const at = "2030-01-01T00:00:00.000Z";
export const branch = (over: Record<string, unknown> = {}) => ({
  id: BRANCH_1,
  name: "สาขาหลัก",
  address: "1 ถนนสุขุมวิท",
  phone: null,
  latitude: null,
  longitude: null,
  timezone: "Asia/Bangkok",
  promptpayId: "0812345678",
  isActive: true,
  version: 1,
  createdAt: at,
  updatedAt: at,
  ...over,
});
export const second = () => branch({ id: BRANCH_2, name: "สาขาสอง", address: null, isActive: false });

export const subscription = (maxBranches: number | null, used: number) => ({
  plan: { code: "basic", name: "Basic", maxBranches, maxStaff: 5, priceSatangPerMonth: 49_900 },
  startedAt: at,
  currentPeriodEnd: null,
  usage: { branches: used, staff: { active: 1, pendingInvitations: 0, total: 1 } },
});

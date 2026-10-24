import { SubscriptionGetResponse } from "@app/contracts";
import { describe, expect, it, vi } from "vitest";
import { createApiClient, subscriptionGet } from "../../src/index";

const ORG_ID = "6f1c0e8e-2f4b-4b8e-9a51-0d3c9b1a7e21";
const subscription = {
  plan: { code: "free", name: "Free", maxBranches: 1, maxStaff: 3, priceSatangPerMonth: 0 },
  startedAt: "2030-01-01T00:00:00.000Z",
  currentPeriodEnd: null,
  usage: { branches: 1, staff: { active: 1, pendingInvitations: 0, total: 1 } },
};

describe("subscription.get (T-0025, foundation#contract-subscription-get)", () => {
  it("GET /subscription with X-Org-Id → SubscriptionGetResponse", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(JSON.stringify(subscription), { status: 200 }));
    const api = createApiClient({ baseUrl: "/api/v1", fetch });

    await expect(api.request(subscriptionGet, { orgId: ORG_ID })).resolves.toEqual(subscription);
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe("/api/v1/subscription");
    expect(init?.method).toBe("GET");
    expect(new Headers(init?.headers).get("x-org-id")).toBe(ORG_ID);
    expect(init?.body).toBeUndefined();
    expect(subscriptionGet.response).toBe(SubscriptionGetResponse);
  });
});

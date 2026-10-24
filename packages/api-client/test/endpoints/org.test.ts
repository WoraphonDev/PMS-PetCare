import { Branch, BranchCreateRequest, BranchListResponse, BranchUpdateRequest, Organization, OrgUpdateRequest } from "@app/contracts";
import { describe, expect, it, vi } from "vitest";
import { branchCreate, branchList, branchUpdate, createApiClient, orgGet, orgUpdate } from "../../src/index";

const ORG_ID = "6f1c0e8e-2f4b-4b8e-9a51-0d3c9b1a7e21";
const BRANCH_ID = "8a0b5c1d-3e2f-4a6b-8c7d-9e0f1a2b3c4d";
const at = "2030-01-01T00:00:00.000Z";
const org = {
  id: ORG_ID,
  slug: "happy-paws",
  displayName: "Happy Paws",
  legalName: null,
  taxId: null,
  phone: null,
  logoFileId: null,
  receiptFooter: null,
  status: "active",
  createdAt: at,
  updatedAt: at,
};
const branch = {
  id: BRANCH_ID,
  name: "สาขาหลัก",
  address: null,
  phone: null,
  latitude: 13.7563,
  longitude: 100.5018,
  timezone: "Asia/Bangkok",
  promptpayId: null,
  isActive: true,
  version: 1,
  createdAt: at,
  updatedAt: at,
};

function setup(status: number, body: unknown) {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(JSON.stringify(body), { status }));
  const api = createApiClient({ baseUrl: "/api/v1", fetch });
  const sent = () => {
    const [url, init] = fetch.mock.calls[0] ?? [];
    const headers = new Headers(init?.headers);
    return { url, method: init?.method, body: init?.body, orgId: headers.get("x-org-id"), contentType: headers.get("content-type") };
  };
  return { api, sent };
}

describe("org descriptors (T-0025, foundation#contract-org)", () => {
  it("org.get: GET /org with X-Org-Id → Organization", async () => {
    const { api, sent } = setup(200, org);
    await expect(api.request(orgGet, { orgId: ORG_ID })).resolves.toEqual(org);
    expect(sent()).toEqual({ url: "/api/v1/org", method: "GET", body: undefined, orgId: ORG_ID, contentType: null });
    expect(orgGet.response).toBe(Organization);
  });

  it("org.update: PATCH /org with the JSON body and X-Org-Id → Organization", async () => {
    const { api, sent } = setup(200, { ...org, legalName: "บริษัท" });
    const body = { legalName: "บริษัท", taxId: null };
    await expect(api.request(orgUpdate, { orgId: ORG_ID, body })).resolves.toEqual({ ...org, legalName: "บริษัท" });
    expect(sent()).toEqual({
      url: "/api/v1/org",
      method: "PATCH",
      body: JSON.stringify(body),
      orgId: ORG_ID,
      contentType: "application/json",
    });
    expect(orgUpdate.body).toBe(OrgUpdateRequest);
    expect(orgUpdate.response).toBe(Organization);
  });
});

describe("branch descriptors (T-0025, foundation#contract-branch)", () => {
  it("branch.list: GET /branches with X-Org-Id → { items }", async () => {
    const { api, sent } = setup(200, { items: [branch] });
    await expect(api.request(branchList, { orgId: ORG_ID })).resolves.toEqual({ items: [branch] });
    expect(sent()).toEqual({ url: "/api/v1/branches", method: "GET", body: undefined, orgId: ORG_ID, contentType: null });
    expect(branchList.response).toBe(BranchListResponse);
  });

  it("branch.create: POST /branches with the JSON body → 201 Branch", async () => {
    const { api, sent } = setup(201, branch);
    const body = { name: "สาขาหลัก", address: null, phone: null, latitude: 13.7563, longitude: 100.5018 };
    await expect(api.request(branchCreate, { orgId: ORG_ID, body })).resolves.toEqual(branch);
    expect(sent()).toEqual({
      url: "/api/v1/branches",
      method: "POST",
      body: JSON.stringify(body),
      orgId: ORG_ID,
      contentType: "application/json",
    });
    expect(branchCreate.body).toBe(BranchCreateRequest);
    expect(branchCreate.response).toBe(Branch);
  });

  it("branch.update: PATCH /branches/{branchId} (encoded) with the JSON body → Branch", async () => {
    const { api, sent } = setup(200, { ...branch, isActive: false });
    const body = { isActive: false };
    await expect(api.request(branchUpdate, { orgId: ORG_ID, params: { branchId: BRANCH_ID }, body })).resolves.toEqual({
      ...branch,
      isActive: false,
    });
    expect(sent()).toEqual({
      url: `/api/v1/branches/${BRANCH_ID}`,
      method: "PATCH",
      body: JSON.stringify(body),
      orgId: ORG_ID,
      contentType: "application/json",
    });
    expect(branchUpdate.body).toBe(BranchUpdateRequest);
    expect(branchUpdate.response).toBe(Branch);
  });

  it("branch.update requires the branchId path param", async () => {
    const { api } = setup(200, branch);
    // @ts-expect-error params is required
    await expect(api.request(branchUpdate, { orgId: ORG_ID, body: { isActive: true } })).rejects.toThrow(TypeError);
  });
});

import type { Endpoint, RequestInput, ResponseOf } from "@app/api-client";
import type { MeResponse } from "@app/contracts";
import { type QueryKey, useQueryClient } from "@tanstack/react-query";
import { useRouteContext } from "@tanstack/react-router";
import { createContext, type ReactNode, useContext, useMemo, useState } from "react";
import { meQueryKey, sessionRequired } from "./session";

// foundation#scr-org-switcher — current shop + branch, remembered per user.
export type Membership = MeResponse["memberships"][number];
export type Branch = Membership["branches"][number];
interface Stored {
  orgId?: string;
  branchId?: string;
}

const storageKey = (userId: string) => `pms.ctx.${userId}`;

function readStored(userId: string): Stored {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storageKey(userId)) ?? "{}");
    return value && typeof value === "object" ? (value as Stored) : {};
  } catch {
    return {};
  }
}

function writeStored(userId: string, value: Stored) {
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(value));
  } catch {
    // Private mode / blocked storage: the choice just is not remembered.
  }
}

/** Remembered org if still a member, else the first; remembered branch if still in it, else the first, else null. */
export function resolveContext(me: MeResponse, stored: Stored) {
  const membership = me.memberships.find((m) => m.org.id === stored.orgId) ?? me.memberships[0] ?? null;
  const branch = membership?.branches.find((b) => b.id === stored.branchId) ?? membership?.branches[0] ?? null;
  return { membership, branch };
}

interface OrgContextValue {
  me: MeResponse;
  membership: Membership | null;
  branch: Branch | null;
  selectOrg: (orgId: string) => void;
  selectBranch: (branchId: string) => void;
}

const OrgContext = createContext<OrgContextValue | null>(null);

export function OrgProvider({ me, children }: { me: MeResponse; children: ReactNode }) {
  const queryClient = useQueryClient();
  const [stored, setStored] = useState(() => readStored(me.user.id));
  const { membership, branch } = resolveContext(me, stored);

  const value: OrgContextValue = {
    me,
    membership,
    branch,
    selectOrg(orgId) {
      if (orgId === membership?.org.id) return;
      // Data of one shop must never render under another: drop everything but `me` before the switch.
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== meQueryKey[0] });
      const next = { orgId };
      writeStored(me.user.id, next);
      setStored(next);
    },
    selectBranch(branchId) {
      const next = { orgId: membership?.org.id, branchId };
      writeStored(me.user.id, next);
      setStored(next);
    },
  };
  return <OrgContext.Provider value={value}>{children}</OrgContext.Provider>;
}

export function useOrg(): OrgContextValue {
  const value = useContext(OrgContext);
  if (!value) throw new Error("useOrg() outside <OrgProvider>");
  return value;
}

/**
 * The api client bound to the current shop: requests carry `X-Org-Id`, and the query/mutation options it builds
 * carry `sessionRequired`. Use only on screens under `_app` with a membership.
 */
export function useOrgApi() {
  const { api } = useRouteContext({ from: "__root__" });
  const orgId = useOrg().membership?.org.id;
  return useMemo(() => {
    if (!orgId) throw new Error("useOrgApi() without a current shop");
    const request = <E extends Endpoint<unknown, unknown>>(endpoint: E, input?: Omit<RequestInput<E>, "orgId">) =>
      (api.request as (e: E, i: RequestInput<E>) => Promise<ResponseOf<E>>)(endpoint, { ...input, orgId } as RequestInput<E>);
    return {
      orgId,
      request,
      queryOptions: <T,>(queryKey: QueryKey, queryFn: () => Promise<T>) => ({ queryKey, queryFn, meta: sessionRequired }),
      mutationOptions: <T, V>(mutationFn: (variables: V) => Promise<T>) => ({ mutationFn, meta: sessionRequired }),
    };
  }, [api, orgId]);
}

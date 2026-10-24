import { type ApiClient, ApiError, authLogout, meGet } from "@app/api-client";
import type { MeResponse } from "@app/contracts";
import { type QueryClient, useQuery } from "@tanstack/react-query";

/**
 * Opt-in flag for the session-expiry redirect. Set only on requests that need a session from inside `_app`
 * (the `me` guard query and everything built through `useOrgApi()`), never on credential calls: they answer
 * `UNAUTHENTICATED` as an ordinary result and handle it on their own screen.
 */
export const sessionRequired = { sessionRequired: true } as const;

export const meQueryKey = ["me"] as const;

export const meQueryOptions = (api: ApiClient) => ({
  queryKey: meQueryKey,
  queryFn: () => api.request(meGet),
  meta: sessionRequired,
});

/** The cached `me`, seeded by the `_app` guard; re-renders when it is refetched. */
export const useMe = (api: ApiClient, initialData: MeResponse) => useQuery({ ...meQueryOptions(api), initialData }).data;

const codeOf = (error: unknown) => (error instanceof ApiError && error.status !== 0 ? error.code : undefined);

interface Navigator {
  pathname: () => string;
  navigate: (to: "/login" | "/change-password") => void;
}

/** Watches both caches; acts only on failed requests carrying `sessionRequired`. Returns the unsubscribe. */
export function watchSessionExpiry(queryClient: QueryClient, nav: Navigator): () => void {
  const onError = (error: unknown, meta: Record<string, unknown> | undefined) => {
    if (meta?.sessionRequired !== true) return;
    const code = codeOf(error);
    if (code === "UNAUTHENTICATED") {
      queryClient.clear();
      nav.navigate("/login");
    } else if (code === "PASSWORD_CHANGE_REQUIRED" && nav.pathname() !== "/change-password") {
      nav.navigate("/change-password");
    }
  };
  const offQueries = queryClient.getQueryCache().subscribe((event) => {
    if (event.type === "updated" && event.action.type === "error") onError(event.action.error, event.query.meta);
  });
  const offMutations = queryClient.getMutationCache().subscribe((event) => {
    if (event.type === "updated" && event.action.type === "error") onError(event.action.error, event.mutation.options.meta);
  });
  return () => {
    offQueries();
    offMutations();
  };
}

/** foundation#ep-auth.logout. Local state is cleared even when the request fails. */
export async function logout(api: ApiClient, queryClient: QueryClient): Promise<void> {
  try {
    await api.request(authLogout);
  } catch {
    // The session may already be gone; the user still leaves.
  } finally {
    queryClient.clear();
  }
}

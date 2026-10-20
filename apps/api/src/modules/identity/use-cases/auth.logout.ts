import type { Auth } from "../auth";

// docs/spec/features/foundation.md#ep-auth.logout — revokes the current session and clears the cookie.
export async function authLogout(ctx: { headers: Headers }, deps: { auth: Auth }): Promise<{ setCookies: string[] }> {
  const res = await deps.auth.api.signOut({ headers: ctx.headers, asResponse: true });
  return { setCookies: res.headers.getSetCookie() };
}

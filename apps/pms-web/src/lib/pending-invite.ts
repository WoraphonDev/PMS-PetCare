// foundation#rule-invitation-token — the invitation token is persisted only here: sessionStorage (tab-scoped), cleared
// when read. Between routes it travels in memory, never in a URL, and is never logged.
const KEY = "pms.pendingInvite";

let held: string | null = null;
let joinedOrg: string | null = null;

/** Login detour of scr-invite-accept. Blocked storage: the invitation link has to be opened again. */
export function savePendingInvite(token: string): void {
  try {
    sessionStorage.setItem(KEY, token);
  } catch {
    // Private mode / blocked storage.
  }
}

/** After login: moves a saved token from storage into memory for /invite. True when there was one. */
export function restorePendingInvite(): boolean {
  let token: string | null = null;
  try {
    token = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
  } catch {
    // Nothing readable: nothing pending.
  }
  if (token) held = token;
  return Boolean(token);
}

/** The token restored by `restorePendingInvite`, if any; pure, so it is safe in a state initializer. */
export const heldInvite = () => held;
export const clearHeldInvite = () => {
  held = null;
};

/** The shop just joined: `/` makes it the current shop once (T-0024 context). */
export const rememberJoinedOrg = (orgId: string) => {
  joinedOrg = orgId;
};
export function takeJoinedOrg(): string | null {
  const orgId = joinedOrg;
  joinedOrg = null;
  return orgId;
}

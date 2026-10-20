// Public API of the identity module (ADR-0002): other modules import only from here.
export { AUTH, type Auth, toHeaders } from "./auth";
export { type AuthedRequest, AuthGuard } from "./auth.guard";
export { BACKGROUND, BackgroundWork } from "./background";
export { IdentityModule } from "./identity.module";
export type { UserRow } from "./identity.repository";
export { FailureLimiter } from "./rate-limit";

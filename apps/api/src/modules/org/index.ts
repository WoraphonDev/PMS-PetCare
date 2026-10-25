// Public API of org (ADR-0002): other modules call these, never org's internals or its tables.
export {
  type BootstrapOrganizationInput,
  type BootstrapOrganizationResult,
  bootstrapOrganization,
} from "./bootstrap";
export { type ClaimedInvitation, claimInvitation, writeInvitationAccept } from "./invitation-claim";
export { invitationTokenOrg } from "./invitation-token";
/** Strict-body pipe whose `details.fields` has no prototype (keys such as `toString` are reported, not crashed on). */
export { OrgBody } from "./org-body.pipe";
export {
  type OrgPosition,
  type OrgSearchRow,
  type OrgStatus,
  type OrgUsage,
  orgWithOwners,
  recordOrgViewed,
  searchOrgs,
  setOrgStatus,
  usageOf,
} from "./platform-access";
export { branchCount, memberNames, staffSeats } from "./public-reads";

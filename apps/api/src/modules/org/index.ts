// Public API of org (ADR-0002): other modules call these, never org's internals or its tables.
export {
  type BootstrapOrganizationInput,
  type BootstrapOrganizationResult,
  bootstrapOrganization,
} from "./bootstrap";

import type { Organization } from "@app/contracts";
import { AppError } from "../../../common/app-error";
import type { OrgRequestContext } from "../../../common/context";
import { findOrg, toOrganization } from "../org.repository";

/** docs/spec/features/foundation.md#ep-org.get · #contract-org */
export async function orgGet(ctx: OrgRequestContext): Promise<Organization> {
  const row = await ctx.db.run((tx) => findOrg(tx, ctx.org.id));
  if (!row) throw new AppError("NOT_FOUND");
  return toOrganization(row);
}

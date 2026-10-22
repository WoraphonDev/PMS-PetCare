import type { z } from "zod";
import { PromptpayId, strictBody } from "./fields";

// docs/spec/features/foundation.md#contract-branch-payment-settings — the key is required; null clears the value.
export const BranchPaymentSettingsUpdateRequest = strictBody({ promptpayId: PromptpayId.nullable() });
export type BranchPaymentSettingsUpdateRequest = z.infer<typeof BranchPaymentSettingsUpdateRequest>;

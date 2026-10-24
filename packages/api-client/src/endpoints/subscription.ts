import { SubscriptionGetResponse } from "@app/contracts";
import { defineEndpoint } from "../client";

// foundation#ep-subscription.get (shop-scoped).
export const subscriptionGet = defineEndpoint({ method: "GET", path: "/subscription", response: SubscriptionGetResponse });

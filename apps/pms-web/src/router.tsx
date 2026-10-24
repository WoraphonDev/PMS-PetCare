import type { ApiClient } from "@app/api-client";
import type { QueryClient } from "@tanstack/react-query";
import { createRouter, type RouterHistory } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export interface RouterContext {
  queryClient: QueryClient;
  api: ApiClient;
}

export function createAppRouter({ history, ...context }: RouterContext & { history?: RouterHistory }) {
  return createRouter({ routeTree, context, history, defaultPreload: "intent" });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}

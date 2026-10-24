import { ApiError } from "@app/api-client";
import { QueryClient } from "@tanstack/react-query";

const isClientError = (error: unknown) => error instanceof ApiError && error.status >= 400 && error.status < 500;

/** Queries retry once on network/server errors, never on a 4xx answer; mutations never retry. */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: (failureCount, error) => failureCount < 1 && !isClientError(error) },
      mutations: { retry: 0 },
    },
  });
}

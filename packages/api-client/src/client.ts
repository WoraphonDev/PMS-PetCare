import { type ErrorCode, ErrorResponse } from "@app/contracts";
import type { z } from "zod";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/**
 * One API endpoint, built from `@app/contracts` schemas. `path` is relative to the base URL and may hold `{name}`
 * placeholders. `response: null` = the endpoint answers without a body (204). `body` types the request JSON.
 */
export interface Endpoint<Res = unknown, Body = undefined, Path extends string = string> {
  readonly method: HttpMethod;
  readonly path: Path;
  readonly response: z.ZodType<Res> | null;
  readonly body?: z.ZodType<unknown, Body>;
}

/** Keeps the literal path type so its `{name}` params can be required at the call site. */
export function defineEndpoint<const Path extends string, Res = undefined, Body = undefined>(endpoint: {
  method: HttpMethod;
  path: Path;
  response: z.ZodType<Res> | null;
  body?: z.ZodType<unknown, Body>;
}): Endpoint<Res, Body, Path> {
  return endpoint;
}

// biome-ignore lint/suspicious/noExplicitAny: generic constraint over every endpoint shape
type AnyEndpoint = Endpoint<any, any, string>;
type PathParams<P extends string> = P extends `${string}{${infer K}}${infer Rest}` ? K | PathParams<Rest> : never;

export type RequestInput<E extends AnyEndpoint> = {
  /** Sent as `X-Org-Id` for endpoints scoped to a shop. */
  orgId?: string;
  query?: Record<string, string | undefined>;
  signal?: AbortSignal;
} & (E extends Endpoint<unknown, unknown, infer P>
  ? [PathParams<P>] extends [never]
    ? { params?: never }
    : { params: Record<PathParams<P>, string> }
  : never) &
  (E extends Endpoint<unknown, infer B, string> ? ([B] extends [undefined] ? { body?: never } : { body: B }) : never);

export type ResponseOf<E extends AnyEndpoint> = E extends Endpoint<infer R, unknown, string> ? R : never;

type Args<E extends AnyEndpoint> = object extends RequestInput<E> ? [input?: RequestInput<E>] : [input: RequestInput<E>];

/** Every failure the client reports. `status: 0` = no HTTP response (offline, DNS, CORS). */
export class ApiError extends Error {
  override readonly name = "ApiError";
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

const internal = (status: number, message: string) => new ApiError(status, "INTERNAL", message);

export interface ApiClient {
  request<E extends AnyEndpoint>(endpoint: E, ...args: Args<E>): Promise<ResponseOf<E>>;
}

export function createApiClient(options: { baseUrl: string; fetch?: typeof globalThis.fetch }): ApiClient {
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const doFetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));

  return {
    async request<E extends AnyEndpoint>(endpoint: E, ...[input]: Args<E>): Promise<ResponseOf<E>> {
      const { orgId, query, signal, params, body } = (input ?? {}) as {
        orgId?: string;
        query?: Record<string, string | undefined>;
        signal?: AbortSignal;
        params?: Record<string, string>;
        body?: unknown;
      };
      const path = endpoint.path.replace(/\{(\w+)\}/g, (_, name: string) => {
        const value = params?.[name];
        if (value === undefined) throw new TypeError(`Missing path param "${name}" for ${endpoint.path}`);
        return encodeURIComponent(value);
      });
      const search = new URLSearchParams();
      for (const [key, value] of Object.entries(query ?? {})) if (value !== undefined) search.append(key, value);
      const url = `${baseUrl}${path}${search.size > 0 ? `?${search}` : ""}`;

      // Content-Type only with a body: the API rejects an empty body declared as JSON (T-0043-01 A).
      const headers: Record<string, string> = { Accept: "application/json" };
      if (body !== undefined) headers["Content-Type"] = "application/json";
      if (orgId !== undefined) headers["X-Org-Id"] = orgId;

      let res: Response;
      try {
        res = await doFetch(url, {
          method: endpoint.method,
          credentials: "include",
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
          signal,
        });
      } catch {
        throw internal(0, "Network error");
      }

      const text = await res.text().catch(() => "");
      let data: unknown;
      let isJson = true;
      try {
        data = text === "" ? undefined : JSON.parse(text);
      } catch {
        isJson = false;
      }

      if (!res.ok) {
        const envelope = isJson ? ErrorResponse.safeParse(data) : undefined;
        if (!envelope?.success) throw internal(res.status, `Unexpected error response (HTTP ${res.status})`);
        const { code, message, details } = envelope.data.error;
        throw new ApiError(res.status, code, message, details);
      }
      if (endpoint.response === null) return undefined as ResponseOf<E>;
      const parsed = isJson ? endpoint.response.safeParse(data) : undefined;
      if (!parsed?.success) throw internal(res.status, "Response does not match the contract");
      return parsed.data as ResponseOf<E>;
    },
  };
}

import "reflect-metadata";
import { systemClock } from "@app/domain";
import helmet from "@fastify/helmet";
import { type DynamicModule, Global, Module, type Type } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppError } from "./common/app-error";
import { CLOCK, CONFIG } from "./common/context";
import { createInfra, type Infra, InfraLifecycle, PLATFORM_DB, RUNTIME_DB, VALKEY } from "./common/db";
import { ErrorFilter, toErrorResponse } from "./common/error.filter";
import { requestIdFrom } from "./common/request-id";
import type { Config } from "./config";
import { IdentityModule } from "./modules/identity";
import { OrgModule } from "./modules/org/org.module";
import { SystemModule } from "./modules/system/system.module";

// Logged objects never carry credentials (AGENTS.md rule 9).
const SECRET_KEYS = ["password", "newPassword", "currentPassword", "token", "secret"];
// pino redact wildcards match one level each, so cover the root and two levels of nesting explicitly.
const REDACT = [
  "req.headers.authorization",
  "req.headers.cookie",
  'res.headers["set-cookie"]',
  ...SECRET_KEYS.flatMap((k) => [k, `*.${k}`, `*.*.${k}`]),
];

/**
 * CSRF guard for cookie-authenticated requests: browsers send `Origin` on every cross-origin and same-origin
 * POST/PUT/PATCH/DELETE. SameSite=Lax does not stop a sibling sub-domain (same site), and CORS does not stop a simple
 * request from executing — so a mutating request whose Origin is not APP_ORIGIN is refused before any handler runs.
 * Requests without Origin (server-to-server, curl) carry no victim cookies and pass.
 */
const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

function isForbiddenOrigin(method: string, origin: string | undefined, allowed: readonly string[]): boolean {
  if (SAFE.has(method.toUpperCase()) || origin === undefined) return false;
  return !allowed.includes(origin);
}

/** Query strings may carry tokens (reset links, OAuth codes) — never log them. */
export function withoutQuery(url: string): string {
  const i = url.indexOf("?");
  return i === -1 ? url : `${url.slice(0, i)}?[REDACTED]`;
}

// ownsInfra: close connections on shutdown only when createApp opened them (tests pass and close their own).
function rootModule(config: Config, infra: Infra, ownsInfra: boolean, extra: Array<Type | DynamicModule>): DynamicModule {
  @Global()
  @Module({})
  class CoreModule {}
  return {
    module: CoreModule,
    // Registry: one module per line, alphabetical (scripts/check-registries.mjs) so parallel cards merge cleanly.
    // biome-ignore format: keep one entry per line
    imports: [
      IdentityModule,
      OrgModule,
      SystemModule,
      ...extra,
    ],
    providers: [
      { provide: CONFIG, useValue: config },
      { provide: CLOCK, useValue: systemClock },
      { provide: RUNTIME_DB, useValue: infra.runtimeDb },
      { provide: PLATFORM_DB, useValue: infra.platformDb },
      { provide: VALKEY, useValue: infra.valkey },
      ...(ownsInfra ? [InfraLifecycle] : []),
    ],
    exports: [CONFIG, CLOCK, RUNTIME_DB, PLATFORM_DB, VALKEY],
    global: true,
  };
}

export async function createApp(
  config: Config,
  opts: { extraModules?: Array<Type | DynamicModule>; logger?: boolean; logStream?: { write(line: string): void }; infra?: Infra } = {},
): Promise<NestFastifyApplication> {
  const adapter = new FastifyAdapter({
    trustProxy: config.TRUSTED_PROXY_CIDRS ?? false,
    genReqId: (req: { headers: Record<string, string | string[] | undefined> }) => requestIdFrom(req.headers),
    logger:
      opts.logger === false
        ? false
        : {
            level: config.NODE_ENV === "production" ? "info" : "debug",
            redact: { paths: REDACT, censor: "[REDACTED]" },
            serializers: { req: (req: { method: string; url: string }) => ({ method: req.method, url: withoutQuery(req.url) }) },
            ...(opts.logStream ? { stream: opts.logStream } : {}),
          },
  });
  const app = await NestFactory.create<NestFastifyApplication>(
    rootModule(config, opts.infra ?? createInfra(config), !opts.infra, opts.extraModules ?? []),
    adapter,
    {
      logger: opts.logger === false || opts.logStream ? false : undefined,
    },
  );
  app.setGlobalPrefix("api/v1");
  app.useGlobalFilters(new ErrorFilter());
  // Request id + Helmet first: CORS answers preflight requests itself, and those responses need both too.
  const fastify = app.getHttpAdapter().getInstance();
  fastify.addHook("onRequest", async (req, reply) => {
    reply.header("x-request-id", req.id);
    // T-0013-01: Fastify has no parser for a DELETE body without content-type and rejects it before routing. Read it as
    // text/plain (buffered within bodyLimit; zero bytes → "") so the route's no-body rule decides. POST/PUT/PATCH keep theirs.
    if (req.method === "DELETE" && req.headers["content-type"] === undefined) req.headers["content-type"] = "text/plain";
    const origin = typeof req.headers.origin === "string" ? req.headers.origin : undefined;
    if (isForbiddenOrigin(req.method, origin, [config.APP_ORIGIN])) {
      const { status, body } = toErrorResponse(new AppError("FORBIDDEN", "Origin not allowed"), () => undefined);
      return reply.status(status).send(body);
    }
  });
  await app.register(helmet);
  app.enableCors({ origin: [config.APP_ORIGIN], credentials: true });
  return app;
}

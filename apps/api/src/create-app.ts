import "reflect-metadata";
import { systemClock } from "@app/domain";
import helmet from "@fastify/helmet";
import { type DynamicModule, Global, Module, type Type } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { CLOCK, CONFIG } from "./common/context";
import { ErrorFilter } from "./common/error.filter";
import { requestIdFrom } from "./common/request-id";
import type { Config } from "./config";
import { SystemModule } from "./modules/system/system.module";

// Logged objects never carry credentials (AGENTS.md rule 9).
const REDACT = [
  "req.headers.authorization",
  "req.headers.cookie",
  'res.headers["set-cookie"]',
  "*.password",
  "*.newPassword",
  "*.currentPassword",
  "*.token",
];

/** Query strings may carry tokens (reset links, OAuth codes) — never log them. */
export function withoutQuery(url: string): string {
  const i = url.indexOf("?");
  return i === -1 ? url : `${url.slice(0, i)}?[REDACTED]`;
}

function rootModule(config: Config, extra: Array<Type | DynamicModule>): DynamicModule {
  @Global()
  @Module({})
  class CoreModule {}
  return {
    module: CoreModule,
    imports: [SystemModule, ...extra],
    providers: [
      { provide: CONFIG, useValue: config },
      { provide: CLOCK, useValue: systemClock },
    ],
    exports: [CONFIG, CLOCK],
    global: true,
  };
}

export async function createApp(
  config: Config,
  opts: { extraModules?: Array<Type | DynamicModule>; logger?: boolean; logStream?: { write(line: string): void } } = {},
): Promise<NestFastifyApplication> {
  const adapter = new FastifyAdapter({
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
  const app = await NestFactory.create<NestFastifyApplication>(rootModule(config, opts.extraModules ?? []), adapter, {
    logger: opts.logger === false || opts.logStream ? false : undefined,
  });
  app.setGlobalPrefix("api/v1");
  app.useGlobalFilters(new ErrorFilter());
  app.enableCors({ origin: [config.APP_ORIGIN], credentials: true });
  await app.register(helmet);

  const fastify = app.getHttpAdapter().getInstance();
  fastify.addHook("onRequest", async (req, reply) => {
    reply.header("x-request-id", req.id);
  });
  return app;
}

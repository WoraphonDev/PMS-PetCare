import type { Db } from "@app/db";
import { Module } from "@nestjs/common";
import type Valkey from "iovalkey";
import { CONFIG } from "../../common/context";
import { PLATFORM_DB, VALKEY } from "../../common/db";
import type { Config } from "../../config";
import { AUTH, createAuth } from "./auth";
import { AuthGuard } from "./auth.guard";
import { IdentityController } from "./identity.controller";
import { LOGIN_LIMITER, loginLimiter } from "./rate-limit";

@Module({
  controllers: [IdentityController],
  providers: [
    { provide: AUTH, inject: [CONFIG, PLATFORM_DB], useFactory: (config: Config, db: Db) => createAuth(config, db) },
    { provide: LOGIN_LIMITER, inject: [VALKEY], useFactory: (valkey: Valkey) => loginLimiter(valkey) },
    AuthGuard,
  ],
  exports: [AUTH, AuthGuard],
})
export class IdentityModule {}

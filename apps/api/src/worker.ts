import "reflect-metadata";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { loadConfig } from "./config";

// Worker entrypoint (ADR-0002): same codebase, separate process. Queue consumers arrive with the outbox relay card.
@Module({})
class WorkerModule {}

try {
  loadConfig(process.env);
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}

const app = await NestFactory.createApplicationContext(WorkerModule);
app.enableShutdownHooks();

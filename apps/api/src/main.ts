import { loadConfig } from "./config";
import { createApp } from "./create-app";

let config: ReturnType<typeof loadConfig>;
try {
  config = loadConfig(process.env);
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}

const app = await createApp(config);
await app.listen({ port: config.PORT, host: "0.0.0.0" });

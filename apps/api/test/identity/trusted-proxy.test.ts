import { afterAll, beforeAll, expect, it } from "vitest";
import { createApp } from "../../src/create-app";
import { testConfig } from "../support/app";
import { createTestInfra, type TestInfra } from "../support/infra";

let infra: TestInfra;
beforeAll(async () => {
  infra = await createTestInfra();
}, 180_000);
afterAll(async () => {
  await infra?.stop();
});
it.each([
  [undefined, "10.0.0.1", "10.0.0.1"],
  [["10.0.0.0/24"], "10.0.0.1", "198.51.100.9"],
  [["10.0.0.0/24"], "10.0.1.1", "10.0.1.1"],
])("only trusts configured proxy addresses %s", async (trusted, remoteAddress, expected) => {
  const app = await createApp({ ...testConfig, TRUSTED_PROXY_CIDRS: trusted }, { infra, logger: false });
  const fastify = app.getHttpAdapter().getInstance();
  fastify.get("/test-ip", async (req) => ({ ip: req.ip }));
  try {
    await app.init();
    await fastify.ready();
    const res = await app.inject({
      method: "GET",
      url: "/test-ip",
      remoteAddress,
      headers: { "x-forwarded-for": "192.0.2.88, 198.51.100.9" },
    });
    expect(res.json()).toEqual({ ip: expected });
  } finally {
    await app.close();
  }
});

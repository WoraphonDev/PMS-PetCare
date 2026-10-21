import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { resendLimiter, signupLimiter } from "../../src/modules/identity";
import { forgotLimiter, loginLimiter } from "../../src/modules/identity/rate-limit";
import { createTestInfra, type TestInfra } from "../support/infra";

let infra: TestInfra;
beforeAll(async () => {
  infra = await createTestInfra();
}, 180_000);
afterAll(async () => {
  await infra?.stop();
});
const ip = () => randomUUID();
const email = () => `${randomUUID()}@example.com`;
const key = (prefix: string, part: string) => `${prefix}:${encodeURIComponent(part.toLowerCase())}`;

describe("standalone Valkey atomic abuse ports", () => {
  it("uses real standalone Valkey, admitting exactly five concurrent signup attempts", async () => {
    expect(await infra.valkey.info("cluster")).toContain("cluster_enabled:0");
    const limiter = signupLimiter(infra.valkey);
    const address = ip();
    const results = await Promise.all(Array.from({ length: 30 }, () => limiter.consume(address)));
    expect(results.filter(Boolean)).toHaveLength(5);
    expect(await limiter.consume(address)).toBe(false);
    expect(await infra.valkey.get(key("signup-attempt", address))).toBe("31");
  });

  it("enforces three per normalized email across IPs and ten per IP across emails", async () => {
    const limiter = resendLimiter(infra.valkey);
    const recipient = email();
    const perEmail = await Promise.all(Array.from({ length: 20 }, () => limiter.consume(recipient.toUpperCase(), ip())));
    expect(perEmail.filter(Boolean)).toHaveLength(3);
    const address = ip();
    const perIp = await Promise.all(Array.from({ length: 30 }, () => limiter.consume(email(), address)));
    expect(perIp.filter(Boolean)).toHaveLength(10);
  });

  it("increments both counters even when either counterpart is already blocked", async () => {
    const limiter = resendLimiter(infra.valkey);
    const recipient = email();
    for (let i = 0; i < 3; i++) expect(await limiter.consume(recipient, ip())).toBe(true);
    const address = ip();
    for (let i = 0; i < 10; i++) expect(await limiter.consume(recipient, address)).toBe(false);
    expect(await limiter.consume(email(), address)).toBe(false);
    const fresh = email();
    for (let i = 0; i < 3; i++) expect(await limiter.consume(fresh, address)).toBe(false);
    expect(await limiter.consume(fresh, ip())).toBe(false);
    expect(await infra.valkey.get(key("resend-email-attempt", recipient))).toBe("13");
    expect(await infra.valkey.get(key("resend-ip-attempt", address))).toBe("14");
  });

  it("keeps first-attempt expiry on accepted and blocked attempts without refunds", async () => {
    const address = ip();
    const recipient = email();
    const signup = signupLimiter(infra.valkey);
    const resend = resendLimiter(infra.valkey);
    await signup.consume(address);
    await resend.consume(recipient, address);
    const keys = [key("signup-attempt", address), key("resend-email-attempt", recipient), key("resend-ip-attempt", address)];
    for (const k of keys) {
      expect(await infra.valkey.ttl(k)).toBeGreaterThan(3590);
      await infra.valkey.pexpire(k, 1500);
    }
    const before = await Promise.all(keys.map((k) => infra.valkey.pttl(k)));
    for (let i = 0; i < 12; i++) {
      await signup.consume(address);
      await resend.consume(recipient, address);
    }
    for (const [i, k] of keys.entries()) {
      expect(await infra.valkey.pttl(k)).toBeLessThanOrEqual(before[i] as number);
      expect(await infra.valkey.pttl(k)).toBeGreaterThan(0);
    }
  });

  it("does not admit command errors or mutate the other resend counter on wrong type", async () => {
    const recipient = email();
    const address = ip();
    await infra.valkey.set(key("resend-ip-attempt", address), "corrupt");
    expect(await resendLimiter(infra.valkey).consume(recipient, address)).toBe(false);
    expect(await infra.valkey.get(key("resend-email-attempt", recipient))).toBeNull();
    await infra.valkey.set(key("signup-attempt", address), "corrupt");
    await expect(signupLimiter(infra.valkey).consume(address)).rejects.toMatchObject({ code: "INTERNAL" });
  });

  it("fails closed/suppresses when a real client is disconnected", async () => {
    const client = infra.valkey.duplicate({ lazyConnect: true, enableOfflineQueue: false, retryStrategy: () => null });
    client.on("error", () => undefined);
    client.disconnect();
    await expect(signupLimiter(client).consume(ip())).rejects.toMatchObject({ code: "INTERNAL" });
    expect(await resendLimiter(client).consume(email(), ip())).toBe(false);
  });

  it("keeps login and forgot namespaces and policies separate", async () => {
    const address = ip();
    const recipient = email();
    const login = loginLimiter(infra.valkey);
    const forgot = forgotLimiter(infra.valkey);
    for (let i = 0; i < 12; i++) {
      await signupLimiter(infra.valkey).consume(address);
      await resendLimiter(infra.valkey).consume(recipient, address);
    }
    expect(await login.isBlocked(recipient, address)).toBe(false);
    for (let i = 0; i < 5; i++) await login.recordFailure(recipient, address);
    expect(await login.isBlocked(recipient, address)).toBe(true);
    expect(await login.ttl(recipient, address)).toBeGreaterThan(890);
    for (let i = 0; i < 3; i++) expect(await forgot.tryConsume(recipient, address)).toBe(true);
    expect(await forgot.tryConsume(recipient, address)).toBe(false);
    expect(await forgot.ttl(recipient, address)).toBeGreaterThan(3590);
    await login.reset(recipient, address);
    expect(await login.isBlocked(recipient, address)).toBe(false);
    expect(await forgot.tryConsume(recipient, address)).toBe(false);
    expect(await signupLimiter(infra.valkey).consume(address)).toBe(false);
  });

  it("resets all quotas after actual fixed expiry", async () => {
    const address = ip();
    const recipient = email();
    for (let i = 0; i < 11; i++) {
      await signupLimiter(infra.valkey).consume(address);
      await resendLimiter(infra.valkey).consume(recipient, address);
    }
    const keys = [key("signup-attempt", address), key("resend-email-attempt", recipient), key("resend-ip-attempt", address)];
    for (const k of keys) await infra.valkey.pexpire(k, 50);
    await vi.waitFor(async () => {
      expect(await infra.valkey.exists(...keys)).toBe(0);
    });
    expect(await signupLimiter(infra.valkey).consume(address)).toBe(true);
    expect(await resendLimiter(infra.valkey).consume(recipient, address)).toBe(true);
  });

  it.each([null, undefined, 2, "1", [1], new Error("command failure")])("rejects invalid script response %s", async (reply) => {
    const evalSpy = vi.spyOn(infra.valkey, "eval");
    if (reply instanceof Error) evalSpy.mockRejectedValueOnce(reply).mockRejectedValueOnce(reply);
    else evalSpy.mockResolvedValueOnce(reply).mockResolvedValueOnce(reply);
    try {
      await expect(signupLimiter(infra.valkey).consume(ip())).rejects.toMatchObject({ code: "INTERNAL" });
      expect(await resendLimiter(infra.valkey).consume(email(), ip())).toBe(false);
    } finally {
      evalSpy.mockRestore();
    }
  });
});

import type { Readable } from "node:stream";
import type { PipeTransform } from "@nestjs/common";
import type { z } from "zod";
import { AppError } from "../../common/app-error";

/**
 * Like common ZodBody, but `details.fields` has no prototype: the strict org bodies report every unknown key by name
 * (#contract-org, #contract-branch), and a key such as `toString` or `constructor` must not hit Object.prototype.
 */
export class OrgBody<S extends z.ZodType> implements PipeTransform<unknown, z.infer<S>> {
  constructor(private readonly schema: S) {}

  transform(value: unknown): z.infer<S> {
    const parsed = this.schema.safeParse(value);
    if (parsed.success) return parsed.data;
    const fields: Record<string, string[]> = Object.create(null);
    for (const issue of parsed.error.issues) {
      const key = issue.path.join(".") || "_";
      fields[key] = [...(fields[key] ?? []), issue.message];
    }
    throw new AppError("VALIDATION_FAILED", "Invalid request", { fields });
  }
}

export interface NoBodyRequest {
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
  raw: Readable;
}

/**
 * GET/DELETE schedule routes take no body (#contract-branch-schedule-common): absent or zero-byte only. A chunked body
 * is judged by its bytes: Fastify has already parsed a DELETE body, while a GET body is left unread on the raw stream.
 */
export async function assertNoBody(req: NoBodyRequest): Promise<void> {
  if (await hasBody(req)) {
    throw new AppError("VALIDATION_FAILED", "Invalid request", { fields: { _: ["Request body is not allowed"] } });
  }
}

async function hasBody({ headers, body, raw }: NoBodyRequest): Promise<boolean> {
  const length = headers["content-length"];
  if (headers["transfer-encoding"] === undefined) return length !== undefined && length !== "0";
  if (body !== undefined) return body !== "";
  return hasFirstByte(raw);
}

/** Resolves on the first nonempty chunk (pausing the stream, never destroying it) or on the end of an empty stream. */
function hasFirstByte(raw: Readable): Promise<boolean> {
  if (raw.readableEnded) return Promise.resolve(false);
  return new Promise((resolve, reject) => {
    const settle = (value: boolean) => {
      raw.off("data", onData).off("end", onEnd).off("close", onEnd).off("error", reject);
      resolve(value);
    };
    const onData = (chunk: Buffer | string) => {
      if (chunk.length === 0) return;
      raw.pause();
      settle(true);
    };
    const onEnd = () => settle(false);
    raw.on("data", onData).once("end", onEnd).once("close", onEnd).once("error", reject);
  });
}

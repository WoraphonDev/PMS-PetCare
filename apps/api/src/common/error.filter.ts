import { type ErrorCode, type ErrorResponse, errorHttpStatus } from "@app/contracts";
import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, Logger } from "@nestjs/common";
import { AppError } from "./app-error";

interface Reply {
  status(code: number): Reply;
  send(body: unknown): unknown;
}

const BY_HTTP_STATUS: Record<number, ErrorCode> = {
  400: "VALIDATION_FAILED",
  401: "UNAUTHENTICATED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  413: "VALIDATION_FAILED",
  415: "VALIDATION_FAILED",
  429: "RATE_LIMITED",
};

/** Maps any thrown value to the error envelope. Unknown errors become INTERNAL and are logged, never echoed. */
export function toErrorResponse(err: unknown, log: (e: unknown) => void): { status: number; body: ErrorResponse } {
  let code: ErrorCode;
  let message: string;
  let details: Record<string, unknown> | undefined;
  if (err instanceof AppError) {
    ({ code, message, details } = err);
  } else if (err instanceof HttpException && BY_HTTP_STATUS[err.getStatus()]) {
    code = BY_HTTP_STATUS[err.getStatus()] as ErrorCode;
    message = code === "NOT_FOUND" ? "Not found" : "Request rejected";
  } else if (isFastifyClientError(err)) {
    code = BY_HTTP_STATUS[err.statusCode] ?? "VALIDATION_FAILED";
    message = "Invalid request";
    details = code === "VALIDATION_FAILED" ? { fields: { body: ["Malformed request body"] } } : undefined;
  } else {
    log(err);
    code = "INTERNAL";
    message = "Unexpected error";
  }
  return { status: errorHttpStatus[code], body: { error: details ? { code, message, details } : { code, message } } };
}

function isFastifyClientError(err: unknown): err is { statusCode: number } {
  const status = (err as { statusCode?: unknown } | null)?.statusCode;
  return typeof status === "number" && status >= 400 && status < 500;
}

@Catch()
export class ErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger("ErrorFilter");

  catch(err: unknown, host: ArgumentsHost) {
    const reply = host.switchToHttp().getResponse<Reply>();
    const { status, body } = toErrorResponse(err, (e) => this.logger.error(e instanceof Error ? e.stack : String(e)));
    reply.status(status).send(body);
  }
}

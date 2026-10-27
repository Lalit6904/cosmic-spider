import { ZodError } from "zod";
import { env } from "../config/env.js";
import { logger, securityLog } from "./logger.js";
class AppError extends Error {
  status;
  code;
  fields;
  expose;
  constructor(status, code, message, options = {}) {
    super(message, { cause: options.cause });
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.fields = options.fields;
    this.expose = options.expose ?? status < 500;
  }
}
function badRequest(code, message, fields) {
  return new AppError(400, code, message, { fields });
}
function unauthorized(message = "Authentication required.") {
  return new AppError(401, "UNAUTHENTICATED", message);
}
function forbidden(message = "You do not have permission to do that.") {
  return new AppError(403, "FORBIDDEN", message);
}
function notFound(message = "Resource not found.") {
  return new AppError(404, "NOT_FOUND", message);
}
function conflict(code, message) {
  return new AppError(409, code, message);
}
function tooManyRequests(message = "Too many requests. Please wait and try again.", retryAfterMs) {
  const error = new AppError(429, "RATE_LIMITED", message);
  if (retryAfterMs != null) {
    Object.assign(error, { retryAfterMs });
  }
  return error;
}
function parseInput(schema, value) {
  return schema.parse(value);
}
function zodFields(error) {
  const fields = {};
  for (const issue of error.issues) {
    const path = issue.path.join(".") || "form";
    if (!fields[path]) fields[path] = issue.message;
  }
  return fields;
}
function errorHandler(error, req, res, _next) {
  const requestId = req.requestId;
  if (error instanceof ZodError) {
    res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Please check the highlighted fields.",
        fields: zodFields(error),
        requestId
      }
    });
    return;
  }
  if (error instanceof AppError) {
    if (error.status >= 500) {
      logger.error({ err: error, requestId }, "Application error");
    } else if (error.status === 403 || error.status === 401) {
      securityLog.info(
        { requestId, code: error.code, path: req.path, method: req.method, ip: req.ip },
        "Request rejected"
      );
    }
    res.status(error.status).json({
      error: {
        code: error.code,
        message: error.expose ? error.message : "Something went wrong.",
        ...error.fields ? { fields: error.fields } : {},
        requestId
      }
    });
    return;
  }
  if (typeof error === "object" && error !== null && "code" in error && error.code === 11e3) {
    res.status(409).json({
      error: {
        code: "CONFLICT",
        message: "That value is already in use.",
        requestId
      }
    });
    return;
  }
  logger.error({ err: error, requestId, path: req.path, method: req.method }, "Unhandled application error");
  res.status(500).json({
    error: {
      code: "INTERNAL_ERROR",
      message: "An unexpected error occurred.",
      requestId
    }
  });
}
function notFoundHandler(req, res) {
  const isApi = req.originalUrl.startsWith("/api/") || req.path.startsWith("/api/");
  if (isApi) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Endpoint not found.", requestId: req.requestId } });
    return;
  }
  res.status(404).type("text/plain").send(env.isProduction ? "Not found" : "Not found. Build the client or use the Vite dev server.");
}
export {
  AppError,
  badRequest,
  conflict,
  errorHandler,
  forbidden,
  notFound,
  notFoundHandler,
  parseInput,
  tooManyRequests,
  unauthorized,
  zodFields
};

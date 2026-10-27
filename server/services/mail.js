import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import nodemailer from "nodemailer";
import { env } from "../config/env.js";
const transport = env.SMTP_HOST && env.NODE_ENV !== "test" ? nodemailer.createTransport({
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  secure: env.SMTP_SECURE,
  auth: env.SMTP_USER && env.SMTP_PASS ? {
    user: env.SMTP_USER,
    pass: env.SMTP_PASS
  } : void 0,
  disableFileAccess: true,
  disableUrlAccess: true
}) : null;
async function writeDevelopmentMail(to, subject, text) {
  const directory = path.resolve(process.cwd(), ".mail-outbox");
  await mkdir(directory, { recursive: true });
  const safeName = `reset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`;
  const body = [
    `To: ${to}`,
    `Subject: ${subject}`,
    `Date: ${(/* @__PURE__ */ new Date()).toISOString()}`,
    "",
    text,
    ""
  ].join("\n");
  await writeFile(path.join(directory, safeName), body, { encoding: "utf8", mode: 384 });
}
async function sendPasswordResetEmail(to, resetUrl) {
  const subject = "Reset your Cosmic Spider password";
  const text = [
    "Someone requested a password reset for your Cosmic Spider account.",
    "",
    `Open this link within 30 minutes to choose a new password: ${resetUrl}`,
    "",
    "If you did not request this, you can ignore the email. Your password has not changed."
  ].join("\n");
  if (!transport) {
    if (env.NODE_ENV === "development") {
      await writeDevelopmentMail(to, subject, text);
      return;
    }
    if (env.NODE_ENV !== "test") {
      throw new Error("SMTP transport is not configured");
    }
    return;
  }
  await transport.sendMail({
    from: env.SMTP_FROM,
    to,
    subject,
    text
  });
}
export {
  sendPasswordResetEmail
};

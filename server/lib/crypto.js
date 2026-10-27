import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
function randomToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}
function hashToken(token) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
function constantTimeEqualHex(a, b) {
  if (!/^[a-f0-9]{64}$/i.test(a) || !/^[a-f0-9]{64}$/i.test(b)) return false;
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}
function randomId(bytes = 16) {
  return randomBytes(bytes).toString("hex");
}
export {
  constantTimeEqualHex,
  hashToken,
  randomId,
  randomToken
};

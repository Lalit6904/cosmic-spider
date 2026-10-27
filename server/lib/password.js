import bcrypt from "bcrypt";
const BCRYPT_ROUNDS = 12;
const dummyHashPromise = bcrypt.hash("cosmic-spider-timing-equalizer-71", BCRYPT_ROUNDS);
async function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}
async function verifyPassword(password, hash) {
  if (!hash) return false;
  return bcrypt.compare(password, hash);
}
async function verifyPasswordOrDummy(password, hash) {
  const effectiveHash = hash ?? await dummyHashPromise;
  const matches = await bcrypt.compare(password, effectiveHash);
  return Boolean(hash) && matches;
}
async function burnPasswordTime(password) {
  await bcrypt.compare(password, await dummyHashPromise);
}
export {
  burnPasswordTime,
  hashPassword,
  verifyPassword,
  verifyPasswordOrDummy
};

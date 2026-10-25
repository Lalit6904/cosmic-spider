import bcrypt from 'bcrypt';

const BCRYPT_ROUNDS = 12;
const dummyHashPromise = bcrypt.hash('cosmic-spider-timing-equalizer-71', BCRYPT_ROUNDS);

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string | null | undefined): Promise<boolean> {
  if (!hash) return false;
  return bcrypt.compare(password, hash);
}

/** Always performs a bcrypt comparison so missing accounts are less distinguishable. */
export async function verifyPasswordOrDummy(password: string, hash: string | null | undefined): Promise<boolean> {
  const effectiveHash = hash ?? (await dummyHashPromise);
  const matches = await bcrypt.compare(password, effectiveHash);
  return Boolean(hash) && matches;
}

export async function burnPasswordTime(password: string): Promise<void> {
  await bcrypt.compare(password, await dummyHashPromise);
}

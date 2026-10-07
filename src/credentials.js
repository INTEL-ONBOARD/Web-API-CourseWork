import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);

export function deriveSeedSecret(master, identity) {
  if (!master || master.length < 32) {
    throw new Error('SEED_CREDENTIAL_MASTER must contain at least 32 characters');
  }
  return createHmac('sha256', master).update(identity).digest('base64url');
}

export async function hashSecret(secret) {
  const salt = randomBytes(16);
  const derived = await scrypt(secret, salt, 64);
  return `${salt.toString('hex')}:${derived.toString('hex')}`;
}

export async function verifySecret(secret, stored) {
  if (typeof secret !== 'string' || typeof stored !== 'string') return false;
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex || saltHex.length !== 32 || hashHex.length !== 128) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = await scrypt(secret, Buffer.from(saltHex, 'hex'), expected.length);
  return timingSafeEqual(actual, expected);
}

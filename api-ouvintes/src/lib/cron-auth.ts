import { timingSafeEqual } from 'node:crypto';

export function isCronRequestAuthorized(authorization: string | undefined, secret: string | undefined): boolean {
  if (!authorization || !secret || !authorization.startsWith('Bearer ')) return false;
  const provided = Buffer.from(authorization.slice('Bearer '.length), 'utf8');
  const expected = Buffer.from(secret, 'utf8');
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

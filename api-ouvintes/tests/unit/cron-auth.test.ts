import { describe, expect, it } from 'vitest';
import { isCronRequestAuthorized } from '../../src/lib/cron-auth.js';

describe('Vercel Cron authorization', () => {
  it('accepts only an exact Bearer secret', () => {
    expect(isCronRequestAuthorized('Bearer synthetic-cron-secret', 'synthetic-cron-secret')).toBe(true);
    expect(isCronRequestAuthorized('Bearer synthetic-cron-secret-extra', 'synthetic-cron-secret')).toBe(false);
    expect(isCronRequestAuthorized('synthetic-cron-secret', 'synthetic-cron-secret')).toBe(false);
  });

  it('rejects missing authorization and missing configuration', () => {
    expect(isCronRequestAuthorized(undefined, 'synthetic-cron-secret')).toBe(false);
    expect(isCronRequestAuthorized('Bearer synthetic-cron-secret', undefined)).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { calendarOAuthCallbackSchema } from '../../src/schemas/calendar-oauth.js';

const callback = { code: 'test-code', state: 's'.repeat(43) };

describe('Google Calendar OAuth callback', () => {
  it('accepts the standard metadata returned by Google', () => {
    expect(calendarOAuthCallbackSchema.parse({ ...callback,
      iss: 'https://accounts.google.com',
      scope: 'https://www.googleapis.com/auth/calendar.events.readonly',
      authuser: '4', prompt: 'consent',
    }).code).toBe('test-code');
  });
  it('rejects a different issuer and unexpected parameters', () => {
    expect(calendarOAuthCallbackSchema.safeParse({ ...callback, iss: 'https://example.com' }).success).toBe(false);
    expect(calendarOAuthCallbackSchema.safeParse({ ...callback, redirect_uri: 'https://example.com' }).success).toBe(false);
  });
  it('retains bounds and accepts a canceled authorization', () => {
    expect(calendarOAuthCallbackSchema.safeParse({ ...callback, scope: 'a'.repeat(4097) }).success).toBe(false);
    expect(calendarOAuthCallbackSchema.safeParse({ ...callback, state: 'short' }).success).toBe(false);
    expect(calendarOAuthCallbackSchema.parse({ error: 'access_denied', error_description: 'Canceled' }).error).toBe('access_denied');
  });
  it('rejects an unexpected issuer', () => {
    expect(calendarOAuthCallbackSchema.safeParse({ ...callback, iss: 'https://example.com' }).success).toBe(false);
  });

  it('retains state constraints and rejects unknown parameters', () => {
    expect(calendarOAuthCallbackSchema.safeParse({ ...callback, state: 'short' }).success).toBe(false);
    expect(calendarOAuthCallbackSchema.safeParse({ ...callback, redirect_uri: 'https://example.com' }).success).toBe(false);
  });
});

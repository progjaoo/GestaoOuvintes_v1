import { describe, expect, it, vi } from 'vitest';
import { createGoogleCalendarApi, GoogleCalendarSyncTokenExpired } from '../../src/services/google-calendar-api.js';

const scope = 'https://www.googleapis.com/auth/calendar.events.readonly';
const allowedCalendarId = 'fixture-calendar@group.calendar.google.com';
function tokenResponse(scopes = scope) {
  return new Response(JSON.stringify({ access_token: 'synthetic-access-token', token_type: 'Bearer', expires_in: 3600, scope: scopes }), { status: 200 });
}

describe('Google Calendar read-only client', () => {
  it('uses only token refresh POST and fixed allowlisted events GET with stable sync parameters', async () => {
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input) === 'https://oauth2.googleapis.com/token') return tokenResponse();
      const url = new URL(String(input));
      expect(init?.method).toBe('GET');
      expect((init?.headers as Record<string, string>).authorization).toBe('Bearer synthetic-access-token');
      expect(url.searchParams.get('maxResults')).toBe('2500');
      expect(url.searchParams.get('showDeleted')).toBe('true');
      expect(url.searchParams.get('singleEvents')).toBe('true');
      expect(url.searchParams.get('timeZone')).toBe('America/Sao_Paulo');
      expect(url.searchParams.get('syncToken')).toBe('cursor-previous');
      expect(url.searchParams.has('timeMin')).toBe(false);
      expect(url.searchParams.get('pageToken')).toBe('page-2');
      return new Response(JSON.stringify({ items: [{ id: 'event-1' }], nextSyncToken: 'cursor-next' }), { status: 200 });
    });
    const api = createGoogleCalendarApi({ clientId: 'synthetic-client', clientSecret: 'synthetic-secret', allowedCalendarId,
      loadRefreshToken: async () => 'synthetic-refresh-token' }, fetcher);

    const result = await api.listEvents({ calendarId: allowedCalendarId, syncToken: 'cursor-previous', pageToken: 'page-2' });

    expect(result.items).toEqual([{ id: 'event-1' }]);
    expect(result.nextSyncToken).toBe('cursor-next');
    expect(fetcher.mock.calls.map(([, init]) => init?.method)).toEqual(['POST', 'GET']);
  });

  it('bounds initial history consistently across pages and keeps all future events', async () => {
    const urls: URL[] = [];
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      if (String(input) === 'https://oauth2.googleapis.com/token') return tokenResponse();
      urls.push(new URL(String(input)));
      return new Response(JSON.stringify({items:[],nextSyncToken:'next'}),{status:200});
    });
    const api=createGoogleCalendarApi({clientId:'client',clientSecret:'secret',allowedCalendarId,loadRefreshToken:async()=>'refresh'},fetcher);
    await api.listEvents({calendarId:allowedCalendarId,syncToken:null});
    await api.listEvents({calendarId:allowedCalendarId,syncToken:null,pageToken:'next-page'});
    expect(urls[0]!.searchParams.get('timeMin')).toBe(urls[1]!.searchParams.get('timeMin'));
    expect(Date.parse(urls[0]!.searchParams.get('timeMin')!)).toBeLessThan(Date.now()-34*86400000);
    expect(urls[0]!.searchParams.has('timeMax')).toBe(false);
  });

  it('rejects any calendar outside the server allowlist before requesting a token', async () => {
    const fetcher = vi.fn();
    const api = createGoogleCalendarApi({ clientId: 'client', clientSecret: 'secret', allowedCalendarId,
      loadRefreshToken: async () => 'refresh' }, fetcher as typeof fetch);

    await expect(api.listEvents({ calendarId: 'other-calendar', syncToken: null })).rejects.toMatchObject({ code: 'CALENDAR_ID_NOT_ALLOWED' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects tokens with broader OAuth scopes', async () => {
    const fetcher = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => String(input) === 'https://oauth2.googleapis.com/token'
      ? tokenResponse(`${scope} https://www.googleapis.com/auth/calendar`) : new Response('{}', { status: 200 }));
    const api = createGoogleCalendarApi({ clientId: 'client', clientSecret: 'secret', allowedCalendarId,
      loadRefreshToken: async () => 'refresh' }, fetcher);

    await expect(api.listEvents({ calendarId: allowedCalendarId, syncToken: null })).rejects.toMatchObject({ code: 'CALENDAR_OAUTH_SCOPE_REJECTED' });
  });

  it('signals an expired cursor for a full read without issuing any write request', async () => {
    const fetcher = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => String(input) === 'https://oauth2.googleapis.com/token'
      ? tokenResponse() : new Response('', { status: 410 }));
    const api = createGoogleCalendarApi({ clientId: 'client', clientSecret: 'secret', allowedCalendarId,
      loadRefreshToken: async () => 'refresh' }, fetcher);

    await expect(api.listEvents({ calendarId: allowedCalendarId, syncToken: 'expired-cursor' })).rejects.toBeInstanceOf(GoogleCalendarSyncTokenExpired);
    expect(fetcher.mock.calls.map(([, init]) => init?.method)).toEqual(['POST', 'GET']);
  });

  it('maps Google refresh failures to safe errors without exposing provider details', async () => {
    const fetcher = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ error: 'invalid_grant', description: 'private provider detail' }), { status: 400 }));
    const api = createGoogleCalendarApi({ clientId: 'client', clientSecret: 'secret', allowedCalendarId,
      loadRefreshToken: async () => 'refresh' }, fetcher as typeof fetch);

    try {
      await api.listEvents({ calendarId: allowedCalendarId, syncToken: null });
      throw new Error('Expected refresh failure');
    } catch (error) {
      expect(error).toMatchObject({ code: 'CALENDAR_RECONNECT_REQUIRED' });
      expect(String(error)).not.toContain('private provider detail');
    }
  });
});

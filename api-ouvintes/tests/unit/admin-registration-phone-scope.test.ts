import Fastify from 'fastify';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { adminRegistrationRoutes } from '../../src/routes/admin-registrations.js';
const fixture = vi.hoisted(() => ({ global: false, list: vi.fn(), detail: vi.fn(), exports: vi.fn() }));
vi.mock('../../src/plugins/auth.js', () => ({
  requireAuthentication: async (request: any) => {
    request.authz = { permissions: new Set(['listener.phone.read']), scopes: new Map([['listener.phone.read', [{ type: fixture.global ? 'global' : 'participation', departmentId: null }]]]) };
    request.user = { sub: 'fixture' };
  }, requirePermission: () => async () => {},
}));
vi.mock('../../src/services/registration-service.js', () => ({
  listListenerRegistrations: fixture.list, getListenerRegistration: fixture.detail, getRegistrationsForExport: fixture.exports, auditExport: vi.fn(),
}));
vi.mock('../../src/services/export-service.js', () => ({ createCsv: (rows: unknown) => JSON.stringify(rows), createXlsx: vi.fn() }));
afterEach(() => { fixture.global = false; vi.clearAllMocks(); });
describe('legacy phone scope boundary', () => {
  it('does not reveal full phones for participation-scoped grants in global list', async () => {
    fixture.list.mockResolvedValue({ rows: [{ id: 'fixture', phone: 'fixture-phone' }], total: 1 });
    const app=Fastify(); await app.register(adminRegistrationRoutes);
    const reply=await app.inject({url:'/'});
    expect(reply.statusCode).toBe(200); expect(reply.json().items[0].phone).toBeNull();
    expect(fixture.list.mock.calls[0]?.[1]).toEqual({ canSearchPhone: false }); await app.close();
  });
  it('does not reveal full phones through a direct id', async () => {
    fixture.detail.mockResolvedValue({ id:'fixture', phone:'fixture-phone' });
    const app=Fastify(); await app.register(adminRegistrationRoutes);
    const reply=await app.inject({url:'/11111111-1111-4111-8111-111111111111'});
    expect(reply.statusCode).toBe(200); expect(reply.json().phone).toBeNull(); await app.close();
  });
  it('preserves explicitly global phone access', async () => {
    fixture.global=true; fixture.detail.mockResolvedValue({id:'fixture',phone:'fixture-phone'});
    const app=Fastify(); await app.register(adminRegistrationRoutes);
    const reply=await app.inject({url:'/11111111-1111-4111-8111-111111111111'});
    expect(reply.statusCode).toBe(200); expect(reply.json().phone).toBe('fixture-phone'); await app.close();
  });
});

import { afterAll, beforeEach, expect, it, vi } from 'vitest';
vi.mock('./env', () => ({ env: { secret: 'terminology-fixture', publicOrigin: 'https://fixture.invalid' }, nowIso: () => new Date().toISOString() }));
vi.mock('./db', async () => {
  const { default: Database } = await import('better-sqlite3');
  const { drizzle } = await import('drizzle-orm/better-sqlite3');
  const schema = await import('./db/schema'); const { MIGRATIONS } = await import('./db/migrations');
  const sqlite = new Database(':memory:'); sqlite.pragma('foreign_keys = ON');
  for (const migration of MIGRATIONS) sqlite.exec(migration.sql);
  return { sqlite, schema, db: drizzle(sqlite, { schema }) };
});
import { sqlite } from './db';
import { createEvent, getEvent } from './events';
import { orderReferenceLabel } from '$shared/terminology';
import { actions } from '../../routes/admin/events/[id]/+page.server';
import { actions as createActions } from '../../routes/admin/+page.server';
const action = (id: number, form: Record<string, string>) => (actions.update as Function)({ params: { id: String(id) }, locals: { admin: { id: 1 } }, request: new Request('https://fixture.invalid', { method: 'POST', body: new URLSearchParams(form) }) });
beforeEach(() => sqlite.exec('DELETE FROM events'));
afterAll(() => sqlite.close());
it('creates neutral projects without restricting subject matter or changing explicit labels', () => {
  expect(createEvent({ name: 'Nature' }).subjectLabel).toBe('Order reference');
  expect(createEvent({ name: 'Conference', subjectLabel: ' Participant name ' }).subjectLabel).toBe('Participant name');
  expect(createEvent({ name: 'Products', subjectLabel: 'Product code' }).subjectLabel).toBe('Product code');
});
it('saves a custom label through project settings and isolates it to that project', async () => {
  const first = createEvent({ name: 'Conference' }), second = createEvent({ name: 'Products', subjectLabel: 'Product code' });
  expect(await action(first.id, { subjectLabel: '  Participant   name  ' })).toEqual({ ok: 'Project settings saved.' });
  expect(getEvent(first.id)?.subjectLabel).toBe('Participant name');
  expect(getEvent(second.id)?.subjectLabel).toBe('Product code');
});
it('retains legacy choices for older forms, and resets only an explicitly cleared label', async () => {
  const legacy = createEvent({ name: 'Existing project', subjectLabel: 'child' });
  await action(legacy.id, { name: 'Renamed' });
  expect(getEvent(legacy.id)?.subjectLabel).toBe('child');
  expect(orderReferenceLabel(getEvent(legacy.id)?.subjectLabel)).toBe('Child name(s)');
  await action(legacy.id, { subjectLabel: '  ' });
  expect(orderReferenceLabel(getEvent(legacy.id)?.subjectLabel)).toBe('Order reference');
});
it('rejects oversized labels before mutating project settings', async () => {
  const event = createEvent({ name: 'Keep this', subjectLabel: 'Team' });
  expect(await action(event.id, { name: 'Do not change', subjectLabel: 'x'.repeat(81) })).toMatchObject({ status: 400 });
  expect(getEvent(event.id)).toMatchObject({ name: 'Keep this', subjectLabel: 'Team' });
});
it('rejects invalid project-creation labels without creating a partial project', async () => {
  const result = await (createActions.create as Function)({ request: new Request('https://fixture.invalid', { method: 'POST', body: new URLSearchParams({ name: 'Invalid', subjectLabel: 'x'.repeat(81) }) }) });
  expect(result).toMatchObject({ status: 400 });
  expect(sqlite.prepare('SELECT count(*) n FROM events').get()).toEqual({ n: 0 });
});

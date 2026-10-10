import 'dotenv/config';
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from '../src/app.js';
import { pool } from '../src/db.js';
import { deriveSeedSecret } from '../src/credentials.js';

const api = request(app);
const tokens = {};
let temporaryProvinceId;
let temporaryReadingId;

async function login(path, identity, label) {
  const response = await api.post(path).send({
    identity,
    secret: deriveSeedSecret(process.env.SEED_CREDENTIAL_MASTER, label),
  });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return response.body.access_token;
}

before(async () => {
  tokens.national = await login('/api/v1/auth/user-tokens', 'national.analyst', 'user:national.analyst');
  tokens.district = await login('/api/v1/auth/user-tokens', 'district.colombo', 'user:district.colombo');
  tokens.admin = await login('/api/v1/auth/user-tokens', 'catalog.admin', 'user:catalog.admin');
  tokens.device = await login('/api/v1/auth/device-tokens', 'SLSEA-0001', 'meter:SLSEA-0001');
});

after(async () => {
  if (temporaryReadingId) await pool.query('DELETE FROM generation_readings WHERE id = $1', [temporaryReadingId]);
  if (temporaryProvinceId) await pool.query('DELETE FROM provinces WHERE id = $1', [temporaryProvinceId]);
  await pool.end();
});

test('seeded geography and history are queryable', async () => {
  const provinces = await api.get('/api/v1/provinces').auth(tokens.national, { type: 'bearer' });
  assert.equal(provinces.status, 200);
  assert.equal(provinces.body.data.length, 9);
  const history = await api.get('/api/v1/solar-installations/1/generation-readings?page_size=2&sort=timestamp_asc')
    .auth(tokens.national, { type: 'bearer' });
  assert.equal(history.status, 200);
  assert.equal(history.body.pagination.total, 672);
  assert.equal(history.body.data.length, 2);
  assert.ok(history.body.data[0].recorded_at <= history.body.data[1].recorded_at);
  assert.match(history.body.pagination.next, /page=2/);
  assert.equal(history.body.pagination.previous, null);
});

test('district scope blocks other districts and device cannot read', async () => {
  const own = await api.get('/api/v1/districts/1').auth(tokens.district, { type: 'bearer' });
  const other = await api.get('/api/v1/districts/2').auth(tokens.district, { type: 'bearer' });
  const otherHistory = await api.get('/api/v1/districts/2/generation-readings').auth(tokens.district, { type: 'bearer' });
  const deviceRead = await api.get('/api/v1/provinces').auth(tokens.device, { type: 'bearer' });
  assert.equal(own.status, 200);
  assert.equal(other.status, 404);
  assert.equal(otherHistory.status, 404);
  assert.equal(deviceRead.status, 403);
});

test('conditional GET, unacceptable Accept, and invalid input use correct contracts', async () => {
  const first = await api.get('/api/v1/provinces/1').auth(tokens.national, { type: 'bearer' });
  assert.equal(first.status, 200);
  assert.ok(first.headers.etag);
  assert.ok(first.headers['last-modified']);
  const cached = await api.get('/api/v1/provinces/1').auth(tokens.national, { type: 'bearer' })
    .set('If-None-Match', first.headers.etag);
  assert.equal(cached.status, 304);
  assert.equal(cached.text, '');
  const unacceptable = await api.get('/api/v1/provinces').auth(tokens.national, { type: 'bearer' })
    .set('Accept', 'text/html');
  assert.equal(unacceptable.status, 406);
  assert.equal(unacceptable.body.code, 'NOT_ACCEPTABLE');
  const invalid = await api.get('/api/v1/solar-installations/1/generation-readings?page_size=0')
    .auth(tokens.national, { type: 'bearer' });
  assert.equal(invalid.status, 400);
  assert.deepEqual(Object.keys(invalid.body), ['code', 'message', 'details']);
});

test('device can append only to its installation and returns Location', async () => {
  const payload = {
    recorded_at: new Date(Date.now() - 30_000).toISOString(),
    power_kw: 0,
    energy_kwh: 2500,
    voltage: 230,
  };
  const denied = await api.post('/api/v1/solar-installations/2/generation-readings')
    .auth(tokens.device, { type: 'bearer' }).send(payload);
  assert.equal(denied.status, 403);
  const created = await api.post('/api/v1/solar-installations/1/generation-readings')
    .auth(tokens.device, { type: 'bearer' }).send(payload);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  temporaryReadingId = created.body.id;
  assert.equal(created.headers.location, `/api/v1/solar-installations/1/generation-readings/${temporaryReadingId}`);
  const retrieved = await api.get(created.headers.location).auth(tokens.national, { type: 'bearer' });
  assert.equal(retrieved.status, 200);
  assert.equal(retrieved.body.id, temporaryReadingId);
});

test('admin metadata CRUD respects If-Match and dependent-record protection', async () => {
  const code = `TEST-${Date.now()}`;
  const created = await api.post('/api/v1/provinces').auth(tokens.admin, { type: 'bearer' })
    .send({ code, name: `Temporary ${code}` });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  temporaryProvinceId = created.body.id;
  assert.equal(created.headers.location, `/api/v1/provinces/${temporaryProvinceId}`);
  const stale = await api.patch(created.headers.location).auth(tokens.admin, { type: 'bearer' })
    .set('If-Match', '"stale"').send({ name: 'Changed' });
  assert.equal(stale.status, 412);
  const updated = await api.patch(created.headers.location).auth(tokens.admin, { type: 'bearer' })
    .set('If-Match', created.headers.etag).send({ name: 'Changed' });
  assert.equal(updated.status, 200, JSON.stringify(updated.body));
  assert.equal(updated.body.name, 'Changed');
  const deleted = await api.delete(created.headers.location).auth(tokens.admin, { type: 'bearer' });
  assert.equal(deleted.status, 204);
  temporaryProvinceId = undefined;
  const protectedDelete = await api.delete('/api/v1/provinces/1').auth(tokens.admin, { type: 'bearer' });
  assert.equal(protectedDelete.status, 409);
});

test('district summary is scoped and includes measurement units', async () => {
  const summary = await api.get('/api/v1/districts/1/generation-summary').auth(tokens.district, { type: 'bearer' });
  assert.equal(summary.status, 200);
  assert.equal(summary.body.installation_count, 8);
  assert.equal(summary.body.time_zone, 'Asia/Colombo');
  assert.equal(typeof summary.body.current_power_kw, 'number');
  assert.equal(typeof summary.body.today_energy_kwh, 'number');
});

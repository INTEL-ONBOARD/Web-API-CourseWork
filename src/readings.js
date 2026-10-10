import { Router } from 'express';
import { z } from 'zod';
import { pool } from './db.js';
import { authenticate } from './auth.js';
import { requireAnalyst, requireDevice, scopeCondition } from './access.js';
import { getCatalogItem } from './catalog.js';
import { ApiError, badRequest, notFound } from './errors.js';
import { sendJson } from './http.js';
import { parseTimestamp, positiveId, requireJson, validate } from './validation.js';

const readingSchema = z.strictObject({
  recorded_at: z.string(),
  power_kw: z.number().finite().nonnegative(),
  energy_kwh: z.number().finite().nonnegative(),
  voltage: z.number().finite().positive().max(500),
});

const historyFrom = `generation_readings r
  JOIN solar_installations i ON i.id = r.installation_id
  JOIN grid_substations s ON s.id = i.substation_id
  JOIN districts d ON d.id = s.district_id
  JOIN provinces p ON p.id = d.province_id`;

const scopeFields = {
  installation: 'i.id', province: 'p.id', district: 'd.id', substation: 's.id',
};

function reading(row) {
  return {
    id: String(row.id),
    installation_id: row.installation_id,
    recorded_at: new Date(row.recorded_at).toISOString(),
    power_kw: Number(row.power_kw),
    energy_kwh: Number(row.energy_kwh),
    voltage: Number(row.voltage),
    received_at: new Date(row.received_at).toISOString(),
  };
}

function historyOptions(query) {
  const allowed = new Set(['from', 'to', 'sort', 'page', 'page_size']);
  for (const key of Object.keys(query)) if (!allowed.has(key)) throw badRequest(`Unknown query parameter: ${key}`);
  const getOne = (key) => {
    const value = query[key];
    if (value === undefined) return undefined;
    if (typeof value !== 'string') throw badRequest(`${key} must appear once`);
    return value;
  };
  const from = getOne('from') ? parseTimestamp(getOne('from'), 'from') : null;
  const to = getOne('to') ? parseTimestamp(getOne('to'), 'to') : null;
  if (from && to && from >= to) throw badRequest('from must be earlier than to');
  const sort = getOne('sort') ?? 'timestamp_desc';
  if (!['timestamp_asc', 'timestamp_desc'].includes(sort)) throw badRequest('sort must be timestamp_asc or timestamp_desc');
  const page = Number(getOne('page') ?? 1);
  const pageSize = Number(getOne('page_size') ?? 25);
  if (!Number.isSafeInteger(page) || page < 1) throw badRequest('page must be a positive integer');
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) throw badRequest('page_size must be between 1 and 100');
  if (!Number.isSafeInteger((page - 1) * pageSize)) throw badRequest('page is too large');
  return { from, to, sort, page, pageSize };
}

function pageLink(request, page) {
  const url = new URL(request.originalUrl, 'https://api.local');
  url.searchParams.set('page', String(page));
  return `${url.pathname}${url.search}`;
}

async function history(request, response, kind, scopeId) {
  await getCatalogItem(kind, scopeId, request.principal);
  const options = historyOptions(request.query);
  const values = [scopeId];
  const clauses = [`${scopeFields[kind]} = $1`];
  clauses.push(scopeCondition(request.principal, kind, values));
  if (options.from) {
    values.push(options.from);
    clauses.push(`r.recorded_at >= $${values.length}`);
  }
  if (options.to) {
    values.push(options.to);
    clauses.push(`r.recorded_at < $${values.length}`);
  }
  const where = clauses.join(' AND ');
  const countResult = await pool.query(
    `SELECT count(*)::integer AS total, max(r.received_at) AS last_modified FROM ${historyFrom} WHERE ${where}`,
    values
  );
  const total = countResult.rows[0].total;
  const direction = options.sort === 'timestamp_asc' ? 'ASC' : 'DESC';
  const pageValues = [...values, options.pageSize, (options.page - 1) * options.pageSize];
  const rows = await pool.query(
    `SELECT r.id, r.installation_id, r.recorded_at, r.power_kw, r.energy_kwh, r.voltage, r.received_at
     FROM ${historyFrom} WHERE ${where}
     ORDER BY r.recorded_at ${direction}, r.id ${direction}
     LIMIT $${pageValues.length - 1} OFFSET $${pageValues.length}`,
    pageValues
  );
  const body = {
    data: rows.rows.map(reading),
    pagination: {
      total,
      page: options.page,
      page_size: options.pageSize,
      next: options.page * options.pageSize < total ? pageLink(request, options.page + 1) : null,
      previous: options.page > 1 ? pageLink(request, options.page - 1) : null,
    },
  };
  sendJson(request, response, body, { lastModified: countResult.rows[0].last_modified });
}

export const readingsRouter = Router();
readingsRouter.use(authenticate);

readingsRouter.get('/solar-installations/:installationId/generation-readings', requireAnalyst, async (request, response) => {
  await history(request, response, 'installation', positiveId(request.params.installationId, 'installationId'));
});

for (const [kind, segment] of [
  ['province', 'provinces'], ['district', 'districts'], ['substation', 'grid-substations'],
]) {
  readingsRouter.get(`/${segment}/:scopeId/generation-readings`, requireAnalyst, async (request, response) => {
    await history(request, response, kind, positiveId(request.params.scopeId, 'scopeId'));
  });
}

readingsRouter.post('/solar-installations/:installationId/generation-readings', requireDevice, async (request, response) => {
  const installationId = positiveId(request.params.installationId, 'installationId');
  if (request.principal.installationId !== installationId) {
    throw new ApiError(403, 'FORBIDDEN', 'Device can submit readings only for its installation');
  }
  requireJson(request);
  const body = validate(readingSchema, request.body);
  const recordedAt = parseTimestamp(body.recorded_at, 'recorded_at');
  if (recordedAt.getTime() > Date.now() + 5 * 60_000) throw badRequest('recorded_at is too far in the future');
  const site = (await pool.query(
    "SELECT capacity_kw FROM solar_installations WHERE id = $1 AND status = 'active'", [installationId]
  )).rows[0];
  if (!site) throw notFound('Installation not found');
  if (body.power_kw > Number(site.capacity_kw) * 1.1) throw badRequest('power_kw exceeds installation capacity tolerance');
  const result = await pool.query(
    `INSERT INTO generation_readings (installation_id, recorded_at, power_kw, energy_kwh, voltage)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [installationId, recordedAt, body.power_kw, body.energy_kwh, body.voltage]
  );
  const created = reading(result.rows[0]);
  sendJson(request, response, created, {
    status: 201,
    location: `/api/v1/solar-installations/${installationId}/generation-readings/${created.id}`,
    lastModified: created.received_at,
  });
});

readingsRouter.get('/solar-installations/:installationId/generation-readings/:readingId', requireAnalyst, async (request, response) => {
  const installationId = positiveId(request.params.installationId, 'installationId');
  if (!/^[1-9]\d*$/.test(request.params.readingId)) throw badRequest('readingId must be a positive integer');
  await getCatalogItem('installation', installationId, request.principal);
  const result = await pool.query(
    'SELECT * FROM generation_readings WHERE id = $1 AND installation_id = $2',
    [request.params.readingId, installationId]
  );
  if (!result.rowCount) throw notFound('Reading not found');
  const item = reading(result.rows[0]);
  sendJson(request, response, item, { lastModified: item.received_at });
});

readingsRouter.get('/solar-installations/:installationId/last-known-reading', requireAnalyst, async (request, response) => {
  const installationId = positiveId(request.params.installationId, 'installationId');
  await getCatalogItem('installation', installationId, request.principal);
  const result = await pool.query(
    `SELECT * FROM generation_readings WHERE installation_id = $1
     ORDER BY recorded_at DESC, id DESC LIMIT 1`, [installationId]
  );
  if (!result.rowCount) throw notFound('No readings exist for this installation');
  const latest = reading(result.rows[0]);
  sendJson(request, response, {
    installation_id: installationId,
    reading: latest,
    is_stale: Date.now() - new Date(latest.recorded_at).getTime() > 30 * 60_000,
  }, { lastModified: latest.received_at });
});

readingsRouter.get('/solar-installations/:installationId/overview', requireAnalyst, async (request, response) => {
  const installationId = positiveId(request.params.installationId, 'installationId');
  const installation = await getCatalogItem('installation', installationId, request.principal);
  const hierarchy = (await pool.query(
    `SELECT s.id AS substation_id, s.name AS substation_name,
            d.id AS district_id, d.name AS district_name,
            p.id AS province_id, p.name AS province_name
     FROM solar_installations i JOIN grid_substations s ON s.id = i.substation_id
     JOIN districts d ON d.id = s.district_id JOIN provinces p ON p.id = d.province_id
     WHERE i.id = $1`, [installationId]
  )).rows[0];
  const latestResult = await pool.query(
    `SELECT * FROM generation_readings WHERE installation_id = $1
     ORDER BY recorded_at DESC, id DESC LIMIT 1`, [installationId]
  );
  const latest = latestResult.rowCount ? reading(latestResult.rows[0]) : null;
  sendJson(request, response, {
    installation,
    hierarchy,
    last_known_reading: latest,
    is_stale: latest ? Date.now() - new Date(latest.recorded_at).getTime() > 30 * 60_000 : true,
  }, { lastModified: latest?.received_at ?? installation.updated_at });
});

readingsRouter.get('/districts/:districtId/generation-summary', requireAnalyst, async (request, response) => {
  const districtId = positiveId(request.params.districtId, 'districtId');
  const district = await getCatalogItem('district', districtId, request.principal);
  const now = new Date(Math.floor(Date.now() / 60_000) * 60_000);
  const colombo = new Date(now.getTime() + 330 * 60_000);
  const day = colombo.toISOString().slice(0, 10);
  const dayStart = new Date(Date.parse(`${day}T00:00:00Z`) - 330 * 60_000);
  const dayEnd = new Date(dayStart.getTime() + 86_400_000);
  const result = await pool.query(
    `WITH sites AS (
       SELECT i.id FROM solar_installations i
       JOIN grid_substations s ON s.id = i.substation_id
       WHERE s.district_id = $1 AND i.status = 'active'
     ), latest AS (
       SELECT DISTINCT ON (r.installation_id) r.installation_id, r.recorded_at, r.power_kw
       FROM generation_readings r JOIN sites ON sites.id = r.installation_id
       ORDER BY r.installation_id, r.recorded_at DESC, r.id DESC
     ), timed AS (
       SELECT r.installation_id, r.recorded_at, r.energy_kwh,
         lag(r.energy_kwh) OVER (PARTITION BY r.installation_id ORDER BY r.recorded_at, r.id) AS previous_energy
       FROM generation_readings r JOIN sites ON sites.id = r.installation_id
       WHERE r.recorded_at >= $2::timestamptz - interval '1 day'
         AND r.recorded_at < $3::timestamptz
     ), energy AS (
       SELECT coalesce(sum(greatest(energy_kwh - previous_energy, 0)), 0) AS today_kwh
       FROM timed WHERE recorded_at >= $2::timestamptz AND previous_energy IS NOT NULL
     )
     SELECT (SELECT count(*)::integer FROM sites) AS installation_count,
       (SELECT count(*)::integer FROM latest WHERE recorded_at >= $4::timestamptz - interval '30 minutes') AS fresh_count,
       (SELECT coalesce(sum(power_kw), 0) FROM latest WHERE recorded_at >= $4::timestamptz - interval '30 minutes') AS current_power_kw,
       (SELECT max(recorded_at) FROM latest) AS latest_recorded_at,
       (SELECT today_kwh FROM energy) AS today_energy_kwh`,
    [districtId, dayStart, dayEnd, now]
  );
  const summary = result.rows[0];
  sendJson(request, response, {
    district_id: district.id,
    day,
    time_zone: 'Asia/Colombo',
    as_of: now.toISOString(),
    latest_recorded_at: summary.latest_recorded_at?.toISOString() ?? null,
    installation_count: summary.installation_count,
    fresh_installation_count: summary.fresh_count,
    stale_installation_count: summary.installation_count - summary.fresh_count,
    current_power_kw: Number(summary.current_power_kw),
    today_energy_kwh: Number(summary.today_energy_kwh),
  }, { lastModified: summary.latest_recorded_at });
});

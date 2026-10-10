import { Router } from 'express';
import { z } from 'zod';
import { pool, withTransaction } from './db.js';
import { authenticate } from './auth.js';
import { requireAdmin, requireAnalyst, scopeCondition } from './access.js';
import { ApiError, badRequest, notFound } from './errors.js';
import { assertIfMatch, sendJson } from './http.js';
import { hashSecret } from './credentials.js';
import { nonEmptyString, positiveId, positiveNumber, requireJson, shortCode, validate } from './validation.js';

const definitions = {
  province: {
    path: 'provinces', table: 'provinces', alias: 'p',
    from: 'provinces p',
    select: 'p.id, p.code, p.name, p.created_at, p.updated_at',
    fields: { code: shortCode, name: nonEmptyString },
  },
  district: {
    path: 'districts', table: 'districts', alias: 'd',
    from: 'districts d JOIN provinces p ON p.id = d.province_id',
    select: 'd.id, d.province_id, d.code, d.name, d.created_at, d.updated_at',
    fields: { province_id: z.number().int().positive(), code: shortCode, name: nonEmptyString },
  },
  substation: {
    path: 'grid-substations', table: 'grid_substations', alias: 's',
    from: 'grid_substations s JOIN districts d ON d.id = s.district_id JOIN provinces p ON p.id = d.province_id',
    select: 's.id, s.district_id, s.code, s.name, s.created_at, s.updated_at',
    fields: { district_id: z.number().int().positive(), code: shortCode, name: nonEmptyString },
  },
  installation: {
    path: 'solar-installations', table: 'solar_installations', alias: 'i',
    from: `solar_installations i JOIN grid_substations s ON s.id = i.substation_id
      JOIN districts d ON d.id = s.district_id JOIN provinces p ON p.id = d.province_id`,
    select: 'i.id, i.substation_id, i.meter_id, i.capacity_kw, i.status, i.created_at, i.updated_at',
    fields: {
      substation_id: z.number().int().positive(),
      meter_id: z.string().trim().regex(/^[A-Z0-9-]{4,64}$/),
      capacity_kw: positiveNumber.max(100_000),
      status: z.enum(['active', 'inactive']),
    },
  },
};

const parentOf = {
  district: { kind: 'province', field: 'province_id', parameter: 'provinceId' },
  substation: { kind: 'district', field: 'district_id', parameter: 'districtId' },
  installation: { kind: 'substation', field: 'substation_id', parameter: 'substationId' },
};

function representation(kind, row) {
  if (kind === 'installation') return { ...row, capacity_kw: Number(row.capacity_kw) };
  return row;
}

function schemaFor(kind, method, nested = false) {
  const fields = { ...definitions[kind].fields };
  if (nested) delete fields[parentOf[kind].field];
  if (kind === 'installation' && method === 'POST') {
    fields.device_secret = z.string().min(20).max(256);
    fields.status = fields.status.optional();
  } else if (kind === 'installation') {
    fields.device_secret = z.string().min(20).max(256).optional();
  }
  let schema = z.strictObject(fields);
  if (method === 'PATCH') {
    schema = schema.partial().refine((value) => Object.keys(value).length > 0, 'At least one field is required');
  }
  return schema;
}

export async function getCatalogItem(kind, id, principal, db = pool, lock = false) {
  const definition = definitions[kind];
  const values = [id];
  const scope = scopeCondition(principal, kind, values);
  const result = await db.query(
    `SELECT ${definition.select} FROM ${definition.from}
     WHERE ${definition.alias}.id = $1 AND ${scope}${lock ? ` FOR UPDATE OF ${definition.alias}` : ''}`,
    values
  );
  if (!result.rowCount) throw notFound(`${kind} not found`);
  return representation(kind, result.rows[0]);
}

async function listCatalog(kind, principal, parentField = null, parentId = null) {
  const definition = definitions[kind];
  const values = [];
  const clauses = [];
  if (parentField) {
    values.push(parentId);
    clauses.push(`${definition.alias}.${parentField} = $${values.length}`);
  }
  clauses.push(scopeCondition(principal, kind, values));
  const result = await pool.query(
    `SELECT ${definition.select} FROM ${definition.from} WHERE ${clauses.join(' AND ')} ORDER BY ${definition.alias}.id`,
    values
  );
  return result.rows.map((row) => representation(kind, row));
}

function lastModified(rows) {
  return rows.reduce((latest, row) => latest > new Date(row.updated_at) ? latest : new Date(row.updated_at), new Date(0));
}

async function createCatalog(request, response, kind, parentId = null) {
  requireJson(request);
  const nested = parentId !== null;
  const body = validate(schemaFor(kind, 'POST', nested), request.body);
  const definition = definitions[kind];
  if (nested) body[parentOf[kind].field] = parentId;
  if (kind === 'installation') {
    body.device_secret_hash = await hashSecret(body.device_secret);
    delete body.device_secret;
    body.status ??= 'active';
  }
  const columns = Object.keys(body);
  const values = Object.values(body);
  const placeholders = columns.map((_column, index) => `$${index + 1}`);
  const result = await pool.query(
    `INSERT INTO ${definition.table} (${columns.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING id`, values
  );
  const item = await getCatalogItem(kind, result.rows[0].id, request.principal);
  return sendJson(request, response, item, {
    status: 201, location: `/api/v1/${definition.path}/${item.id}`, lastModified: item.updated_at,
  });
}

async function updateCatalog(request, response, kind, id, method) {
  requireJson(request);
  const body = validate(schemaFor(kind, method), request.body);
  if (kind === 'installation' && body.device_secret !== undefined) {
    body.device_secret_hash = await hashSecret(body.device_secret);
    delete body.device_secret;
  }
  const definition = definitions[kind];
  const updated = await withTransaction(async (db) => {
    const current = await getCatalogItem(kind, id, request.principal, db, true);
    assertIfMatch(request, current);
    const entries = Object.entries(body);
    if (!entries.length) throw badRequest('No fields to update');
    const assignments = entries.map(([field], index) => `${field} = $${index + 1}`);
    const values = entries.map(([_field, value]) => value);
    values.push(id);
    await db.query(
      `UPDATE ${definition.table} SET ${assignments.join(', ')}, updated_at = now()
       WHERE id = $${values.length}`, values
    );
    return getCatalogItem(kind, id, request.principal, db);
  });
  return sendJson(request, response, updated, { lastModified: updated.updated_at });
}

async function deleteCatalog(request, response, kind, id) {
  const definition = definitions[kind];
  await withTransaction(async (db) => {
    const current = await getCatalogItem(kind, id, request.principal, db, true);
    assertIfMatch(request, current);
    await db.query(`DELETE FROM ${definition.table} WHERE id = $1`, [id]);
  });
  response.status(204).end();
}

export const catalogRouter = Router();
catalogRouter.use(authenticate);

catalogRouter.get('/provinces', requireAnalyst, async (request, response) => {
  const rows = await listCatalog('province', request.principal);
  sendJson(request, response, { data: rows }, { lastModified: rows.length ? lastModified(rows) : null });
});

for (const [kind, parent] of Object.entries(parentOf)) {
  const parentDefinition = definitions[parent.kind];
  const path = `/${parentDefinition.path}/:${parent.parameter}/${definitions[kind].path}`;
  catalogRouter.get(path, requireAnalyst, async (request, response) => {
    const parentId = positiveId(request.params[parent.parameter], parent.parameter);
    await getCatalogItem(parent.kind, parentId, request.principal);
    const rows = await listCatalog(kind, request.principal, parent.field, parentId);
    sendJson(request, response, { data: rows }, { lastModified: rows.length ? lastModified(rows) : null });
  });
  catalogRouter.post(path, requireAdmin, async (request, response) => {
    const parentId = positiveId(request.params[parent.parameter], parent.parameter);
    await getCatalogItem(parent.kind, parentId, request.principal);
    await createCatalog(request, response, kind, parentId);
  });
}

catalogRouter.post('/provinces', requireAdmin, async (request, response) => {
  await createCatalog(request, response, 'province');
});

for (const [kind, definition] of Object.entries(definitions)) {
  const path = `/${definition.path}/:id`;
  catalogRouter.get(path, requireAnalyst, async (request, response) => {
    const item = await getCatalogItem(kind, positiveId(request.params.id), request.principal);
    sendJson(request, response, item, { lastModified: item.updated_at });
  });
  for (const method of ['patch', 'put']) {
    catalogRouter[method](path, requireAdmin, async (request, response) => {
      await updateCatalog(request, response, kind, positiveId(request.params.id), method.toUpperCase());
    });
  }
  catalogRouter.delete(path, requireAdmin, async (request, response) => {
    await deleteCatalog(request, response, kind, positiveId(request.params.id));
  });
}

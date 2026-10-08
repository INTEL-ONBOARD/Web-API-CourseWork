import { ApiError, notFound } from './errors.js';

export function requireAnalyst(request, _response, next) {
  if (request.principal?.kind !== 'user') return next(new ApiError(403, 'FORBIDDEN', 'An analyst token is required'));
  next();
}

export function requireAdmin(request, _response, next) {
  if (request.principal?.kind !== 'user' || request.principal.role !== 'admin') {
    return next(new ApiError(403, 'FORBIDDEN', 'A provisioning administrator token is required'));
  }
  next();
}

export function requireDevice(request, _response, next) {
  if (request.principal?.kind !== 'device') return next(new ApiError(403, 'FORBIDDEN', 'A device token is required'));
  next();
}

export function scopeCondition(principal, kind, values) {
  if (principal.role === 'admin' || principal.role === 'national_analyst') return 'TRUE';
  if (principal.role === 'province_analyst') {
    values.push(principal.province_id);
    return `p.id = $${values.length}`;
  }
  if (principal.role === 'district_analyst') {
    values.push(principal.district_id);
    if (kind === 'province') {
      return `EXISTS (SELECT 1 FROM districts allowed WHERE allowed.province_id = p.id AND allowed.id = $${values.length})`;
    }
    return `d.id = $${values.length}`;
  }
  throw new ApiError(403, 'FORBIDDEN', 'Unknown analyst role');
}

export async function ensureScopedRow(db, sql, values, message) {
  const result = await db.query(sql, values);
  if (!result.rowCount) throw notFound(message);
  return result.rows[0];
}

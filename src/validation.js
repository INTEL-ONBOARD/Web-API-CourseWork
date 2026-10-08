import { z } from 'zod';
import { ApiError, badRequest } from './errors.js';

export function positiveId(value, label = 'id') {
  if (!/^[1-9]\d*$/.test(String(value))) throw badRequest(`${label} must be a positive integer`);
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw badRequest(`${label} is too large`);
  return number;
}

export function validate(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw badRequest('Request validation failed', result.error.issues.map((issue) => ({
      path: issue.path.join('.'), message: issue.message,
    })));
  }
  return result.data;
}

export const nonEmptyString = z.string().trim().min(1).max(120);
export const shortCode = z.string().trim().regex(/^[A-Z0-9][A-Z0-9-]{1,31}$/, 'Use 2-32 uppercase letters, digits, or hyphens');
export const positiveNumber = z.number().finite().positive();

export function requireJson(request) {
  if (!request.is('application/json')) {
    throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Send an application/json request body');
  }
  if (request.body === undefined || request.body === null || Array.isArray(request.body)) {
    throw badRequest('A JSON object request body is required');
  }
}

export function parseTimestamp(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    throw badRequest(`${label} must be an ISO 8601 timestamp with timezone`);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw badRequest(`${label} is not a valid timestamp`);
  return date;
}

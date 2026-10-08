import { createHash } from 'node:crypto';
import { ApiError } from './errors.js';

export function acceptJson(request, _response, next) {
  if (!request.accepts('json')) {
    return next(new ApiError(406, 'NOT_ACCEPTABLE', 'Only application/json is available'));
  }
  next();
}

export function etagFor(value) {
  const digest = createHash('sha256').update(JSON.stringify(value)).digest('hex');
  return `"${digest}"`;
}

function matchesIfNoneMatch(header, etag) {
  return header.split(',').some((candidate) => {
    const tag = candidate.trim().replace(/^W\//, '');
    return tag === '*' || tag === etag;
  });
}

export function sendJson(request, response, value, options = {}) {
  const etag = etagFor(value);
  response.set('ETag', etag);
  response.set('Cache-Control', 'private, max-age=0, must-revalidate');
  response.set('Vary', 'Authorization, Accept');
  if (options.lastModified) response.set('Last-Modified', new Date(options.lastModified).toUTCString());
  if (options.location) response.set('Location', options.location);
  if (request.method === 'GET' || request.method === 'HEAD') {
    const inm = request.get('If-None-Match');
    if (inm && matchesIfNoneMatch(inm, etag)) return response.status(304).end();
    if (!inm && options.lastModified && request.get('If-Modified-Since')) {
      const since = new Date(request.get('If-Modified-Since'));
      const modifiedSecond = Math.floor(new Date(options.lastModified).getTime() / 1000);
      if (!Number.isNaN(since.getTime()) && modifiedSecond <= Math.floor(since.getTime() / 1000)) {
        return response.status(304).end();
      }
    }
  }
  return response.status(options.status ?? 200).json(value);
}

export function assertIfMatch(request, currentRepresentation) {
  const header = request.get('If-Match');
  if (!header) return;
  const current = etagFor(currentRepresentation);
  const matched = header.split(',').some((candidate) => candidate.trim() === '*' || candidate.trim() === current);
  if (!matched) throw new ApiError(412, 'PRECONDITION_FAILED', 'The resource has changed; retrieve it and retry');
}

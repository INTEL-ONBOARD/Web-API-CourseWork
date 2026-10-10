export class ApiError extends Error {
  constructor(status, code, message, details = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message, details = null) => new ApiError(400, 'BAD_REQUEST', message, details);
export const notFound = (message = 'Resource not found') => new ApiError(404, 'NOT_FOUND', message);

export function errorHandler(error, _request, response, next) {
  if (response.headersSent) return next(error);
  let issue = error;
  if (!(issue instanceof ApiError)) {
    if (issue?.type === 'entity.parse.failed') {
      issue = badRequest('Malformed JSON request body');
    } else if (issue?.code === '23505') {
      issue = new ApiError(409, 'CONFLICT', 'A record with this unique value already exists');
    } else if (issue?.code === '23503') {
      issue = new ApiError(409, 'CONFLICT', 'The referenced resource is missing or still has dependent records');
    } else if (issue?.code === '23514' || issue?.code === '23502' || issue?.code === '22P02') {
      issue = badRequest('Data violates a database constraint');
    } else {
      console.error('Unhandled request error', error);
      issue = new ApiError(500, 'INTERNAL_ERROR', 'An internal error occurred');
    }
  }
  if (issue.status === 401) response.set('WWW-Authenticate', 'Bearer');
  response.status(issue.status).json({ code: issue.code, message: issue.message, details: issue.details });
}

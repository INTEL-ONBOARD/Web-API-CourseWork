import { Router } from 'express';
import { SignJWT, jwtVerify } from 'jose';
import { z } from 'zod';
import { pool } from './db.js';
import { verifySecret } from './credentials.js';
import { ApiError } from './errors.js';
import { requireJson, validate } from './validation.js';

const issuer = 'slsea-solar-api';
const audience = 'slsea-api-clients';
const ttlSeconds = 900;
const tokenSchema = z.strictObject({ identity: z.string().trim().min(1), secret: z.string().min(1) });

function signingKey() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) throw new Error('JWT_SECRET must contain at least 32 characters');
  return new TextEncoder().encode(secret);
}

async function issueToken(subject, kind, scope) {
  const accessToken = await new SignJWT({ kind, scope })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(issuer).setAudience(audience).setSubject(subject)
    .setIssuedAt().setExpirationTime(`${ttlSeconds}s`)
    .sign(signingKey());
  return { access_token: accessToken, token_type: 'Bearer', expires_in: ttlSeconds, scope };
}

export const authRouter = Router();

authRouter.post('/user-tokens', async (request, response) => {
  requireJson(request);
  const { identity, secret } = validate(tokenSchema, request.body);
  const result = await pool.query(
    'SELECT id, password_hash, active FROM users WHERE username = $1', [identity]
  );
  const user = result.rows[0];
  if (!user?.active || !(await verifySecret(secret, user.password_hash))) {
    throw new ApiError(401, 'UNAUTHORIZED', 'Invalid credentials');
  }
  response.set('Cache-Control', 'no-store').json(await issueToken(`user:${user.id}`, 'user', 'analyst:read'));
});

authRouter.post('/device-tokens', async (request, response) => {
  requireJson(request);
  const { identity, secret } = validate(tokenSchema, request.body);
  const result = await pool.query(
    'SELECT id, device_secret_hash, status FROM solar_installations WHERE meter_id = $1', [identity]
  );
  const installation = result.rows[0];
  if (installation?.status !== 'active' || !(await verifySecret(secret, installation.device_secret_hash))) {
    throw new ApiError(401, 'UNAUTHORIZED', 'Invalid credentials');
  }
  response.set('Cache-Control', 'no-store').json(await issueToken(`installation:${installation.id}`, 'device', 'installation:write'));
});

export async function authenticate(request, _response, next) {
  try {
    const match = /^Bearer ([A-Za-z0-9._~-]+)$/.exec(request.get('Authorization') ?? '');
    if (!match) throw new ApiError(401, 'UNAUTHORIZED', 'Bearer token required');
    let payload;
    try {
      ({ payload } = await jwtVerify(match[1], signingKey(), { issuer, audience, algorithms: ['HS256'] }));
    } catch {
      throw new ApiError(401, 'UNAUTHORIZED', 'Invalid or expired bearer token');
    }
    if (payload.kind === 'user' && payload.scope === 'analyst:read' && /^user:[1-9]\d*$/.test(payload.sub ?? '')) {
      const id = Number(payload.sub.slice(5));
      const result = await pool.query(
        'SELECT id, role, province_id, district_id FROM users WHERE id = $1 AND active = true', [id]
      );
      if (!result.rowCount) throw new ApiError(401, 'UNAUTHORIZED', 'User is inactive or missing');
      request.principal = { kind: 'user', ...result.rows[0] };
    } else if (payload.kind === 'device' && payload.scope === 'installation:write' && /^installation:[1-9]\d*$/.test(payload.sub ?? '')) {
      const id = Number(payload.sub.slice('installation:'.length));
      const result = await pool.query(
        "SELECT id FROM solar_installations WHERE id = $1 AND status = 'active'", [id]
      );
      if (!result.rowCount) throw new ApiError(401, 'UNAUTHORIZED', 'Installation is inactive or missing');
      request.principal = { kind: 'device', installationId: id };
    } else {
      throw new ApiError(401, 'UNAUTHORIZED', 'Token principal is invalid');
    }
    next();
  } catch (error) {
    next(error);
  }
}

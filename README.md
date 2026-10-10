# SLSEA Solar Generation Data API

Express and PostgreSQL backend for the NB6007CEM solar-generation coursework. Meter devices submit readings for their own installations. SLSEA analysts query scoped operational and historical data. The API is the deliverable; no dashboard is included.

## What is implemented

- Five-entity geography and asset hierarchy plus users; meter ID is an installation attribute.
- Append-only generation readings, one-week synthetic seed for 200 installations, 25 substations, 25 districts, and 9 provinces.
- JWT bearer login for users and devices; district, province, and national read scopes; device-only ingestion; administrator metadata CRUD.
- Installation composite and latest-reading resources; regional history, pagination, time filters, sorting, conditional GET, and district generation summary.
- One JSON error shape, OpenAPI at `/openapi.json`, Swagger at `/docs`, and readiness at `/health`.

The detailed contract and unresolved coursework interpretation are in [docs/SPEC.md](docs/SPEC.md). See [architecture notes](docs/ARCHITECTURE.md) for the component/data-flow diagrams and [traceability](docs/TRACEABILITY.md) for the rubric mapping and remaining submission gates. The module's separate REST API Design Guidelines white paper was not provided with the brief; confirm URI choices against it before submission.

## Local setup

Requirements: Node.js 22, npm, and Docker with Compose.

1. Copy `.env.example` to `.env`. Replace both secret values with independent random strings of at least 32 characters. `.env` is ignored by Git.
2. Run `npm ci`.
3. Start PostgreSQL with `docker compose up -d db`.
4. Run `npm run migrate` and `npm run seed`.
5. Run `npm start`. Browse `http://localhost:3000/docs` and `http://localhost:3000/health`.

Alternatively, after configuring `.env`, run `docker compose up --build`. The API container migrates the database on startup. Seed once with `docker compose exec api npm run seed`.

The seed is idempotent: rerunning it with the same private seed master does not add duplicate history. It creates synthetic data ending at the nearest quarter hour on first seed; later requests report the actual timestamp and staleness rather than claiming fresh meter data indefinitely.

## Authentication examples

The seed creates four sample user identities: `national.analyst`, `province.western`, `district.colombo`, and `catalog.admin`, plus distinct secrets for each meter. Run `npm run demo:credentials` **only on a trusted terminal** to derive the local test secrets. Never commit or publish those secrets. The seed master must be the same one used during `npm run seed`.

Exchange a user's identity and secret using `POST /api/v1/auth/user-tokens`; exchange a meter ID and its secret using `POST /api/v1/auth/device-tokens`. Both accept JSON `{ "identity": "...", "secret": "..." }` and return a short-lived bearer token. Use Swagger's Authorize control or the `Authorization: Bearer <token>` header. Share examiner test credentials through a private course-approved channel, not the repository.

## Key routes

| Route | Purpose |
| --- | --- |
| `GET /api/v1/provinces` | Scoped hierarchy entry point |
| `GET /api/v1/provinces/:id/districts` | Scoped district collection |
| `GET /api/v1/districts/:id/grid-substations` | Scoped substation collection |
| `GET /api/v1/grid-substations/:id/solar-installations` | Scoped installation collection |
| `GET /api/v1/solar-installations/:id/overview` | Composite asset view |
| `GET /api/v1/solar-installations/:id/last-known-reading` | Operational latest reading |
| `GET /api/v1/solar-installations/:id/generation-readings` | Analytical history |
| `POST /api/v1/solar-installations/:id/generation-readings` | Device ingestion; 201 + Location |
| `GET /api/v1/districts/:id/generation-summary` | District power and daily energy |

Regional history routes are available under provinces, districts, and grid substations. Metadata create/update/delete routes are documented in Swagger and require an administrator token. Readings themselves have no update/delete API.

History query parameters: `from` (inclusive ISO timestamp), `to` (exclusive), `sort=timestamp_asc|timestamp_desc`, `page` (default 1), and `page_size` (1-100, default 25). Responses include total count and next/previous URLs.

## Verification

Run `npm run check`, `npm run check:openapi`, and `npm test` after seeding. The integration tests use the local `DATABASE_URL` and clean up their temporary records. GitHub Actions runs the same checks with a fresh PostgreSQL service and also builds the Docker image.

## Deployment

Build the Docker image on any HTTPS-capable host that supplies a persistent PostgreSQL database. Set `DATABASE_URL`, `JWT_SECRET`, `SEED_CREDENTIAL_MASTER`, `PORT`, and `NODE_ENV=production` as private environment variables. Run `npm run migrate` once per release, and `npm run seed` once on an empty database. Verify `/health`, `/docs`, `/openapi.json`, an authenticated history request, and a denial request on the public URL. Keep the service and database available through the marking and viva period. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for the release checklist.

Current deployment: [public Swagger UI](https://solar-api.84-247-139-75.sslip.io/docs/) and [health endpoint](https://solar-api.84-247-139-75.sslip.io/health). The API runs in an isolated Compose stack on the supplied server; PostgreSQL is private to the stack. The `sslip.io` hostname resolves the server IP and can be replaced with a student-owned domain before submission.

The coursework report must be written in the student's own prose. AI-assisted code and aids must be disclosed in the report appendix; the project log in [docs/AI_ASSISTANCE_LOG.md](docs/AI_ASSISTANCE_LOG.md) records this development session for that purpose.

# Solar Generation Data API - technical specification

Status: implementation contract, 10 October 2026. This is project planning material, not submission report prose.

## 1. Scope and source of truth

Build one backend REST API for the SLSEA coursework. Deliver a public HTTPS deployment with live OpenAPI/Swagger, a seeded PostgreSQL database, incremental Git history, and evidence for the student's own report and viva. No dashboard or other client is in scope.

The supplied coursework brief and marking rubric govern requirements. The module's separate **REST API Design Guidelines** white paper is named as the design authority but was not in the supplied folder. URI and representation choices below are therefore provisional until it is obtained.

### Eligibility gates

The deployed API must be operational against seed data at submission time. The repository must be shared with the module leader. The student's report must be 2,250-2,750 words, include architecture, design, and deployment sections, a signed declaration, and an AI-aid appendix. The student must attend the viva and explain submitted artefacts. The coursework allows AI-generated code with disclosure; the report narrative must be the student's own writing.

## 2. Technology and boundaries

- Node.js 22, Express 5, plain ECMAScript modules. Routes remain thin; services own authorization and domain decisions; SQL stays in repository/query modules.
- PostgreSQL 17 for foreign keys, durable history, indexed filtering, and aggregation. `pg` uses parameterized queries. SQL migration and seed commands are explicit and repeatable.
- `jose` signs and verifies short-lived HS256 bearer JWTs. Password and device secrets are hashed with Node's `scrypt`; raw credentials and signing keys stay outside Git.
- Docker builds the API; Docker Compose runs API plus PostgreSQL locally. The deployment provider supplies HTTPS and persistent PostgreSQL.
- OpenAPI 3 is served as JSON and Swagger UI at `/docs`. The API namespace is `/api/v1`.

### Data flow

1. A meter authenticates with its installation meter ID and secret, receives a short-lived device token, and POSTs a reading only to that installation.
2. An SLSEA user authenticates with a username and password and receives a short-lived user token containing a role and server-verified jurisdiction.
3. Every analyst read restricts SQL to the authenticated jurisdiction before pagination, counting, or aggregation.
4. PostgreSQL stores each reading as an immutable time-series row. Latest-reading and district-summary responses are derived at request time.

## 3. Domain model

| Entity | Core fields | Relationship / invariant |
| --- | --- | --- |
| Province | id, code, name, updated_at | One province has many districts. |
| District | id, province_id, code, name, updated_at | One district belongs to one province and has many substations. |
| GridSubstation | id, district_id, code, name, updated_at | One substation belongs to one district and has many installations. |
| SolarInstallation | id, substation_id, meter_id, capacity_kw, status, device_secret_hash, updated_at | Meter ID is an installation attribute, not a Device entity. One installation has many readings. |
| GenerationReading | id, installation_id, recorded_at, power_kw, energy_kwh, voltage, received_at | Append-only, unique `(installation_id, recorded_at)`. No user or admin update/delete endpoint. |
| User | id, username, password_hash, role, province_id, district_id, active | Role and assigned jurisdiction determine read scope. |

Numeric measurements are nonnegative. Timestamps are stored as `timestamptz` and emitted in UTC. The district summary's calendar day is Asia/Colombo. A late reading is allowed when its timestamp is unique; callers must not assume ingestion order equals measurement order. The API exposes freshness via the latest measurement timestamp. A reset in a real meter's cumulative energy needs a documented policy; the seed never resets.

### Seed contract

- Exactly 9 provinces and 25 districts, at least 20 substations and 200 installations.
- At least 7 days of 15-minute readings per installation: 200 x 7 x 96 = 134,400 minimum example rows.
- Deterministic seeded IDs and data shape; rerunning the seed does not duplicate rows.
- Plausible Sri Lankan geographic allocation, daylight-shaped output, zero overnight power, capacity-bounded power, increasing cumulative energy, plausible voltage, and valid foreign keys.
- Seeded credentials are derived per principal from a private environment secret. No shared device password or committed live credential.

## 4. Principal and authorization matrix

| Principal | Reads | Writes |
| --- | --- | --- |
| Device for installation I | No analyst reads | POST a reading for I only |
| District analyst D | Province metadata for D's province and resources within D | None |
| Province analyst P | Resources within P | None |
| National analyst | All read resources | None |
| Provisioning administrator | All read resources | Metadata CRUD for provinces, districts, substations, installations |

Device write scope is `installation:write` plus a server-validated installation ID. Analyst read scope is `analyst:read` plus the assigned district/province or national role. An administrator has `catalog:write`. JWT claims cannot replace the database lookup: each request confirms the user/installation is still active and uses current jurisdiction. Out-of-scope atomic resources return 404 to avoid revealing existence; an authenticated principal attempting the wrong operation returns 403. Missing/invalid credentials return 401 and `WWW-Authenticate: Bearer`.

The brief requests full CRUD on writable resources while also requiring append-only readings and device-only ingestion. This implementation gives metadata CRUD to a provisioning administrator, with readings limited to create/retrieve. Confirm this interpretation against the missing white paper or lecturer guidance.

## 5. Resource contract

Base: `/api/v1`. Collections use lowercase plural nouns; nested collections carry their parent scope. Atomic resources may have a canonical short URI.

| Resource | Methods | Notes |
| --- | --- | --- |
| `/provinces`, `/provinces/:provinceId` | GET; admin POST/PATCH/PUT/DELETE | District users see only their province. |
| `/provinces/:provinceId/districts`, `/districts/:districtId` | GET; admin POST/PATCH/PUT/DELETE | Collection is scoped to a province. |
| `/districts/:districtId/grid-substations`, `/grid-substations/:substationId` | GET; admin POST/PATCH/PUT/DELETE | Collection is scoped to a district. |
| `/grid-substations/:substationId/solar-installations`, `/solar-installations/:installationId` | GET; admin POST/PATCH/PUT/DELETE | Collection is scoped to a substation. |
| `/solar-installations/:installationId/overview` | GET | Composite installation + substation/district/province + latest reading. |
| `/solar-installations/:installationId/last-known-reading` | GET | Derived latest reading, or 404 if no readings. |
| `/solar-installations/:installationId/generation-readings` | GET; device POST | Paginated history; 201 + Location on POST. |
| `/solar-installations/:installationId/generation-readings/:readingId` | GET | Atomic immutable reading. |
| `/provinces/:provinceId/generation-readings`, `/districts/:districtId/generation-readings`, `/grid-substations/:substationId/generation-readings` | GET | Regional scoped history using the same query contract. |
| `/districts/:districtId/generation-summary` | GET | Current total power and today's energy, with `as_of` and staleness detail. |
| `/auth/user-tokens`, `/auth/device-tokens` | POST | Exchange private credentials for short-lived bearer tokens. |
| `/health` | GET | Readiness; no domain data. |

The history query accepts `from`, `to` (ISO 8601, inclusive start/exclusive end), `sort=timestamp_asc|timestamp_desc`, `page>=1`, and `page_size=1..100`. All filters are applied before `COUNT(*)` and `LIMIT/OFFSET`; ties are resolved by reading ID. Responses include `data`, `pagination.total`, `pagination.page`, `pagination.page_size`, `pagination.next`, and `pagination.previous`. Empty pages return 200 with an empty `data` array. A second explicit jurisdiction filter can be added if the white paper requires query-parameter filtering in addition to scoped regional paths.

### HTTP semantics

- GET is safe and idempotent. POST creates server-assigned records; return 201, JSON, `Location`, `Content-Type`, and representation validators.
- PUT replaces the full mutable metadata representation; PATCH changes only supplied fields. DELETE is idempotent in effect, with 204 on successful removal. Reject deletion of a parent with children or an installation with readings (409); never cascade away history.
- JSON is the only API representation. Unsupported `Accept` returns 406. Malformed JSON/parameters return 400. Unknown resources return 404. Conflicts return 409.
- Retrievable resources emit `ETag`, `Last-Modified` when a meaningful last-change time exists, `Cache-Control: private`, and `Vary: Authorization, Accept`.
- `If-None-Match` on GET returns bodyless 304 when the caller's authorized representation matches. `If-Match` on mutable updates/deletes returns 412 for stale validators.
- Error responses use `{ "code": string, "message": string, "details": object | array | null }` consistently. No stack traces or secrets in API responses.

## 6. District summary calculation

For each active installation in an authorized district, take the latest reading; only readings inside a documented freshness window contribute to `current_power_kw`. Report stale-site count separately. For today's energy, sum positive differences in cumulative kWh between consecutive readings within the Asia/Colombo day; account for the first reading relative to the last reading before day start. In a reset, avoid a negative contribution and report the limitation. Include `as_of`, `day`, contributing installation count, stale count, and units. The seed is synthetic and must not be described as a live national measurement feed.

## 7. Verification and operations

### Automated tests

- Domain constraints: foreign keys, uniqueness, nonnegative values, capacity limits, malformed timestamps, duplicate readings, and parent deletion safety.
- Auth matrix: every principal against allowed and forbidden routes; cross-installation POST and cross-district GET/list/count/aggregate must fail without leakage.
- HTTP: 201 + Location, GET of created resource, 204 DELETE, 304 empty body, 400, 401, 403/404, 406, 409, and 412; Content-Type, ETag, Last-Modified where applicable.
- History: counts, next/previous links, time windows, all three jurisdiction scopes, both sort directions, empty result, and stable tie ordering.
- Seed: exact geographic counts, minimum asset/history counts, realistic day/night pattern, and idempotent rerun.

### Deployment gates

- `docker compose up --build` starts a healthy API and database locally; migration and seed commands work from a clean database.
- Public HTTPS URL serves `/health`, `/docs`, `/openapi.json`, and real seeded endpoints. Documentation describes security, examples, errors, and response headers.
- Verify the live deployment from outside the local machine shortly before submission. Keep database persistence and service lifetime through the viva.
- Git history contains meaningful increments; repository collaborator invitation is a manual account action when the module leader's GitHub identity is known.

## 8. Build order and evidence

1. Contract and data model, including this specification and OpenAPI outline.
2. Dockerized PostgreSQL, migrations, and deterministic seed.
3. Credential hashing, token issuance, authentication, jurisdiction policy.
4. Hierarchy and installation read endpoints.
5. Device ingestion, immutable history, pagination/filtering/sorting.
6. Metadata CRUD, composite/derived resources, conditional requests, error contract.
7. Automated integration tests, deployment configuration, live verification.
8. Evidence capture and the student's own report/viva preparation.

Keep a prompt/AI-aid log for the report appendix. Do not submit this specification as the student's report prose.

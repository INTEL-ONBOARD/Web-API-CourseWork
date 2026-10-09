# Coursework traceability and remaining gates

This maps the supplied brief and rubric to the implementation. It is a development checklist, not submission report prose.

| Requirement or rubric area | Implementation evidence | Verification or remaining gate |
| --- | --- | --- |
| Five-entity hierarchy plus User; meter ID on installation | `db/migrations/001_initial.sql`, `docs/ARCHITECTURE.md` | Foreign keys and entity relationships reviewed |
| Append-only time series with timestamp, kW, kWh, voltage | `generation_readings` table; read-only history and device POST routes | Integration test covers insertion and atomic GET |
| 9 provinces, 25 districts, 20+ substations, 200+ sites, week/site | `scripts/seed.js` | Local seed: 9, 25, 25, 200, 134,400 rows; rerun inserts zero |
| Atomic, collection, composite, and derived resources | `src/catalog.js`, `src/readings.js`, `openapi.yaml` | OpenAPI parser validates 18 paths; smoke test key routes |
| Correct write semantics and conditional requests | Admin CRUD, immutable reading POST, 201/Location, 204, ETag/304, If-Match/412 | Integration tests cover success and stale precondition |
| Scoped history, time filtering, sorting, pagination | Regional and installation history routes | Tests cover seeded count/sort/page and scope denial; expand when needed |
| District aggregate stretch | `/districts/{id}/generation-summary` | Integration test checks scoped shape and units |
| JWT write/read separation and jurisdiction | `src/auth.js`, `src/access.js` | Tests deny cross-device write, cross-district read, device read |
| Consistent JSON client errors | `src/errors.js`, OpenAPI error schema | Tests check 400, 403/404, 406, 409, 412 |
| Docker, public HTTPS, live Swagger | `Dockerfile`, `compose.yaml`, `/docs` | Local Docker and docs verified; **public host still needed** |
| Incremental shared Git history | Separate specification, database, API, and quality commits | Push to GitHub; module-leader invitation needs identity/account action |
| Report and viva | Brief/template and `docs/AI_ASSISTANCE_LOG.md` | Student writes 2,250–2,750 words, signs declaration, discloses prompts, and defends code |

## Student report outline

Use the supplied report template and write each section in your own words:

1. Architecture and data model: domain hierarchy, cardinalities, device identifier decision, time-series storage.
2. API design justification: resource taxonomy, URI naming, method and status choices, headers, pagination/filter/sort, conditional requests, Richardson Level 2 evidence and Level 3 boundary.
3. Security: meter versus analyst authentication, jurisdiction policy, JWT claims versus server checks, HTTPS, remaining risks.
4. Deployment and operation: actual public host, persistent database, exact live URL and Swagger URL, seed and health evidence.
5. Critical evaluation: strengths, measured limitations, alternatives and future scale work.
6. References, signed declaration and specific AI-aid/prompt appendix outside the word count as instructed by the brief.

## Blocking external inputs

- The module's **REST API Design Guidelines** white paper was not in the supplied folder. Compare URI and HTTP decisions against it before submission.
- A durable public HTTPS host and database account are needed for the required live deployment.
- The module leader's GitHub identity must be confirmed to add the required repository collaborator.

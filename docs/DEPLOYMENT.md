# Deployment and evidence checklist

This is an operational checklist, not submission report prose.

1. Select an HTTPS web host for the Docker image and a persistent PostgreSQL instance. Do not put PostgreSQL data in the API container filesystem. Check that the chosen service and database remain available through the viva. Render's free web service sleeps when idle and free PostgreSQL expires after 30 days, so a durable tier or another durable provider is needed for reliable marking.
2. Set private `POSTGRES_PASSWORD`, `JWT_SECRET`, and `SEED_CREDENTIAL_MASTER` in the server `.env` when using `compose.production.yaml`; Compose constructs `DATABASE_URL` for the API. Generate independent random values. Never expose them in Git, screenshots, or the report.
3. Build from a known commit. Run `npm run migrate` before switching traffic to the new image. Run `npm run seed` on a new database; reruns are idempotent with the same seed master.
4. Confirm `/health` is 200 over HTTPS, `/docs` loads Swagger UI, and `/openapi.json` returns the validated contract.
5. Use privately shared demo credentials to check national, province, district, and device tokens. Record a successful history page, a cross-district denial, and a cross-installation device denial.
6. Record a created reading's 201 status and `Location`, an ETag 304 response with empty body, and a stale `If-Match` 412 response. Keep any demonstration writes separate from the synthetic seed so evidence is accurate.
7. Enter the exact deployment, Swagger, and Git URLs in the coursework template. Invite the module leader as repository collaborator after confirming their GitHub identity. Capture the Git commit history and deployment health evidence.
8. Shortly before submission and viva, recheck the public service and database. If the seed's latest readings have become stale, describe them as historical synthetic data and show the actual last-recorded timestamp.

Live deployment, repository sharing, the signed declaration, and the student's report remain account and student-owned actions.

## Production Compose layout

`compose.production.yaml` creates a separate `slsea-solar-api` stack. PostgreSQL has no published host port and stores data in a named Docker volume. The API listens only on the host loopback address at port 4400; the host's HTTPS reverse proxy should forward a dedicated hostname to `127.0.0.1:4400`. Keep the production `.env` at the server checkout with mode `0600`, and back up the database volume regularly. After code changes, rebuild the API image and verify health, Swagger, authenticated reads, and the existing data count.

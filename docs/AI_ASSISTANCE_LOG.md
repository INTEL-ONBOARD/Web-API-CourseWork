# AI assistance log for appendix preparation

This technical log records assistance used so the student can make a complete disclosure in the report appendix. It is not report narrative and does not replace the student's own explanation at viva.

| Date | User direction / prompt summary | AI aid and output | Human review needed |
| --- | --- | --- | --- |
| 10 Oct 2026 | Read the coursework folder, analyse the task, research options, and plan implementation and report. | Codex reviewed the supplied brief, rubric, and template; researched official HTTP, FastAPI, PostgreSQL, security, and hosting sources; proposed the API architecture. | Check the missing module REST API Design Guidelines white paper and assignment interpretation. |
| 10 Oct 2026 | Map the plan into HTML with architecture and visualizations. | Codex created a planning HTML page in the separate Codex outputs folder. | Review visual layout and factual labels. |
| 10 Oct 2026 | Use the supplied GitHub repository and Development folder; start development with Express, PostgreSQL, and Docker; make a full specification. | Codex cloned the empty repository, wrote `docs/SPEC.md`, migration, deterministic seed, Express API, OpenAPI, Docker and integration tests. | Review each route, SQL query, auth rule, test, and deployment decision; be ready to explain them at viva. |
| 10 Oct 2026 | Confirm whether unit tests and Swagger documentation were implemented. | Codex explained that six tests are API integration tests and the OpenAPI contract covers 18 paths. | Do not describe the existing suite as unit tests. |
| 10 Oct 2026 | Deploy the API on server 84.247.139.75. | Codex installed a separate production Compose stack, seeded 134,400 readings, added a Caddy HTTPS hostname, tested authenticated reads and access denial, scheduled backups, and verified a restore. | Recheck uptime, certificate, seed timestamps, and backups shortly before submission. |
| 10 Oct 2026 | Start the required report documentation in the student's voice. | Codex prepared a Word authoring draft from the supplied template with diagrams, evidence tables, source candidates, and section prompts. | Student supplies a writing sample, writes the final narrative personally, checks the prompt record, signs the declaration, and declares the final word count. |

Implementation review performed by the AI aid: fixed an auth route mounting error found during smoke testing; corrected a test expectation for the bodyless 304; validated the OpenAPI document; verified seed counts and idempotent rerun. Add later prompts and repairs as development continues.

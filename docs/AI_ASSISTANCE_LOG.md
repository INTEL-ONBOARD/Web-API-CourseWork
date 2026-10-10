# AI assistance log for appendix preparation

This technical log records assistance used so the student can make a complete disclosure in the report appendix. It is not report narrative and does not replace the student's own explanation at viva.

| Date | User direction / prompt summary | AI aid and output | Human review needed |
| --- | --- | --- | --- |
| 10 Oct 2026 | Read the coursework folder, analyse the task, research options, and plan implementation and report. | Codex reviewed the supplied brief, rubric, and template; researched official HTTP, FastAPI, PostgreSQL, security, and hosting sources; proposed the API architecture. | Check the missing module REST API Design Guidelines white paper and assignment interpretation. |
| 10 Oct 2026 | Map the plan into HTML with architecture and visualizations. | Codex created a planning HTML page in the separate Codex outputs folder. | Review visual layout and factual labels. |
| 10 Oct 2026 | Use the supplied GitHub repository and Development folder; start development with Express, PostgreSQL, and Docker; make a full specification. | Codex cloned the empty repository, wrote `docs/SPEC.md`, migration, deterministic seed, Express API, OpenAPI, Docker and integration tests. | Review each route, SQL query, auth rule, test, and deployment decision; be ready to explain them at viva. |

Implementation review performed by the AI aid: fixed an auth route mounting error found during smoke testing; corrected a test expectation for the bodyless 304; validated the OpenAPI document; verified seed counts and idempotent rerun. Add later prompts and repairs as development continues.

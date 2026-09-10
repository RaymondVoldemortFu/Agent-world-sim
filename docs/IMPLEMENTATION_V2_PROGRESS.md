# V2 implementation tracking

Authorized: implement both design documents, validate, then run 20 people / 100 days using real LLM.
Historical experiments remain unchanged. New version and explicit controller/preset configuration.

- [x] Data catalog: items, crops, buildings, recipes and calibrated parameters
- [x] Ecology: seasons/weather, water, soils, forests, wild food/animals, finite deposits, regions
- [x] Physical economy: mass/energy batches, storage, minute scheduling, production jobs, agriculture, husbandry, construction/transport
- [x] Hybrid brain: local-only rules, persistent goals, event-triggered compact LLM requests, consent execution, knowledge/skills, budgets and traceability
- [x] Shared CLI/Worker integration, save/replay/verification and backend prompt/control support
- [x] UI: ecological map, inventory, industry/jobs, calendar and brain/cost controls
- [x] Deterministic annual/industry/conservation/privacy/restore tests, backend/UI checks
- [ ] Complete 100-day / 20-person LLM experiment and report

Implementation details and explicit modeling approximations: `ECOLOGY_V2_IMPLEMENTATION.md`.

Map refresh: illustrated SVG terrain, residents/buildings/fields, regional selection, zoom/pan/grid and accessible tile selection.

Experiment `eco-hybrid-100day-20` was paused for a zero-time parallel-boundary correction. Current experiment: `artifacts/eco-hybrid-v2-100day-20`. This run was checkpoint-paused to add hunting byproducts and explicit survey/learning/repair/confrontation goals, reconcile discarded model-attempt quotas, and deploy chronicle search indexing. Continuation uses the same world and journals; implementation fingerprints record the code change boundary.

Chronicle search: persistent incremental SQLite metadata/decision-offset cache, literal Chinese substring search, committed-boundary cursor pagination, debounced UI and explicit search refresh. Performance and validation: `CHRONICLE_SEARCH_PERFORMANCE.md`.

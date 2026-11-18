-- 0010: agents.model — drop the stale placeholder default.
--
-- 'google:gemini-flash' was the Phase 0 placeholder id; the registry now uses
-- ids like 'google:gemini-3.8-flash', so the default pointed at an unknown
-- model. NULL means "use the app default" (the dashboard-configured default
-- model), which is what the mobile model picker resolves at run time.

alter table agents alter column model drop default;
update agents set model = null where model = 'google:gemini-flash';

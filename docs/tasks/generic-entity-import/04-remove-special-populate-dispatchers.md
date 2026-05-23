# Remove Special Populate Dispatchers

**Parent Plan:** [Generic Entity Import](./README.md)

**Type:** AFK

**Status:** done

## What to build

Remove the old special populate dispatcher design from the import worker. The worker should no longer route jobs to person, company, or group populate handlers, and the import flow should no longer enqueue special populate jobs. The generic import path introduced by earlier tasks should be the only details import path.

Delete or stop exporting old person/company/group populate job schemas, job names, handlers, and helper functions once they are no longer used. Keep the current queue/job naming and current worker module location for this PRD, but add TODO comments near those retained names/boundaries explaining that they should later be renamed or moved to reflect generic entity import behavior.

This slice should remove dispatcher-specific code without changing the public import endpoint or search behavior.

## Acceptance criteria

- [x] `processMediaJob` no longer dispatches to person, company, or group populate handlers.
- [x] The import flow no longer enqueues person, company, or group populate jobs.
- [x] Old person/company/group populate job definitions are removed or made unreachable only if still required temporarily by tests in an earlier slice.
- [x] Old person/company/group populate handlers and special stub processors are removed when no longer referenced.
- [x] The retained media import queue/job naming has a TODO comment noting it should later be renamed for generic entity import behavior.
- [x] The retained worker module location has a TODO comment noting it should later move to a generic entity import module.
- [x] Public import and search endpoints continue to behave as before from the API consumer perspective.
- [x] Tests no longer depend on special populate jobs or dispatcher branches.

## User stories addressed

Reference by number from the parent PRD:

- User story 18
- User story 20
- User story 27
- User story 29
- User story 33

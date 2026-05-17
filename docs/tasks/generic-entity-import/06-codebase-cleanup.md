# Codebase Cleanup

**Parent Plan:** [Generic Entity Import](./README.md)

**Type:** AFK

**Status:** done

## What to build

Review every file touched during this plan and remove anything that is no longer needed or was introduced as scaffolding. Follow the `codebase-cleanup` skill, with special attention to duplicate code, duplicate or alias-only types, dead code, unnecessary exports, shallow wrappers, stale support artifacts, and speculative abstractions. The cleanup is scoped to touched files and directly affected modules, not unrelated opportunistic refactors.

For this plan, pay special attention to old dispatcher code, special populate job definitions, stale media-specific helper schemas, obsolete script migration helpers, unused test fixtures, and TODO comments that were intended only as temporary implementation notes rather than the explicit long-term queue/module naming TODOs required by the PRD.

## Acceptance criteria

- [x] The task is executed using the `codebase-cleanup` skill
- [x] The cleanup pass covers all files touched by this plan and any directly affected modules
- [x] Any removals or simplifications are reflected in the changed code before the plan is considered complete

---
name: prd-to-issues
description: Break a PRD into independently-grabbable task files using tracer-bullet vertical slices. Use when user wants to convert a PRD to tasks, create implementation tickets, or break down a PRD into work items. Do not use subagents for this.
---

# PRD to Tasks

Break a PRD into independently-grabbable task markdown files using vertical slices (tracer bullets).

## Process

### 1. Locate the PRD

Ask the user for the plan name (e.g., "user-authentication").

If the PRD is not already in your context window, read it from `docs/tasks/{plan-name}/README.md`.

### 2. Explore the codebase (optional)

If you have not already explored the codebase, do so to understand the current state of the code.

### 3. Draft vertical slices

Break the PRD into **tracer bullet** tasks. Each task is a thin vertical slice that cuts through ALL integration layers end-to-end, NOT a horizontal slice of one layer.

Slices may be 'HITL' or 'AFK'. HITL slices require human interaction, such as an architectural decision or a design review. AFK slices can be implemented and merged without human interaction. Prefer AFK over HITL where possible.

<vertical-slice-rules>
- Each slice delivers a narrow but COMPLETE path through every layer (schema, API, UI, tests)
- A completed slice is demoable or verifiable on its own
- Prefer many thin slices over few thick ones
</vertical-slice-rules>

### 4. Quiz the user

Present the proposed breakdown as a numbered list. For each slice, show:

- **Title**: short descriptive name
- **Type**: HITL / AFK
- **Blocked by**: which other slices (if any) must complete first
- **User stories covered**: which user stories from the PRD this addresses

Ask the user:

- Does the granularity feel right? (too coarse / too fine)
- Are the dependency relationships correct?
- Should any slices be merged or split further?
- Are the correct slices marked as HITL and AFK?

Iterate until the user approves the breakdown.

### 5. Create the task files

For each approved slice, create a task markdown file in `docs/tasks/{plan-name}/` where `{plan-name}` is the plan directory name.

Task files should be named `{NN}-{task-title}.md` where:

- `{NN}` is zero-padded (01, 02, 03, etc.)
- `{task-title}` is in kebab-case

Create tasks in dependency order (blockers first) so you can reference earlier task files in the "Blocked by" field.

<task-template>
# {Task Title}

**Parent Plan:** [{Plan Name}](./README.md)

**Type:** HITL / AFK

**Status:** todo

## What to build

A concise description of this vertical slice. Describe the end-to-end behavior, not layer-by-layer implementation. Reference specific sections of the parent PRD rather than duplicating content.

## Acceptance criteria

- [ ] Criterion 1
- [ ] Criterion 2
- [ ] Criterion 3

## Blocked by

- [Task NN](./{NN}-{task-title}.md)

Or "None - can start immediately" if no blockers.

## User stories addressed

Reference by number from the parent PRD:

- User story 3
- User story 7

</task-template>

After creating all task files, update the parent README.md file to replace the placeholder Tasks section with the actual task tracking table:

Replace the Tasks section (everything after `---` and `## Tasks`) with:

## <tasks-section-template>

## Tasks

**Overall Progress:** 0 of {N} tasks completed

**Current Task:** [Task 01](./{01}-{task-title}.md) (todo)

### Task List

| #   | Task                                   | Type | Status | Blocked By |
| --- | -------------------------------------- | ---- | ------ | ---------- |
| 01  | [{Task Title}](./{01}-{task-title}.md) | AFK  | todo   | None       |
| 02  | [{Task Title}](./{02}-{task-title}.md) | HITL | todo   | Task 01    |
| 03  | [{Task Title}](./{03}-{task-title}.md) | AFK  | todo   | Task 02    |

</tasks-section-template>

Do NOT modify other sections of the parent README.md.

### 6. Updating task status

When a task status changes (e.g., from `todo` to `in-progress` to `done`), update BOTH files:

1. Update the task file's `**Status:**` field
2. Update the README.md's task table row for that task
3. Update the README.md's "Overall Progress" counter (count completed tasks)
4. Update the README.md's "Current Task" to point to the first non-done task

**Valid status values:**

- `todo` - Not started
- `in-progress` - Currently being worked on
- `done` - Completed
- `blocked` - Waiting on dependencies
- `cancelled` - No longer needed

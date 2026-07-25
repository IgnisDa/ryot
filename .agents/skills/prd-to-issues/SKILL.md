---
name: prd-to-issues
description: Break a PRD into independently-grabbable task files using tracer-bullet vertical slices. Use when user wants to convert a PRD to tasks, create implementation tickets, or break down a PRD into work items. Do not use subagents for this.
---

# PRD to Tasks

Break a PRD into independently-grabbable task markdown files using vertical slices (tracer bullets).

**Core principle:** Each task file, read together with the parent PRD, must give a fresh agent with no prior context everything it needs to understand the work and implement the changes — including all relevant technical decisions. Never assume the agent has explored the codebase or has memory of prior conversations.

## Process

### 1. Draft vertical slices

Break the PRD into **tracer bullet** tasks. Each task is a thin vertical slice that cuts through ALL integration layers end-to-end, NOT a horizontal slice of one layer.

The **final task must always be a codebase cleanup task**. It must not be merged or skipped. It must explicitly follow the `codebase-cleanup` skill, and it should be scoped to the touched files and directly affected modules for the plan.

<vertical-slice-rules>
- Each slice delivers a narrow but COMPLETE path through every layer (schema, API, UI, tests)
- A completed slice is demoable or verifiable on its own
- Prefer many thin slices over few thick ones
</vertical-slice-rules>

### 2. Quiz the user

Present the proposed breakdown as a numbered list. For each slice, show:

- **Title**: short descriptive name
- **User stories covered**: which user stories from the PRD this addresses

Ask the user:

- Does the granularity feel right? (too coarse / too fine)
- Should any slices be merged or split further?

Iterate until the user approves the breakdown.

### 3. Create the task files

For each approved slice, create a task markdown file in `docs/tasks/{plan-name}/` where `{plan-name}` is a single lowercase word with no spaces, hyphens, or underscores. Choose it as the concise name for the plan, such as `ryotql`.

Task files should be named `{NN}-{task-title}.md` where:

- `{NN}` is zero-padded (01, 02, 03, etc.)
- `{task-title}` is in kebab-case

Create tasks in a sensible execution order so the task list reads cleanly from top to bottom.

<task-template>
# {Task Title}

**Parent Plan:** [{Plan Name}](./README.md)

**Status:** todo

## What to build

A concise description of this vertical slice. Describe the end-to-end behavior, not layer-by-layer implementation. Reference specific sections of the parent PRD rather than duplicating content. Supplement with any slice-specific technical decisions or constraints not already captured in the PRD, so that a fresh agent reading only this file and the parent PRD has everything it needs to implement the slice without further exploration.

## Acceptance criteria

- [ ] Criterion 1
- [ ] Criterion 2
- [ ] Criterion 3

## User stories addressed

Reference by number from the parent PRD:

- User story 3
- User story 7

## Implementor Notes

Notes written by the implementor that contain technical details may be useful for future implementors. This section is optional.

</task-template>

After creating all task files, update the parent README.md file to replace the top-of-file Tasks section with the actual task tracking table:

Replace the Tasks section at the top of the file with:

## <tasks-section-template>

## Tasks

**Overall Progress:** 0 of {N} tasks completed

**Current Task:** [Task 01](./{01}-{task-title}.md) (todo)

### Task List

| #   | Task                                   | Status |
| --- | -------------------------------------- | ------ |
| 01  | [{Task Title}](./{01}-{task-title}.md) | todo   |
| 02  | [{Task Title}](./{02}-{task-title}.md) | todo   |
| 03  | [{Task Title}](./{03}-{task-title}.md) | todo   |

</tasks-section-template>

Keep the Tasks section at the top of the README.md and do NOT modify other sections of the parent README.md.

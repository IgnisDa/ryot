# Event Trigger Workflows

**Parent Plan:** [App Backend Effect Migration](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Migrate before-create and after-create event trigger behavior onto the Effect sandbox/workflow substrate. Event creation should run active before-create triggers where required, respect allow/skip/replace outcomes, persist events, then run after-create triggers for automation such as auto-complete policies.

The implementation should avoid queue-specific replay state and use durable workflow/activity patterns where asynchronous trigger work is needed.

## Acceptance criteria

- [ ] Event creation can run active before-create trigger scripts
- [ ] Before-create allow, skip, and replace outcomes are validated and applied
- [ ] Event creation persists valid events after before-create processing
- [ ] After-create trigger scripts run for created events where configured
- [ ] Trigger failures map to typed expected failures or durable failure records as appropriate
- [ ] Event trigger E2E tests pass through the Effect client

## User stories addressed

Reference by number from the parent PRD:

- User story 28
- User story 33
- User story 38

# Notification Automation Ownership

**Parent Plan:** [Plugin System — Phase 2](./README.md)

**Type:** AFK

**Status:** todo

## Before you start

Read `docs/plans/plugin-system/00-overview.md` and
`docs/plans/plugin-system/02-phase-2-plugin-contract-and-loader.md` in full. The owner-confirmed
notification ownership decision in plan §2 is authoritative. Honor the plan markers and stop on any
new contradiction. Per `AGENTS.md`, launch multiple bounded `explore` subagents to map the signal
definition contract and registry, notification subscription resolution, plugin script catalogs,
kernel source-zero persistence, and notification behavior tests. Depends on tasks 03 and 05 and
must complete before task 07 finalizes script storage.

## What to build

Implement notification formatters according to signal ownership while preserving notification
behavior:

1. **Signal definition contract**: add `notificationScriptSlug` to subscribable signal-schema
   definitions. Validate each reference against an automation script in the complete prospective
   registry snapshot; this is reference validation, not plugin dependency resolution. Kernel
   source-zero scripts live outside the loader snapshot (the static kernel set, persisted as
   `pluginSlug`-null rows), so extend the validation universe to include them.
2. **Formatter ownership**: move all media-signal formatting into a media plugin automation and
   `workout.created` formatting into a fitness plugin automation. Keep only the
   `integration.disabled` formatter in kernel source zero. Preserve every existing message.
3. **Subscription resolution**: reshape `notification_subscription_state` — drop `scriptSlug`,
   narrow the unique key to `(userId, signalSchemaSlug)`, regenerate the migration. Dispatch
   resolves the formatter from the subscribed signal definition's `notificationScriptSlug` at
   execution time (active plugin script or content-addressed source-zero script). Rows whose
   signal definition is no longer registered are inert: skipped by dispatch, omitted from rule
   listings, never an error.
4. **Ownership invariant**: update relevant module documentation and tests to state that scripts
   are owned by an installed plugin or kernel source zero. Do not introduce a synthetic kernel
   plugin. Task 07 removes legacy user ownership and applies the final storage constraints.
5. **Tests**: preserve notification-subscription and notification-delivery assertions. Add focused
   validation and resolution coverage for plugin-owned and source-zero formatters.

Full spec: plan §2, §4, §5, and Decision 2. Do not add a notification-template DSL, native
domain-specific formatting, or a new top-level manifest section.

## Acceptance criteria

- [ ] No media- or fitness-specific signal slug or message formatting remains in kernel source
- [ ] Every subscribable signal definition explicitly selects a valid automation formatter
- [ ] Media and fitness formatters are compiled and loaded from their owning plugin packages;
      source zero formats only `integration.disabled`
- [ ] `notification_subscription_state` stores no formatter slug (unique on
      `(userId, signalSchemaSlug)`, migration regenerated); dispatch resolves the formatter from
      the signal definition for both plugin-owned and source-zero scripts, and rows for
      unregistered signals are inert rather than errors
- [ ] Existing notification message and delivery assertions are unchanged and green
- [ ] Backend `check` + unit tests, affected e2e suites, and `app-client` check pass

## User stories addressed

- User story 40

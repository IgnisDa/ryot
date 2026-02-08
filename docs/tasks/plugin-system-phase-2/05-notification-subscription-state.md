# Per-User Notification Subscriptions to State Table

**Parent Plan:** [Plugin System — Phase 2](./README.md)

**Type:** AFK

**Status:** done

## Before you start

Read `docs/plans/plugin-system/00-overview.md` and
`docs/plans/plugin-system/02-phase-2-plugin-contract-and-loader.md` in full before writing any
code. They are the authoritative spec; this task file only frames the slice. Honor the plan
markers (`[DECIDED]`/`[RECOMMENDED]`/`[IMPLEMENTER-DECIDES]`) as described in the parent PRD.
Per `AGENTS.md`, launch an `explore` subagent first — `NotificationSubscriptionsService`
(`automations/notification-subscriptions-service.ts`), the `automations` contract group
(`installRule`/`activateRule`/`deactivateRule`/`deleteRule`/`listRules`), `ensureDefaultRules`
in `user-bootstrap/bootstrap.ts` and its callers in `auth/service.ts` and `god-mode/service.ts`,
the `automation_rule` and `subscription_run` tables, and the per-user state-split pattern to
mirror (`plugin_state`, task 03). Depends on task 03; task 04 recommended first (real-loader
fixture in place).

## What to build

Move the last definition/state conflation off the database: per-user notification subscriptions
(the `userId`-set `automation_rule` rows) become dedicated per-user state, after which
`automation_rule` is deleted entirely.

1. **New `notification_subscription_state` table** (`[RECOMMENDED]`)
   `(id, userId, signalSchemaSlug, scriptSlug, isActive, metadata?, timestamps)`, unique on
   `(userId, signalSchemaSlug, scriptSlug)`, following the `plugin_state` pattern. Regenerate
   the single drizzle migration rather than authoring ALTERs.
2. **Re-point, surface preserved** (plumbing only): `NotificationSubscriptionsService`, the
   `automations` rule endpoints, `ensureDefaultRules`, and the `auth`/`god-mode` consumers now
   read/write the new table instead of `automation_rule`. The user-facing rule surface and its
   behavior are unchanged.
3. **`subscription_run`**: keep the table with one non-null text `ruleId`, containing the generated
   notification-subscription-state ID for per-user runs or the existing deterministic binding ID
   for manifest-driven runs. This is the run's single durable attribution field.
4. **Delete `automation_rule`** — now that both the global-binding move (task 03) and this
   per-user move are done, the table has no remaining rows or readers.
5. **Migrate `tests/src/tests/automations/notification-subscriptions.test.ts`** with assertions
   preserved (plumbing only — Decision 16, cross-phase invariant 2).

Full spec: plan §5 (per-user subscriptions, `subscription_run` change, table deletion). Do not
restate or re-derive it.

## Acceptance criteria

- [x] `notification_subscription_state` exists (unique on `(userId, signalSchemaSlug,
  scriptSlug)`) via a regenerated migration; `automation_rule` is deleted (done criterion 2,
      remaining half)
- [x] `NotificationSubscriptionsService`, the `automations` endpoints, `ensureDefaultRules`, and
      the `auth`/`god-mode` consumers read/write the new table with the user-facing rule surface
      unchanged (plan §5)
- [x] `subscription_run.ruleId` is non-null durable text, its FK and duplicate attribution column
      are absent, and execution bookkeeping survives subscription-state deletion and plugin
      snapshot replacement (plan §5)
- [x] The notification-subscriptions e2e suite is green with assertions unchanged (cross-phase
      invariant 2); notification-delivery behavior remains green (done criterion 2)
- [ ] Backend `check` + unit tests, the full e2e suite, and `app-client` check pass (done
      criterion 6, cross-phase invariant 1)

  Backend and app-client checks pass; backend tests pass 935/935; the affected e2e suite passes
  4/4. The full e2e run passed 494/495, with the unrelated media-trending poll timeout passing
  2/2 when rerun in isolation.

## User stories addressed

- User story 21
- User story 22
- User story 23
- User story 34

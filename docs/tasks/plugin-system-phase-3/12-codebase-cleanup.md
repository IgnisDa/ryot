# Codebase Cleanup

**Parent Plan:** [Plugin System — Phase 3: Capability Migrations](./README.md)

**Type:** AFK

**Status:** done

## What to build

Review every file touched during this plan and remove anything that is no longer needed or was
introduced as scaffolding. Follow the `codebase-cleanup` skill, with special attention to
duplicate code, duplicate or alias-only types, dead code, unnecessary exports, shallow wrappers,
stale support artifacts, and speculative abstractions. The cleanup is scoped to touched files and
directly affected modules, not unrelated opportunistic refactors.

Pay particular attention to residue of the five deleted native domain modules (`media-trending`,
`exercises`, `metadata-lookup`, `episode-resolver`, `media-monitoring`), the deleted native
sink/yank adapters and all nineteen import-source adapters, the deleted media/non-media import
orchestration split, the temporary step-2 `invokeOperation` scaffolding, and any Promise-based
sandbox entrypoint/host compatibility wrapper or alias left after the Effect-native cutover. Also
remove any runtime entrypoint selector, driver-map compatibility path, script-backed provider
provenance, or script-scoped cache key retained for provider-associated scripts.

Step 4 specifically leaves these to verify as fully gone: the hardcoded
`IntegrationProviderSpecifics` union and `providerLotByProvider` tables, the hardcoded import
source table in `imports/runtime/source-definitions.ts`, `episodeLocator` and every remnant of the
subject-selection branch, Netflix's `"netflix-search-planned"` two-phase path, and
`lib/shared/title-parsing.ts` / `title-matching.ts`. Confirm none of the four withdrawn host
functions (`putRunBlobs`, `getRunBlobs`, `recordImportFailures`, `reportImportProgress`) was
introduced anywhere.

## Acceptance criteria

- [x] The task is executed using the `codebase-cleanup` skill
- [x] The cleanup pass covers all files touched by this plan and any directly affected modules
- [x] Any removals or simplifications are reflected in the changed code before the plan is
      considered complete
- [x] Repository searches confirm future-facing code and documentation use direct scripts,
      logical providers, trusted execution authority, and provider-scoped caches

## Coverage ledger

The inventory is the **commit-log union** of every path named by every commit in `02fc77f4..HEAD`
(first source commit `530b693b3`), including deleted, renamed, and later-reverted paths: **1,007
paths**. Each landed on exactly one outcome:

| Outcome                                  | Paths |
| ---------------------------------------- | ----- |
| reviewed / no cleanup                    | 770   |
| deleted-or-renamed, checked for residue  | 181   |
| changed                                  | 53    |
| excluded (generated / legacy V1 surface) | 3     |

The 181 deleted/renamed paths are dominated by `apps/app-backend/src` (116 — the five native domain
modules, the sink/yank adapters, and the import-orchestration split) and `plugins/media/scripts`
(51 — provider scripts superseded by their already-split `-details` / `-search` / `-translate`
counterparts). Exclusions: `bun.lock` (generated lockfile) and
`apps/docs/src/includes/backend-config-schema.yaml` (documents the legacy V1 Rust config surface).
Standing exclusions applied throughout: generated/ignored output (`dist/`, `*.generated.ts`,
`generated-sandbox/`, `runner.generated.ts`), `node_modules/`, backup apps
(`apps/app-client-backup`, retained as a reference with deletion deferred), legacy V1 Rust crates
under `crates/`, and stale agent worktrees.

A further **12 paths outside the union** were changed because this task's scope explicitly extends
to them: the `legacy-bootstrap` module's migration targets and its generated-SQL test. Historical
prose in `docs/plans/**` and `docs/tasks/**` deliberately retains withdrawn names where it is
describing history.

## Deliberate non-removals

- **`span` host function** — named as a candidate by the inventory (registered end-to-end, no plugin
  caller today), but it is a deliberately-offered observability capability with real coverage in
  `bridge-adapter.test.ts`, `observability-host-functions.test.ts`, and SDK `core.test.ts`, and is
  documented as `log`'s pair. Kept. None of the four _actually_ withdrawn host functions
  (`putRunBlobs`, `getRunBlobs`, `recordImportFailures`, `reportImportProgress`) exists anywhere.
- **`libs/sandbox-compiler/src/compiler-source.ts` driver-map diagnostics** — the
  `defineDriver`/`defineProviderDriver`/`drivers`-literal checks reject the withdrawn API rather
  than supporting it, so they are a regression guardrail, not a compatibility layer. Kept.
- **`parseCsvText` duplicated between `plugins/fitness` and `plugins/media`** — the two plugins are
  intentionally isolated and neither depends on the other, so consolidating would mean inventing a
  new shared package. Left duplicated rather than adding an abstraction.
- **Rust `IntegrationProviderSpecifics`** (`crates/models/{media,database}/src/…`) — legacy V1
  crates, documented scope exclusion. No V2 TypeScript equivalent exists:
  `IntegrationProviderSettings` is `Schema.Record({ key: Schema.String, value: Schema.Unknown })`,
  i.e. generic manifest-validated settings.

## Waived Task 11 baseline

Two e2e failures are pre-existing and owner-waived; each was reproduced identically with this task's
changes stashed, so neither is attributable to Task 12:

- `imports/imports.test.ts` → "attaches per-episode history to the episode entity and drops
  unresolvable locators": `PollTimeout` — the import run does not complete within 60s. Identical at
  `763720970`. (Before the local `.env` was migrated to the plugin-scoped variable names this
  surfaced as `BadRequest: Watcharr importer is not configured`, which masked the real timeout.)
- `integrations/integrations.test.ts` → three cases under "Webhook routes" / "Progress
  normalization": import run status `failed` where `completed` is expected. Identical at
  `763720970`.

These remain Task 11's to close. They are **not** reclassified as Task 12 successes, and no
branch-wide or full-suite green claim is made.

# Effect 3.x to 4.x Migration Plan

**Target Version**: `4.0.0-beta.102`
**Approach**: Phased parallel upgrades with autonomous execution
**Verification**: Per-package tests, no full e2e suite
**Git**: No commits required during migration; commit once all phases complete

---

## Background

Effect v4 introduces structural reorganization with no core programming model changes:

- **Unified versioning**: All Effect packages release together at `4.0.0-beta.102`
- **Package consolidation**: Workflow, Cluster, RPC, and Experimental functionality move into core `effect` under `effect/unstable/*` — **separate packages removed**
- **API renames**: 53 mechanical renames across 595 import statements (find/replace via migration guide)
- **@effect/platform-\***: Remain separate; platform-specific packages upgrade alongside core

**Current Baseline**:

```json
"effect": "3.21.4",
"@effect/cluster": "0.59.0",
"@effect/experimental": "0.60.0",
"@effect/opentelemetry": "0.63.0",
"@effect/platform": "0.96.2",
"@effect/platform-bun": "0.90.0",
"@effect/sql-pg": "0.52.1",
"@effect/workflow": "0.18.2"
```

**Target Baseline**:

```json
"effect": "4.0.0-beta.102",
"@effect/platform-bun": "4.0.0-beta.102",
"@effect/sql-pg": "4.0.0-beta.102",
"@effect/opentelemetry": "4.0.0-beta.102",
"@effect/vitest": "4.0.0-beta.102"
```

**Removed** (all merged into core `effect@4.0.0-beta.102`):

- `@effect/platform` → import from `effect/*` (e.g., `effect/FileSystem`, `effect/Path`, `effect/Terminal`) or `effect/unstable/*` (e.g., `effect/unstable/http/HttpClient`)
- `@effect/cluster` → import from `effect/unstable/cluster/*`
- `@effect/workflow` → import from `effect/unstable/workflow/*`
- `@effect/experimental` → import from `effect/unstable/eventlog/*`, `effect/unstable/persistence/*`, `effect/unstable/reactivity/*`, etc.
- `@effect/rpc` → import from `effect/unstable/rpc/*`

---

## Migration Guide Reference

Migration details are authoritative in `/tmp/effect/migration/`:

- **v3-to-v4.md**: 290 import renames, 53 API renames (use for find/replace)
- **services.md**: `Context.Tag` → `Context.Service`
- **error-handling.md**: Error combinator renames
- **schema.md**: Schema DSL changes (if using Schema heavily)
- **workflow**: No dedicated guide; follow import renames + API renames

---

## Execution Strategy

### Phases

1. **Phase 1 — Core Effect Upgrade**: Upgrade `effect`, `@effect/platform`, `@effect/platform-bun`
2. **Phase 2 — Remaining Platforms & Integrations**: Upgrade `@effect/sql-pg`, `@effect/opentelemetry`, add `@effect/vitest`
3. **Phase 3 — Package Removal & Code Migration**: Remove `@effect/workflow`, `@effect/cluster`, `@effect/experimental`; update all imports to `effect/unstable/*` paths; apply API renames
4. **Phase 4 — Libraries**: Migrate `@ryot/contract`, `@ryot/sandbox-sdk`, `@ryot/plugin-kit`, `@ryot/testing`
5. **Phase 5 — Apps**: Migrate `@ryot/app-backend`, `@ryot/app-client`, `@ryot/website`, `@ryot/browser-extension`, `@ryot/app-client-backup`
6. **Phase 6 — Plugins**: Migrate `@ryot/plugin-fitness`, `@ryot/plugin-media`
7. **Phase 7 — Integration Tests**: Migrate `tests` package

### Subagent Parallelization

Within each phase, **independent packages can migrate in parallel** via subagents. Packages with dependencies (e.g., `@ryot/app-backend` depends on `@ryot/contract`) **must have dependencies migrated first**.

**No parallelization across phases**: Each phase begins only after the previous phase is verified.

### Critical Note on Phase 3

Phase 3 is a **package removal + code migration** phase. It:

1. Removes `@effect/workflow`, `@effect/cluster`, `@effect/experimental` from all `package.json` files
2. Updates **1,600+ imports** from old package paths to `effect/unstable/*` paths
3. Applies **53 API renames** across all code
4. This phase is the highest-risk point; all remaining Type errors will surface here

---

## Phase 1: Core Effect Upgrade

**Packages**: `effect`, `@effect/platform-bun`
**Dependencies**: None (core)
**Duration**: ~5 minutes
**Parallelization**: Parallel (independent upgrades)

### 1.1 Upgrade Dependencies

```bash
cd /Users/diptesh/Desktop/Personal/ryot

# Upgrade core
bun add --exact "effect@4.0.0-beta.102"
bun add --exact "@effect/platform-bun@4.0.0-beta.102"

# Verify lock file
git diff bun.lock
```

**Expected**: 1–2 minutes. Lock file shows new versions pinned.

### 1.2 No Type Checking in Phase 1

Do NOT run tests yet. `@effect/platform`, `@effect/workflow`, `@effect/cluster`, `@effect/experimental` packages still exist in code and will be handled in Phase 3.

### 1.3 No Code Migration in Phase 1

Do NOT apply import/API renames yet. Those happen in Phase 3 after package removal.

---

## Phase 2: Remaining Platform & Integration Packages

**Packages**: `@effect/sql-pg`, `@effect/opentelemetry`, `@effect/vitest`
**Dependencies**: Phase 1 complete
**Duration**: ~5 minutes
**Parallelization**: All in parallel (independent package upgrades)

### 2.1 Upgrade & Add Dependencies

```bash
cd /Users/diptesh/Desktop/Personal/ryot

# Upgrade
bun add --exact "@effect/sql-pg@4.0.0-beta.102"
bun add --exact "@effect/opentelemetry@4.0.0-beta.102"

# Add if not already present (check apps/app-backend/package.json)
bun add --exact "@effect/vitest@4.0.0-beta.102"
```

**Expected**: Lock file updated with v4 versions.

### 2.2 No Code Migration in Phase 2

No import/API renames yet. Package upgrades only.

### 2.3 No Type Checking in Phase 2

Tests will fail due to missing `@effect/platform`, `@effect/workflow`, etc. — this is expected. Wait for Phase 3.

---

## Phase 3: Package Removal & Critical Code Migration

**Action**: Remove `@effect/platform`, `@effect/workflow`, `@effect/cluster`, `@effect/experimental` from all `package.json` files; migrate all imports to `effect/*` and `effect/unstable/*`; apply 53 API renames
**Dependencies**: Phase 1–2 complete
**Duration**: ~40 minutes
**Parallelization**: None (single coordinated phase; highest risk)
**Risk Level**: HIGHEST — this is where most type errors will surface

### 3.1 Remove Old Packages from package.json

```bash
cd /Users/diptesh/Desktop/Personal/ryot

# Remove from all package.json files that depend on them
# Files to edit:
#   - apps/app-backend/package.json
#   - Any other package.json that imports from removed packages

cd apps/app-backend
# Manually edit package.json to remove:
#   "@effect/platform": "...",
#   "@effect/workflow": "...",
#   "@effect/cluster": "...",
#   "@effect/experimental": "...",

# Update lock file
bun install
```

**Expected**: Lock file shrinks significantly; all four packages removed.

### 3.2 Code Migration – CRITICAL CHANGES

This phase performs **four concurrent transformations** across all source files:

#### 3.2a: Platform Imports (moved to `effect/*` or `effect/unstable/*`)

```txt
@effect/platform/ChannelSchema → effect/ChannelSchema
@effect/platform/FileSystem → effect/FileSystem
@effect/platform/Path → effect/Path
@effect/platform/Terminal → effect/Terminal
@effect/platform/Error → effect/PlatformError
@effect/platform/MsgPack → effect/unstable/encoding/Msgpack
@effect/platform/Ndjson → effect/unstable/encoding/Ndjson
@effect/platform/Cookies → effect/unstable/http/Cookies
@effect/platform/Etag → effect/unstable/http/Etag
@effect/platform/FetchHttpClient → effect/unstable/http/FetchHttpClient
@effect/platform/Headers → effect/unstable/http/Headers
@effect/platform/HttpBody → effect/unstable/http/HttpBody
@effect/platform/HttpClient → effect/unstable/http/HttpClient
@effect/platform/HttpClientError → effect/unstable/http/HttpClientError
@effect/platform/HttpClientRequest → effect/unstable/http/HttpClientRequest
@effect/platform/HttpClientResponse → effect/unstable/http/HttpClientResponse
@effect/platform/HttpApp → effect/unstable/http/HttpEffect
@effect/platform/HttpIncomingMessage → effect/unstable/http/HttpIncomingMessage
@effect/platform/HttpMethod → effect/unstable/http/HttpMethod
@effect/platform/HttpMiddleware → effect/unstable/http/HttpMiddleware
@effect/platform/HttpRouter → effect/unstable/http/HttpRouter
@effect/platform/HttpServer → effect/unstable/http/HttpServer
@effect/platform/HttpServerError → effect/unstable/http/HttpServerError
@effect/platform/HttpServerRequest → effect/unstable/http/HttpServerRequest
@effect/platform/HttpServerResponse → effect/unstable/http/HttpServerResponse
@effect/platform/Multipart → effect/unstable/http/Multipart
@effect/platform/Socket → effect/unstable/socket/Socket
@effect/platform/SocketServer → effect/unstable/socket/SocketServer
... (see /tmp/effect/migration/v3-to-v4.md for complete list)
```

#### 3.2b: Workflow Imports (8 modules)

```txt
@effect/workflow/Activity → effect/unstable/workflow/Activity
@effect/workflow/DurableClock → effect/unstable/workflow/DurableClock
@effect/workflow/DurableDeferred → effect/unstable/workflow/DurableDeferred
@effect/workflow/DurableQueue → effect/unstable/workflow/DurableQueue
@effect/workflow/Workflow → effect/unstable/workflow/Workflow
@effect/workflow/WorkflowEngine → effect/unstable/workflow/WorkflowEngine
@effect/workflow/WorkflowProxy → effect/unstable/workflow/WorkflowProxy
@effect/workflow/WorkflowProxyServer → effect/unstable/workflow/WorkflowProxyServer
```

#### 3.2b: Cluster Imports (35 modules)

```txt
@effect/cluster/ClusterCron → effect/unstable/cluster/ClusterCron
@effect/cluster/ClusterError → effect/unstable/cluster/ClusterError
@effect/cluster/ClusterMetrics → effect/unstable/cluster/ClusterMetrics
@effect/cluster/ClusterSchema → effect/unstable/cluster/ClusterSchema
@effect/cluster/ClusterWorkflowEngine → effect/unstable/cluster/ClusterWorkflowEngine
@effect/cluster/DeliverAt → effect/unstable/cluster/DeliverAt
@effect/cluster/Entity → effect/unstable/cluster/Entity
@effect/cluster/EntityAddress → effect/unstable/cluster/EntityAddress
@effect/cluster/EntityId → effect/unstable/cluster/EntityId
@effect/cluster/EntityProxy → effect/unstable/cluster/EntityProxy
@effect/cluster/EntityProxyServer → effect/unstable/cluster/EntityProxyServer
@effect/cluster/EntityResource → effect/unstable/cluster/EntityResource
@effect/cluster/EntityType → effect/unstable/cluster/EntityType
@effect/cluster/Envelope → effect/unstable/cluster/Envelope
@effect/cluster/HttpRunner → effect/unstable/cluster/HttpRunner
@effect/cluster/K8sHttpClient → effect/unstable/cluster/K8sHttpClient
@effect/cluster/MachineId → effect/unstable/cluster/MachineId
@effect/cluster/Message → effect/unstable/cluster/Message
@effect/cluster/MessageStorage → effect/unstable/cluster/MessageStorage
@effect/cluster/Reply → effect/unstable/cluster/Reply
@effect/cluster/Runner → effect/unstable/cluster/Runner
@effect/cluster/RunnerAddress → effect/unstable/cluster/RunnerAddress
@effect/cluster/RunnerHealth → effect/unstable/cluster/RunnerHealth
@effect/cluster/RunnerServer → effect/unstable/cluster/RunnerServer
@effect/cluster/RunnerStorage → effect/unstable/cluster/RunnerStorage
@effect/cluster/Runners → effect/unstable/cluster/Runners
@effect/cluster/ShardId → effect/unstable/cluster/ShardId
@effect/cluster/Sharding → effect/unstable/cluster/Sharding
@effect/cluster/ShardingConfig → effect/unstable/cluster/ShardingConfig
@effect/cluster/ShardingRegistrationEvent → effect/unstable/cluster/ShardingRegistrationEvent
@effect/cluster/SingleRunner → effect/unstable/cluster/SingleRunner
@effect/cluster/Singleton → effect/unstable/cluster/Singleton
@effect/cluster/SingletonAddress → effect/unstable/cluster/SingletonAddress
@effect/cluster/Snowflake → effect/unstable/cluster/Snowflake
@effect/cluster/SocketRunner → effect/unstable/cluster/SocketRunner
@effect/cluster/SqlMessageStorage → effect/unstable/cluster/SqlMessageStorage
@effect/cluster/SqlRunnerStorage → effect/unstable/cluster/SqlRunnerStorage
@effect/cluster/TestRunner → effect/unstable/cluster/TestRunner
```

#### 3.2d: Experimental Imports (mapped to multiple unstable modules)

```txt
@effect/experimental/Event → effect/unstable/eventlog/Event
@effect/experimental/EventGroup → effect/unstable/eventlog/EventGroup
@effect/experimental/EventJournal → effect/unstable/eventlog/EventJournal
@effect/experimental/EventLog → effect/unstable/eventlog/EventLog
@effect/experimental/EventLogEncryption → effect/unstable/eventlog/EventLogEncryption
@effect/experimental/EventLogRemote → effect/unstable/eventlog/EventLogMessage
@effect/experimental/EventLogServer → effect/unstable/eventlog/EventLogServer
@effect/experimental/Persistence → effect/unstable/persistence/Persistence
@effect/experimental/PersistedCache → effect/unstable/persistence/PersistedCache
@effect/experimental/PersistedQueue → effect/unstable/persistence/PersistedQueue
@effect/experimental/RateLimiter → effect/unstable/persistence/RateLimiter
@effect/experimental/Reactivity → effect/unstable/reactivity/Reactivity
(... see /tmp/effect/migration/v3-to-v4.md for complete mapping)
```

#### 3.2e: API Renames (53 total)

Apply across all `.ts`/`.tsx` files:

```txt
Effect.async → Effect.callback
Effect.zipRight → Effect.andThen
Effect.zipLeft → Effect.tap
Effect.either → Effect.result
Effect.catchAll → Effect.catch
Effect.catchAllCause → Effect.catchCause
Effect.catchSome → Effect.catchIf
Effect.optionFromOptional → Effect.catchNoSuchElement
Effect.catchSomeCause → Effect.catchCauseIf
Effect.tapErrorCause → Effect.tapCause
Layer.scoped → Layer.effect
Layer.scopedDiscard → Layer.effectDiscard
Layer.tapErrorCause → Layer.tapCause
Either → Result
Either.right → Result.succeed
Either.left → Result.fail
Scope.extend → Scope.provide
Stream.repeatEffect → Stream.fromEffectRepeat
Stream.repeatEffectWithSchedule → Stream.fromEffectSchedule
Stream.async → Stream.callback
Stream.either → Stream.result
Stream.flattenChunks → Stream.flattenArray
Stream.flattenIterables → Stream.flattenIterable
Stream.mergeEither → Stream.mergeResult
... (and 29 more)
```

**Execution**: Subagent applies all import path renames (~28 from platform + 8 from workflow + 35 from cluster + ~15 from experimental) + 53 API renames in a single coordinated pass across all `.ts`/`.tsx` files in the repository. Uses `/tmp/effect/migration/v3-to-v4.md` as the authoritative source.

### 3.3 Verification – CRITICAL

```bash
cd apps/app-backend
bun run test check
```

**Expected**: All type errors related to old imports should resolve. If errors remain:

- Missed import path (report with file/line)
- Missed API rename (report with file/line)
- Schema changes (review `/tmp/effect/migration/schema.md`)

**PAUSE ON ANY ERROR**: Report full error context to user. Do not proceed to Phase 4 until this passes completely.

---

## Phase 4: Libraries

**Packages**: `@ryot/contract`, `@ryot/sandbox-sdk`, `@ryot/plugin-kit`, `@ryot/testing`
**Dependencies**: Phase 1–3 complete
**Duration**: ~20 minutes
**Parallelization**: All four in parallel (no interdependencies at this level)

### 4.1 Code Migration

Subagents upgrade each library independently:

- Apply import/API renames (inherited)
- No package.json changes needed; libraries consume `effect@4.0.0-beta.102` from root

### 4.2 Per-Library Verification

```bash
cd libs/contract && bun run test check
cd libs/sandbox-sdk && bun run test check
cd libs/plugin-kit && bun run test check
cd libs/testing && bun run test check
```

**Expected**: All pass. If any fail:

- **PAUSE**: Report affected library and error

---

## Phase 5: Apps

**Packages**: `@ryot/app-backend`, `@ryot/app-client`, `@ryot/website`, `@ryot/browser-extension`, `@ryot/app-client-backup`
**Dependencies**: Phase 1–4 complete
**Duration**: ~25 minutes
**Parallelization**: All five in parallel

### 5.1 Code Migration

Subagents upgrade each app independently. app-backend is the most complex (1,600+ Effect.gen uses); others are lighter.

### 5.2 Per-App Verification

```bash
cd apps/app-backend && bun run test check
cd apps/app-client && bun run test check
cd apps/website && bun run test check
cd apps/browser-extension && bun run test check
cd apps/app-client-backup && bun run test check
```

**Expected**: All pass. If app-backend fails:

- Likely cause: missed rename in workflow orchestration code
- **PAUSE**: Report with file/line references

---

## Phase 6: Plugins

**Packages**: `@ryot/plugin-fitness`, `@ryot/plugin-media`
**Dependencies**: Phase 1–5 complete
**Duration**: ~10 minutes
**Parallelization**: Both in parallel

### 6.1 Code Migration

Subagents upgrade plugin source.

### 6.2 Per-Plugin Verification

```bash
cd apps/plugin-fitness && bun run test check
cd apps/plugin-media && bun run test check
```

**Expected**: Pass.

---

## Phase 7: Integration Tests

**Package**: `tests`
**Dependencies**: Phase 1–6 complete
**Duration**: ~10 minutes

### 7.1 Code Migration

Subagent upgrades test package.

### 7.2 Verification

```bash
cd tests && bun run test
```

**Expected**: Pass. If failures, likely affect-specific test utilities need renames.

---

## Post-Migration Checklist

After all phases complete and user verifies with e2e suite:

### 1. Remove Cleanup (if needed)

- Check for any dead code, unused imports, or comments added during migration
- Ensure no `// TODO: migration` markers left behind

### 2. Verify Documentation

- Update `docs/effect-workflow-guide.md` if any import paths or API references changed (e.g., `effect/unstable/workflow/Workflow` instead of `@effect/workflow/Workflow`)
- Confirm any other `docs/` examples still compile

### 3. Final Build

```bash
bun turbo build
```

### 4. Create Summary Commit (User Decision)

Once user confirms e2e suite passes, create a single commit:

```bash
git add .
git commit -m "chore: upgrade effect ecosystem to 4.0.0-beta.102

Consolidate to unified v4 versioning and reorganized package structure:

Upgraded:
- effect@4.0.0-beta.102 (was 3.21.4)
- @effect/platform@4.0.0-beta.102 (was 0.96.2)
- @effect/platform-bun@4.0.0-beta.102 (was 0.90.0)
- @effect/sql-pg@4.0.0-beta.102 (was 0.52.1)
- @effect/opentelemetry@4.0.0-beta.102 (was 0.63.0)

Removed (consolidated into effect@4.0.0-beta.102):
- @effect/workflow (import from effect/unstable/workflow/*)
- @effect/cluster (import from effect/unstable/cluster/*)
- @effect/experimental (import from effect/unstable/eventlog/*, effect/unstable/persistence/*, etc.)
- @effect/rpc (import from effect/unstable/rpc/*)

Changes:
- 43 import path renames (package consolidation + unstable modules)
- 53 API renames (Effect.async→callback, Either→Result, catchAll→catch, etc.)
- All packages now released together with unified version number"
```

---

## Subagent Invocation

### Template: Phase 3 Subagent (Critical)

This is the only subagent invocation; all other phases are manual or dependent on Phase 3 completion.

```txt
description: "Migrate all code to Effect 4.0.0-beta.102 (Phase 3)"

prompt: """
Perform a repository-wide code migration for Effect 4.0.0-beta.102.

Location: /Users/diptesh/Desktop/Personal/ryot

Tasks:

1. **Import Path Renames**: Apply all ~86 import path renames from /tmp/effect/migration/v3-to-v4.md across all `.ts`/`.tsx` files:
   - Platform (~28 renames): @effect/platform/* → effect/* (e.g., effect/FileSystem) or effect/unstable/* (e.g., effect/unstable/http/HttpClient)
   - Workflow (8 renames): @effect/workflow/* → effect/unstable/workflow/*
   - Cluster (35 renames): @effect/cluster/* → effect/unstable/cluster/*
   - Experimental (~15 renames): @effect/experimental/* → effect/unstable/*(eventlog|persistence|reactivity|...)

2. **API Renames**: Apply all 53 API renames from /tmp/effect/migration/v3-to-v4.md:
   - Effect.* renames (Effect.async→callback, Effect.zipRight→andThen, Effect.catchAll→catch, etc.)
   - Layer.* renames (Layer.scoped→effect, etc.)
   - Stream.* renames (Stream.repeatEffect→fromEffectRepeat, etc.)
   - Type renames (Either→Result, Mailbox→Queue, etc.)
   - See the "API Renames" section of v3-to-v4.md for the complete list

3. **Report**:
   - Total files scanned
   - Files modified (count)
   - Any import paths that could not be resolved (report file + line)
   - Any API calls that look suspicious or non-mechanical (report file + line)
   - Any patterns from the migration guide that were skipped

4. **Do NOT run tests**. Do not run `bun run test check`. Human will verify after your changes.

Use /tmp/effect/migration/v3-to-v4.md as the authoritative source for all renames.
"""
```

### Subagent Collection

After all subagents in a phase complete, collect results:

```txt
- Phase X: N files updated across M packages
- Issues: [list, or "none"]
- Ready for verification: yes/no
```

If any subagent reports issues, **PAUSE** and surface to user.

---

## Decision Points (User Pauses)

The following **MUST** pause migration and ask user:

1. **Type errors after Phase 1**: Any `bun run test check` failure → show error, ask "proceed with manual fixes or investigate?"
2. **Workflow/Cluster errors in Phase 3**: Any issue in app-backend tests → "inspect manually or restart?"
3. **Plugin errors in Phase 6**: Any test failure → "acceptable, revert, or investigate?"
4. **E2E suite**: After Phase 7, user runs full e2e suite manually. **Do not run it ourselves.**

---

## Abort Conditions (Stop Entirely)

- **Phase 1 fails to compile**: Core Effect changes broke build. Likely upstream issue; stop and report.
- **Phase 3 workflow code breaks**: Unlikely; indicates custom patterns incompatible with v4. Stop and ask user.
- **Multiple phases accumulate errors**: Stop at first blocky error; do not proceed speculatively.

---

## Timeline Estimate

- Phase 1 (Core upgrade): 10 min
- Phase 2 (Platform packages): 5 min
- Phase 3 (Package removal + code migration): 40 min ⚠️ CRITICAL PHASE
- Phase 4 (Libraries): 20 min (parallel)
- Phase 5 (Apps): 25 min (parallel)
- Phase 6 (Plugins): 10 min (parallel)
- Phase 7 (Tests): 10 min
- User e2e validation: 10–30 min (not our responsibility)

**Total agent time**: ~2 hours
**Total wall time**: ~1.5 hours (phases 4–6 can overlap during Phase 3 verification, but typically sequential)

**Critical Path**: Phase 1 → Phase 2 → Phase 3 (blocker) → Phase 4 → Phase 5 → Phase 6 → Phase 7

---

## Files Affected

**Largest exposure** (files with Effect imports):

- `apps/app-backend/src`: ~300 files, 1,600+ Effect.gen uses
- `apps/app-client/src`: ~80 files
- `libs/contract/src`: ~30 files
- `libs/sandbox-sdk/src`: ~20 files (re-exports)
- Plugins: ~40 files total
- Tests: ~60 files

**Total**: ~600 files, 595 imports to rename, 1,985 instances of Effect APIs

---

## Recovery & Rollback

**No explicit rollback plan** (per requirements). If unrecoverable error:

- User can `git checkout effect` to restore v3 dependencies manually
- Revert lock file
- Restart migration

---

## Success Criteria

✅ All 7 phases complete with no unresolved errors
✅ `bun turbo --filter=@ryot/app-backend test check` passes
✅ User confirms e2e suite passes (manual validation)
✅ All packages pinned to `4.0.0-beta.102`
✅ No dead code or migration artifacts left behind

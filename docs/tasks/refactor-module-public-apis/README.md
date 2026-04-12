# Refactor: Module Public APIs via Barrel Files

## Problem

Every feature module under `modules/` and every shared library under `lib/` exposes its full internal
file structure to all callers. There are no `index.ts` files enforcing a public contract per module.
Callers import directly from sub-paths:

```typescript
// lib/views/definition.ts — reaches into 4 separate module internals
import { propertySchemaObjectSchema } from "~/modules/property-schemas/schemas";
import { QueryEngineRequest }         from "~/modules/query-engine/schemas";
import { SavedViewQueryDefinition }   from "~/modules/saved-views/schemas";
import { buildQuerySql }              from "~/modules/query-engine/query-builder";

// modules/authentication/bootstrap/manifests.ts
import { createDefaultDisplayConfiguration } from "~/modules/saved-views/constants";

// lib/sandbox/host-functions/get-entity-schemas.ts
import { listEntitySchemas } from "~/modules/entity-schemas/service";
```

There are **35+ cross-module sub-path imports** across the codebase (excluding `app/api.ts` which is
the composition root). The key coupling points:

| Caller                                             | Target sub-paths crossed                                                                                |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `lib/views/definition.ts`                          | `saved-views/schemas`, `query-engine/schemas`, `query-engine/query-builder`, `property-schemas/schemas` |
| `lib/views/validator.ts`                           | `saved-views/schemas`, `query-engine/schemas`                                                           |
| `lib/test-fixtures/*.ts`                           | `*/schemas`, `*/service` for every module                                                               |
| `lib/sandbox/host-functions/get-entity-schemas.ts` | `entity-schemas/service`                                                                                |
| `modules/authentication/bootstrap/manifests.ts`    | `saved-views/constants`                                                                                 |
| `modules/media/service.ts`                         | `query-engine/schemas`                                                                                  |

**Consequences:**

- Renaming or splitting an internal file (e.g., splitting `saved-views/schemas.ts`) requires
  updating every caller that reached into it — with no tooling to find them all reliably.
- There is no defined contract for "what is the public API of the saved-views module?" A developer
  must read all its internal files to know what's available.
- Repository functions are unintentionally accessible cross-module, enabling callers to bypass the
  service layer.
- Tests import internal types (`ServiceDeps`, internal schemas) directly, tying test stability to
  internal file structure.

## Proposed Interface

Each module gets an `index.ts` that is its only public face. The API is caller-optimized: it
re-exports types, service functions, and factory constants that other modules genuinely need.
Repository functions are **never** part of a module's public API.

### Shape of a module `index.ts`

```typescript
// modules/saved-views/index.ts
export type {
  ListedSavedView,
  CreateSavedViewBody,
  UpdateSavedViewBody,
  SavedViewQueryDefinition,
  DisplayConfiguration,
  EventJoinDefinition,
  GridConfig,
  ListConfig,
  TableConfig,
  SortDefinition,
} from "./schemas";

export {
  createSavedView,
  updateSavedView,
  deleteSavedView,
  cloneSavedView,
  reorderSavedViews,
  resolveSavedViewName,
  buildBuiltinSavedViewName,
} from "./service";

export type { SavedViewServiceDeps, SavedViewServiceResult } from "./service";

export {
  createDefaultDisplayConfiguration,
  createDefaultQueryDefinition,
} from "./constants";

// Routes are NOT re-exported here. app/api.ts imports routes directly.
```

### What callers look like after migration

```typescript
// lib/views/definition.ts — before
import { propertySchemaObjectSchema }              from "~/modules/property-schemas/schemas";
import { QueryEngineRequest, QueryEngineResponse } from "~/modules/query-engine/schemas";
import { SavedViewQueryDefinition }                from "~/modules/saved-views/schemas";

// lib/views/definition.ts — after
import { propertySchemaObjectSchema }              from "~/modules/property-schemas";
import type { QueryEngineRequest }                 from "~/modules/query-engine";
import type { SavedViewQueryDefinition }           from "~/modules/saved-views";
```

```typescript
// modules/authentication/bootstrap/manifests.ts — before
import { createDefaultDisplayConfiguration } from "~/modules/saved-views/constants";

// after
import { createDefaultDisplayConfiguration } from "~/modules/saved-views";
```

```typescript
// lib/test-fixtures/saved-views.ts — before
import type { ListedSavedView }    from "~/modules/saved-views/schemas";
import type { SavedViewServiceDeps } from "~/modules/saved-views/service";

// after
import type { ListedSavedView, SavedViewServiceDeps } from "~/modules/saved-views";
```

### What complexity the interface hides

- Which file inside a module contains a given function or type
- Internal type variants (e.g., stored vs. runtime schema shapes)
- The existence of repository functions as a separate layer
- Dependency injection types that test consumers need but production callers do not

### Exemption: `app/api.ts`

`app/api.ts` is the composition root. It intentionally imports `routes.ts` from each module to
mount Hono routers. Routes are NOT re-exported through `index.ts` — they are a presentation
concern, not domain API.

## Dependency Strategy

**In-process.** All modules are compiled together in a single process. There is no network boundary
to cross. The barrel files are purely a structural/navigability improvement — no runtime change.

The TypeScript path alias `~/modules/saved-views` already resolves to the module directory.
Adding an `index.ts` makes it resolve to that file automatically with zero tsconfig changes.

## Testing Strategy

**New boundary tests to write:** None needed. This is a structural refactor — no logic changes.
Existing tests remain valid; only their import paths change.

**Old tests to delete:** None.

**Test environment needs:** After migration, run the full test suite once to verify import
resolution is correct.

## Implementation Recommendations

### What each barrel owns

- **Exports**: types, service functions, factory/constant functions that cross-module callers need
- **Hides**: repository functions, internal schema variants, route handlers, implementation utilities
- **Never exports**: anything from `repository.ts` — force callers through the service layer

### Migration order (safest to riskiest)

1. Create `index.ts` for all `modules/` first (they have the most callers)
   - `saved-views` — most imported module
   - `entity-schemas`, `event-schemas`, `property-schemas`
   - `query-engine` (includes `query-builder` re-export)
   - remaining modules
2. Update `lib/test-fixtures/*.ts` — high churn, low risk
3. Update `lib/views/definition.ts` and `lib/views/validator.ts` — core logic, needs careful review
4. Update `lib/sandbox/host-functions/` and `modules/authentication/bootstrap/`
5. Consider adding `lib/views/index.ts` to barrel the views library as well

### What each module should expose via `index.ts`

| Module             | Types                                                                                                                     | Service fns                                                                                         | Factories/Constants                                                 |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `saved-views`      | `ListedSavedView`, `DisplayConfiguration`, `SavedViewQueryDefinition`, `EventJoinDefinition`, `*Config`, `SortDefinition` | `create/update/delete/clone/reorderSavedViews`, `resolveSavedViewName`, `buildBuiltinSavedViewName` | `createDefaultDisplayConfiguration`, `createDefaultQueryDefinition` |
| `entity-schemas`   | `ListedEntitySchema`, `CreateEntitySchemaBody`                                                                            | `listEntitySchemas`, `createEntitySchema`, `getEntitySchemaById`, validation helpers                | —                                                                   |
| `query-engine`     | `QueryEngineRequest`, `QueryEngineResponseData`                                                                           | `executeQuery`                                                                                      | —                                                                   |
| `property-schemas` | property schema types                                                                                                     | `parseLabeledPropertySchemaInput`                                                                   | —                                                                   |
| `entities`         | `ListedEntity`, `CreateEntityBody`                                                                                        | `createEntity`, `listEntities`, `getEntityById`                                                     | —                                                                   |
| `events`           | `ListedEvent`, `CreateEventBody`                                                                                          | `createEvent`, `listEvents`                                                                         | —                                                                   |
| `event-schemas`    | `ListedEventSchema`                                                                                                       | `listEventSchemas`, `createEventSchema`                                                             | —                                                                   |
| `trackers`         | `ListedTracker`                                                                                                           | `listTrackers`, `createTracker`                                                                     | —                                                                   |
| `sandbox`          | `SandboxScript`                                                                                                           | `executeScript`, `createScript`                                                                     | —                                                                   |
| `media`            | types                                                                                                                     | `getMediaOverview`                                                                                  | —                                                                   |
| `uploads`          | —                                                                                                                         | `getUploadUrl`                                                                                      | —                                                                   |
| `system`           | —                                                                                                                         | `getHealth`                                                                                         | —                                                                   |
| `authentication`   | —                                                                                                                         | `registerUser`, bootstrap fns                                                                       | —                                                                   |

### Callers must migrate

After barrel files exist, every cross-module import must go through `index.ts`. For the migration,
a ripgrep search-and-replace is sufficient:

```bash
# Example: migrate saved-views sub-path imports
rg 'from "~/modules/saved-views/(service|schemas|constants)"' -l
# then update each file to import from "~/modules/saved-views"
```

---

## Tasks

**Overall Progress:** 3 of 3 tasks completed

**Current Task:** All tasks completed

### Task List

| #   | Task                                                                                      | Type | Status      | Blocked By       |
| --- | ----------------------------------------------------------------------------------------- | ---- | ----------- | ---------------- |
| 01  | [Create barrel files for high-traffic modules](./01-barrel-files-high-traffic-modules.md) | AFK  | completed   | None             |
| 02  | [Create barrel files for remaining modules](./02-barrel-files-remaining-modules.md)       | AFK  | completed   | None             |
| 03  | [Migrate all callers to barrel imports](./03-migrate-callers-to-barrel-imports.md)        | AFK  | completed   | Task 01, Task 02 |

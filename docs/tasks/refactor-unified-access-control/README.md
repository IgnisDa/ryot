# Refactor: Unified Access Control Framework

## Problem

Access control logic is scattered across 4+ modules with similar but slightly different implementations:

- `lib/app/entity-schema-access.ts`: `resolveEntitySchemaReadAccess`, `resolveCustomEntitySchemaAccess`
- `modules/trackers/access.ts`: `resolveTrackerReadAccess`, `resolveCustomTrackerAccess`
- `modules/events/service.ts`: `resolveEntityEventAccess`, `resolveEventCreateAccess`
- `modules/entities/service.ts`: `resolveEntityDetailAccess`

### Current Architectural Friction

1. **Duplicated Patterns**: Every module reimplements the same checks ("not_found", "builtin") with slightly different error types and return shapes
2. **Integration Risk**: When adding a new resource type, developers must understand and replicate patterns from multiple existing modules
3. **Testing Overhead**: Each access function requires its own test file (`entity-schema-access.test.ts`, `events/access.test.ts`) with nearly identical test cases
4. **Error Mapping Boilerplate**: Every call site maps access errors to ServiceResult errors, adding 5-10 lines of conversion code per access check
5. **Cognitive Load**: Understanding access control requires bouncing between 4+ files to see all variations

### Tight Coupling

The current pattern couples access control tightly to:
	ResourceScope,
- Specific resource types (entities, trackers, events)
- Specific error code strings (`"not_found"`, `"builtin"`, `"event_schema_mismatch"`)
- Service layer error handling patterns

## Proposed Interface

### Design Choice: Optimized for Common Case

We adopt **Design #3** (Optimized) with hybrid elements from Design #1:

**Core Principle**: The 80% case should be one line. The 20% case should be explicit.

### Interface Signature

```typescript
// lib/access/types.ts
export type AccessError = "not_found" | "forbidden" | "builtin_resource";

export type AccessResult<T, E extends string = AccessError> =
  | { data: T }
  | { error: E; message: string };

export type ResourceScope = {
  id: string;
  userId: string;
  isBuiltin: boolean;
};

export type AccessRule<T> = {
  test: (scope: T) => boolean;
  error: AccessError;
  message: string;
};

export type AccessCheck<T extends ResourceScope> = {
  scope: T | undefined;
  requireCustom?: boolean;
  rules?: AccessRule<T>[];
  messages?: Partial<Record<AccessError, string>>;
};

// lib/access/index.ts
export const checkAccess: <T extends ResourceScope>(
  check: AccessCheck<T>
) => AccessResult<T, AccessError>;

export const checkReadAccess: <T extends ResourceScope>(
  scope: T | undefined,
  messages?: Partial<Record<AccessError, string>>
) => AccessResult<T>;

export const checkCustomAccess: <T extends ResourceScope>(
  scope: T | undefined,
  messages?: Partial<Record<"not_found" | "builtin_resource", string>>
) => AccessResult<T, "not_found" | "builtin_resource">;
```

### Usage Example

**Before (current scattered pattern):**

```typescript
// modules/entities/service.ts
const foundEntity = resolveEntityDetailAccess(
  await deps.getEntityScopeForUser({ entityId, userId })
);
if ("error" in foundEntity) {
  return serviceError(
    foundEntity.error === "not_found" ? "not_found" : "validation",
    foundEntity.error === "not_found" ? entityNotFoundError : customEntityDetailError
  );
}

// modules/events/service.ts
const foundScope = resolveEventCreateAccess(
  await deps.getEventCreateScopeForUser({ userId, entityId, eventSchemaId })
);
if ("error" in foundScope) {
  return resolveCreateAccessMessage(foundScope.error); // Helper needed!
}
```

**After (unified pattern):**

```typescript
// modules/entities/service.ts
import { checkCustomAccess } from "~/lib/access";

const entityResult = checkCustomAccess(
  await deps.getEntityScopeForUser({ entityId, userId }),
  { builtin_resource: "Built-in entities do not support detail pages" }
);
if ("error" in entityResult) {
  return entityResult; // Direct pass-through - same shape as ServiceResult!
}

// modules/events/service.ts
import { checkAccess } from "~/lib/access";

const eventResult = checkAccess({
  scope: await deps.getEventCreateScopeForUser({ userId, entityId, eventSchemaId }),
  rules: [
    {
      test: (s) => s.eventSchemaId != null,
      error: "not_found",
      message: "Event schema not found"
    },
    {
      test: (s) => s.eventSchemaEntitySchemaId === s.entitySchemaId,
      error: "forbidden",
      message: "Event schema does not belong to this entity"
    }
  ]
});
if ("error" in eventResult) {
  return eventResult; // Direct pass-through!
}
```

### What Complexity It Hides

1. **Multiple return shapes** → Unified `AccessResult<T>` always returns `{ data: T } | { error: E; message: string }`
2. **Error mapping boilerplate** → Error messages configurable via `messages` option, with sensible defaults
3. **Rule chaining logic** → Sequential rule evaluation with early return on first failure
4. **Builtin vs custom checks** → `requireCustom: true` flag handles this common case
5. **Access-to-ServiceResult conversion** → Same shape means direct pass-through, no conversion needed
6. **Discriminated union narrowing** → Standard `{ data } | { error }` pattern works with TypeScript control flow

## Dependency Strategy

**Category: In-process**

The access control framework is pure computation with no I/O:
- No database dependencies (scope objects are passed in from repositories)
- No external service calls
- No filesystem or network operations

**Implementation location**: `lib/access/` directory with zero dependencies on other modules

**Dependency flow**:
```
lib/access/
├── types.ts          # Core types (zero dependencies)
├── index.ts          # Main checkAccess function (zero dependencies)
└── resources.ts      # Optional: Pre-configured checks for common resources

Modules depend on lib/access:
- modules/entities/service.ts → checkCustomAccess
- modules/events/service.ts → checkAccess with rules
- modules/trackers/service.ts → checkCustomAccess
- modules/entity-schemas/service.ts → checkReadAccess
```

**No circular dependencies**: `lib/access` has zero dependencies on:

- modules (avoids circular deps)
- repositories (scope is passed in)
- result.ts (same shape, but no import needed)

## Testing Strategy

### New Boundary Tests to Write

Create `lib/access/index.test.ts` covering:

1. **Existence check**: Returns `not_found` error when scope is undefined
2. **Custom check**: Returns `builtin_resource` when `requireCustom: true` and scope is builtin
3. **Custom rules**: Evaluates rules sequentially, returns first failure
4. **Success case**: Returns scope as `data` when all checks pass
5. **Error messages**: Uses custom messages when provided, defaults otherwise
6. **Type inference**: Properly narrows types for different error sets

### Old Tests to Delete

After migration is complete:

- `lib/app/entity-schema-access.test.ts` → delete (functionality covered by unified tests)
- `modules/events/access.test.ts` → delete (functionality covered by unified tests)
- `modules/trackers/access.test.ts` → create then delete after migration

### Test Environment Needs

No special environment needs - pure functions tested with:

- No database required
- No external services
- Standard Bun test runner

## Implementation Recommendations

### Module Responsibilities

**`lib/access` should own:**

1. Access control decision logic (existence, custom vs builtin, custom rules)
2. Error message defaults and customization
3. Type-safe result shapes
4. Rule evaluation order and short-circuiting

**`lib/access` should hide:**

1. Specific resource type knowledge (entities, trackers, events are all just scopes)
2. Repository implementation details
3. Service layer error mapping conventions
4. Internal rule evaluation mechanics

**`lib/access` should expose:**

1. `checkAccess()` - the main entry point for complex checks
2. `checkReadAccess()` - convenience for simple existence checks
3. `checkCustomAccess()` - convenience for custom-only operations
4. Type definitions for `AccessResult`, `AccessCheck`, `AccessRule`, `ResourceScope`

### Caller Migration Guide

**Phase 1: Create the framework**

1. Create `lib/access/types.ts` with type definitions
2. Create `lib/access/index.ts` with `checkAccess`, `checkReadAccess`, `checkCustomAccess`
3. Write comprehensive tests in `lib/access/index.test.ts`

**Phase 2: Migrate modules (one at a time)**

For each module:

1. Replace `resolve*Access` calls with unified functions
2. Update service functions to use direct pass-through pattern
3. Run tests to verify behavior unchanged
4. Delete old `resolve*Access` functions once no longer used

**Migration pattern for services:**

```typescript
// BEFORE:
const access = resolveEntityDetailAccess(scope);
if ("error" in access) {
  return serviceError(
    access.error === "not_found" ? "not_found" : "validation",
    access.error === "not_found" ? entityNotFoundError : customEntityDetailError
  );
}

// AFTER:
const result = checkCustomAccess(scope, {
  builtin_resource: "Built-in entities do not support detail pages"
});
if ("error" in result) {
  return result; // Direct pass-through
}
```

**Phase 3: Cleanup**

1. Delete `lib/app/entity-schema-access.ts`
2. Delete `modules/trackers/access.ts`
3. Delete old test files
4. Update any documentation referencing old patterns

### Type-Specific Scope Extensions

For complex scopes (like event create), extend the base pattern:

```typescript
// modules/events/types.ts
type EventCreateScope = ResourceScope & {
  eventSchemaId: string | null;
  eventSchemaName: string | null;
  eventSchemaSlug: string | null;
  propertiesSchema: unknown;
  eventSchemaEntitySchemaId: string | null;
  entitySchemaId: string;
};

// Usage in service.ts
const result = checkAccess<EventCreateScope>({
  scope: eventCreateScope,
  rules: [
    {
      test: (s) => s.eventSchemaId != null,
      error: "not_found",
      message: "Event schema not found"
    }
  ]
});
```

## Status

- [x] RFC accepted
- [x] Implementation started
- [x] Implementation complete
- [x] Old tests deleted
- [x] New boundary tests written
- [x] Typecheck passes

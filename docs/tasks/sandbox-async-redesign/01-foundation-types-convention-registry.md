# Foundation: Types, Convention, and Registry

**Parent Plan:** [Sandbox Async Redesign](./README.md)

**Type:** AFK

**Status:** done

## What to build

Establish the shared type system and static function registry that all subsequent tasks depend on. This slice has no API or queue changes — it is purely an internal refactor of the sandbox type layer and the three existing host functions.

Specifically:

- Add `HostFunction<TContext>` (a generic type alias enforcing the context-first convention) and `ApiFunctionDescriptor` (the serializable descriptor type) to `types.ts`. Remove or rename the old `ApiFunction` type to align with the new convention.
- Migrate all three existing host functions (`httpCall`, `getAppConfigValue`, `getUserConfigValue`) to the context-first signature. All three have no per-request state, so their context type is `Record<string, never>` and the factory wrapper in the registry uses `(_ctx) => (...args) => fn(...args)`.
- Create `src/lib/sandbox/function-registry.ts` exporting a `hostFunctionRegistry` object that maps each `functionKey` string to its factory. The registry type must be checked against the `HostFunction` convention so violations are caught at compile time.
- Write unit tests for all three host functions and for the registry itself.

See the **Host function convention**, **Function descriptor type**, and **Static function registry** sections of the parent PRD for the precise type shapes and factory patterns.

## Acceptance criteria

- [ ] `HostFunction<TContext>` and `ApiFunctionDescriptor` types exist in `types.ts` and are exported.
- [ ] All three existing host functions accept `context` as their first parameter (typed `Record<string, never>`).
- [ ] `function-registry.ts` exports `hostFunctionRegistry` containing entries for `httpCall`, `getAppConfigValue`, and `getUserConfigValue`.
- [ ] The registry's TypeScript type prevents registering a function with the wrong signature (compile-time check).
- [ ] Unit tests pass for all three host functions: valid inputs return the expected `apiSuccess` shape; invalid inputs return `apiFailure`; error paths are covered.
- [ ] Unit tests pass for the registry: every registered key resolves to a callable factory; calling a factory with an empty context returns a function; an unknown key lookup (simulating what `executeQueuedRun` will do) can be shown to return `undefined`.
- [ ] `bun run typecheck`, `bun test`, and `bun run lint` pass in `apps/app-backend`.

## Blocked by

None — can start immediately.

## User stories addressed

- User story 1 (uniform context-first signature enforced by type system)
- User story 2 (add a new function by implementing + registering in one place)
- User story 3 (job payload is fully self-contained JSON — types make this possible)
- User story 4 (per-request data flows through typed context)
- User story 5 (unknown `functionKey` path — registry returns `undefined` for unknown keys)

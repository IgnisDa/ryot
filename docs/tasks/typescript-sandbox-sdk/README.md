# TypeScript Sandbox SDK and Compilation

## Problem Statement

Ryot owns 61 sandbox JavaScript sources totaling 18,378 lines: 52 provider scripts, five trigger scripts, three shared helper fragments, and one Deno runner. The provider and trigger sources are imported into the backend as opaque text, helper fragments are concatenated as strings, and the Deno runner evaluates each stored script through a dynamically constructed function. TypeScript never checks the script bodies, injected host functions are untyped, driver input and output conventions are implicit, and external JSON commonly crosses the script boundary without a shared type contract.

The sandbox API also accepts user-authored source code. Long-term user-authored TypeScript is a product requirement, not merely a development convenience for built-in scripts. Users need the same driver contracts, host-function types, validation schemas, diagnostics, and execution semantics as Ryot's built-ins. The backend must compile untrusted TypeScript without executing it in the application process, persist the authored source separately from executable JavaScript, and continue to execute code inside the existing restricted Deno process boundary.

Ryot's end-to-end test package is also a sandbox-script consumer. Its sandbox, trigger, provider, import, translation, trending, and media-monitoring suites currently construct JavaScript `driver(...)` source strings, submit them through the script creation API, insert global provider rows containing raw JavaScript directly through SQL, and mutate stored script code directly for refresh scenarios. Those fixtures must migrate with the production format. The end-to-end package must exercise the authoritative TypeScript creation compiler rather than retaining legacy JavaScript strings or implementing a test-only compiler.

Simply renaming the existing fragments to TypeScript is insufficient. Deno currently receives script code as a string and passes it to dynamic function construction, which cannot parse TypeScript syntax. The current files are also function-body fragments rather than modules, and three helpers contain top-level returns that are invalid in ordinary TypeScript modules. A durable solution therefore requires a public sandbox SDK, real TypeScript module authoring, ahead-of-time compilation, a versioned internal compiled-module shape, typed host contracts, runtime validation, and explicit resource limits.

## Solution

Create a new workspace library named `@ryot/sandbox-sdk` that is shared by built-in scripts and user-authored scripts. It will expose typed script, provider, trigger, driver, manifest, host-function, schema, and testing APIs while remaining independent of backend, database, Bun, Node, and Deno infrastructure. It will be usable from the monorepo immediately and can be packaged for external publication later without changing its architecture.

Replace function-body fragments with ordinary TypeScript ES modules. Each module will export a static manifest and a script definition created through the SDK. Driver inputs and outputs will be declared with SDK-provided Zod schemas, and the inferred TypeScript types will flow into each driver implementation. Host methods visible to a driver will be restricted at compile time and runtime by the exact capabilities declared in its manifest.

Create a backend-owned sandbox compiler as a deep module. It will type-check source with the TypeScript compiler API, enforce the static manifest and import policies, bundle source into one JavaScript ES module with Bun, and return structured diagnostics or a compiled module. User compilation will use a virtual single-file project that can import only explicit SDK entry points. Built-in compilation will use the same compiler but may resolve trusted relative imports so shared helpers become ordinary modules.

The existing script database row remains the owner of a script. It will store the original TypeScript source, the compiled JavaScript module, the validated manifest metadata, and a minimal internal compiled-format number. There will not be a separate artifact row. The term "compiled module" means the emitted JavaScript plus its inline source map and validated manifest, not a database entity.

The existing script creation endpoint will be the only user-authoring endpoint in this phase. It will accept one TypeScript source file, compile it before persistence, return structured diagnostics on failure, and atomically persist only successful compilations. There will be no compile-only or update endpoint yet.

Migrate the end-to-end sandbox fixtures to generate complete single-file TypeScript modules with static manifests and SDK definitions. API-owned fixtures will submit that source through script creation. Fixtures that need global built-in rows will first create and compile a temporary user-owned script through the API, then promote the successfully compiled row or copy its compiled representation through SQL. This keeps compilation authoritative while preserving the test package's established ability to seed global rows that public APIs cannot create.

The Deno runner will load the compiled JavaScript as an in-memory ES module instead of evaluating a function-body fragment. It will validate the module definition, select the requested driver, validate driver input, construct a capability-filtered host object, execute the driver, validate the output, and return a structured result. TypeScript compilation will never occur during enqueueing or execution.

## User Stories

1. As a Ryot maintainer, I want every built-in sandbox script to be a normal TypeScript module, so that TypeScript can check its implementation during normal development.
2. As a Ryot maintainer, I want providers, triggers, and generic scripts to use explicit SDK definitions, so that their different contracts are visible and enforceable.
3. As a provider author, I want driver input types inferred from runtime schemas, so that validation and static types cannot silently diverge.
4. As a provider author, I want standard search, details, resolve, and translate result schemas, so that downstream backend consumers receive consistent values.
5. As a trigger author, I want before-create and after-create trigger contracts, so that invalid trigger return values are rejected before they affect event processing.
6. As a generic script author, I want to define custom driver names with explicit input and output schemas, so that the SDK does not restrict scripts to provider and trigger use cases.
7. As a script author, I want host functions to have typed arguments and results, so that incorrect calls fail during compilation rather than at runtime.
8. As a script author, I want the available host methods narrowed by declared capabilities, so that I cannot accidentally call a host function the runtime will not expose.
9. As a script author, I want a shared helper for unwrapping host success and failure results, so that host error handling is consistent without hiding failures.
10. As a script author, I want cache and configuration values to remain runtime-validated JSON values, so that generic type parameters cannot create false safety.
11. As a script author, I want approved libraries through explicit SDK imports, so that local type checking and Deno execution use the same exact dependency versions.
12. As a user, I want to submit one TypeScript source file to create a script, so that authoring does not require generating JavaScript myself.
13. As a user, I want compilation failures to include file, line, column, severity, diagnostic code, and message, so that I can correct my source.
14. As a user, I want a script row created only after successful compilation, so that an invalid script cannot be enqueued later.
15. As a user, I want runtime failures to identify whether loading, input validation, execution, or output validation failed, so that I can diagnose the correct layer.
16. As a user, I want runtime locations mapped back to my TypeScript source, so that generated JavaScript does not obscure errors.
17. As a user, I want my original TypeScript returned and stored rather than generated JavaScript, so that the authored source remains the editable representation.
18. As a user, I want the backend to compile source authoritatively, so that execution does not depend on my local compiler or SDK installation.
19. As a backend operator, I want compilation outside the main backend process, so that pathological source cannot exhaust the application process directly.
20. As a backend operator, I want strict source, compiled-module, context, bridge, network, log, result, and cache limits, so that user code cannot consume unbounded resources.
21. As a backend operator, I want a per-execution host-call budget, so that scripts cannot amplify load through tight bridge loops.
22. As a backend operator, I want upstream HTTP responses bounded while streaming, so that a remote server cannot force unbounded buffering.
23. As a backend operator, I want each Deno execution to retain the existing timeout and process isolation, so that TypeScript support does not weaken the sandbox.
24. As a backend operator, I want a Deno heap limit in addition to the existing timeout, so that memory-heavy scripts are terminated predictably.
25. As a backend operator, I want oversized logs truncated deterministically, so that diagnostic output remains useful without failing otherwise valid work.
26. As a backend operator, I want oversized final results rejected, so that workflow and API persistence cannot be flooded with script output.
27. As a security reviewer, I want user source restricted to SDK imports, so that compilation cannot resolve arbitrary files or packages from the backend installation.
28. As a security reviewer, I want manifests statically extracted without executing user source, so that requested capabilities are known before runtime.
29. As a security reviewer, I want sensitive application configuration denied to user scripts, so that the typed SDK does not broaden existing secret access.
30. As a security reviewer, I want compiled JavaScript treated as untrusted code, so that TypeScript types never replace Deno permissions or runtime validation.
31. As a built-in script maintainer, I want ordinary relative imports between trusted TypeScript modules, so that shared helpers no longer require string concatenation.
32. As a built-in script maintainer, I want all built-ins compiled by the same compiler as user source, so that the two execution formats cannot drift.
33. As a built-in script maintainer, I want compilation integrated with check, test, build, and development watch workflows, so that generated modules cannot become stale.
34. As a test author, I want SDK-provided typed host stubs, so that driver unit tests can focus on Ryot behavior rather than reconstructing runtime globals.
35. As a test author, I want every built-in compiled and loaded in Deno during CI, so that untested providers still receive format and module-shape coverage.
36. As a test author, I want direct TypeScript driver tests and compiled-module execution tests, so that both authoring behavior and production representation are verified.
37. As an SDK consumer, I want explicit public export paths, so that internal SDK files can be reorganized without accidentally expanding the public API.
38. As a future external SDK consumer, I want the SDK free of backend and runtime-specific dependencies, so that it can later be published and used in editors or standalone projects.
39. As a maintainer, I want the current latest approved package versions resolved and pinned exactly, so that fresh deployments execute reproducibly.
40. As a maintainer, I want a small internal compiled-format marker, so that incompatible persisted JavaScript fails clearly during beta even without a stable public SDK versioning policy.
41. As an end-to-end test author, I want sandbox fixtures to generate valid SDK-based TypeScript modules, so that E2E coverage exercises the same authoring contract exposed to users.
42. As an end-to-end test author, I want fake provider source builders for search, details, translate, generic, and trigger drivers, so that tests remain concise without concatenating legacy JavaScript registrations.
43. As an end-to-end test author, I want global provider fixtures compiled through the public creation flow before SQL promotion, so that the test package does not duplicate the production compiler.
44. As an end-to-end test author, I want compilation failures asserted at script creation, so that syntax, import, manifest, and capability errors are tested at the correct lifecycle stage.
45. As an end-to-end test author, I want sandbox result assertions to understand structured execution errors, so that asynchronous failures remain actionable after the result contract changes.

## Implementation Decisions

### Current-State Replacement

- Replace all 61 JavaScript sandbox sources with TypeScript-authored equivalents.
- Providers, triggers, and user scripts become real ES modules rather than function-body fragments.
- The Deno runner becomes TypeScript-authored infrastructure and is compiled to JavaScript before execution.
- Remove dynamic function construction for script loading.
- Replace helper source concatenation with ordinary TypeScript imports bundled into each consuming built-in.
- Remove declarations that type sandbox JavaScript imports as opaque strings once no consumer needs them.
- Remove JavaScript-specific test import rewriting and raw-text test loading once compiled-module tests cover the new representation.
- Do not preserve a legacy JavaScript authoring or execution path.

### Public SDK Module

- Create the workspace package `@ryot/sandbox-sdk` under the shared libraries workspace.
- Keep the SDK runtime-neutral with ESNext and DOM types only. It must not import Bun, Node, Deno, backend services, database libraries, Redis libraries, or server configuration.
- Avoid a dependency from the SDK to the application contract package. Sandbox-facing shapes belong to the SDK, while backend HTTP contracts remain in the application contract package.
- Expose explicit public entry points for the core API, provider contracts, trigger contracts, testing utilities, and each approved runtime dependency. Do not expose a wildcard subpath.
- Export the SDK's Zod instance from the approved SDK surface so source schemas and inferred types use one pinned version.
- Expose definition helpers for static manifests, generic scripts, providers, triggers, and drivers.
- Expose JSON-value, host-result, execution metadata, driver context, standard provider result, and trigger-result schemas and inferred types.
- Expose typed test helpers for invoking definitions with capability-checked host stubs.
- Keep compiler implementation, artifact persistence, Deno loading, and host bridge dispatch outside the SDK.
- Configure the package for workspace source consumption initially. Publication packaging is deferred, but the public surface must already be suitable for later declaration and ESM output.

### Dependency Policy

- Pin Zod to `4.4.3`, Day.js to `1.11.21`, Cheerio to `1.2.0`, and youtubei.js to `17.2.0`. These were the current latest registry versions when this PRD was written.
- Include the Day.js custom parse format plugin through the approved Day.js SDK entry point.
- Scripts import approved libraries only through explicit SDK entry points, never through direct npm or Deno npm specifiers.
- The compiler maps approved SDK library imports to exact, versioned runtime modules available to Deno.
- Build runtime dependency modules ahead of execution and expose them through a Deno import map rooted in a read-only runtime directory.
- Deno must continue to run without remote module access. Runtime dependency resolution must not contact a registry.
- Verify and adapt existing youtubei.js integrations to the pinned release because its API and type surface may differ from the currently cached version.

### Static Manifest

- Every source module exports one manifest created through the SDK's manifest helper.
- The manifest is the source of truth for name, slug, script kind, exact host capabilities, required application configuration keys, and optional provider information.
- Provider information contains the external source identifier and optional canonical language.
- Trigger definitions additionally declare whether they implement before-create or after-create behavior so the SDK can assign the correct output contract.
- The compiler extracts the manifest through the TypeScript syntax tree without evaluating module code.
- Manifest data must be JSON-safe literals. Reject computed property names, spreads, function calls other than the manifest helper, and values derived from runtime expressions.
- Validate names, slugs, capability names, provider information, and required configuration keys before compilation succeeds.
- Do not infer capabilities from host-method usage. Explicit declaration remains mandatory and auditable.
- At runtime, expose only the intersection of declared capabilities and server-approved host functions.

### Driver Contracts

- Generic scripts define a record of driver names. Every driver declares a Zod input schema, a Zod output schema, and an asynchronous run function.
- The driver run function receives validated input, a capability-filtered host object, and execution metadata containing stored metadata and the sandbox script identifier.
- The generic script definition must support arbitrary JSON-serializable driver results after output-schema validation.
- Provider definitions standardize `search`, `details`, `resolve`, and `translate` drivers while allowing a provider to implement only the drivers it supports.
- The standard search result contains an `items` array. Each item contains a non-empty external identifier, a non-empty text title property, and an optional primary subtitle that is either a null property or a numeric property.
- The standard details result contains a name and properties, plus optional recursive child entities and optional related-entity groups.
- A child entity contains name, external identifier, properties, entity-schema slug, and optional nested child entities.
- A related-entity group contains authoritative or additive synchronization, a relationship-schema slug, incoming or outgoing direction, and related entities. Each related entity contains name, external identifier, script slug, and optional relationship properties.
- The standard resolve result contains a nullable external identifier.
- The standard translate result contains optional nullable name and optional nullable property overlay.
- Before-create triggers return one of allow, skip with a reason, or replace with a replacement body.
- After-create triggers return no value after performing any allowed side effects.
- Runtime input validation happens before driver execution. Runtime output validation happens before result serialization.
- Backend Effect schemas remain the application trust-boundary decoders. They must be explicitly constrained to SDK-exported encoded types and covered by parity tests so SDK Zod schemas and Effect schemas cannot drift.

### Host Contract

- The SDK owns a typed map whose keys exactly match the existing host-function names.
- The exact capability names are `httpCall`, `getCachedValue`, `setCachedValue`, `claimCachedValue`, `getAppConfigValue`, `getEntity`, `getEntitySchema`, `getIntegration`, `getUserPreferences`, `listEventSchemas`, `listEvents`, `listIntegrations`, `createEvents`, and `executeQueryEngine`.
- Every host method returns a discriminated success or failure result. Success contains typed data. Failure contains a message and may contain typed failure details where the existing behavior needs them, such as an HTTP status.
- Provide an SDK helper that returns success data or throws an ordinary script error for authors who prefer exception-style handling.
- `httpCall` accepts method, URL, optional text body, and optional string headers. Success returns response body text, status, and headers. Non-success HTTP responses return a host failure that includes the status.
- `getCachedValue` returns a JSON value or null. `setCachedValue` accepts a JSON value and positive integer TTL. These values remain scoped to the current server run and script.
- `claimCachedValue` accepts a key, JSON value, and positive integer TTL. It returns whether the persistent claim was acquired and, when not acquired, the existing JSON value or null.
- `getAppConfigValue` returns an untrusted JSON value that the script must parse. Existing policy remains: user scripts cannot read sensitive configuration, while built-ins may read declared sensitive provider configuration.
- `getEntity`, `getEntitySchema`, `getIntegration`, `listEventSchemas`, `listEvents`, and `listIntegrations` use SDK-owned serialized schemas matching the current backend responses.
- `getUserPreferences` returns normalized `isNsfw` and `disableIntegrations` booleans.
- `listEvents` accepts optional entity identifier, event-schema slug, and session-entity identifier filters.
- `listIntegrations` accepts optional supported provider and disabled-state filters.
- `createEvents` accepts the public event-creation item shape and returns the backend creation summary.
- `executeQueryEngine` accepts the public query document. Its result remains unknown because the query document controls the dynamic result shape; callers must parse it with a script-owned schema.
- Cache values, application configuration, query results, and arbitrary entity properties must not expose unchecked generic return types.
- The backend host registry must satisfy the SDK host implementation map before conversion to the dynamic bridge record. Unknown argument arrays remain only at the final RPC dispatch boundary.
- Preserve existing user-scope checks for host methods that require a user and existing script-scope checks for cache and configuration methods.

### Compiler Module

- Implement one backend-owned `SandboxCompiler` deep module used by user script creation and built-in generation.
- The compiler's user-facing operation accepts a single source string and returns either structured diagnostics or a compiled module containing JavaScript, an inline source map, a validated manifest, and internal compiled format `1`.
- The compiler's trusted built-in operation accepts multiple filesystem entries and may resolve relative imports between trusted modules.
- Type-check with the TypeScript compiler API using an isolated virtual project for user source.
- Do not apply the backend's Effect language-service rules to user source. Use a dedicated strict compiler configuration targeting modern ECMAScript and ES modules with web-standard libraries.
- Compile with strict checking, unchecked-index protection, exact optional properties, and no implicit returns. SDK definitions provide contextual types for driver implementations.
- Bundle with Bun into one ESM module per script using the browser target, disabled code splitting, disabled minification, and an inline source map.
- Bundle local helper imports and the small SDK definition runtime into the emitted module.
- Leave only approved, compiler-mapped SDK runtime imports external. Reject any unapproved static import, direct npm import, Deno npm import, Node import, Bun import, or computed dynamic import.
- User compilation uses one logical source filename and no relative imports. Built-ins may have multiple trusted source files through relative imports but still emit one module per script.
- Do not execute user source in the backend during parsing, type checking, manifest extraction, or bundling.
- Run user compilation outside the main backend process with a wall-clock timeout and bounded concurrency. Production process or container supervision must enforce the compiler memory budget.
- Cap returned diagnostics and diagnostic bytes so one invalid source cannot create an unbounded error response.
- Compilation success requires no TypeScript errors, a valid static manifest, a valid import graph, and an emitted module within the compiled-size limit.

### Compiled Module and Persistence

- Use "compiled module" as the implementation term instead of "artifact" unless referring generically to build output.
- The compiled module is derived data, not a separate database entity.
- Replace the script row's single source-code field with separate required TypeScript source and compiled JavaScript fields.
- Continue storing validated manifest metadata as JSON on the script row. Store name and slug from the manifest in their existing indexed columns.
- Add a required small integer compiled-format field whose initial and only supported value is `1`.
- Inline the source map in the compiled JavaScript for this phase; do not add a source-map column.
- Do not add SDK version, compiler version, source hash, artifact hash, draft, revision, or rollback columns in this beta phase.
- Store both built-in TypeScript source and built-in compiled JavaScript so the database representation is consistent across built-in and user-owned scripts.
- Repositories return source to application callers and compiled JavaScript only to execution and internal seeding consumers.
- Never return compiled JavaScript from the public script creation response.
- If a future backend release no longer supports compiled format `1`, it may reject, delete, or recompile beta scripts without a compatibility guarantee.

### Script Creation API

- Keep script creation as the only user-authoring endpoint in this phase.
- Change the creation payload to one required TypeScript source string. Name, slug, metadata, and capabilities come from the static manifest instead of duplicate request fields.
- Keep the existing authenticated route and conflict behavior for duplicate user slugs.
- Add a typed HTTP 400 compilation failure carrying a general message and structured diagnostics.
- Each diagnostic contains logical filename, one-based line, one-based column, optional length, TypeScript or compiler diagnostic code, severity, and human-readable message.
- Source-size, manifest, import-policy, and emitted-size failures use the same structured compilation failure response.
- Compile before checking slug uniqueness because the slug comes from the manifest. Do not hold a database transaction or database connection while compilation runs.
- After successful compilation, check uniqueness and insert source, compiled code, compiled format, manifest metadata, name, slug, owner, and built-in state in one repository operation.
- A failed compilation or failed insert leaves no partial script row.
- Return the created script with identifier, name, slug, original source, and validated metadata.
- Do not add a compile-preview endpoint, update endpoint, delete endpoint, draft endpoint, or revision endpoint in this phase.

### Built-In Compilation

- Convert built-in providers and triggers to SDK definitions and convert shared helper fragments to ordinary TypeScript helper modules.
- Preserve current provider, trigger, metadata, configuration-key, and capability behavior unless adapting to the newly pinned dependency APIs requires a correction.
- Add an explicit `sandbox:compile` package command that compiles every built-in and the Deno runner.
- Generate one JavaScript ESM module per built-in plus a generated registry containing source, compiled code, and validated manifest data for seeding.
- Keep generated modules and registry output out of version control.
- Run built-in compilation as part of backend check, test, and build commands, and run it in watch mode during backend development.
- Normal TypeScript checking still checks the authored built-in modules. The additional compilation step proves that each module can be emitted under the sandbox compiler and import policy.
- Compile and type-check the Deno runner with a Deno-specific configuration so Deno globals do not leak into the backend or public SDK type environments.
- The backend production bundle embeds generated built-in JavaScript as text and seeds that compiled code into script rows.
- The generated registry replaces manual source-text imports and manual helper injection.

### End-to-End Test Package Migration

- Treat the end-to-end test package as a first-class consumer of `@ryot/sandbox-sdk` and the script creation contract.
- Add the SDK as a workspace dependency of the test package so fixture data, manifests, driver inputs, and driver outputs can use the public SDK types.
- Replace all embedded JavaScript `driver(...)` registrations with complete single-file TypeScript module source using a static manifest and SDK definitions.
- Centralize dynamic source construction in domain-owned sandbox fixtures rather than repeating module templates throughout suites.
- Provide test fixture builders for generic scripts, fake provider search results, fake provider details results, fake translations, before-create triggers, after-create triggers, cache behavior, host calls, query-engine calls, and deliberately throwing drivers.
- Source builders may inject test-specific JSON-safe values such as random slugs, fake HTTP server URLs, query documents, and expected provider payloads. Serialize injected values rather than interpolating executable test input.
- Keep user-facing E2E scripts single-file and restricted to SDK imports, matching production user policy.
- Submit API-owned test scripts through the script creation endpoint with a TypeScript `source` payload. Do not pass name, slug, metadata, capabilities, or JavaScript code separately.
- Change tests that currently expect a syntax error only after enqueueing. Invalid TypeScript must now fail script creation with structured HTTP 400 diagnostics and must not produce an identifier that can be enqueued.
- Change tests that currently call an undeclared global host function and expect a runtime undefined error. Ordinary source should now fail compilation because the capability-filtered host type does not expose the method.
- Retain runtime capability-enforcement coverage by compiling a valid script, then using a narrowly owned SQL fixture to remove or alter stored capability metadata before execution. This proves the Deno host object remains authoritative even when persisted metadata and compiled intent are inconsistent.
- Update sandbox polling and completion assertions to report structured execution phase, message, mapped location, and sanitized stack instead of assuming an error string.
- Update direct SQL references from the legacy code column to the source, compiled-code, compiled-format, and manifest representation.
- Do not insert raw or TypeScript source directly as executable compiled code in SQL fixtures.
- For hermetic global provider fixtures, create and compile the module through the authenticated creation API, then promote that row to a global built-in row through SQL and establish any required entity-schema link.
- Promotion must preserve source, compiled code, compiled format, name, slug, and validated manifest while changing only ownership and built-in state required by the fixture.
- For scenarios that must replace a built-in provider implementation without an update endpoint, create and compile a temporary script through the API, copy its source, compiled code, compiled format, and manifest to the target row through one fixture-owned SQL operation, then remove the temporary row.
- Refactor the existing fake provider source helpers so search, details, and translate drivers are assembled into one SDK provider module rather than concatenated registration strings.
- Refactor trending fixtures to use a generic SDK driver module and the same API-compile-then-promote flow.
- Refactor before-create trigger fixtures to emit typed before-create trigger modules for allow, skip, replace, ordering, and thrown-error scenarios.
- Preserve hermetic provider behavior: all provider-driven E2E suites except the existing live smoke suite remain offline and deterministic.
- Preserve existing cleanup ownership and ordering for promoted global scripts, generated entities, relationships, schema links, and temporary compile rows.
- Update the test package's agent guidance to describe TypeScript source fixtures, API compilation, global-row promotion, structured sandbox errors, and the removal of legacy driver-code concatenation.
- Do not refactor the test package's seed script as part of this migration unless a direct schema-column change makes a minimal update unavoidable.

### Deno Runtime

- Preserve the pre-warmed, single-use Deno process pool, localhost RPC bridge, bearer token, execution expiry, cached-only operation, denied environment, denied write, denied subprocess, denied FFI, denied prompt, and bridge-only network access.
- Replace dynamic function construction with dynamic import of the compiled JavaScript as an in-memory data URL ES module.
- Load approved dependency modules through the runtime import map and read-only runtime directory.
- Validate the compiled-format value before sending or loading a module.
- After module import, validate the default script definition and ensure the requested driver exists.
- Construct the host object from server-selected bridge stubs and expose only declared and approved capabilities.
- Parse driver context through the driver's input schema, invoke the run function with parsed input, host, and execution metadata, and parse the returned value through the output schema.
- Serialize only JSON-compatible output. Convert module-load, input-validation, execution, output-validation, timeout, and serialization failures into structured execution errors.
- Continue treating every compiled module as untrusted regardless of successful TypeScript compilation.
- Continue using one Deno process for one execution so module cache and global state cannot cross executions.

### Diagnostics and Runtime Errors

- Compilation diagnostics are returned by script creation and never stored as an executable script.
- Runtime errors carry one of the phases `load`, `input`, `execute`, or `output`, plus message, optional mapped line and column, and a sanitized stack when available.
- Use inline source maps to map generated JavaScript locations to the one user TypeScript source file or trusted built-in source module.
- Remove data-URL payloads, runner internals, bridge credentials, and internal filesystem locations from returned stacks.
- Update sandbox completed-result contracts and internal consumers to read the structured error instead of assuming a nullable string.
- Infrastructure failures that prevent a completed sandbox result may remain workflow-level failures, but user-code failures must use the structured execution error.
- Log truncation is not an execution failure. Append one deterministic truncation marker and ignore later log content after the total budget is exhausted.
- Oversized driver output is an output-phase failure rather than silent truncation.

### Resource Limits

- Measure all string and JSON byte limits after UTF-8 encoding rather than by JavaScript character count.
- Limit authored TypeScript source to 256 KiB.
- Limit the static manifest to 16 KiB after JSON encoding.
- Limit user compilation to five seconds of wall-clock time.
- Limit the compiler process to a 256 MiB memory budget in production supervision.
- Limit concurrent user compilations to a small bounded pool; use two concurrent compilations initially rather than running unbounded compiler subprocesses.
- Limit one compiled JavaScript module, including its inline source map, to 1 MiB.
- Limit returned compilation diagnostics to 100 entries and 256 KiB total.
- Keep the existing sandbox execution timeout default of 10 seconds and worker concurrency default of five.
- Limit the Deno V8 heap to 256 MiB per process. Production container memory limits remain the outer native-memory boundary.
- Limit driver context to 256 KiB after JSON encoding.
- Limit the total request sent to a Deno runner to 2 MiB.
- Limit one bridge RPC request body to 1 MiB and one bridge RPC response body to 10 MiB.
- Limit one execution to 200 total bridge calls and 50 `httpCall` calls. Count successful and failed calls against the budget.
- Limit an `httpCall` request body to 1 MiB and response body to 10 MiB.
- Enforce the HTTP response limit while streaming. Do not buffer an unbounded response and check afterward.
- Return a host failure when an HTTP body or bridge budget is exceeded.
- Limit one log entry to 8 KiB, one execution to 500 log entries, and total captured logs to 256 KiB.
- Limit the final serialized driver result to 1 MiB.
- Limit cache keys to 256 UTF-8 bytes, cache values to 256 KiB after JSON encoding, and cache TTLs to 30 days.
- Apply the same execution and host limits to built-in and user-authored scripts so CI exercises production limits.
- Keep limit values centralized and directly testable. Do not add an environment variable for every limit in this phase; retain environment configuration only for established operational settings such as timeout and worker concurrency.

### Beta Compatibility Policy

- User-authored TypeScript remains beta and has no SDK semantic-version compatibility guarantee in this phase.
- Support only one SDK and dependency set in a deployed backend.
- Do not retain old SDK runtime bundles solely for user compatibility.
- Breaking SDK changes may require users to recreate scripts or operators to recompile stored source.
- The internal compiled-format number exists only to detect incompatible executable representations; it does not imply public backward compatibility.
- Store source separately so later recompilation is possible even though no automated migration mechanism is included now.

### Major Modules

- `@ryot/sandbox-sdk`: the public, runtime-neutral authoring contract and test support.
- `SandboxCompiler`: isolated type checking, manifest extraction, import policy, bundling, and diagnostics.
- Built-in sandbox compilation command: trusted entry discovery, batch compilation, generated registry, and development watch.
- Sandbox contract module: script creation payload, created-script response, compilation diagnostics, and structured runtime errors.
- Sandbox API service: compilation orchestration, uniqueness handling, and persistence without holding database resources during compilation.
- Sandbox repository and script table: source, compiled code, compiled format, manifest, and ownership persistence.
- Typed host contract and backend host registry adapter: exact method contracts before dynamic RPC erasure.
- Deno runner: ES module loading, definition validation, capability-filtered host construction, driver validation, execution, limits, source-map errors, and result encoding.
- Runtime dependency module builder and import map: exact approved packages available without remote access.
- Built-in provider and trigger modules: migrated SDK definitions with behavior preserved.
- Sandbox limit utilities: centralized byte measurement, counters, truncation, bounded stream reads, and deterministic limit errors.
- End-to-end sandbox fixtures: typed TypeScript source builders, API compilation helpers, global-row promotion, compiled-representation replacement, polling, and structured error assertions.

## Testing Decisions

- Tests should verify Ryot-owned contracts, branching, security policy, limits, and observable execution behavior. They should not test that TypeScript, Bun, Zod, Day.js, Cheerio, youtubei.js, or Deno perform their documented library behavior.
- SDK schema tests should cover meaningful unions and recursive contracts, especially provider details, before-create trigger results, host failures, and capability narrowing.
- Add type-check fixtures that prove declared capabilities expose only their host methods, driver input is inferred from its schema, invalid output is rejected, and direct imports outside the SDK fail.
- Compiler tests should cover valid user source, valid trusted relative imports, TypeScript diagnostics, static manifest rejection, duplicate or missing manifest rejection, forbidden imports, computed dynamic imports, source limits, manifest limits, diagnostic limits, compilation timeout, and compiled-size limits.
- Compiler tests should assert structured diagnostics inline rather than snapshotting entire compiler output.
- Host contract parity tests should prove backend implementations satisfy SDK argument and result types before dynamic bridge conversion.
- Backend Effect schema parity tests should decode representative values produced by SDK schemas for search, details, resolve, translate, trigger, and structured execution errors.
- Script creation service tests should cover successful compilation and insert, compilation failure without insert, static-manifest failure, duplicate slug conflict, source-size rejection, and compiler-process failure.
- Script creation route tests should verify the TypeScript-source payload, 201 response without compiled code, typed 400 diagnostics, authentication, rate limiting, and 409 conflict.
- End-to-end sandbox suites must submit SDK-based TypeScript source through the real creation endpoint and then enqueue and poll the resulting script through the real durable workflow path.
- End-to-end creation coverage must prove invalid TypeScript, an invalid static manifest, a forbidden import, and an undeclared host capability fail before a script row is returned.
- End-to-end execution coverage must retain plain results, thrown errors, HTTP host calls, query-engine host calls, application configuration, user preferences, cache round trips, cache misses, cache isolation, cross-user job access, timing, and missing-job behavior using the new source and result contracts.
- End-to-end trigger coverage must retain before-create skip, replacement, thrown-error, and ordered replacement behavior with typed trigger modules.
- Hermetic provider E2E coverage must use API-compiled modules promoted to global built-ins, then retain search, import, population, translation, relationship, trending, monitoring, and interest assertions.
- Add fixture-level coverage proving promotion preserves the exact compiled representation and cleanup removes temporary and promoted rows without masking test failures.
- Media-monitoring and other tests that replace provider code must compile replacement source through the API before copying the compiled representation; assert the backend executes the replacement rather than stale code.
- The test package must contain no legacy `driver(...)` source generation and no direct SQL insertion of uncompiled executable code after migration.
- Repository tests should verify source and compiled code are stored separately and execution reads compiled code rather than source.
- Runner tests should execute compiled ESM through Deno and cover module load, missing driver, capability filtering, input validation, output validation, JSON serialization, source-mapped execution errors, timeout, and compiled-format rejection.
- Limit tests should cover UTF-8 byte measurement, source, context, runner request, RPC request and response, HTTP request and streamed response, host-call budgets, logs, result, cache key, cache value, and cache TTL behavior.
- Log tests should verify one truncation marker and continued successful execution. Result-size tests should verify an output-phase error without partial output.
- Security tests should prove user source cannot resolve relative files, arbitrary packages, direct npm specifiers, Deno npm specifiers, Node built-ins, Bun APIs, sensitive configuration, undeclared host methods, or undeclared bridge functions.
- Built-in compilation smoke tests must discover and compile every built-in entry and fail if any entry lacks a valid manifest or emits more than one module.
- Built-in Deno load tests must import every compiled module and validate its definition, even when no detailed provider behavior test exists.
- Existing provider and trigger behavior tests should be migrated to call TypeScript definitions through SDK test hosts. Preserve their current assertions rather than replacing them with type-only smoke tests.
- Existing runtime host-function, application-configuration, registry, workflow, provider, and trigger suites are the prior art for backend test style and expected behavior.
- Add focused compiled-module integration coverage for at least one complex provider using external libraries, one provider using local helper imports, one before-create trigger, and one after-create trigger before bulk conversion.
- Run SDK tests from the SDK package, backend tests from the backend package, and repository-wide check and build through Turbo.
- The backend check must run normal TypeScript checking, built-in sandbox compilation, formatting, and type-aware linting.
- Do not require live third-party provider credentials or network calls. Continue using deterministic host and package stand-ins where behavior belongs to Ryot.
- Use assertion functions for test-only narrowing and follow the repository's existing inline-assertion philosophy.

## Out of Scope

- Supporting JavaScript-authored scripts alongside TypeScript.
- Migrating or preserving existing persisted user scripts.
- A compile-only or validation-preview endpoint.
- Updating, deleting, drafting, revising, rolling back, or versioning user scripts.
- Multi-file user projects or user-supplied relative imports.
- Arbitrary npm, URL, Node, Bun, or Deno dependencies.
- User-selected dependency versions.
- Public SDK semantic-version compatibility during beta.
- Retaining multiple SDK runtime versions.
- Publishing `@ryot/sandbox-sdk` to a package registry in this phase.
- Extracting the backend compiler into a separate public or workspace compiler package before another consumer requires it.
- Compiling TypeScript during enqueueing or execution.
- Changing provider or trigger product behavior except where required for the pinned dependency APIs or typed contracts.
- Adding new host functions or grouping existing function-level capabilities into broader permissions.
- Building a browser editor, Monaco integration, CLI, or local upload tool.
- Full script revision history or automatic recompile-on-deploy behavior.
- A test-only compiler or direct use of backend compiler internals from the end-to-end package.

## Further Notes

- The intended implementation order is a vertical slice: SDK core and contracts, compiler, compiled-module persistence, ESM Deno runner, one representative complex provider, one before-create trigger, one after-create trigger, diagnostics and limits, then bulk conversion of the remaining sources.
- TMDB Show is the preferred representative complex provider because it is the largest current script and implements multiple provider drivers. A helper-consuming provider should also be included before bulk conversion to prove local import bundling.
- The existing Deno process and bridge permissions remain the security boundary. Successful type checking is never evidence that code is safe to execute in the backend process.
- The end-to-end package is part of the migration surface. Completion requires its JavaScript source fixtures, direct script-row inserts, direct script-code updates, polling helpers, and result assertions to use the TypeScript source and compiled-module model.
- The compiler should be designed as a deep module with a small stable interface. User creation, built-in generation, and tests should not know about TypeScript virtual files, Bun plugins, import maps, or source-map internals.
- The SDK should be designed as a future public API even though beta compatibility is not promised. Explicit exports and backend independence prevent unnecessary publication work later.
- When this PRD is broken into implementation tasks, the mandatory final task must run the codebase-cleanup skill over touched files and directly affected sandbox modules.

---

## Tasks

**Overall Progress:** 5 of 18 tasks completed

**Current Task:** [Task 06](./06-built-in-provider-compilation-tracer.md) (todo)

### Task List

| #   | Task                                                                                           | Type | Status |
| --- | ---------------------------------------------------------------------------------------------- | ---- | ------ |
| 01  | [TypeScript Script Execution Tracer](./01-typescript-script-execution-tracer.md)               | AFK  | done   |
| 02  | [Core Host Capability Contracts](./02-core-host-capability-contracts.md)                       | AFK  | done   |
| 03  | [Domain Host Capability Contracts](./03-domain-host-capability-contracts.md)                   | AFK  | done   |
| 04  | [Approved Runtime Dependencies](./04-approved-runtime-dependencies.md)                         | AFK  | done   |
| 05  | [Diagnostics and Resource Limits](./05-diagnostics-and-resource-limits.md)                     | AFK  | done   |
| 06  | [Built-In Provider Compilation Tracer](./06-built-in-provider-compilation-tracer.md)           | AFK  | todo   |
| 07  | [Typed Trigger Migration](./07-typed-trigger-migration.md)                                     | AFK  | todo   |
| 08  | [End-to-End Sandbox Fixtures](./08-end-to-end-sandbox-fixtures.md)                             | AFK  | todo   |
| 09  | [TMDB Provider Family](./09-tmdb-provider-family.md)                                           | AFK  | todo   |
| 10  | [TVDB Provider Family](./10-tvdb-provider-family.md)                                           | AFK  | todo   |
| 11  | [Anime and Manga Providers](./11-anime-and-manga-providers.md)                                 | AFK  | todo   |
| 12  | [Book Providers](./12-book-providers.md)                                                       | AFK  | todo   |
| 13  | [Audiobook and Podcast Providers](./13-audiobook-and-podcast-providers.md)                     | AFK  | todo   |
| 14  | [Music Providers](./14-music-providers.md)                                                     | AFK  | todo   |
| 15  | [Game Providers](./15-game-providers.md)                                                       | AFK  | todo   |
| 16  | [Comic, Visual Novel, and Fitness Providers](./16-comic-visual-novel-and-fitness-providers.md) | AFK  | todo   |
| 17  | [Complete Sandbox Cutover](./17-complete-sandbox-cutover.md)                                   | AFK  | todo   |
| 18  | [Codebase Cleanup](./18-codebase-cleanup.md)                                                   | AFK  | todo   |

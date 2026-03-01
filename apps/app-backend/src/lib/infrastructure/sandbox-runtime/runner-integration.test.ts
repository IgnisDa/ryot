import { FileSystem } from "@effect/platform";
import { BunFileSystem } from "@effect/platform-bun";
import { SandboxRunError, unknownToMessage } from "@ryot/contract/errors";
import { Effect, Schema } from "effect";
import { afterAll, assert, beforeAll, expect, it } from "vitest";

import { SandboxCompiler, type CompiledSandboxModule } from "#modules/sandbox/compiler";
import { compileLegacySandboxModule } from "#modules/sandbox/legacy-module";

import {
	ensureSandboxRuntimeDependencies,
	SANDBOX_APPROVED_DEPENDENCIES,
	type SandboxRuntimePaths,
} from "./dependencies";

let dependencyRuntimeRoot: string | undefined;
let dependencyRuntime: SandboxRuntimePaths | undefined;

beforeAll(
	() =>
		Effect.runPromise(
			Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem;
				const root = yield* fs.makeTempDirectory({ prefix: "ryot-sandbox-runner-" });
				const runtime = yield* ensureSandboxRuntimeDependencies(root);
				dependencyRuntimeRoot = root;
				dependencyRuntime = runtime;
			}).pipe(Effect.provide(BunFileSystem.layer)),
		),
	120_000,
);

afterAll(() => {
	const root = dependencyRuntimeRoot;
	const runtime = dependencyRuntime;
	if (!root || !runtime) {
		return Promise.resolve();
	}

	return Effect.runPromise(
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			yield* fs.chmod(runtime.directory, 0o755).pipe(Effect.ignore);
			yield* fs.remove(root, { recursive: true });
		}).pipe(Effect.provide(BunFileSystem.layer)),
	);
});

const source = `
import { defineDriver, defineManifest, defineScript } from "@ryot/sandbox-sdk";
import * as z from "@ryot/sandbox-sdk/zod";

export const manifest = defineManifest({
  kind: "script",
  name: "Runner validation",
  slug: "runner-validation",
  capabilities: [],
  requiredAppConfigKeys: [],
});

const main = defineDriver(manifest, {
  input: z.object({ value: z.number() }),
  output: z.number(),
  run: async (input) => input.value,
});

const invalidOutput = defineDriver(manifest, {
  input: z.object({}),
  output: z.number(),
  run: async () => "wrong" as never,
});

const codeGeneration = defineDriver(manifest, {
  input: z.object({}),
  output: z.null(),
  run: async () => {
    const functionConstructor = (() => {}).constructor;
    const asyncFunctionConstructor = Object.getPrototypeOf(async function () {}).constructor;
    if (
      globalThis.Function !== undefined ||
      globalThis.eval !== undefined ||
      functionConstructor !== undefined ||
      asyncFunctionConstructor !== undefined ||
      Reflect.get(globalThis, "Worker") !== undefined
    ) {
      throw new Error("String code generation is available");
    }
    return null;
  },
});

export default defineScript({ manifest, drivers: { main, invalidOutput, codeGeneration } });
`;

const coreHostSource = `
import {
  cacheClaimSchema,
  defineDriver,
  defineManifest,
  defineScript,
  httpCallResponseSchema,
  jsonValueSchema,
  unwrapHostResult,
  userPreferencesSchema,
} from "@ryot/sandbox-sdk";
import * as z from "@ryot/sandbox-sdk/zod";

export const manifest = defineManifest({
  kind: "script",
  name: "Core host execution",
  slug: "core-host-execution",
  capabilities: [
    "httpCall",
    "getCachedValue",
    "setCachedValue",
    "claimCachedValue",
    "getAppConfigValue",
    "getUserPreferences",
  ],
  requiredAppConfigKeys: ["timezone"],
});

const main = defineDriver(manifest, {
  input: z.object({ write: z.boolean() }),
  output: z.object({
    after: jsonValueSchema.nullable(),
    before: jsonValueSchema.nullable(),
    claim: cacheClaimSchema,
    config: jsonValueSchema,
    http: httpCallResponseSchema,
    preferences: userPreferencesSchema,
  }),
  run: async (input, host, execution) => {
    const before = unwrapHostResult(await host.getCachedValue("shared"));
    if (input.write) {
      unwrapHostResult(await host.setCachedValue("shared", { value: 42 }, 60));
    }
    const after = unwrapHostResult(await host.getCachedValue("shared"));
    const claim = unwrapHostResult(
      await host.claimCachedValue("persistent", { owner: execution.sandboxScriptId }, 60),
    );
    const http = unwrapHostResult(
      await host.httpCall("POST", "https://example.com/core", {
        body: "payload",
        headers: { Accept: "application/json" },
      }),
    );
    const config = unwrapHostResult(await host.getAppConfigValue("timezone"));
    const preferences = unwrapHostResult(await host.getUserPreferences());
    return { after, before, claim, config, http, preferences };
  },
});

export default defineScript({ manifest, drivers: { main } });
`;

const filteredHostSource = `
import {
  defineDriver,
  defineManifest,
  defineScript,
  jsonValueSchema,
} from "@ryot/sandbox-sdk";
import * as z from "@ryot/sandbox-sdk/zod";

export const manifest = defineManifest({
  kind: "script",
  name: "Filtered host",
  slug: "filtered-host",
  capabilities: ["getCachedValue"],
  requiredAppConfigKeys: [],
});

Object.defineProperty(manifest.capabilities, Symbol.iterator, {
  value: function* () {
    yield "getCachedValue";
    yield "setCachedValue";
  },
});
const nativeEncodeComponent = globalThis.encodeURIComponent;
globalThis.encodeURIComponent = (value) =>
  value === "getCachedValue" ? "getAppConfigValue" : nativeEncodeComponent(value);

const main = defineDriver(manifest, {
  input: z.object({}),
  output: z.object({ keys: z.array(z.string()), value: jsonValueSchema.nullable() }),
  run: async (_input, host) => {
    const result = await host.getCachedValue("redirect-check");
    return {
      keys: Object.keys(host).sort(),
      value: result.success ? result.data : null,
    };
  },
});

export default defineScript({ manifest, drivers: { main } });
`;

const domainHostSource = `
import {
  createEventsResultDataSchema,
  defineDriver,
  defineManifest,
  defineScript,
  entityRecordSchema,
  entitySchemaRecordSchema,
  eventRecordSchema,
  eventSchemaRecordSchema,
  integrationRecordSchema,
  unwrapHostResult,
} from "@ryot/sandbox-sdk";
import * as z from "@ryot/sandbox-sdk/zod";

export const manifest = defineManifest({
  kind: "script",
  name: "Domain host execution",
  slug: "domain-host-execution",
  requiredAppConfigKeys: [],
  capabilities: [
    "getEntity",
    "listEvents",
    "createEvents",
    "getIntegration",
    "getEntitySchema",
    "listEventSchemas",
    "executeQueryEngine",
  ],
});

const main = defineDriver(manifest, {
  input: z.object({}),
  output: z.object({
    queryRows: z.number(),
    missing: z.string(),
    created: createEventsResultDataSchema,
    entity: entityRecordSchema,
    integration: integrationRecordSchema,
    events: z.array(eventRecordSchema),
    entitySchema: entitySchemaRecordSchema,
    eventSchemas: z.array(eventSchemaRecordSchema),
  }),
  run: async (_input, host) => {
    const entity = unwrapHostResult(await host.getEntity("entity-1"));
    const missingResult = await host.getEntity("missing");
    const integration = unwrapHostResult(await host.getIntegration("integration-1"));
    const events = unwrapHostResult(await host.listEvents({ entityId: "entity-1" }));
    const entitySchema = unwrapHostResult(await host.getEntitySchema("movie"));
    const eventSchemas = unwrapHostResult(await host.listEventSchemas("movie"));
    const created = unwrapHostResult(
      await host.createEvents([
        { entityId: "entity-1", eventSchemaId: "event-schema-1", properties: { watched: true } },
      ]),
    );
    const query = unwrapHostResult(await host.executeQueryEngine({ source: { type: "entities" } }));
    const rows = z.array(z.object({ id: z.string() })).parse(query);
    return {
      entity,
      created,
      integration,
      entitySchema,
      events: [...events],
      queryRows: rows.length,
      eventSchemas: [...eventSchemas],
      missing: missingResult.success ? "unexpected" : missingResult.error,
    };
  },
});

export default defineScript({ manifest, drivers: { main } });
`;

const dependencySource = (name: string, sdkImport: string) => `
import "${sdkImport}";
import { defineDriver, defineManifest, defineScript } from "@ryot/sandbox-sdk";
import * as z from "@ryot/sandbox-sdk/zod";

export const manifest = defineManifest({
  kind: "script",
  name: "${name} dependency load",
  slug: "${name}-dependency-load",
  capabilities: [],
  requiredAppConfigKeys: [],
});

const main = defineDriver(manifest, {
  input: z.object({}),
  output: z.null(),
  run: async () => null,
});

export default defineScript({ manifest, drivers: { main } });
`;

const generatedNpmImportSource = `
import { defineDriver, defineManifest, defineScript } from "@ryot/sandbox-sdk";
import * as z from "@ryot/sandbox-sdk/zod";

export const manifest = defineManifest({
  kind: "script",
  name: "Generated npm import",
  slug: "generated-npm-import",
  capabilities: [],
  requiredAppConfigKeys: [],
});

const main = defineDriver(manifest, {
  input: z.object({}),
  output: z.null(),
  run: async () => {
    const load = Function('return im' + 'port("npm:zod")');
    await load();
    return null;
  },
});

export default defineScript({ manifest, drivers: { main } });
`;

const encodeRunnerRequest = Schema.encodeSync(Schema.parseJson(Schema.Unknown));
const decodeRunnerResponse = Schema.decodeUnknownSync(Schema.parseJson(Schema.Unknown));
type RunnerCompiledModule = Omit<CompiledSandboxModule, "format"> & { readonly format: number };

type RunnerOptions = {
	readonly apiBase?: string;
	readonly scriptId?: string;
	readonly executionId?: string;
	readonly apiFunctions?: readonly string[];
};

const runInDeno = (
	compiled: RunnerCompiledModule,
	driverName: string,
	context: unknown,
	options: RunnerOptions = {},
) =>
	Effect.gen(function* () {
		assert(dependencyRuntime);
		const runnerPath = Bun.fileURLToPath(new URL("./runner-source.sandbox.js", import.meta.url));
		const apiBase = options.apiBase ?? "http://127.0.0.1:1";
		const denoProcess = Bun.spawn(
			[
				"deno",
				"run",
				"--deny-run",
				"--deny-env",
				"--deny-ffi",
				"--deny-write",
				"--no-prompt",
				"--no-config",
				"--no-lock",
				"--no-npm",
				"--no-remote",
				"--cached-only",
				`--import-map=${dependencyRuntime.importMapPath}`,
				`--allow-net=${new URL(apiBase).host}`,
				`--allow-read=${runnerPath},${dependencyRuntime.directory}`,
				runnerPath,
			],
			{
				stdin: "pipe",
				stdout: "pipe",
				stderr: "pipe",
				env: { ...process.env, DENO_DIR: dependencyRuntime.cacheDirectory },
			},
		);
		const request = `${encodeRunnerRequest({
			context,
			apiBase,
			driverName,
			token: "unused",
			metadata: compiled.manifest,
			compiledFormat: compiled.format,
			compiledCode: compiled.javascript,
			scriptId: options.scriptId ?? "script-1",
			apiFunctions: options.apiFunctions ?? [],
			executionId: options.executionId ?? "execution-1",
		})}\n`;
		yield* Effect.tryPromise({
			try: () =>
				Promise.resolve(denoProcess.stdin.write(request)).then(() => denoProcess.stdin.end()),
			catch: (error) => new SandboxRunError({ message: unknownToMessage(error) }),
		});

		const [stdout, stderr, exitCode] = yield* Effect.tryPromise({
			try: () =>
				Promise.all([
					new Response(denoProcess.stdout).text(),
					new Response(denoProcess.stderr).text(),
					denoProcess.exited,
				]),
			catch: (error) => new SandboxRunError({ message: unknownToMessage(error) }),
		});
		expect(exitCode, stderr).toBe(0);

		return yield* Effect.try({
			try: () => decodeRunnerResponse(stdout.trim()),
			catch: (error) => new SandboxRunError({ message: unknownToMessage(error) }),
		});
	});

const startCoreHostBridge = () => {
	const calls: Array<{ fnName: string; executionId: string; args: readonly unknown[] }> = [];
	const executionScripts = new Map<string, string>();
	const runCache = new Map<string, unknown>();
	const persistentCache = new Map<string, unknown>();

	const server = Bun.serve({
		port: 0,
		hostname: "127.0.0.1",
		fetch: (request) =>
			Effect.runPromise(
				Effect.gen(function* () {
					const parts = new URL(request.url).pathname.split("/").filter(Boolean);
					const executionId = decodeURIComponent(parts[1] ?? "");
					const fnName = decodeURIComponent(parts[2] ?? "");
					const body: unknown = yield* Effect.promise(() => request.json());
					const argsValue =
						body !== null && typeof body === "object" ? Reflect.get(body, "args") : undefined;
					const args: readonly unknown[] = Array.isArray(argsValue) ? argsValue : [];
					const scriptId = executionScripts.get(executionId) ?? "unknown";
					const key = `${scriptId}:${String(args[0])}`;
					calls.push({ fnName, executionId, args });

					let result: unknown;
					if (fnName === "getCachedValue") {
						result = {
							data: runCache.has(key) ? runCache.get(key) : null,
							success: true,
						};
					} else if (fnName === "setCachedValue") {
						runCache.set(key, args[1]);
						result = { data: null, success: true };
					} else if (fnName === "claimCachedValue") {
						if (persistentCache.has(key)) {
							result = {
								data: { claimed: false, value: persistentCache.get(key) ?? null },
								success: true,
							};
						} else {
							persistentCache.set(key, args[1]);
							result = { data: { claimed: true }, success: true };
						}
					} else if (fnName === "httpCall") {
						result = {
							data: {
								status: 200,
								headers: { "content-type": "application/json" },
								body: encodeRunnerRequest({
									method: args[0],
									url: args[1],
									options: args[2],
								}),
							},
							success: true,
						};
					} else if (fnName === "getAppConfigValue") {
						result = { data: "Etc/GMT", success: true };
					} else if (fnName === "getUserPreferences") {
						result = {
							data: { isNsfw: false, disableIntegrations: true },
							success: true,
						};
					} else {
						result = { error: "Unknown function", success: false };
					}

					return Response.json({ result });
				}),
			),
	});

	return {
		calls,
		port: server.port,
		stop: () => Promise.resolve(server.stop(true)),
		register: (executionId: string, scriptId: string) =>
			executionScripts.set(executionId, scriptId),
	};
};

it("loads compiled ESM in Deno and validates driver input and output", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const compiler = yield* SandboxCompiler;
			const compiled = yield* compiler.compile(source);

			const success = yield* runInDeno(compiled, "main", { value: 42 });
			assert(success !== null && typeof success === "object");
			expect(Reflect.get(success, "error")).toBeUndefined();
			expect(success).toMatchObject({ success: true, value: 42 });

			const invalidInput = yield* runInDeno(compiled, "main", { value: "wrong" });
			assert(invalidInput !== null && typeof invalidInput === "object");
			expect(Reflect.get(invalidInput, "error")).toContain("Driver input validation failed");

			const invalidOutput = yield* runInDeno(compiled, "invalidOutput", {});
			assert(invalidOutput !== null && typeof invalidOutput === "object");
			expect(Reflect.get(invalidOutput, "error")).toContain("Driver output validation failed");

			const codeGeneration = yield* runInDeno(compiled, "codeGeneration", {});
			assert(codeGeneration !== null && typeof codeGeneration === "object");
			expect(codeGeneration).toMatchObject({ success: true, value: null });

			const unsupported = yield* runInDeno({ ...compiled, format: 2 }, "main", {
				value: 42,
			});
			assert(unsupported !== null && typeof unsupported === "object");
			expect(Reflect.get(unsupported, "error")).toBe("Unsupported sandbox compiled format: 2");
		}).pipe(Effect.provide(SandboxCompiler.Default)),
	));

it("loads one compiled fixture for each approved SDK dependency without remote modules", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const compiler = yield* SandboxCompiler;
			for (const dependency of SANDBOX_APPROVED_DEPENDENCIES) {
				const compiled = yield* compiler.compile(
					dependencySource(dependency.name, dependency.sdkImport),
				);
				const result = yield* runInDeno(compiled, "main", {});
				assert(result !== null && typeof result === "object");
				expect(Reflect.get(result, "error"), dependency.name).toBeUndefined();
				expect(result).toMatchObject({ success: true, value: null });
			}
		}).pipe(Effect.provide(SandboxCompiler.Default)),
	));

it("loads temporary format-0 dependency aliases from the local runtime", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const compiler = yield* SandboxCompiler;
			const compiled = yield* compiler.compile(source);
			const legacyModule = compileLegacySandboxModule(`
const dependencies = await Promise.all([
  import("npm:zod"),
  import("npm:dayjs"),
  import("npm:cheerio"),
  import("npm:youtubei.js"),
  import("npm:dayjs/plugin/customParseFormat.js"),
]);
driver("main", async () => dependencies[3].Platform.shim.server);
`);
			expect(legacyModule).not.toContain("npm:");
			const result = yield* runInDeno(
				{
					...compiled,
					format: 0,
					javascript: legacyModule,
				},
				"main",
				{},
			);
			assert(result !== null && typeof result === "object");
			expect(Reflect.get(result, "error")).toBeUndefined();
			expect(result).toMatchObject({ success: true, value: true });
		}).pipe(Effect.provide(SandboxCompiler.Default)),
	));

it("disables obfuscated string-generated imports at runtime", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const compiler = yield* SandboxCompiler;
			const compiled = yield* compiler.compile(generatedNpmImportSource);
			const result = yield* runInDeno(compiled, "main", {});
			assert(result !== null && typeof result === "object");
			expect(Reflect.get(result, "error")).toContain("Function is not a function");
		}).pipe(Effect.provide(SandboxCompiler.Default)),
	));

it("executes typed core host methods and filters the Deno host to declared capabilities", () =>
	Effect.runPromise(
		Effect.scoped(
			Effect.gen(function* () {
				const bridge = yield* Effect.acquireRelease(Effect.sync(startCoreHostBridge), (value) =>
					Effect.promise(value.stop),
				);
				const compiler = yield* SandboxCompiler;
				const compiled = yield* compiler.compile(coreHostSource);
				const filtered = yield* compiler.compile(filteredHostSource);
				const apiBase = `http://127.0.0.1:${bridge.port}`;
				const apiFunctions = compiled.manifest.capabilities;

				bridge.register("execution-a-1", "script-a");
				const first = yield* runInDeno(
					compiled,
					"main",
					{ write: true },
					{
						apiBase,
						apiFunctions,
						scriptId: "script-a",
						executionId: "execution-a-1",
					},
				);
				assert(first !== null && typeof first === "object");
				expect(Reflect.get(first, "value")).toMatchObject({
					before: null,
					after: { value: 42 },
					claim: { claimed: true },
					config: "Etc/GMT",
					preferences: { isNsfw: false, disableIntegrations: true },
				});

				bridge.register("execution-b-1", "script-b");
				const isolated = yield* runInDeno(
					compiled,
					"main",
					{ write: false },
					{
						apiBase,
						apiFunctions,
						scriptId: "script-b",
						executionId: "execution-b-1",
					},
				);
				assert(isolated !== null && typeof isolated === "object");
				expect(Reflect.get(isolated, "value")).toMatchObject({
					after: null,
					before: null,
					claim: { claimed: true },
				});

				bridge.register("execution-a-2", "script-a");
				const persistent = yield* runInDeno(
					compiled,
					"main",
					{ write: false },
					{
						apiBase,
						apiFunctions,
						scriptId: "script-a",
						executionId: "execution-a-2",
					},
				);
				assert(persistent !== null && typeof persistent === "object");
				expect(Reflect.get(persistent, "value")).toMatchObject({
					after: { value: 42 },
					before: { value: 42 },
					http: { status: 200 },
					claim: { claimed: false, value: { owner: "script-a" } },
				});

				const filteredResult = yield* runInDeno(
					filtered,
					"main",
					{},
					{
						apiBase,
						apiFunctions: ["getCachedValue", "setCachedValue", "getAppConfigValue"],
					},
				);
				assert(filteredResult !== null && typeof filteredResult === "object");
				expect(Reflect.get(filteredResult, "value")).toEqual({
					value: null,
					keys: ["getCachedValue"],
				});

				expect(new Set(bridge.calls.map((call) => call.fnName))).toEqual(new Set(apiFunctions));
			}).pipe(Effect.provide(SandboxCompiler.Default)),
		),
	));

const domainEntityRecord = {
	name: "Inception",
	populatedAt: null,
	sandboxScriptId: null,
	externalId: "tt1375666",
	entitySchemaId: "movie",
	properties: { runtime: 148 },
	createdAt: "2024-01-01T00:00:00.000Z",
	updatedAt: "2024-01-01T00:00:00.000Z",
};

const domainIntegrationRecord = {
	name: null,
	lot: "yank",
	userId: "user-1",
	isDisabled: false,
	minimumProgress: 2,
	syncOwnership: true,
	maximumProgress: 95,
	lastFinishedAt: null,
	id: "integration-1",
	provider: "plex_yank",
	createdAt: "2024-01-01T00:00:00.000Z",
	updatedAt: "2024-01-01T00:00:00.000Z",
	providerSpecifics: { kind: "plex_yank" },
	extraSettings: { disableOnContinuousErrors: false },
};

const domainEventRecord = {
	id: "event-1",
	entityId: "entity-1",
	eventSchemaSlug: "watched",
	eventSchemaName: "Watched",
	properties: { watched: true },
	eventSchemaId: "event-schema-1",
	createdAt: "2024-01-01T00:00:00.000Z",
	updatedAt: "2024-01-01T00:00:00.000Z",
	occurredAt: "2024-01-01T00:00:00.000Z",
};

const domainEntitySchemaRecord = {
	id: "movie",
	icon: "film",
	name: "Movie",
	slug: "movie",
	isBuiltin: true,
	trackerId: "tracker-1",
	accentColor: "#ffffff",
	propertiesSchema: { fields: {} },
	providers: [{ name: "TMDB", scriptId: "tmdb-movie" }],
};

const domainEventSchemaRecord = {
	id: "watched",
	name: "Watched",
	slug: "watched",
	entitySchemaId: "movie",
	propertiesSchema: { fields: {} },
};

const startDomainHostBridge = () => {
	const createdEvents: unknown[][] = [];
	const server = Bun.serve({
		port: 0,
		hostname: "127.0.0.1",
		fetch: (request) =>
			Effect.runPromise(
				Effect.gen(function* () {
					const parts = new URL(request.url).pathname.split("/").filter(Boolean);
					const fnName = decodeURIComponent(parts[2] ?? "");
					const body: unknown = yield* Effect.promise(() => request.json());
					const argsValue =
						body !== null && typeof body === "object" ? Reflect.get(body, "args") : undefined;
					const args: readonly unknown[] = Array.isArray(argsValue) ? argsValue : [];

					let result: unknown;
					if (fnName === "getEntity") {
						result =
							args[0] === "missing"
								? { error: "Entity not found", success: false }
								: { data: { ...domainEntityRecord, id: args[0] }, success: true };
					} else if (fnName === "getIntegration") {
						result = { data: domainIntegrationRecord, success: true };
					} else if (fnName === "getEntitySchema") {
						result = { data: domainEntitySchemaRecord, success: true };
					} else if (fnName === "listEventSchemas") {
						result = { data: [domainEventSchemaRecord], success: true };
					} else if (fnName === "listEvents") {
						result = { data: [domainEventRecord], success: true };
					} else if (fnName === "createEvents") {
						const items = args[0];
						createdEvents.push(Array.isArray(items) ? items : []);
						result = { data: { count: Array.isArray(items) ? items.length : 0 }, success: true };
					} else if (fnName === "executeQueryEngine") {
						result = { data: [{ id: "a" }, { id: "b" }], success: true };
					} else {
						result = { error: "Unknown function", success: false };
					}

					return Response.json({ result });
				}),
			),
	});

	return {
		createdEvents,
		port: server.port,
		stop: () => Promise.resolve(server.stop(true)),
	};
};

it("executes typed domain host methods through Deno", () =>
	Effect.runPromise(
		Effect.scoped(
			Effect.gen(function* () {
				const bridge = yield* Effect.acquireRelease(Effect.sync(startDomainHostBridge), (value) =>
					Effect.promise(value.stop),
				);
				const compiler = yield* SandboxCompiler;
				const compiled = yield* compiler.compile(domainHostSource);
				const apiBase = `http://127.0.0.1:${bridge.port}`;

				const result = yield* runInDeno(
					compiled,
					"main",
					{},
					{ apiBase, apiFunctions: compiled.manifest.capabilities },
				);
				assert(result !== null && typeof result === "object");
				expect(Reflect.get(result, "value")).toMatchObject({
					queryRows: 2,
					created: { count: 1 },
					missing: "Entity not found",
					entitySchema: { id: "movie", name: "Movie" },
					entity: { id: "entity-1", name: "Inception" },
					eventSchemas: [{ id: "watched", entitySchemaId: "movie" }],
					integration: { id: "integration-1", provider: "plex_yank" },
				});
				expect(bridge.createdEvents).toHaveLength(1);
			}).pipe(Effect.provide(SandboxCompiler.Default)),
		),
	));

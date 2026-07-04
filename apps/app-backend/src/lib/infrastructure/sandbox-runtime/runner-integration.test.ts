import { Command, CommandExecutor, FileSystem, HttpApp, HttpServer } from "@effect/platform";
import { BunContext, BunHttpServer } from "@effect/platform-bun";
import { SandboxRunError, unknownToMessage } from "@ryot/contract/errors";
import type { CompiledSandboxModule } from "@ryot/sandbox-compiler/protocol";
import { Effect, Runtime, Schema, Stream } from "effect";
import { afterAll, assert, beforeAll, expect, it } from "vitest";

import {
	generatedBuiltinSandboxScripts,
	sandboxAnimeDotAnilistScript,
	sandboxAnimeDotMyanimelistScript,
	sandboxComicDashBookDotMetronScript,
	sandboxExerciseDotFreeDashExerciseDashDbScript,
	sandboxVisualDashNovelDotVndbScript,
	sandboxAudiobookDotAudibleScript,
	sandboxBookDotGoogleDashBooksScript,
	sandboxBookDotHardcoverScript,
	sandboxBookDotOpenlibraryScript,
	sandboxCompanyDotTmdbScript,
	sandboxCompanyDotTvdbScript,
	sandboxMangaDotMangaDashUpdatesScript,
	sandboxMovieDashGroupDotTmdbScript,
	sandboxMovieDashGroupDotTvdbScript,
	sandboxMovieDotTmdbScript,
	sandboxMovieDotTvdbScript,
	sandboxMusicDotMusicDashBrainzScript,
	sandboxMusicDotSpotifyScript,
	sandboxPersonDotTmdbScript,
	sandboxPersonDotTvdbScript,
	sandboxPodcastDotItunesScript,
	sandboxPodcastDotListennotesScript,
	sandboxShowDotTmdbScript,
	sandboxShowDotTvdbScript,
	sandboxVideoDashGameDotGiantDashBombScript,
	sandboxVideoDashGameDotIgdbScript,
	sandboxTriggerDotAutoDashCompleteDashOnDashFullDashProgressScript,
	sandboxTriggerDotIntegrationDashProgressDashPolicyScript,
} from "#modules/builtins/generated-sandbox/registry";
import { SandboxCompiler } from "#modules/sandbox/compiler";

import {
	ensureSandboxRuntimeDependencies,
	SANDBOX_APPROVED_DEPENDENCIES,
	type SandboxRuntimePaths,
} from "./dependencies";
import {
	SANDBOX_LIMITS,
	SANDBOX_LOG_TRUNCATION_MARKER,
	SANDBOX_RUNNER_LIMITS,
	utf8ByteLength,
} from "./limits";
import { sandboxRunnerSource } from "./runner.generated";

let dependencyRuntimeRoot: string | undefined;
let dependencyRuntime: SandboxRuntimePaths | undefined;
let runnerPath: string | undefined;

beforeAll(
	() =>
		Effect.runPromise(
			Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem;
				const root = yield* fs.makeTempDirectory({ prefix: "ryot-sandbox-runner-" });
				const runtime = yield* ensureSandboxRuntimeDependencies(root);
				const compiledRunnerPath = `${root}/runner.mjs`;
				yield* fs.writeFileString(compiledRunnerPath, sandboxRunnerSource);
				dependencyRuntimeRoot = root;
				dependencyRuntime = runtime;
				runnerPath = compiledRunnerPath;
			}).pipe(Effect.provide(BunContext.layer)),
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
		}).pipe(Effect.provide(BunContext.layer)),
	);
});

const source = `
import { defineDriver, defineManifest, defineScript } from "@ryot/sandbox-sdk/core";
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
      Reflect.get(globalThis, "Deno") !== undefined ||
      Reflect.get(globalThis, "Worker") !== undefined
    ) {
      throw new Error("String code generation is available");
    }
    return null;
  },
});

const throwing = defineDriver(manifest, {
  input: z.object({}),
  output: z.null(),
  run: async () => {
    throw new Error("mapped execution failure execution-1");
  },
});

const oversizedOutput = defineDriver(manifest, {
  input: z.object({}),
  output: z.string(),
  run: async () => "x".repeat(${SANDBOX_LIMITS.execution.resultBytes + 1}),
});

const oversizedLogEntry = defineDriver(manifest, {
  input: z.object({}),
  output: z.null(),
  run: async () => {
    console.log("🙂".repeat(${Math.floor(SANDBOX_LIMITS.logs.entryBytes / 4) + 1}));
    console.log("ignored");
    return null;
  },
});

const excessiveLogCount = defineDriver(manifest, {
  input: z.object({}),
  output: z.null(),
  run: async () => {
    for (let index = 0; index < ${SANDBOX_LIMITS.logs.entryCount}; index += 1) {
      console.log(index);
    }
    return null;
  },
});

const excessiveLogBytes = defineDriver(manifest, {
  input: z.object({}),
  output: z.null(),
  run: async () => {
    for (let index = 0; index < 40; index += 1) {
      console.log("x".repeat(${SANDBOX_LIMITS.logs.entryBytes}));
    }
    return null;
  },
});

const mutatedIntrinsics = defineDriver(manifest, {
  input: z.object({}),
  output: z.string(),
  run: async () => {
    Reflect.set(JSON, "stringify", () => '"bypassed"');
    Reflect.set(TextEncoder.prototype, "encode", () => new Uint8Array());
    console.log("x".repeat(${SANDBOX_LIMITS.logs.entryBytes + 1}));
    return "x".repeat(${SANDBOX_LIMITS.execution.resultBytes + 1});
  },
});

const unstableSerialization = defineDriver(manifest, {
  input: z.object({}),
  output: z.any(),
  run: async () => {
    let calls = 0;
    return {
      toJSON: () => {
        calls += 1;
        return calls === 1 ? "serialized-once" : "x".repeat(${SANDBOX_LIMITS.execution.resultBytes + 1});
      },
    };
  },
});

export default defineScript({
  manifest,
  drivers: {
    main,
    throwing,
    invalidOutput,
    codeGeneration,
    mutatedIntrinsics,
    oversizedOutput,
    unstableSerialization,
    excessiveLogBytes,
    excessiveLogCount,
    oversizedLogEntry,
  },
});
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
} from "@ryot/sandbox-sdk/core";
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
} from "@ryot/sandbox-sdk/core";
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

const hostBudgetSource = `
import { defineDriver, defineManifest, defineScript } from "@ryot/sandbox-sdk/core";
import * as z from "@ryot/sandbox-sdk/zod";

export const manifest = defineManifest({
  kind: "script",
  name: "Host budgets",
  slug: "host-budgets",
  capabilities: ["getCachedValue", "httpCall"],
  requiredAppConfigKeys: [],
});

const hostCalls = defineDriver(manifest, {
  input: z.object({}),
  output: z.unknown(),
  run: async (_input, host) => {
    let result: unknown = null;
    for (let index = 0; index <= ${SANDBOX_LIMITS.hostCalls.total}; index += 1) {
      result = await host.getCachedValue("budget");
    }
    return result;
  },
});

const httpCalls = defineDriver(manifest, {
  input: z.object({}),
  output: z.unknown(),
  run: async (_input, host) => {
    let result: unknown = null;
    for (let index = 0; index <= ${SANDBOX_LIMITS.hostCalls.http}; index += 1) {
      result = await host.httpCall("GET", "https://example.com/budget");
    }
    return result;
  },
});

export default defineScript({ manifest, drivers: { hostCalls, httpCalls } });
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
} from "@ryot/sandbox-sdk/core";
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
        { entityId: "entity-1", eventSchemaSlug: "event-schema-1", properties: { watched: true } },
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
import { defineDriver, defineManifest, defineScript } from "@ryot/sandbox-sdk/core";
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
import { defineDriver, defineManifest, defineScript } from "@ryot/sandbox-sdk/core";
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
	Effect.scoped(
		Effect.gen(function* () {
			assert(dependencyRuntime);
			assert(runnerPath);
			const apiBase = options.apiBase ?? "http://127.0.0.1:1";
			const request = `${encodeRunnerRequest({
				context,
				apiBase,
				limits: SANDBOX_RUNNER_LIMITS,
				driverName,
				token: "unused",
				metadata: compiled.manifest,
				compiledFormat: compiled.format,
				compiledCode: compiled.javascript,
				scriptId: options.scriptId ?? "script-1",
				apiFunctions: options.apiFunctions ?? [],
				executionId: options.executionId ?? "execution-1",
			})}\n`;
			const executor = yield* CommandExecutor.CommandExecutor;
			const command = Command.make(
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
				`--v8-flags=--max-old-space-size=${SANDBOX_LIMITS.execution.denoHeapMiB}`,
				`--import-map=${dependencyRuntime.importMapPath}`,
				`--allow-net=${new URL(apiBase).host}`,
				`--allow-read=${runnerPath},${dependencyRuntime.directory}`,
				runnerPath,
			).pipe(
				Command.feed(request),
				Command.stdout("pipe"),
				Command.stderr("pipe"),
				Command.env({ DENO_DIR: dependencyRuntime.cacheDirectory }),
			);
			const denoProcess = yield* executor
				.start(command)
				.pipe(
					Effect.mapError((error) => new SandboxRunError({ message: unknownToMessage(error) })),
				);
			yield* Effect.addFinalizer(() => denoProcess.kill("SIGKILL").pipe(Effect.ignore));

			const [stdout, stderr, exitCode] = yield* Effect.all(
				[
					denoProcess.stdout.pipe(
						Stream.decodeText("utf-8"),
						Stream.runFold("", (a, b) => a + b),
					),
					denoProcess.stderr.pipe(
						Stream.decodeText("utf-8"),
						Stream.runFold("", (a, b) => a + b),
					),
					denoProcess.exitCode,
				],
				{ concurrency: "unbounded" },
			).pipe(Effect.mapError((error) => new SandboxRunError({ message: unknownToMessage(error) })));
			expect(exitCode, stderr).toBe(0);

			return yield* Effect.try({
				try: () => decodeRunnerResponse(stdout.trim()),
				catch: (error) => new SandboxRunError({ message: unknownToMessage(error) }),
			});
		}),
	).pipe(Effect.provide(BunContext.layer));

const startCoreHostBridge = (
	options: {
		readonly appConfigValue?: unknown;
		readonly httpResponse?: (url: string) => unknown;
	} = {},
) =>
	Effect.gen(function* () {
		const calls: Array<{ fnName: string; executionId: string; args: readonly unknown[] }> = [];
		const executionScripts = new Map<string, string>();
		const runCache = new Map<string, unknown>();
		const persistentCache = new Map<string, unknown>();
		const runtime = yield* Effect.runtime();

		const server = yield* BunHttpServer.make({
			port: 0,
			hostname: "127.0.0.1",
		});
		yield* HttpServer.serveEffect(
			HttpApp.fromWebHandler((request) =>
				Runtime.runPromise(runtime)(
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
							const customBody = options.httpResponse?.(String(args[1]));
							result = {
								data: {
									status: 200,
									headers: { "content-type": "application/json" },
									body:
										customBody === undefined
											? encodeRunnerRequest({ url: args[1], method: args[0], options: args[2] })
											: encodeRunnerRequest(customBody),
								},
								success: true,
							};
						} else if (fnName === "getAppConfigValue") {
							result = { data: options.appConfigValue ?? "Etc/GMT", success: true };
						} else if (fnName === "getUserPreferences") {
							result = { success: true, data: { isNsfw: false, disableIntegrations: true } };
						} else {
							result = { error: "Unknown function", success: false };
						}

						return Response.json({ result });
					}),
				),
			),
		).pipe(Effect.provideService(HttpServer.HttpServer, server));
		const address = server.address;
		assert(address._tag === "TcpAddress");

		return {
			calls,
			port: address.port,
			register: (executionId: string, scriptId: string) =>
				executionScripts.set(executionId, scriptId),
		};
	});

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
			expect(Reflect.get(invalidInput, "error")).toMatchObject({
				phase: "input",
				message: expect.stringContaining("Driver input validation failed"),
			});

			const invalidOutput = yield* runInDeno(compiled, "invalidOutput", {});
			assert(invalidOutput !== null && typeof invalidOutput === "object");
			expect(Reflect.get(invalidOutput, "error")).toMatchObject({
				phase: "output",
				message: expect.stringContaining("Driver output validation failed"),
			});

			const codeGeneration = yield* runInDeno(compiled, "codeGeneration", {});
			assert(codeGeneration !== null && typeof codeGeneration === "object");
			expect(codeGeneration).toMatchObject({ success: true, value: null });

			const unsupported = yield* runInDeno({ ...compiled, format: 2 }, "main", {
				value: 42,
			});
			assert(unsupported !== null && typeof unsupported === "object");
			expect(Reflect.get(unsupported, "error")).toEqual({
				phase: "load",
				message: "Unsupported sandbox compiled format: 2",
			});
		}).pipe(Effect.provide(SandboxCompiler.Default)),
	));

it("returns source-mapped, sanitized execution and load errors", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const compiler = yield* SandboxCompiler;
			const compiled = yield* compiler.compile(source);
			const throwingLine = source
				.slice(0, source.indexOf('throw new Error("mapped execution failure execution-1")'))
				.split("\n").length;
			const result = yield* runInDeno(compiled, "throwing", {});
			assert(result !== null && typeof result === "object");
			const error = Reflect.get(result, "error");
			assert(error !== null && typeof error === "object");
			expect(error).toMatchObject({
				phase: "execute",
				line: throwingLine,
				message: "mapped execution failure [redacted]",
			});
			const stack = Reflect.get(error, "stack");
			expect(stack).toMatch(/^    at script\.ts:\d+:\d+(?:\n    at script\.ts:\d+:\d+)*$/);
			expect(stack).not.toMatch(/data:|file:|runner|execution-1/);

			const loadSource = source.replace(
				"const main = defineDriver",
				'throw new Error("mapped load failure execution-1");\n\nconst main = defineDriver',
			);
			const loadLine = loadSource
				.slice(0, loadSource.indexOf('throw new Error("mapped load failure execution-1")'))
				.split("\n").length;
			const loadResult = yield* runInDeno(yield* compiler.compile(loadSource), "main", {
				value: 42,
			});
			assert(loadResult !== null && typeof loadResult === "object");
			expect(Reflect.get(loadResult, "error")).toMatchObject({
				phase: "load",
				line: loadLine,
				message: "mapped load failure [redacted]",
			});
		}).pipe(Effect.provide(SandboxCompiler.Default)),
	));

it("bounds output and truncates each log limit exactly once without failing", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const compiler = yield* SandboxCompiler;
			const compiled = yield* compiler.compile(source);

			const oversizedOutput = yield* runInDeno(compiled, "oversizedOutput", {});
			assert(oversizedOutput !== null && typeof oversizedOutput === "object");
			expect(Reflect.get(oversizedOutput, "value")).toBeUndefined();
			expect(Reflect.get(oversizedOutput, "error")).toEqual({
				phase: "output",
				message: `Sandbox driver result exceeds ${SANDBOX_LIMITS.execution.resultBytes} UTF-8 bytes`,
			});

			const entryResult = yield* runInDeno(compiled, "oversizedLogEntry", {});
			assert(entryResult !== null && typeof entryResult === "object");
			const entryLogs = Reflect.get(entryResult, "logs");
			assert(Array.isArray(entryLogs));
			expect(Reflect.get(entryResult, "success")).toBe(true);
			expect(entryLogs).toHaveLength(2);
			expect(utf8ByteLength(String(entryLogs[0]))).toBe(SANDBOX_LIMITS.logs.entryBytes);
			expect(entryLogs[1]).toBe(SANDBOX_LOG_TRUNCATION_MARKER);

			const countResult = yield* runInDeno(compiled, "excessiveLogCount", {});
			assert(countResult !== null && typeof countResult === "object");
			const countLogs = Reflect.get(countResult, "logs");
			assert(Array.isArray(countLogs));
			expect(countLogs).toHaveLength(SANDBOX_LIMITS.logs.entryCount);
			expect(countLogs.filter((log) => log === SANDBOX_LOG_TRUNCATION_MARKER)).toHaveLength(1);

			const byteResult = yield* runInDeno(compiled, "excessiveLogBytes", {});
			assert(byteResult !== null && typeof byteResult === "object");
			const byteLogs = Reflect.get(byteResult, "logs");
			assert(Array.isArray(byteLogs));
			expect(byteLogs.filter((log) => log === SANDBOX_LOG_TRUNCATION_MARKER)).toHaveLength(1);
			expect(
				byteLogs.reduce((total, log) => total + utf8ByteLength(String(log)), 0),
			).toBeLessThanOrEqual(SANDBOX_LIMITS.logs.totalBytes);

			const mutatedResult = yield* runInDeno(compiled, "mutatedIntrinsics", {});
			assert(mutatedResult !== null && typeof mutatedResult === "object");
			expect(Reflect.get(mutatedResult, "error")).toMatchObject({
				phase: "output",
				message: expect.stringContaining("Sandbox driver result exceeds"),
			});
			const mutatedLogs = Reflect.get(mutatedResult, "logs");
			assert(Array.isArray(mutatedLogs));
			expect(mutatedLogs.at(-1)).toBe(SANDBOX_LOG_TRUNCATION_MARKER);

			const serializedOnce = yield* runInDeno(compiled, "unstableSerialization", {});
			assert(serializedOnce !== null && typeof serializedOnce === "object");
			expect(serializedOnce).toMatchObject({ success: true, value: "serialized-once" });
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

it("disables obfuscated string-generated imports at runtime", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const compiler = yield* SandboxCompiler;
			const compiled = yield* compiler.compile(generatedNpmImportSource);
			const result = yield* runInDeno(compiled, "main", {});
			assert(result !== null && typeof result === "object");
			expect(Reflect.get(result, "error")).toMatchObject({
				phase: "execute",
				message: expect.stringContaining("Function is not a function"),
			});
		}).pipe(Effect.provide(SandboxCompiler.Default)),
	));

it("executes typed core host methods and filters the Deno host to declared capabilities", () =>
	Effect.runPromise(
		Effect.scoped(
			Effect.gen(function* () {
				const bridge = yield* startCoreHostBridge();
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

it(
	"imports every generated built-in module in Deno",
	() =>
		Effect.runPromise(
			Effect.forEach(
				generatedBuiltinSandboxScripts,
				(script) =>
					Effect.gen(function* () {
						const result = yield* runInDeno(
							{
								manifest: script.manifest,
								format: script.compiledFormat,
								javascript: script.compiledCode,
							},
							"__ryot_nonexistent_driver__",
							{},
						);
						assert(result !== null && typeof result === "object", script.slug);
						const error = Reflect.get(result, "error");
						assert(error !== null && typeof error === "object", `${script.slug} failed to load`);
						expect(Reflect.get(error, "phase"), script.slug).toBe("load");
						expect(Reflect.get(error, "message"), script.slug).toContain(
							"is not defined in this script",
						);
					}),
				{ concurrency: 5 },
			),
		),
	120_000,
);

it("loads and executes the generated TMDB Show module in Deno", () =>
	Effect.runPromise(
		Effect.scoped(
			Effect.gen(function* () {
				const bridge = yield* startCoreHostBridge({
					appConfigValue: "tmdb-token",
					httpResponse: (url) => {
						expect(new URL(url).pathname).toBe("/3/search/tv");
						return {
							total_pages: 1,
							total_results: 1,
							results: [
								{
									id: 42,
									name: "Generated Show",
									poster_path: "/poster.jpg",
									first_air_date: "2024-01-01",
								},
							],
						};
					},
				});
				const compiled = {
					manifest: sandboxShowDotTmdbScript.manifest,
					format: sandboxShowDotTmdbScript.compiledFormat,
					javascript: sandboxShowDotTmdbScript.compiledCode,
				};
				const result = yield* runInDeno(
					compiled,
					"search",
					{ query: "Generated", page: 1, pageSize: 20 },
					{
						apiBase: `http://127.0.0.1:${bridge.port}`,
						apiFunctions: compiled.manifest.capabilities,
					},
				);
				assert(result !== null && typeof result === "object");
				expect(result).toMatchObject({ success: true });
				expect(Reflect.get(result, "value")).toEqual({
					details: { totalItems: 1, nextPage: null },
					items: [
						{
							externalId: "42",
							calloutProperty: { kind: "null", value: null },
							titleProperty: { kind: "text", value: "Generated Show" },
							primarySubtitleProperty: { kind: "number", value: 2024 },
							secondarySubtitleProperty: { kind: "null", value: null },
							imageProperty: {
								kind: "image",
								value: { type: "remote", url: "https://image.tmdb.org/t/p/original/poster.jpg" },
							},
						},
					],
				});
			}),
		),
	));

it("loads and executes the remaining generated TMDB provider family in Deno", () =>
	Effect.runPromise(
		Effect.scoped(
			Effect.gen(function* () {
				const bridge = yield* startCoreHostBridge({
					appConfigValue: "tmdb-token",
					httpResponse: (url) => {
						const path = new URL(url).pathname;
						if (path === "/3/search/movie") {
							return {
								total_pages: 1,
								total_results: 1,
								results: [{ id: 1, title: "Generated Movie", release_date: "2025-01-01" }],
							};
						}
						if (path === "/3/search/person") {
							return {
								total_pages: 1,
								total_results: 1,
								results: [{ id: 2, name: "Generated Person" }],
							};
						}
						if (path === "/3/search/company") {
							return {
								total_pages: 1,
								total_results: 1,
								results: [{ id: 3, name: "Generated Company" }],
							};
						}
						expect(path).toBe("/3/search/collection");
						return {
							total_pages: 1,
							total_results: 1,
							results: [{ id: 4, name: "Generated Collection" }],
						};
					},
				});
				const cases = [
					{ entry: sandboxMovieDotTmdbScript, title: "Generated Movie", externalId: "1" },
					{ entry: sandboxPersonDotTmdbScript, title: "Generated Person", externalId: "2" },
					{ entry: sandboxCompanyDotTmdbScript, title: "Generated Company", externalId: "3" },
					{
						externalId: "4",
						title: "Generated Collection",
						entry: sandboxMovieDashGroupDotTmdbScript,
					},
				];
				for (const scenario of cases) {
					const compiled = {
						manifest: scenario.entry.manifest,
						format: scenario.entry.compiledFormat,
						javascript: scenario.entry.compiledCode,
					};
					const result = yield* runInDeno(
						compiled,
						"search",
						{ query: "Generated", page: 1, pageSize: 20 },
						{
							apiBase: `http://127.0.0.1:${bridge.port}`,
							apiFunctions: compiled.manifest.capabilities,
						},
					);
					assert(result !== null && typeof result === "object");
					expect(result).toMatchObject({ success: true });
					expect(Reflect.get(result, "value")).toMatchObject({
						details: { totalItems: 1, nextPage: null },
						items: [
							{
								externalId: scenario.externalId,
								titleProperty: { kind: "text", value: scenario.title },
							},
						],
					});
				}
			}),
		),
	));

it("loads and executes the generated TVDB Show module in Deno through the token flow", () =>
	Effect.runPromise(
		Effect.scoped(
			Effect.gen(function* () {
				const bridge = yield* startCoreHostBridge({
					appConfigValue: "tvdb-api-key",
					httpResponse: (url) => {
						const path = new URL(url).pathname;
						if (path === "/v4/login") {
							return { status: "success", data: { token: "generated-token" } };
						}
						expect(path).toBe("/v4/search");
						return {
							status: "success",
							links: { next: null, total_items: 1 },
							data: [
								{
									tvdb_id: "42",
									name: "Generated Series",
									poster: "https://example.com/poster.jpg",
								},
							],
						};
					},
				});
				const compiled = {
					manifest: sandboxShowDotTvdbScript.manifest,
					format: sandboxShowDotTvdbScript.compiledFormat,
					javascript: sandboxShowDotTvdbScript.compiledCode,
				};
				const result = yield* runInDeno(
					compiled,
					"search",
					{ query: "Generated", page: 1, pageSize: 20 },
					{
						apiBase: `http://127.0.0.1:${bridge.port}`,
						apiFunctions: compiled.manifest.capabilities,
					},
				);
				assert(result !== null && typeof result === "object");
				expect(result).toMatchObject({ success: true });
				expect(Reflect.get(result, "value")).toEqual({
					details: { totalItems: 1, nextPage: null },
					items: [
						{
							externalId: "42",
							calloutProperty: { kind: "null", value: null },
							primarySubtitleProperty: { kind: "null", value: null },
							secondarySubtitleProperty: { kind: "null", value: null },
							titleProperty: { kind: "text", value: "Generated Series" },
							imageProperty: {
								kind: "image",
								value: { type: "remote", url: "https://example.com/poster.jpg" },
							},
						},
					],
				});
				const cacheWrite = bridge.calls.find((call) => call.fnName === "setCachedValue");
				expect(cacheWrite?.args).toEqual(["tvdb_access_token", "Bearer generated-token", 82800]);
			}),
		),
	));

it("loads and executes the remaining generated TVDB provider family in Deno", () =>
	Effect.runPromise(
		Effect.scoped(
			Effect.gen(function* () {
				const bridge = yield* startCoreHostBridge({
					appConfigValue: "tvdb-api-key",
					httpResponse: (url) => {
						const requestUrl = new URL(url);
						if (requestUrl.pathname === "/v4/login") {
							return { status: "success", data: { token: "generated-token" } };
						}
						if (requestUrl.pathname === "/v4/lists/4/translations/eng") {
							return {
								status: "success",
								data: [
									{ isPrimary: true, name: "Generated List", overview: "Translated overview" },
								],
							};
						}
						expect(requestUrl.pathname).toBe("/v4/search");
						const searchType = requestUrl.searchParams.get("type");
						const results: Readonly<Record<string, { tvdb_id: string; name: string }>> = {
							movie: { tvdb_id: "1", name: "Generated Movie" },
							person: { tvdb_id: "2", name: "Generated Person" },
							company: { tvdb_id: "3", name: "Generated Company" },
						};
						const result = searchType === null ? undefined : results[searchType];
						expect(result).toBeDefined();
						return {
							status: "success",
							links: { next: null, total_items: 1 },
							data: result === undefined ? [] : [result],
						};
					},
				});
				const apiBase = `http://127.0.0.1:${bridge.port}`;
				const searchCases = [
					{ entry: sandboxMovieDotTvdbScript, title: "Generated Movie", externalId: "1" },
					{ entry: sandboxPersonDotTvdbScript, title: "Generated Person", externalId: "2" },
					{ entry: sandboxCompanyDotTvdbScript, title: "Generated Company", externalId: "3" },
				];
				for (const scenario of searchCases) {
					const compiled = {
						manifest: scenario.entry.manifest,
						format: scenario.entry.compiledFormat,
						javascript: scenario.entry.compiledCode,
					};
					const result = yield* runInDeno(
						compiled,
						"search",
						{ query: "Generated", page: 1, pageSize: 20 },
						{ apiBase, apiFunctions: compiled.manifest.capabilities },
					);
					assert(result !== null && typeof result === "object");
					expect(result).toMatchObject({ success: true });
					expect(Reflect.get(result, "value")).toMatchObject({
						details: { totalItems: 1, nextPage: null },
						items: [
							{
								externalId: scenario.externalId,
								titleProperty: { kind: "text", value: scenario.title },
							},
						],
					});
				}

				const groupEntry = sandboxMovieDashGroupDotTvdbScript;
				const translated = yield* runInDeno(
					{
						manifest: groupEntry.manifest,
						format: groupEntry.compiledFormat,
						javascript: groupEntry.compiledCode,
					},
					"translate",
					{ externalId: "4", language: "en", entitySchemaSlug: "movie-group" },
					{ apiBase, apiFunctions: groupEntry.manifest.capabilities },
				);
				assert(translated !== null && typeof translated === "object");
				expect(translated).toMatchObject({ success: true });
				expect(Reflect.get(translated, "value")).toEqual({
					name: "Generated List",
					properties: { description: "Translated overview" },
				});
			}),
		),
	));

it("loads and executes the generated AniList anime module in Deno with bundled helpers", () =>
	Effect.runPromise(
		Effect.scoped(
			Effect.gen(function* () {
				const bridge = yield* startCoreHostBridge({
					httpResponse: (url) => {
						expect(new URL(url).host).toBe("graphql.anilist.co");
						return {
							data: {
								Media: {
									id: 7,
									episodes: 12,
									type: "ANIME",
									isAdult: false,
									averageScore: 83,
									bannerImage: null,
									status: "FINISHED",
									genres: ["Action"],
									nextAiringEpisode: null,
									tags: [{ name: "Space" }],
									startDate: { year: 2020 },
									description: "Line one<br>Line two",
									title: { english: "Generated Anime" },
									coverImage: { extraLarge: "https://img.example/cover.jpg" },
									studios: { nodes: [{ id: 11, name: "Generated Studio" }] },
									airingSchedule: { nodes: [{ episode: 1, airingAt: 1700000000 }] },
									recommendations: {
										nodes: [
											{
												mediaRecommendation: {
													id: 8,
													type: "MANGA",
													title: { english: "Suggested Manga" },
												},
											},
										],
									},
								},
							},
						};
					},
				});
				const entry = sandboxAnimeDotAnilistScript;
				const compiled = {
					manifest: entry.manifest,
					format: entry.compiledFormat,
					javascript: entry.compiledCode,
				};
				const result = yield* runInDeno(
					compiled,
					"details",
					{ externalId: "7" },
					{
						apiBase: `http://127.0.0.1:${bridge.port}`,
						apiFunctions: compiled.manifest.capabilities,
					},
				);
				assert(result !== null && typeof result === "object");
				expect(result).toMatchObject({ success: true });
				expect(Reflect.get(result, "value")).toEqual({
					name: "Generated Anime",
					relatedEntityGroups: [
						{
							direction: "incoming",
							synchronization: "additive",
							relationshipSchemaSlug: "company-to-anime",
							entities: [
								{
									externalId: "11",
									name: "Generated Studio",
									scriptSlug: "company.anilist",
									relationshipProperties: { roles: ["Animation Studio"] },
								},
							],
						},
						{
							direction: "outgoing",
							synchronization: "authoritative",
							relationshipSchemaSlug: "media-suggestion",
							entities: [{ name: "Suggested Manga", externalId: "8", scriptSlug: "manga.anilist" }],
						},
					],
					properties: {
						episodes: 12,
						isNsfw: false,
						publishYear: 2020,
						providerRating: 83,
						genres: ["Action", "Space"],
						productionStatus: "Finished",
						description: "Line one\nLine two",
						sourceUrl: "https://anilist.co/anime/7/Generated%20Anime",
						images: [{ type: "remote", url: "https://img.example/cover.jpg" }],
						airingSchedule: [{ episode: 1, airingAt: "2023-11-14T22:13:20.000Z" }],
					},
				});
			}),
		),
	));

it("loads and executes the generated MyAnimeList and MangaUpdates modules in Deno", () =>
	Effect.runPromise(
		Effect.scoped(
			Effect.gen(function* () {
				const bridge = yield* startCoreHostBridge({
					appConfigValue: "mal-client-id",
					httpResponse: (url) => {
						const requestUrl = new URL(url);
						if (requestUrl.host === "api.myanimelist.net") {
							expect(requestUrl.pathname).toBe("/v2/anime");
							return {
								paging: {},
								data: [
									{
										node: {
											id: 5,
											start_date: "2021-05-10",
											title: "Generated MAL Anime",
											main_picture: { large: "https://img.example/mal.jpg" },
										},
									},
								],
							};
						}
						expect(requestUrl.host).toBe("api.mangaupdates.com");
						expect(requestUrl.pathname).toBe("/v1/series/search");
						return {
							total_hits: 1,
							results: [
								{
									hit_title: "Generated Series",
									record: {
										year: "2019",
										series_id: 9,
										image: { url: { original: "https://img.example/mu.jpg" } },
									},
								},
							],
						};
					},
				});
				const apiBase = `http://127.0.0.1:${bridge.port}`;
				const searchCases = [
					{
						externalId: "5",
						publishYear: 2021,
						title: "Generated MAL Anime",
						image: "https://img.example/mal.jpg",
						entry: sandboxAnimeDotMyanimelistScript,
					},
					{
						externalId: "9",
						publishYear: 2019,
						title: "Generated Series",
						image: "https://img.example/mu.jpg",
						entry: sandboxMangaDotMangaDashUpdatesScript,
					},
				];
				for (const scenario of searchCases) {
					const compiled = {
						manifest: scenario.entry.manifest,
						format: scenario.entry.compiledFormat,
						javascript: scenario.entry.compiledCode,
					};
					const result = yield* runInDeno(
						compiled,
						"search",
						{ query: "Generated", page: 1, pageSize: 20 },
						{ apiBase, apiFunctions: compiled.manifest.capabilities },
					);
					assert(result !== null && typeof result === "object");
					expect(result).toMatchObject({ success: true });
					expect(Reflect.get(result, "value")).toEqual({
						details: { totalItems: 1, nextPage: null },
						items: [
							{
								externalId: scenario.externalId,
								calloutProperty: { kind: "null", value: null },
								secondarySubtitleProperty: { kind: "null", value: null },
								titleProperty: { kind: "text", value: scenario.title },
								primarySubtitleProperty: { kind: "number", value: scenario.publishYear },
								imageProperty: { kind: "image", value: { type: "remote", url: scenario.image } },
							},
						],
					});
				}
				const malConfigCall = bridge.calls.find((call) => call.fnName === "getAppConfigValue");
				expect(malConfigCall?.args).toEqual(["animeAndManga.malClientId"]);
			}),
		),
	));

it("loads and executes the generated Hardcover book module in Deno through the GraphQL flow", () =>
	Effect.runPromise(
		Effect.scoped(
			Effect.gen(function* () {
				const bridge = yield* startCoreHostBridge({
					appConfigValue: "hardcover-key",
					httpResponse: (url) => {
						expect(new URL(url).host).toBe("api.hardcover.app");
						return {
							data: {
								books_by_pk: {
									id: "42",
									images: [],
									pages: 300,
									book_series: [],
									slug: "the-book",
									title: "The Book",
									release_year: 2020,
									description: "A book.",
									release_date: "2020-01-01",
									image: { url: "https://img/cover.jpg" },
									cached_tags: { Genre: [{ tag: "science fiction" }] },
									contributions: [
										{ contribution: "Author", author_id: 7, author: { name: "Jane Doe" } },
									],
								},
							},
						};
					},
				});
				const entry = sandboxBookDotHardcoverScript;
				const compiled = {
					manifest: entry.manifest,
					format: entry.compiledFormat,
					javascript: entry.compiledCode,
				};
				const result = yield* runInDeno(
					compiled,
					"details",
					{ externalId: "42" },
					{
						apiBase: `http://127.0.0.1:${bridge.port}`,
						apiFunctions: compiled.manifest.capabilities,
					},
				);
				assert(result !== null && typeof result === "object");
				expect(result).toMatchObject({ success: true });
				expect(Reflect.get(result, "value")).toMatchObject({
					name: "The Book",
					properties: { publishYear: 2020, genres: ["Science Fiction"] },
					relatedEntityGroups: [
						{
							relationshipSchemaSlug: "person-to-book",
							entities: [{ externalId: "7", name: "Jane Doe" }],
						},
						{ relationshipSchemaSlug: "company-to-book", entities: [] },
						{ relationshipSchemaSlug: "book-group-to-book", entities: [] },
					],
				});
				const configCall = bridge.calls.find((call) => call.fnName === "getAppConfigValue");
				expect(configCall?.args).toEqual(["books.hardcoverApiKey"]);
			}),
		),
	));

it("loads and executes the generated OpenLibrary book module in Deno with custom date parsing", () =>
	Effect.runPromise(
		Effect.scoped(
			Effect.gen(function* () {
				const bridge = yield* startCoreHostBridge({
					httpResponse: (url) => {
						const requestUrl = new URL(url);
						expect(requestUrl.host).toBe("openlibrary.org");
						if (requestUrl.pathname.endsWith("/editions.json")) {
							return {
								entries: [
									{ number_of_pages: 320, publish_date: "May 5, 2001" },
									{ publish_date: "1999" },
								],
							};
						}
						if (requestUrl.pathname === "/authors/OL1A.json") {
							return { name: "Author Name" };
						}
						return {
							covers: [111],
							title: "The Work",
							key: "/works/OL1W",
							subjects: ["Fiction"],
							authors: [{ author: { key: "/authors/OL1A" } }],
						};
					},
				});
				const entry = sandboxBookDotOpenlibraryScript;
				const compiled = {
					manifest: entry.manifest,
					format: entry.compiledFormat,
					javascript: entry.compiledCode,
				};
				const result = yield* runInDeno(
					compiled,
					"details",
					{ externalId: "OL1W" },
					{
						apiBase: `http://127.0.0.1:${bridge.port}`,
						apiFunctions: compiled.manifest.capabilities,
					},
				);
				assert(result !== null && typeof result === "object");
				expect(result).toMatchObject({ success: true });
				expect(Reflect.get(result, "value")).toMatchObject({
					name: "The Work",
					properties: { pages: 320, publishYear: 1999, genres: ["Fiction"] },
					relatedEntityGroups: [{ entities: [{ externalId: "OL1A", name: "Author Name" }] }],
				});
			}),
		),
	));

it("loads and executes the generated Google Books module in Deno through the REST flow", () =>
	Effect.runPromise(
		Effect.scoped(
			Effect.gen(function* () {
				const bridge = yield* startCoreHostBridge({
					appConfigValue: "google-key",
					httpResponse: (url) => {
						const requestUrl = new URL(url);
						expect(requestUrl.host).toBe("www.googleapis.com");
						expect(requestUrl.pathname).toBe("/books/v1/volumes");
						return {
							totalItems: 1,
							items: [
								{
									id: "g1",
									volumeInfo: {
										title: "G Book",
										publishedDate: "2010-06-01",
										imageLinks: { thumbnail: "https://img/t.jpg" },
									},
								},
							],
						};
					},
				});
				const entry = sandboxBookDotGoogleDashBooksScript;
				const compiled = {
					manifest: entry.manifest,
					format: entry.compiledFormat,
					javascript: entry.compiledCode,
				};
				const result = yield* runInDeno(
					compiled,
					"search",
					{ query: "g", page: 1, pageSize: 20 },
					{
						apiBase: `http://127.0.0.1:${bridge.port}`,
						apiFunctions: compiled.manifest.capabilities,
					},
				);
				assert(result !== null && typeof result === "object");
				expect(result).toMatchObject({ success: true });
				expect(Reflect.get(result, "value")).toEqual({
					details: { totalItems: 1, nextPage: null },
					items: [
						{
							externalId: "g1",
							calloutProperty: { kind: "null", value: null },
							titleProperty: { kind: "text", value: "G Book" },
							secondarySubtitleProperty: { kind: "null", value: null },
							primarySubtitleProperty: { kind: "number", value: 2010 },
							imageProperty: { kind: "image", value: { type: "remote", url: "https://img/t.jpg" } },
						},
					],
				});
			}),
		),
	));

it("loads and executes the generated Audible module in Deno with HTML description cleaning", () =>
	Effect.runPromise(
		Effect.scoped(
			Effect.gen(function* () {
				const bridge = yield* startCoreHostBridge({
					httpResponse: (url) => {
						expect(new URL(url).host).toBe("api.audible.com");
						if (url.includes("/sims?")) {
							return { similar_products: [] };
						}
						return {
							product: {
								series: [],
								asin: "B01",
								narrators: [],
								title: "The Book",
								category_ladders: [],
								is_adult_product: false,
								runtime_length_min: 120,
								release_date: "2020-05-02",
								publisher_summary: "<p>Hello<br>World</p>",
								authors: [{ name: "Jane Doe", asin: "A1" }],
								product_images: { "2400": "https://img/2400.jpg" },
								rating: { num_reviews: 0, overall_distribution: {} },
							},
						};
					},
				});
				const entry = sandboxAudiobookDotAudibleScript;
				const compiled = {
					manifest: entry.manifest,
					format: entry.compiledFormat,
					javascript: entry.compiledCode,
				};
				const result = yield* runInDeno(
					compiled,
					"details",
					{ externalId: "B01" },
					{
						apiBase: `http://127.0.0.1:${bridge.port}`,
						apiFunctions: compiled.manifest.capabilities,
					},
				);
				assert(result !== null && typeof result === "object");
				expect(result).toMatchObject({ success: true });
				expect(Reflect.get(result, "value")).toMatchObject({
					name: "The Book",
					properties: { publishYear: 2020, description: "Hello\nWorld" },
					relatedEntityGroups: [
						{
							relationshipSchemaSlug: "person-to-audiobook",
							entities: [{ externalId: "A1", name: "Jane Doe" }],
						},
						{ relationshipSchemaSlug: "audiobook-group-to-audiobook", entities: [] },
						{ relationshipSchemaSlug: "media-suggestion", entities: [] },
					],
				});
			}),
		),
	));

it("loads and executes the generated iTunes podcast module in Deno", () =>
	Effect.runPromise(
		Effect.scoped(
			Effect.gen(function* () {
				const bridge = yield* startCoreHostBridge({
					httpResponse: (url) => {
						const requestUrl = new URL(url);
						expect(requestUrl.host).toBe("itunes.apple.com");
						expect(requestUrl.pathname).toBe("/search");
						return {
							results: [
								{
									collectionId: 123,
									collectionName: "My Podcast",
									releaseDate: "2021-01-01T00:00:00Z",
									artworkUrl600: "https://img/600.jpg",
								},
							],
						};
					},
				});
				const entry = sandboxPodcastDotItunesScript;
				const compiled = {
					manifest: entry.manifest,
					format: entry.compiledFormat,
					javascript: entry.compiledCode,
				};
				const result = yield* runInDeno(
					compiled,
					"search",
					{ query: "podcast", page: 1, pageSize: 20 },
					{
						apiBase: `http://127.0.0.1:${bridge.port}`,
						apiFunctions: compiled.manifest.capabilities,
					},
				);
				assert(result !== null && typeof result === "object");
				expect(result).toMatchObject({ success: true });
				expect(Reflect.get(result, "value")).toMatchObject({
					details: { totalItems: 1, nextPage: null },
					items: [
						{
							externalId: "123",
							titleProperty: { kind: "text", value: "My Podcast" },
							primarySubtitleProperty: { kind: "number", value: 2021 },
							imageProperty: {
								kind: "image",
								value: { type: "remote", url: "https://img/600.jpg" },
							},
						},
					],
				});
			}),
		),
	));

it("loads and executes the generated ListenNotes podcast module in Deno through the API key header", () =>
	Effect.runPromise(
		Effect.scoped(
			Effect.gen(function* () {
				const bridge = yield* startCoreHostBridge({
					appConfigValue: "listennotes-key",
					httpResponse: (url) => {
						const requestUrl = new URL(url);
						expect(requestUrl.host).toBe("listen-api.listennotes.com");
						expect(requestUrl.pathname).toBe("/api/v2/search");
						return {
							total: 1,
							next_offset: null,
							results: [
								{
									id: "abc",
									image: "https://img/ln.jpg",
									title_original: "LN Podcast",
									earliest_pub_date_ms: 1609459200000,
								},
							],
						};
					},
				});
				const entry = sandboxPodcastDotListennotesScript;
				const compiled = {
					manifest: entry.manifest,
					format: entry.compiledFormat,
					javascript: entry.compiledCode,
				};
				const result = yield* runInDeno(
					compiled,
					"search",
					{ query: "podcast", page: 1, pageSize: 20 },
					{
						apiBase: `http://127.0.0.1:${bridge.port}`,
						apiFunctions: compiled.manifest.capabilities,
					},
				);
				assert(result !== null && typeof result === "object");
				expect(result).toMatchObject({ success: true });
				expect(Reflect.get(result, "value")).toMatchObject({
					details: { totalItems: 1, nextPage: null },
					items: [
						{
							externalId: "abc",
							titleProperty: { kind: "text", value: "LN Podcast" },
							primarySubtitleProperty: { kind: "number", value: 2021 },
							imageProperty: {
								kind: "image",
								value: { type: "remote", url: "https://img/ln.jpg" },
							},
						},
					],
				});
				const configCall = bridge.calls.find((call) => call.fnName === "getAppConfigValue");
				expect(configCall?.args).toEqual(["podcasts.listennotesApiKey"]);
			}),
		),
	));

it("loads and executes the generated MusicBrainz module in Deno", () =>
	Effect.runPromise(
		Effect.scoped(
			Effect.gen(function* () {
				const bridge = yield* startCoreHostBridge({
					httpResponse: (url) => {
						const requestUrl = new URL(url);
						expect(requestUrl.host).toBe("musicbrainz.org");
						expect(requestUrl.pathname).toBe("/ws/2/recording");
						return {
							count: 1,
							recordings: [{ id: "rec-1", title: "Song One", "first-release-date": "2020-05-01" }],
						};
					},
				});
				const entry = sandboxMusicDotMusicDashBrainzScript;
				const compiled = {
					manifest: entry.manifest,
					format: entry.compiledFormat,
					javascript: entry.compiledCode,
				};
				const result = yield* runInDeno(
					compiled,
					"search",
					{ query: "song", page: 1, pageSize: 20 },
					{
						apiBase: `http://127.0.0.1:${bridge.port}`,
						apiFunctions: compiled.manifest.capabilities,
					},
				);
				assert(result !== null && typeof result === "object");
				expect(result).toMatchObject({ success: true });
				expect(Reflect.get(result, "value")).toMatchObject({
					details: { totalItems: 1, nextPage: null },
					items: [
						{
							externalId: "rec-1",
							titleProperty: { kind: "text", value: "Song One" },
							primarySubtitleProperty: { kind: "number", value: 2020 },
						},
					],
				});
			}),
		),
	));

it("loads and executes the generated Spotify module in Deno through the token cache flow", () =>
	Effect.runPromise(
		Effect.scoped(
			Effect.gen(function* () {
				const bridge = yield* startCoreHostBridge({
					appConfigValue: "spotify-cred",
					httpResponse: (url) => {
						const requestUrl = new URL(url);
						if (requestUrl.host === "accounts.spotify.com") {
							expect(requestUrl.pathname).toBe("/api/token");
							return { access_token: "tok", token_type: "Bearer", expires_in: 3600 };
						}
						expect(requestUrl.host).toBe("api.spotify.com");
						expect(requestUrl.pathname).toBe("/v1/search");
						return {
							tracks: {
								total: 1,
								items: [
									{
										id: "t1",
										name: "Track One",
										album: {
											release_date: "2019-03-03",
											images: [{ url: "https://img/s.jpg", width: 640, height: 640 }],
										},
									},
								],
							},
						};
					},
				});
				const entry = sandboxMusicDotSpotifyScript;
				const compiled = {
					manifest: entry.manifest,
					format: entry.compiledFormat,
					javascript: entry.compiledCode,
				};
				const result = yield* runInDeno(
					compiled,
					"search",
					{ query: "track", page: 1, pageSize: 20 },
					{
						apiBase: `http://127.0.0.1:${bridge.port}`,
						apiFunctions: compiled.manifest.capabilities,
					},
				);
				assert(result !== null && typeof result === "object");
				expect(result).toMatchObject({ success: true });
				expect(Reflect.get(result, "value")).toMatchObject({
					details: { totalItems: 1, nextPage: null },
					items: [
						{
							externalId: "t1",
							titleProperty: { kind: "text", value: "Track One" },
							primarySubtitleProperty: { kind: "number", value: 2019 },
							imageProperty: { kind: "image", value: { type: "remote", url: "https://img/s.jpg" } },
						},
					],
				});
				const tokenWrite = bridge.calls.find((call) => call.fnName === "setCachedValue");
				expect(tokenWrite?.args).toEqual(["spotify_access_token", "tok", 3300]);
			}),
		),
	));

it("loads and executes the generated GiantBomb module in Deno", () =>
	Effect.runPromise(
		Effect.scoped(
			Effect.gen(function* () {
				const bridge = yield* startCoreHostBridge({
					appConfigValue: "giant-bomb-key",
					httpResponse: (url) => {
						const requestUrl = new URL(url);
						expect(requestUrl.host).toBe("www.giantbomb.com");
						expect(requestUrl.pathname).toBe("/api/search/");
						return {
							error: "OK",
							number_of_total_results: 1,
							results: [
								{
									guid: "3030-1",
									name: "My Game",
									original_release_date: "2015-06-01 00:00:00",
									image: { original_url: "https://img/gb.jpg" },
								},
							],
						};
					},
				});
				const entry = sandboxVideoDashGameDotGiantDashBombScript;
				const compiled = {
					manifest: entry.manifest,
					format: entry.compiledFormat,
					javascript: entry.compiledCode,
				};
				const result = yield* runInDeno(
					compiled,
					"search",
					{ query: "game", page: 1, pageSize: 20 },
					{
						apiBase: `http://127.0.0.1:${bridge.port}`,
						apiFunctions: compiled.manifest.capabilities,
					},
				);
				assert(result !== null && typeof result === "object");
				expect(result).toMatchObject({ success: true });
				expect(Reflect.get(result, "value")).toMatchObject({
					details: { totalItems: 1, nextPage: null },
					items: [
						{
							externalId: "3030-1",
							titleProperty: { kind: "text", value: "My Game" },
							primarySubtitleProperty: { kind: "number", value: 2015 },
							imageProperty: {
								kind: "image",
								value: { type: "remote", url: "https://img/gb.jpg" },
							},
						},
					],
				});
			}),
		),
	));

it("loads and executes the generated IGDB module in Deno through the Twitch OAuth flow", () =>
	Effect.runPromise(
		Effect.scoped(
			Effect.gen(function* () {
				const bridge = yield* startCoreHostBridge({
					appConfigValue: "twitch-cred",
					httpResponse: (url) => {
						const requestUrl = new URL(url);
						if (requestUrl.host === "id.twitch.tv") {
							expect(requestUrl.pathname).toBe("/oauth2/token");
							return { access_token: "tok", token_type: "bearer", expires_in: 3600 };
						}
						expect(requestUrl.host).toBe("api.igdb.com");
						expect(requestUrl.pathname).toBe("/v4/games");
						return [
							{
								id: 1020,
								name: "IGDB Game",
								cover: { image_id: "co1" },
								first_release_date: 1433116800,
							},
						];
					},
				});
				const entry = sandboxVideoDashGameDotIgdbScript;
				const compiled = {
					manifest: entry.manifest,
					format: entry.compiledFormat,
					javascript: entry.compiledCode,
				};
				const result = yield* runInDeno(
					compiled,
					"search",
					{ query: "game", page: 1, pageSize: 20 },
					{
						apiBase: `http://127.0.0.1:${bridge.port}`,
						apiFunctions: compiled.manifest.capabilities,
					},
				);
				assert(result !== null && typeof result === "object");
				expect(result).toMatchObject({ success: true });
				expect(Reflect.get(result, "value")).toMatchObject({
					details: { totalItems: 1, nextPage: null },
					items: [
						{
							externalId: "1020",
							titleProperty: { kind: "text", value: "IGDB Game" },
							primarySubtitleProperty: { kind: "number", value: 2015 },
							imageProperty: {
								kind: "image",
								value: {
									type: "remote",
									url: "https://images.igdb.com/igdb/image/upload/t_cover_big/co1.jpg",
								},
							},
						},
					],
				});
				const tokenWrite = bridge.calls.find((call) => call.fnName === "setCachedValue");
				expect(tokenWrite?.args).toEqual([
					"access_token",
					{ accessToken: "Bearer tok", clientId: "twitch-cred" },
					3300,
				]);
			}),
		),
	));

it("loads and executes the generated Metron module in Deno through Basic auth", () =>
	Effect.runPromise(
		Effect.scoped(
			Effect.gen(function* () {
				const bridge = yield* startCoreHostBridge({
					appConfigValue: "metron-cred",
					httpResponse: (url) => {
						const requestUrl = new URL(url);
						expect(requestUrl.host).toBe("metron.cloud");
						expect(requestUrl.pathname).toBe("/api/issue/");
						return {
							count: 1,
							results: [
								{
									id: 5,
									number: "1",
									cover_date: "2021-04-01",
									image: "https://img/m.jpg",
									series: { name: "My Series" },
								},
							],
						};
					},
				});
				const entry = sandboxComicDashBookDotMetronScript;
				const compiled = {
					manifest: entry.manifest,
					format: entry.compiledFormat,
					javascript: entry.compiledCode,
				};
				const result = yield* runInDeno(
					compiled,
					"search",
					{ query: "series", page: 1, pageSize: 20 },
					{
						apiBase: `http://127.0.0.1:${bridge.port}`,
						apiFunctions: compiled.manifest.capabilities,
					},
				);
				assert(result !== null && typeof result === "object");
				expect(result).toMatchObject({ success: true });
				expect(Reflect.get(result, "value")).toMatchObject({
					details: { totalItems: 1, nextPage: null },
					items: [
						{
							externalId: "5",
							titleProperty: { kind: "text", value: "My Series #1" },
							primarySubtitleProperty: { kind: "number", value: 2021 },
							imageProperty: { kind: "image", value: { type: "remote", url: "https://img/m.jpg" } },
						},
					],
				});
			}),
		),
	));

it("loads and executes the generated VNDB module in Deno", () =>
	Effect.runPromise(
		Effect.scoped(
			Effect.gen(function* () {
				const bridge = yield* startCoreHostBridge({
					httpResponse: (url) => {
						const requestUrl = new URL(url);
						expect(requestUrl.host).toBe("api.vndb.org");
						expect(requestUrl.pathname).toBe("/kana/vn");
						return {
							count: 1,
							more: false,
							results: [
								{
									id: "v17",
									title: "My VN",
									released: "2015-06-01",
									image: { url: "https://img/vn.jpg" },
								},
							],
						};
					},
				});
				const entry = sandboxVisualDashNovelDotVndbScript;
				const compiled = {
					manifest: entry.manifest,
					format: entry.compiledFormat,
					javascript: entry.compiledCode,
				};
				const result = yield* runInDeno(
					compiled,
					"search",
					{ query: "vn", page: 1, pageSize: 20 },
					{
						apiBase: `http://127.0.0.1:${bridge.port}`,
						apiFunctions: compiled.manifest.capabilities,
					},
				);
				assert(result !== null && typeof result === "object");
				expect(result).toMatchObject({ success: true });
				expect(Reflect.get(result, "value")).toMatchObject({
					details: { totalItems: 1, nextPage: null },
					items: [
						{
							externalId: "v17",
							titleProperty: { kind: "text", value: "My VN" },
							primarySubtitleProperty: { kind: "number", value: 2015 },
							imageProperty: {
								kind: "image",
								value: { type: "remote", url: "https://img/vn.jpg" },
							},
						},
					],
				});
			}),
		),
	));

it("loads and executes the generated Free Exercise DB module in Deno with cache chunking", () =>
	Effect.runPromise(
		Effect.scoped(
			Effect.gen(function* () {
				const bridge = yield* startCoreHostBridge({
					httpResponse: (url) => {
						expect(new URL(url).host).toBe("raw.githubusercontent.com");
						return [
							{
								force: "push",
								level: "beginner",
								name: "Bench Press",
								mechanic: "compound",
								category: "strength",
								equipment: "barbell",
								primaryMuscles: ["chest"],
								images: ["Bench_Press/0.jpg"],
								secondaryMuscles: ["triceps"],
								instructions: ["Lower the bar", "Press up"],
							},
						];
					},
				});
				const entry = sandboxExerciseDotFreeDashExerciseDashDbScript;
				const compiled = {
					manifest: entry.manifest,
					format: entry.compiledFormat,
					javascript: entry.compiledCode,
				};
				const result = yield* runInDeno(
					compiled,
					"search",
					{ query: "bench", page: 1, pageSize: 20 },
					{
						apiBase: `http://127.0.0.1:${bridge.port}`,
						apiFunctions: compiled.manifest.capabilities,
					},
				);
				assert(result !== null && typeof result === "object");
				expect(result).toMatchObject({ success: true });
				expect(Reflect.get(result, "value")).toMatchObject({
					details: { totalItems: 1, nextPage: null },
					items: [
						{
							externalId: "Bench Press",
							titleProperty: { kind: "text", value: "Bench Press" },
							imageProperty: { kind: "image" },
						},
					],
				});
				const cacheWrites = bridge.calls.filter((call) => call.fnName === "setCachedValue");
				expect(cacheWrites.length).toBeGreaterThanOrEqual(2);
				const metadataWrite = cacheWrites.find(
					(call) => call.args[0] === "free-exercise-db:normalized:v1",
				);
				assert(metadataWrite !== undefined);
				expect(metadataWrite.args[1]).toMatchObject({ chunkCount: 1 });
			}),
		),
	));

it("loads migrated event policy and subscription automations in Deno", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const policy = sandboxTriggerDotIntegrationDashProgressDashPolicyScript;
			const policyResult = yield* runInDeno(
				{
					manifest: policy.manifest,
					format: policy.compiledFormat,
					javascript: policy.compiledCode,
				},
				"automation",
				{
					automation: {
						operation: "create",
						ruleId: "rule-policy",
						origin: { kind: "api" },
						occurrenceId: "occurrence-policy",
						source: {
							kind: "event",
							draft: {
								entityId: "entity-1",
								entitySchemaSlug: "movie",
								eventSchemaSlug: "progress",
								properties: { progressPercent: 50 },
								occurredAt: "2026-01-01T00:00:00.000Z",
							},
						},
					},
				},
				{ apiFunctions: policy.manifest.capabilities },
			);
			assert(policyResult !== null && typeof policyResult === "object");
			expect(policyResult).toMatchObject({ success: true, value: { action: "allow" } });

			const subscription = sandboxTriggerDotAutoDashCompleteDashOnDashFullDashProgressScript;
			const subscriptionResult = yield* runInDeno(
				{
					manifest: subscription.manifest,
					format: subscription.compiledFormat,
					javascript: subscription.compiledCode,
				},
				"automation",
				{
					automation: {
						operation: "create",
						origin: { kind: "api" },
						ruleId: "rule-subscription",
						occurredAt: "2026-01-01T00:00:00.000Z",
						occurrenceId: "occurrence-subscription",
						source: {
							kind: "event",
							after: {
								id: "event-1",
								eventSchemaSlug: "progress",
								properties: { progressPercent: 50 },
								occurredAt: "2026-01-01T00:00:00.000Z",
								subject: { id: "entity-1", name: "Movie", entitySchemaSlug: "movie" },
							},
						},
					},
				},
				{ apiFunctions: subscription.manifest.capabilities },
			);
			assert(subscriptionResult !== null && typeof subscriptionResult === "object");
			expect(subscriptionResult).toMatchObject({ success: true, value: null });
		}),
	));

it("counts failed host-call attempts against total and HTTP budgets", () =>
	Effect.runPromise(
		Effect.scoped(
			Effect.gen(function* () {
				const bridge = yield* startCoreHostBridge();
				const compiler = yield* SandboxCompiler;
				const compiled = yield* compiler.compile(hostBudgetSource);
				const options = {
					apiBase: `http://127.0.0.1:${bridge.port}`,
					apiFunctions: compiled.manifest.capabilities,
				};

				const hostResult = yield* runInDeno(compiled, "hostCalls", {}, options);
				assert(hostResult !== null && typeof hostResult === "object");
				expect(Reflect.get(hostResult, "value")).toEqual({
					success: false,
					error: `Sandbox execution exceeds ${SANDBOX_LIMITS.hostCalls.total} host calls`,
				});
				expect(bridge.calls.filter((call) => call.fnName === "getCachedValue")).toHaveLength(
					SANDBOX_LIMITS.hostCalls.total,
				);

				const httpResult = yield* runInDeno(compiled, "httpCalls", {}, options);
				assert(httpResult !== null && typeof httpResult === "object");
				expect(Reflect.get(httpResult, "value")).toEqual({
					success: false,
					error: `Sandbox execution exceeds ${SANDBOX_LIMITS.hostCalls.http} httpCall calls`,
				});
				expect(bridge.calls.filter((call) => call.fnName === "httpCall")).toHaveLength(
					SANDBOX_LIMITS.hostCalls.http,
				);
			}).pipe(Effect.provide(SandboxCompiler.Default)),
		),
	));

const domainEntityRecord = {
	name: "Inception",
	populatedAt: null,
	sandboxScriptId: null,
	externalId: "tt1375666",
	entitySchemaSlug: "movie",
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
	entitySchemaSlug: "movie",
	propertiesSchema: { fields: {} },
};

const startDomainHostBridge = () =>
	Effect.gen(function* () {
		const createdEvents: unknown[][] = [];
		const runtime = yield* Effect.runtime();
		const server = yield* BunHttpServer.make({
			port: 0,
			hostname: "127.0.0.1",
		});
		yield* HttpServer.serveEffect(
			HttpApp.fromWebHandler((request) =>
				Runtime.runPromise(runtime)(
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
			),
		).pipe(Effect.provideService(HttpServer.HttpServer, server));
		const address = server.address;
		assert(address._tag === "TcpAddress");

		return {
			createdEvents,
			port: address.port,
		};
	});

it("executes typed domain host methods through Deno", () =>
	Effect.runPromise(
		Effect.scoped(
			Effect.gen(function* () {
				const bridge = yield* startDomainHostBridge();
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
					eventSchemas: [{ id: "watched", entitySchemaSlug: "movie" }],
					integration: { id: "integration-1", provider: "plex_yank" },
				});
				expect(bridge.createdEvents).toHaveLength(1);
			}).pipe(Effect.provide(SandboxCompiler.Default)),
		),
	));

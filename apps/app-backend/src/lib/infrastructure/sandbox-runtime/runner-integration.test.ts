import { Command, CommandExecutor, FileSystem, HttpApp, HttpServer } from "@effect/platform";
import { BunContext, BunHttpServer } from "@effect/platform-bun";
import { SandboxRunError, unknownToMessage } from "@ryot/contract/errors";
import { compilePluginSandboxSourceEntries } from "@ryot/sandbox-compiler/plugins";
import type { SandboxManifest } from "@ryot/sandbox-sdk/core";
import { Effect, Layer, Runtime, Schema, Stream } from "effect";
import { afterAll, assert, beforeAll, expect, it } from "vitest";

import { kernelScripts } from "#modules/definition-registry/kernel-source";
import { bootPluginSources } from "#modules/plugins/boot-sources";
import { loadPluginSource } from "#modules/plugins/source";
import { SandboxCompiler } from "#modules/sandbox/compiler";

import {
	ensureSandboxRuntimeDependencies,
	SANDBOX_APPROVED_DEPENDENCIES,
	type SandboxRuntimePaths,
} from "./dependencies";
import { SANDBOX_LIMITS, SANDBOX_RUNNER_LIMITS } from "./limits";
import { makeSandboxCommandExecutor } from "./restricted-command-executor";
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
import { defineManifest, defineScript } from "@ryot/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot/sandbox-sdk/effect";

export const manifest = defineManifest({
  kind: "script",
  name: "Runner validation",
  slug: "runner-validation",
  capabilities: [],
  requiredPluginConfigKeys: [],
  requiredSystemConfigKeys: [],
});

export default defineScript({
	manifest,
  input: Schema.Struct({ value: Schema.Number }),
  output: Schema.Number,
  run: (input) => Effect.succeed(input.value),
});

`;

const failureSource = `
import { defineManifest, defineScript } from "@ryot/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot/sandbox-sdk/effect";

export const manifest = defineManifest({
  kind: "script",
  name: "Runner failure",
  slug: "runner-failure",
  capabilities: [],
  requiredPluginConfigKeys: [],
  requiredSystemConfigKeys: [],
});

export default defineScript({
  manifest,
  input: Schema.Struct({}),
  output: Schema.Null,
  run: () => Effect.sync(() => {
    throw new Error("mapped execution failure execution-1");
  }),
});
`;

const limitsSource = `
import { defineManifest, defineScript } from "@ryot/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot/sandbox-sdk/effect";

export const manifest = defineManifest({
  kind: "script",
  name: "Runner limits",
  slug: "runner-limits",
  capabilities: [],
  requiredPluginConfigKeys: [],
  requiredSystemConfigKeys: [],
});

export default defineScript({
  manifest,
  input: Schema.Struct({ mode: Schema.Literal("output", "logs") }),
  output: Schema.Unknown,
  run: (input) => Effect.sync(() => {
    if (input.mode === "output") {
      return "x".repeat(${SANDBOX_LIMITS.execution.resultBytes + 1});
    }
    for (let index = 0; index < ${SANDBOX_LIMITS.logs.entryCount}; index += 1) {
      console.log(index);
    }
    return null;
  }),
});
`;

const filesystemSource = `
import { defineActivity } from "@ryot/sandbox-sdk/activity";
import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot/sandbox-sdk/effect";
import { readArtifact, readNamedArtifact, sandboxScratchManifestSchema, writeScratchChunks } from "@ryot/sandbox-sdk/filesystem";

export const manifest = defineManifest({
  kind: "activity",
  name: "Filesystem",
  slug: "filesystem",
  capabilities: ["artifact-read", "scratch"],
  requiredPluginConfigKeys: [],
  requiredSystemConfigKeys: [],
});

export default defineActivity({
  manifest,
  input: Schema.Struct({ chunkName: Schema.String, artifactKey: Schema.optional(Schema.String) }),
  output: sandboxScratchManifestSchema,
  run: (input) => Effect.gen(function* () {
    const artifact = yield* input.artifactKey ? readNamedArtifact(input.artifactKey) : readArtifact();
    return yield* writeScratchChunks([{ name: input.chunkName, contents: artifact }]);
  }),
});
`;

const coreHostSource = `
import {
  cacheClaimSchema,
  httpCallResponseSchema,
  userPreferencesSchema,
} from "@ryot/sandbox-sdk/core";
import { defineManifest, defineScript } from "@ryot/sandbox-sdk/driver";
import { jsonValueSchema } from "@ryot/sandbox-sdk/wire";
import { Effect, Schema } from "@ryot/sandbox-sdk/effect";

export const manifest = defineManifest({
  kind: "script",
  name: "Core host execution",
  slug: "core-host-execution",
  capabilities: [
    "httpCall",
    "getCachedValue",
    "setCachedValue",
    "claimCachedValue",
    "getSystemConfigValue",
    "getUserPreferences",
  ],
  requiredPluginConfigKeys: [],
  requiredSystemConfigKeys: ["timezone"],
});

export default defineScript({
	manifest,
  input: Schema.Struct({ write: Schema.Boolean }),
  output: Schema.Struct({
    after: Schema.NullOr(jsonValueSchema),
    before: Schema.NullOr(jsonValueSchema),
    claim: cacheClaimSchema,
    config: jsonValueSchema,
    http: httpCallResponseSchema,
    preferences: userPreferencesSchema,
  }),
  run: (input, host, execution) => Effect.gen(function* () {
    const before = yield* host.getCachedValue("shared");
    if (input.write) {
      yield* host.setCachedValue("shared", { value: 42 }, 60);
    }
    const after = yield* host.getCachedValue("shared");
    const claim = yield* host.claimCachedValue(
      "persistent", { owner: execution.sandboxScriptId }, 60,
    );
    const http = yield* host.httpCall("POST", "https://example.com/core", {
        body: "payload",
        headers: { Accept: "application/json" },
      });
    const config = yield* host.getSystemConfigValue("timezone");
    const preferences = yield* host.getUserPreferences();
    return { after, before, claim, config, http, preferences };
  }),
});
`;

const filteredHostSource = `
import { defineManifest, defineScript } from "@ryot/sandbox-sdk/driver";
import { jsonValueSchema } from "@ryot/sandbox-sdk/wire";
import { Effect, Schema } from "@ryot/sandbox-sdk/effect";

export const manifest = defineManifest({
  kind: "script",
  name: "Filtered host",
  slug: "filtered-host",
  capabilities: ["getCachedValue"],
  requiredPluginConfigKeys: [],
  requiredSystemConfigKeys: [],
});

Object.defineProperty(manifest.capabilities, Symbol.iterator, {
  value: function* () {
    yield "getCachedValue";
    yield "setCachedValue";
  },
});
const nativeEncodeComponent = globalThis.encodeURIComponent;
globalThis.encodeURIComponent = (value) =>
  value === "getCachedValue" ? "getSystemConfigValue" : nativeEncodeComponent(value);

export default defineScript({
	manifest,
  input: Schema.Struct({}),
  output: Schema.Struct({ keys: Schema.Array(Schema.String), value: Schema.NullOr(jsonValueSchema) }),
  run: (_input, host) => Effect.gen(function* () {
    const value = yield* host.getCachedValue("redirect-check");
    return {
      keys: Object.keys(host).sort(),
      value,
    };
  }),
});
`;

const hostBudgetSource = `
import { defineManifest, defineScript } from "@ryot/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot/sandbox-sdk/effect";

export const manifest = defineManifest({
  kind: "script",
  name: "Host budgets",
  slug: "host-budgets",
  capabilities: ["getCachedValue", "httpCall"],
  requiredPluginConfigKeys: [],
  requiredSystemConfigKeys: [],
});

export default defineScript({
	manifest,
	input: Schema.Struct({ kind: Schema.Literal("host", "http") }),
	output: Schema.Unknown,
	run: (input, host) => Effect.gen(function* () {
		let result: unknown = null;
		if (input.kind === "host") {
			for (let index = 0; index <= ${SANDBOX_LIMITS.hostCalls.total}; index += 1) {
				result = yield* host.getCachedValue("budget");
			}
		} else {
			for (let index = 0; index <= ${SANDBOX_LIMITS.hostCalls.http}; index += 1) {
				result = yield* host.httpCall("GET", "https://example.com/budget");
			}
		}
		return result;
	}),
});
`;

const domainHostSource = `
import { defineManifest, defineScript } from "@ryot/sandbox-sdk/driver";
import {
  createEventsResultDataSchema,
  entityRecordSchema,
  entitySchemaRecordSchema,
  eventRecordSchema,
  eventSchemaRecordSchema,
  integrationRecordSchema,
} from "@ryot/sandbox-sdk/core";
import { Effect, Schema } from "@ryot/sandbox-sdk/effect";

export const manifest = defineManifest({
  kind: "script",
  name: "Domain host execution",
  slug: "domain-host-execution",
  requiredPluginConfigKeys: [],
  requiredSystemConfigKeys: [],
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

export default defineScript({
	manifest,
  input: Schema.Struct({}),
  output: Schema.Struct({
    queryRows: Schema.Number,
    missing: Schema.String,
    created: createEventsResultDataSchema,
    entity: entityRecordSchema,
    integration: integrationRecordSchema,
    events: Schema.Array(eventRecordSchema),
    entitySchema: entitySchemaRecordSchema,
    eventSchemas: Schema.Array(eventSchemaRecordSchema),
  }),
  run: (_input, host) => Effect.gen(function* () {
    const entity = yield* host.getEntity("entity-1");
    const missingResult = yield* Effect.either(host.getEntity("missing"));
    const integration = yield* host.getIntegration();
    const events = yield* host.listEvents({ entityId: "entity-1" });
    const entitySchema = yield* host.getEntitySchema("movie");
    const eventSchemas = yield* host.listEventSchemas("movie");
    const created = yield* host.createEvents([
        { entityId: "entity-1", eventSchemaSlug: "event-schema-1", properties: { watched: true } },
      ]);
    const query = yield* host.executeQueryEngine({ source: { type: "entities" } });
    const rows = yield* Schema.decodeUnknown(Schema.Array(Schema.Struct({ id: Schema.String })))(query);
    return {
      entity,
      created,
      integration,
      entitySchema,
      events: [...events],
      queryRows: rows.length,
      eventSchemas: [...eventSchemas],
      missing: missingResult._tag === "Left" ? missingResult.left.message : "unexpected",
    };
  }),
});
`;

const dependencySource = (name: string, sdkImport: string) => `
import "${sdkImport}";
import { defineManifest, defineScript } from "@ryot/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot/sandbox-sdk/effect";

export const manifest = defineManifest({
  kind: "script",
  name: "${name} dependency load",
  slug: "${name}-dependency-load",
  capabilities: [],
  requiredPluginConfigKeys: [],
  requiredSystemConfigKeys: [],
});

export default defineScript({
	manifest,
  input: Schema.Struct({}),
  output: Schema.Null,
  run: () => Effect.succeed(null),
});
`;

const workflowHostSource = `
import { Effect, Schema } from "@ryot/sandbox-sdk/effect";

const manifest = {
  kind: "workflow",
  capabilities: [],
  name: "Workflow host",
  slug: "workflow-host",
  requiredPluginConfigKeys: [],
  requiredSystemConfigKeys: [],
};

export default {
  manifest,
  input: Schema.Struct({}),
  definitionType: "ryot:sandbox-script",
  output: Schema.Struct({
    keys: Schema.Array(Schema.String),
    journal: Schema.Array(Schema.Unknown),
  }),
  run: (_input, host) => Effect.gen(function* () {
    const journal = yield* host.durableCalls();
    return { journal, keys: Object.keys(host).sort() };
  }),
};
`;

const workflowNondeterminismSource = `
import { Effect as RuntimeEffect, Schema } from "@ryot/sandbox-sdk/effect";

const Effect = {
  as: RuntimeEffect.as,
  gen: RuntimeEffect.gen,
  succeed: RuntimeEffect.succeed,
};

const manifest = {
  kind: "workflow",
  name: "Workflow nondeterminism",
  slug: "workflow-nondeterminism",
  capabilities: [],
  requiredPluginConfigKeys: [],
  requiredSystemConfigKeys: [],
};
const date = Date;
const dateNow = Date.now;
const { random } = Math;
const { randomUUID, getRandomValues } = crypto;
const performanceNow = performance.now;
const temporalInstant = Temporal.Now.instant;

export default {
  manifest,
  definitionType: "ryot:sandbox-script",
  input: Schema.Struct({ operation: Schema.String, timestamp: Schema.String }),
  output: Schema.Unknown,
  run: (input) => Effect.gen(function* () {
      yield* Effect.succeed(null);
      if (input.operation === "date-call") return date.call(undefined);
      if (input.operation === "date-new") return new date();
      if (input.operation === "date-now") return dateNow.call(Date);
      if (input.operation === "math-random") return random.apply(Math);
      if (input.operation === "crypto-random-uuid") return randomUUID.call(crypto);
      if (input.operation === "crypto-random-values") {
        return getRandomValues.call(crypto, new Uint8Array(1));
      }
      if (input.operation === "performance-now") return performanceNow.apply(performance);
      if (input.operation === "temporal-now") return temporalInstant.call(Temporal.Now);
      if (input.operation === "date-now-callback") return dateNow();
      if (input.operation === "effect-services") {
        return {
          clockWith: typeof Reflect.get(Effect, "clockWith"),
          randomWith: typeof Reflect.get(Effect, "randomWith"),
        };
      }
      const parsedDate = new date(input.timestamp);
      return {
        iso: parsedDate.toISOString(),
        parsed: date.parse(input.timestamp),
        utc: date.UTC(2024, 0, 1),
        instanceConstructor: parsedDate.constructor === date,
        prototypeConstructor: date.prototype.constructor === date,
      };
    }),
};
`;

const ambientScriptSource = `
import { Effect, Schema } from "@ryot/sandbox-sdk/effect";

const manifest = {
  kind: "script",
  name: "Ambient script",
  slug: "ambient-script",
  capabilities: [],
  requiredPluginConfigKeys: [],
  requiredSystemConfigKeys: [],
};

export default {
  manifest,
  definitionType: "ryot:sandbox-script",
  input: Schema.Struct({}),
  output: Schema.Boolean,
  run: () => Effect.sync(() => Date.now() > 0 && Math.random() >= 0 && performance.now() >= 0),
};
`;

const generatedNpmImportSource = `
import { defineManifest, defineScript } from "@ryot/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot/sandbox-sdk/effect";

export const manifest = defineManifest({
  kind: "script",
  name: "Generated npm import",
  slug: "generated-npm-import",
  capabilities: [],
  requiredPluginConfigKeys: [],
  requiredSystemConfigKeys: [],
});

export default defineScript({
	manifest,
  input: Schema.Struct({}),
  output: Schema.Null,
  run: () => Effect.promise(async () => {
    const load = Function('return im' + 'port("npm:zod")');
    await load();
    return null;
  }),
});
`;

const encodeRunnerRequest = Schema.encodeSync(Schema.parseJson(Schema.Unknown));
const decodeRunnerResponse = Schema.decodeUnknownSync(Schema.parseJson(Schema.Unknown));
type RunnerCompiledModule = {
	readonly format: number;
	readonly javascript: string;
	readonly manifest: SandboxManifest;
};

type RunnerOptions = {
	readonly apiBase?: string;
	readonly scriptId?: string;
	readonly executionId?: string;
	readonly apiFunctions?: readonly string[];
	readonly filesystem?: {
		readonly artifactPath?: string;
		readonly scratchDirectory?: string;
		readonly namedArtifactPaths?: Readonly<Record<string, string>>;
	};
};

type RunnerRequest = {
	readonly context: unknown;
	readonly options?: RunnerOptions;
	readonly compiled: RunnerCompiledModule;
};

const runInDenoRequests = (requests: readonly RunnerRequest[]) =>
	Effect.scoped(
		Effect.gen(function* () {
			assert(dependencyRuntime);
			assert(runnerPath);
			const apiBase = requests[0]?.options?.apiBase ?? "http://127.0.0.1:1";
			const filesystem = requests[0]?.options?.filesystem;
			const request = requests
				.map(
					({ compiled, context, options = {} }) =>
						`${encodeRunnerRequest({
							context,
							token: "unused",
							metadata: compiled.manifest,
							limits: SANDBOX_RUNNER_LIMITS,
							compiledFormat: compiled.format,
							compiledCode: compiled.javascript,
							apiBase: options.apiBase ?? apiBase,
							scriptId: options.scriptId ?? "script-1",
							apiFunctions: options.apiFunctions ?? [],
							executionId: options.executionId ?? "execution-1",
							...(options.filesystem ? { filesystem: options.filesystem } : {}),
						})}\n`,
				)
				.join("");
			const executor = yield* CommandExecutor.CommandExecutor;
			const sandboxExecutor = makeSandboxCommandExecutor(executor, {
				PATH: Bun.env["PATH"] ?? "/usr/bin:/bin",
				DENO_DIR: dependencyRuntime.cacheDirectory,
			});
			const command = Command.make(
				"deno",
				"run",
				"--no-npm",
				"--no-lock",
				"--deny-run",
				"--deny-env",
				"--deny-ffi",
				"--no-prompt",
				"--no-config",
				"--no-remote",
				"--cached-only",
				`--allow-net=${new URL(apiBase).host}`,
				`--import-map=${dependencyRuntime.importMapPath}`,
				`--v8-flags=--max-old-space-size=${SANDBOX_LIMITS.execution.denoHeapMiB}`,
				filesystem?.scratchDirectory
					? `--allow-write=${filesystem.scratchDirectory}`
					: "--deny-write",
				`--allow-read=${[
					runnerPath,
					dependencyRuntime.directory,
					...(filesystem?.artifactPath ? [filesystem.artifactPath] : []),
					...Object.values(filesystem?.namedArtifactPaths ?? {}),
					...(filesystem?.scratchDirectory ? [filesystem.scratchDirectory] : []),
				].join(",")}`,
				runnerPath,
			).pipe(Command.feed(request), Command.stdout("pipe"), Command.stderr("pipe"));
			const denoProcess = yield* sandboxExecutor
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
				try: () =>
					stdout
						.trim()
						.split("\n")
						.map((line) => decodeRunnerResponse(line)),
				catch: (error) => new SandboxRunError({ message: unknownToMessage(error) }),
			});
		}),
	).pipe(Effect.provide(BunContext.layer));

const runInDeno = (compiled: RunnerCompiledModule, context: unknown, options: RunnerOptions = {}) =>
	runInDenoRequests([{ compiled, context, options }]).pipe(
		Effect.map(([result]) => {
			assert(result !== undefined);
			return result;
		}),
	);

const startCoreHostBridge = (
	options: {
		readonly pluginConfigValue?: unknown;
		readonly systemConfigValue?: unknown;
		readonly durableCallsResult?: unknown;
		readonly getCachedValueResult?: unknown;
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
							result = options.getCachedValueResult ?? {
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
						} else if (fnName === "getPluginConfigValue") {
							result = { data: options.pluginConfigValue ?? "plugin-value", success: true };
						} else if (fnName === "getSystemConfigValue") {
							result = { data: options.systemConfigValue ?? "Etc/GMT", success: true };
						} else if (fnName === "getUserPreferences") {
							result = { success: true, data: { isNsfw: false, disableIntegrations: true } };
						} else if (fnName === "durableCalls") {
							result = { success: true, data: options.durableCallsResult ?? [] };
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

it("loads compiled ESM in Deno and validates definition input and output", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const compiler = yield* SandboxCompiler;
			const compiled = yield* compiler.compile(source);

			const success = yield* runInDeno(compiled, { value: 42 });
			assert(success !== null && typeof success === "object");
			expect(Reflect.get(success, "error")).toBeUndefined();
			expect(success).toMatchObject({ success: true, value: 42 });

			const invalidInput = yield* runInDeno(compiled, { value: "wrong" });
			assert(invalidInput !== null && typeof invalidInput === "object");
			expect(Reflect.get(invalidInput, "error")).toMatchObject({
				phase: "input",
				message: expect.stringContaining("Definition input validation failed"),
			});

			const promiseManifest = {
				kind: "script",
				name: "Promise definition rejection",
				slug: "promise-definition-rejection",
				capabilities: [],
				requiredPluginConfigKeys: [],
				requiredSystemConfigKeys: [],
			} as const;
			const promiseManifestSource = yield* Schema.encode(Schema.parseJson(Schema.Unknown))(
				promiseManifest,
			);
			const promiseOutput = yield* runInDeno(
				{
					format: 1,
					manifest: promiseManifest,
					javascript: `import { Schema } from "@ryot/sandbox-sdk/effect";
export default {
  definitionType: "ryot:sandbox-script",
  manifest: ${promiseManifestSource},
	input: Schema.Struct({}),
	output: Schema.Boolean,
	run: () => Promise.resolve(true),
};`,
				},
				{},
			);
			assert(promiseOutput !== null && typeof promiseOutput === "object");
			expect(Reflect.get(promiseOutput, "error")).toEqual({
				phase: "execute",
				message: "Sandbox definition must return an Effect",
			});

			const unsupported = yield* runInDeno(
				{ ...compiled, format: 2 },
				{
					value: 42,
				},
			);
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
			const compiled = yield* compiler.compile(failureSource);
			const throwingLine = failureSource
				.slice(0, failureSource.indexOf('throw new Error("mapped execution failure execution-1")'))
				.split("\n").length;
			const result = yield* runInDeno(compiled, {});
			assert(result !== null && typeof result === "object");
			expect(Reflect.get(result, "error")).toMatchObject({
				phase: "execute",
				line: throwingLine,
				message: "mapped execution failure [redacted]",
			});

			const loadSource = failureSource.replace(
				"export default defineScript",
				'throw new Error("mapped load failure execution-1");\n\nexport default defineScript',
			);
			const loadLine = loadSource
				.slice(0, loadSource.indexOf('throw new Error("mapped load failure execution-1")'))
				.split("\n").length;
			const loadResult = yield* runInDeno(yield* compiler.compile(loadSource), {});
			assert(loadResult !== null && typeof loadResult === "object");
			expect(Reflect.get(loadResult, "error")).toMatchObject({
				phase: "load",
				line: loadLine,
				message: "mapped load failure [redacted]",
			});
		}).pipe(Effect.provide(SandboxCompiler.Default)),
	));

it("enforces direct-definition output and log limits", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const compiler = yield* SandboxCompiler;
			const compiled = yield* compiler.compile(limitsSource);
			const output = yield* runInDeno(compiled, { mode: "output" });
			assert(output !== null && typeof output === "object");
			expect(Reflect.get(output, "error")).toEqual({
				phase: "output",
				message: `Sandbox definition result exceeds ${SANDBOX_LIMITS.execution.resultBytes} UTF-8 bytes`,
			});

			const logged = yield* runInDeno(compiled, { mode: "logs" });
			assert(logged !== null && typeof logged === "object");
			const logs = Reflect.get(logged, "logs");
			assert(Array.isArray(logs));
			expect(logs).toHaveLength(SANDBOX_LIMITS.logs.entryCount);
			expect(logs.at(-1)).toBe("[sandbox logs truncated]");
		}).pipe(Effect.provide(SandboxCompiler.Default)),
	));

it("exposes only granted artifact reads and named scratch chunk writes", () =>
	Effect.runPromise(
		Effect.scoped(
			Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem;
				const compiler = yield* SandboxCompiler;
				const root = yield* fs.makeTempDirectoryScoped({ prefix: "ryot-runner-filesystem-" });
				const artifactPath = `${root}/artifact.json`;
				const namedArtifactPath = `${root}/history.json`;
				const scratchDirectory = `${root}/scratch`;
				yield* fs.makeDirectory(scratchDirectory);
				yield* fs.writeFileString(artifactPath, "[1,2]");
				yield* fs.writeFileString(namedArtifactPath, "[3,4]");
				const compiled = yield* compiler.compile(filesystemSource);

				const unavailable = yield* runInDeno(compiled, { chunkName: "chunk.json" });
				assert(unavailable !== null && typeof unavailable === "object");
				expect(Reflect.get(unavailable, "error")).toMatchObject({
					phase: "execute",
					message: "Sandbox artifact grant is unavailable",
				});

				const options = { filesystem: { artifactPath, scratchDirectory } };
				const success = yield* runInDeno(compiled, { chunkName: "chunk.json" }, options);
				expect(success).toMatchObject({
					success: true,
					value: { chunkFiles: ["chunk.json"] },
				});
				expect(yield* fs.readFileString(`${scratchDirectory}/chunk.json`)).toBe("[1,2]");

				const namedOptions = {
					filesystem: {
						scratchDirectory,
						namedArtifactPaths: { historyFilePath: namedArtifactPath },
					},
				};
				const named = yield* runInDeno(
					compiled,
					{ chunkName: "named.json", artifactKey: "historyFilePath" },
					namedOptions,
				);
				expect(named).toMatchObject({
					success: true,
					value: { chunkFiles: ["named.json"] },
				});
				expect(yield* fs.readFileString(`${scratchDirectory}/named.json`)).toBe("[3,4]");
				const missingNamed = yield* runInDeno(
					compiled,
					{ chunkName: "missing.json", artifactKey: "ratingsFilePath" },
					namedOptions,
				);
				assert(missingNamed !== null && typeof missingNamed === "object");
				expect(Reflect.get(missingNamed, "error")).toMatchObject({
					phase: "execute",
					message: 'Sandbox named artifact grant "ratingsFilePath" is unavailable',
				});

				const traversal = yield* runInDeno(compiled, { chunkName: "../outside.json" }, options);
				assert(traversal !== null && typeof traversal === "object");
				expect(Reflect.get(traversal, "error")).toMatchObject({
					phase: "execute",
					message: "Sandbox scratch chunk names must be plain file names",
				});
				expect(yield* fs.exists(`${root}/outside.json`)).toBe(false);
			}).pipe(Effect.provide(Layer.merge(SandboxCompiler.Default, BunContext.layer))),
		),
	));

it("loads one compiled fixture for each approved SDK dependency without remote modules", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const compiler = yield* SandboxCompiler;
			for (const dependency of SANDBOX_APPROVED_DEPENDENCIES) {
				const compiled = yield* compiler.compile(
					dependencySource(dependency.name, dependency.sdkImport),
				);
				const result = yield* runInDeno(compiled, {});
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
			const result = yield* runInDeno(compiled, {});
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
					{},
					{
						apiBase,
						apiFunctions: ["getCachedValue", "setCachedValue", "getSystemConfigValue"],
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

it("rejects malformed private host wire responses", () =>
	Effect.runPromise(
		Effect.scoped(
			Effect.gen(function* () {
				const bridge = yield* startCoreHostBridge({
					getCachedValueResult: { success: true },
				});
				const compiler = yield* SandboxCompiler;
				const compiled = yield* compiler.compile(filteredHostSource);
				const result = yield* runInDeno(
					compiled,
					{},
					{
						apiBase: `http://127.0.0.1:${bridge.port}`,
						apiFunctions: compiled.manifest.capabilities,
					},
				);
				assert(result !== null && typeof result === "object");
				expect(Reflect.get(result, "error")).toMatchObject({
					phase: "execute",
					message: expect.stringContaining("is missing"),
				});
			}).pipe(Effect.provide(SandboxCompiler.Default)),
		),
	));

it(
	"loads every boot-configured and kernel script in Deno",
	() =>
		Effect.runPromise(
			Effect.gen(function* () {
				const pluginOutputs = yield* Effect.forEach(bootPluginSources, (plugin) =>
					Effect.gen(function* () {
						const pluginSource = yield* loadPluginSource(plugin.packageRoot, plugin.manifest);
						return yield* compilePluginSandboxSourceEntries(
							pluginSource.files,
							plugin.manifest.scripts,
						);
					}),
				);
				const kernelFiles = Object.fromEntries(
					yield* Effect.forEach(kernelScripts, (script) =>
						Effect.tryPromise(() =>
							Bun.file(new URL(`../../../../${script.entry}`, import.meta.url)).text(),
						).pipe(Effect.map((scriptSource) => [script.entry, scriptSource] as const)),
					),
				);
				const kernelOutputs = yield* compilePluginSandboxSourceEntries(kernelFiles, kernelScripts);
				const outputs = [...pluginOutputs.flat(), ...kernelOutputs];

				yield* Effect.forEach(
					outputs,
					({ compiled }) =>
						Effect.gen(function* () {
							const slug = compiled.manifest.slug;
							const result = yield* runInDeno(compiled, {});
							assert(result !== null && typeof result === "object", slug);
							const error = Reflect.get(result, "error");
							if (error !== null && typeof error === "object") {
								expect(
									Reflect.get(error, "phase"),
									`${slug}: ${String(Reflect.get(error, "message"))}`,
								).not.toBe("load");
							}
						}),
					{ concurrency: 5 },
				);
			}),
		),
	120_000,
);

it("exposes only kernel-selected workflow host functions despite an empty manifest", () =>
	Effect.runPromise(
		Effect.scoped(
			Effect.gen(function* () {
				const bridge = yield* startCoreHostBridge({
					durableCallsResult: [{ recorded: true }],
				});
				const manifest = {
					name: "Workflow host",
					slug: "workflow-host",
					kind: "workflow" as const,
					capabilities: [] as const,
					requiredPluginConfigKeys: [] as const,
					requiredSystemConfigKeys: [] as const,
				};
				const result = yield* runInDeno(
					{ manifest, format: 1, javascript: workflowHostSource },
					{},
					{ apiFunctions: ["durableCalls"], apiBase: `http://127.0.0.1:${bridge.port}` },
				);

				expect(result).toMatchObject({
					success: true,
					value: { keys: ["durableCalls"], journal: [{ recorded: true }] },
				});
				expect(bridge.calls).toEqual([
					expect.objectContaining({ fnName: "durableCalls", args: [] }),
				]);
			}),
		),
	));

it("blocks ambient workflow nondeterminism through aliases and call helpers at runtime", () =>
	Effect.runPromise(
		Effect.forEach(
			[
				["date-call", "Date()"],
				["date-new", "new Date()"],
				["math-random", "Math.random"],
				["temporal-now", "Temporal.Now"],
				["performance-now", "performance.now"],
				["crypto-random-uuid", "crypto.randomUUID"],
				["crypto-random-values", "crypto.getRandomValues"],
			] as const,
			([operation, expected]) =>
				Effect.gen(function* () {
					const manifest = {
						kind: "workflow" as const,
						capabilities: [] as const,
						name: "Workflow nondeterminism",
						slug: "workflow-nondeterminism",
						requiredPluginConfigKeys: [] as const,
						requiredSystemConfigKeys: [] as const,
					};
					const result = yield* runInDeno(
						{ manifest, format: 1, javascript: workflowNondeterminismSource },
						{ operation, timestamp: "2024-01-01T00:00:00.000Z" },
					);
					assert(result !== null && typeof result === "object");
					expect(Reflect.get(result, "error")).toMatchObject({
						phase: "execute",
						message: expect.stringContaining(expected),
					});
				}),
			{ concurrency: 4 },
		),
	));

it("keeps the deterministic workflow clock active through Effect callbacks", () =>
	Effect.runPromise(
		Effect.forEach(["date-now", "date-now-callback"], (operation) =>
			Effect.gen(function* () {
				const manifest = {
					kind: "workflow" as const,
					capabilities: [] as const,
					name: "Workflow nondeterminism",
					slug: "workflow-nondeterminism",
					requiredPluginConfigKeys: [] as const,
					requiredSystemConfigKeys: [] as const,
				};
				const result = yield* runInDeno(
					{ manifest, format: 1, javascript: workflowNondeterminismSource },
					{ operation, timestamp: "2024-01-01T00:00:00.000Z" },
				);

				expect(result).toMatchObject({ success: true, value: 0 });
			}),
		),
	));

it("allows deterministic workflow dates without changing ambient APIs for scripts", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const workflowManifest = {
				kind: "workflow" as const,
				capabilities: [] as const,
				name: "Workflow nondeterminism",
				slug: "workflow-nondeterminism",
				requiredPluginConfigKeys: [] as const,
				requiredSystemConfigKeys: [] as const,
			};
			const scriptManifest = {
				name: "Ambient script",
				slug: "ambient-script",
				kind: "script" as const,
				capabilities: [] as const,
				requiredPluginConfigKeys: [] as const,
				requiredSystemConfigKeys: [] as const,
			};
			const [workflowResult, scriptResult] = yield* runInDenoRequests([
				{
					context: { operation: "parse", timestamp: "2024-01-01T00:00:00.000Z" },
					compiled: {
						format: 1,
						manifest: workflowManifest,
						javascript: workflowNondeterminismSource,
					},
				},
				{
					context: {},
					compiled: { format: 1, manifest: scriptManifest, javascript: ambientScriptSource },
				},
			]);
			expect(workflowResult).toMatchObject({
				success: true,
				value: {
					utc: 1_704_067_200_000,
					parsed: 1_704_067_200_000,
					instanceConstructor: true,
					prototypeConstructor: true,
					iso: "2024-01-01T00:00:00.000Z",
				},
			});
			expect(scriptResult).toMatchObject({ success: true, value: true });
		}),
	));

it("does not expose Effect Clock or Random services to workflows at runtime", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const manifest = {
				kind: "workflow" as const,
				capabilities: [] as const,
				name: "Workflow nondeterminism",
				slug: "workflow-nondeterminism",
				requiredPluginConfigKeys: [] as const,
				requiredSystemConfigKeys: [] as const,
			};
			const result = yield* runInDeno(
				{ manifest, format: 1, javascript: workflowNondeterminismSource },
				{ operation: "effect-services", timestamp: "2024-01-01T00:00:00.000Z" },
			);

			expect(result).toMatchObject({
				success: true,
				value: { clockWith: "undefined", randomWith: "undefined" },
			});
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

				const hostResult = yield* runInDeno(compiled, { kind: "host" }, options);
				assert(hostResult !== null && typeof hostResult === "object");
				expect(Reflect.get(hostResult, "error")).toEqual({
					phase: "execute",
					message: `Sandbox execution exceeds ${SANDBOX_LIMITS.hostCalls.total} host calls`,
				});
				expect(bridge.calls.filter((call) => call.fnName === "getCachedValue")).toHaveLength(
					SANDBOX_LIMITS.hostCalls.total,
				);

				const httpResult = yield* runInDeno(compiled, { kind: "http" }, options);
				assert(httpResult !== null && typeof httpResult === "object");
				expect(Reflect.get(httpResult, "error")).toEqual({
					phase: "execute",
					message: `Sandbox execution exceeds ${SANDBOX_LIMITS.hostCalls.http} httpCall calls`,
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
	providerId: "tmdb",
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
	pluginSlug: "plugin-1",
	accentColor: "#ffffff",
	propertiesSchema: { fields: {} },
	providers: [{ name: "TMDB", providerId: "tmdb" }],
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

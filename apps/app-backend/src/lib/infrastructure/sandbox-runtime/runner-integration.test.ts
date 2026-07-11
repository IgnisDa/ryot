import { Command, CommandExecutor, FileSystem, HttpApp, HttpServer } from "@effect/platform";
import { BunContext, BunHttpServer } from "@effect/platform-bun";
import { SandboxRunError, unknownToMessage } from "@ryot/contract/errors";
import type { SandboxManifest } from "@ryot/sandbox-sdk/core";
import { Effect, Runtime, Schema, Stream } from "effect";
import { afterAll, assert, beforeAll, expect, it } from "vitest";

import { SandboxCompiler } from "#modules/sandbox/compiler";

import {
	ensureSandboxRuntimeDependencies,
	SANDBOX_APPROVED_DEPENDENCIES,
	type SandboxRuntimePaths,
} from "./dependencies";
import {
	generatedSandboxScripts,
	sandboxAnimeDotAnilistDotDetailsScript,
	sandboxAnimeDotMyanimelistDotSearchScript,
	sandboxComicDashBookDotMetronDotSearchScript,
	sandboxExerciseDotFreeDashExerciseDashDbDotSearchScript,
	sandboxVisualDashNovelDotVndbDotSearchScript,
	sandboxAudiobookDotAudibleDotDetailsScript,
	sandboxBookDotGoogleDashBooksDotResolveScript,
	sandboxBookDotGoogleDashBooksDotSearchScript,
	sandboxBookDotHardcoverDotDetailsScript,
	sandboxBookDotOpenlibraryDotDetailsScript,
	sandboxCompanyDotTmdbDotSearchScript,
	sandboxCompanyDotTvdbDotSearchScript,
	sandboxMangaDotMangaDashUpdatesDotSearchScript,
	sandboxMovieDashGroupDotTmdbDotSearchScript,
	sandboxMovieDashGroupDotTvdbDotTranslateScript,
	sandboxMovieDotTmdbDotSearchScript,
	sandboxMovieDotTvdbDotSearchScript,
	sandboxMusicDotMusicDashBrainzDotSearchScript,
	sandboxMusicDotSpotifyDotSearchScript,
	sandboxPersonDotTmdbDotSearchScript,
	sandboxPersonDotTvdbDotSearchScript,
	sandboxPodcastDotItunesDotSearchScript,
	sandboxPodcastDotListennotesDotSearchScript,
	sandboxShowDotTmdbDotSearchScript,
	sandboxShowDotTvdbDotSearchScript,
	sandboxVideoDashGameDotGiantDashBombDotSearchScript,
	sandboxVideoDashGameDotIgdbDotSearchScript,
	sandboxTriggerDotAutoDashCompleteDashOnDashFullDashProgressScript,
	sandboxTriggerDotIntegrationDashProgressDashPolicyScript,
} from "./generated-sandbox/registry";
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
  requiredAppConfigKeys: [],
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
  requiredAppConfigKeys: [],
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
  requiredAppConfigKeys: [],
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
    "getAppConfigValue",
    "getUserPreferences",
  ],
  requiredAppConfigKeys: ["timezone"],
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
    const config = yield* host.getAppConfigValue("timezone");
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
  requiredAppConfigKeys: [],
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
    const integration = yield* host.getIntegration("integration-1");
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
  requiredAppConfigKeys: [],
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
  requiredAppConfigKeys: [],
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
  requiredAppConfigKeys: [],
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
  requiredAppConfigKeys: [],
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
  requiredAppConfigKeys: [],
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
	readonly manifest: SandboxManifest;
	readonly javascript: string;
	readonly format: number;
};

type RunnerOptions = {
	readonly apiBase?: string;
	readonly scriptId?: string;
	readonly executionId?: string;
	readonly apiFunctions?: readonly string[];
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
			const request = requests
				.map(
					({ compiled, context, options = {} }) =>
						`${encodeRunnerRequest({
							context,
							apiBase: options.apiBase ?? apiBase,
							limits: SANDBOX_RUNNER_LIMITS,
							token: "unused",
							metadata: compiled.manifest,
							compiledFormat: compiled.format,
							compiledCode: compiled.javascript,
							scriptId: options.scriptId ?? "script-1",
							apiFunctions: options.apiFunctions ?? [],
							executionId: options.executionId ?? "execution-1",
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
		readonly appConfigValue?: unknown;
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
						} else if (fnName === "getAppConfigValue") {
							result = { data: options.appConfigValue ?? "Etc/GMT", success: true };
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
				requiredAppConfigKeys: [],
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
					{ apiBase, apiFunctions: ["getCachedValue", "setCachedValue", "getAppConfigValue"] },
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
	"imports every generated built-in module in Deno",
	() =>
		Effect.runPromise(
			Effect.forEach(
				generatedSandboxScripts,
				(script) =>
					Effect.gen(function* () {
						const result = yield* runInDeno(
							{
								manifest: script.manifest,
								format: script.compiledFormat,
								javascript: script.compiledCode,
							},
							{},
						);
						assert(result !== null && typeof result === "object", script.slug);
						const error = Reflect.get(result, "error");
						if (error !== null && typeof error === "object") {
							expect(Reflect.get(error, "phase"), script.slug).not.toBe("load");
						}
					}),
				{ concurrency: 5 },
			),
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
					requiredAppConfigKeys: [] as const,
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
						requiredAppConfigKeys: [] as const,
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
					requiredAppConfigKeys: [] as const,
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
				requiredAppConfigKeys: [] as const,
			};
			const scriptManifest = {
				name: "Ambient script",
				slug: "ambient-script",
				kind: "script" as const,
				capabilities: [] as const,
				requiredAppConfigKeys: [] as const,
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
				requiredAppConfigKeys: [] as const,
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
					manifest: sandboxShowDotTmdbDotSearchScript.manifest,
					format: sandboxShowDotTmdbDotSearchScript.compiledFormat,
					javascript: sandboxShowDotTmdbDotSearchScript.compiledCode,
				};
				const result = yield* runInDeno(
					compiled,
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
					{ entry: sandboxMovieDotTmdbDotSearchScript, title: "Generated Movie", externalId: "1" },
					{
						entry: sandboxPersonDotTmdbDotSearchScript,
						title: "Generated Person",
						externalId: "2",
					},
					{
						entry: sandboxCompanyDotTmdbDotSearchScript,
						title: "Generated Company",
						externalId: "3",
					},
					{
						externalId: "4",
						title: "Generated Collection",
						entry: sandboxMovieDashGroupDotTmdbDotSearchScript,
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
					manifest: sandboxShowDotTvdbDotSearchScript.manifest,
					format: sandboxShowDotTvdbDotSearchScript.compiledFormat,
					javascript: sandboxShowDotTvdbDotSearchScript.compiledCode,
				};
				const result = yield* runInDeno(
					compiled,
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
					{ entry: sandboxMovieDotTvdbDotSearchScript, title: "Generated Movie", externalId: "1" },
					{
						entry: sandboxPersonDotTvdbDotSearchScript,
						title: "Generated Person",
						externalId: "2",
					},
					{
						entry: sandboxCompanyDotTvdbDotSearchScript,
						title: "Generated Company",
						externalId: "3",
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

				const groupEntry = sandboxMovieDashGroupDotTvdbDotTranslateScript;
				const translated = yield* runInDeno(
					{
						manifest: groupEntry.manifest,
						format: groupEntry.compiledFormat,
						javascript: groupEntry.compiledCode,
					},
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
				const entry = sandboxAnimeDotAnilistDotDetailsScript;
				const compiled = {
					manifest: entry.manifest,
					format: entry.compiledFormat,
					javascript: entry.compiledCode,
				};
				const result = yield* runInDeno(
					compiled,
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
									providerSlug: "company.anilist",
									relationshipProperties: { roles: ["Animation Studio"] },
								},
							],
						},
						{
							direction: "outgoing",
							synchronization: "authoritative",
							relationshipSchemaSlug: "media-suggestion",
							entities: [
								{ name: "Suggested Manga", externalId: "8", providerSlug: "manga.anilist" },
							],
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
						entry: sandboxAnimeDotMyanimelistDotSearchScript,
					},
					{
						externalId: "9",
						publishYear: 2019,
						title: "Generated Series",
						image: "https://img.example/mu.jpg",
						entry: sandboxMangaDotMangaDashUpdatesDotSearchScript,
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
				const entry = sandboxBookDotHardcoverDotDetailsScript;
				const compiled = {
					manifest: entry.manifest,
					format: entry.compiledFormat,
					javascript: entry.compiledCode,
				};
				const result = yield* runInDeno(
					compiled,
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
				const entry = sandboxBookDotOpenlibraryDotDetailsScript;
				const compiled = {
					manifest: entry.manifest,
					format: entry.compiledFormat,
					javascript: entry.compiledCode,
				};
				const result = yield* runInDeno(
					compiled,
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
				const entry = sandboxBookDotGoogleDashBooksDotSearchScript;
				const compiled = {
					manifest: entry.manifest,
					format: entry.compiledFormat,
					javascript: entry.compiledCode,
				};
				const result = yield* runInDeno(
					compiled,
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

				const resolveEntry = sandboxBookDotGoogleDashBooksDotResolveScript;
				const resolved = yield* runInDeno(
					{
						manifest: resolveEntry.manifest,
						format: resolveEntry.compiledFormat,
						javascript: resolveEntry.compiledCode,
					},
					{ identifierType: "isbn", value: "9780000000000" },
					{
						apiBase: `http://127.0.0.1:${bridge.port}`,
						apiFunctions: resolveEntry.manifest.capabilities,
					},
				);
				assert(resolved !== null && typeof resolved === "object");
				expect(resolved).toMatchObject({ success: true, value: { externalId: "g1" } });
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
				const entry = sandboxAudiobookDotAudibleDotDetailsScript;
				const compiled = {
					manifest: entry.manifest,
					format: entry.compiledFormat,
					javascript: entry.compiledCode,
				};
				const result = yield* runInDeno(
					compiled,
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
				const entry = sandboxPodcastDotItunesDotSearchScript;
				const compiled = {
					manifest: entry.manifest,
					format: entry.compiledFormat,
					javascript: entry.compiledCode,
				};
				const result = yield* runInDeno(
					compiled,
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
				const entry = sandboxPodcastDotListennotesDotSearchScript;
				const compiled = {
					manifest: entry.manifest,
					format: entry.compiledFormat,
					javascript: entry.compiledCode,
				};
				const result = yield* runInDeno(
					compiled,
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
				const entry = sandboxMusicDotMusicDashBrainzDotSearchScript;
				const compiled = {
					manifest: entry.manifest,
					format: entry.compiledFormat,
					javascript: entry.compiledCode,
				};
				const result = yield* runInDeno(
					compiled,
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
				const entry = sandboxMusicDotSpotifyDotSearchScript;
				const compiled = {
					manifest: entry.manifest,
					format: entry.compiledFormat,
					javascript: entry.compiledCode,
				};
				const result = yield* runInDeno(
					compiled,
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
				const entry = sandboxVideoDashGameDotGiantDashBombDotSearchScript;
				const compiled = {
					manifest: entry.manifest,
					format: entry.compiledFormat,
					javascript: entry.compiledCode,
				};
				const result = yield* runInDeno(
					compiled,
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
				const entry = sandboxVideoDashGameDotIgdbDotSearchScript;
				const compiled = {
					manifest: entry.manifest,
					format: entry.compiledFormat,
					javascript: entry.compiledCode,
				};
				const result = yield* runInDeno(
					compiled,
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
				const entry = sandboxComicDashBookDotMetronDotSearchScript;
				const compiled = {
					manifest: entry.manifest,
					format: entry.compiledFormat,
					javascript: entry.compiledCode,
				};
				const result = yield* runInDeno(
					compiled,
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
				const entry = sandboxVisualDashNovelDotVndbDotSearchScript;
				const compiled = {
					manifest: entry.manifest,
					format: entry.compiledFormat,
					javascript: entry.compiledCode,
				};
				const result = yield* runInDeno(
					compiled,
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
				const entry = sandboxExerciseDotFreeDashExerciseDashDbDotSearchScript;
				const compiled = {
					manifest: entry.manifest,
					format: entry.compiledFormat,
					javascript: entry.compiledCode,
				};
				const result = yield* runInDeno(
					compiled,
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

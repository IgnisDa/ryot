import { BunServices, BunHttpServer } from "@effect/platform-bun";
import { SandboxRunError, unknownToMessage } from "@ryot-app/contract/errors";
import { compilePluginSandboxSourceEntries } from "@ryot-app/sandbox-compiler/plugins";
import type { SandboxManifest } from "@ryot-app/sandbox-sdk/core";
import { SANDBOX_RUNTIME_REGISTRY } from "@ryot-app/sandbox-sdk/runtime-registry";
import { sha256Hex } from "@ryot-app/ts-utils/crypto";
import { Effect, Layer, Schema, Stream, FileSystem, Path } from "effect";
import { HttpEffect, HttpServer } from "effect/unstable/http";
import { ChildProcess } from "effect/unstable/process";
import { afterAll, assert, beforeAll, expect, it } from "vitest";

import { materializeSandboxCompiledModule } from "#lib/infrastructure/sandbox-runtime/compiled-modules";
import {
	materializeShippedSandboxRuntime,
	type SandboxRuntimePaths,
} from "#lib/infrastructure/sandbox-runtime/dependencies";
import { SANDBOX_LIMITS, SANDBOX_RUNNER_LIMITS } from "#lib/infrastructure/sandbox-runtime/limits";
import type { SandboxRunnerLimits } from "#lib/infrastructure/sandbox-runtime/runner-utilities.sandbox";
import { sandboxRunnerSource } from "#lib/infrastructure/sandbox-runtime/runner.generated";
import { kernelScripts } from "#modules/definition-registry/kernel-source";
import { SandboxCompiler } from "#modules/sandbox/sandbox-compiler";

let dependencyRuntimeRoot: string | undefined;
let dependencyRuntime: SandboxRuntimePaths | undefined;
let runnerPath: string | undefined;

beforeAll(
	() =>
		Effect.runPromise(
			Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem;
				const root = yield* fs.makeTempDirectory({ prefix: "ryot-sandbox-runner-" });
				const runtime = yield* materializeShippedSandboxRuntime(root);
				const compiledRunnerPath = `${root}/runner.mjs`;
				yield* fs.writeFileString(compiledRunnerPath, sandboxRunnerSource);
				dependencyRuntimeRoot = root;
				dependencyRuntime = runtime;
				runnerPath = compiledRunnerPath;
			}).pipe(Effect.provide(BunServices.layer)),
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
		}).pipe(Effect.provide(BunServices.layer)),
	);
});

const source = `
import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";

export const manifest = defineManifest({
  kind: "script",
  capabilities: [],
  name: "Runner validation",
  slug: "runner-validation",
  requiredPluginConfigKeys: [],
  requiredSystemConfigKeys: [],
});

export default defineScript({
	manifest,
  output: Schema.Number,
  run: (input) => Effect.succeed(input.value),
  input: Schema.Struct({ value: Schema.Number }),
});

`;

const aliasIdentitySource = `
import { Effect as SdkEffect, Schema } from "@ryot-app/sandbox-sdk/effect";
import { Effect as PluginKitEffect } from "@ryot-app/plugin-kit/effect";
import { table as sdkTable } from "@ryot-app/sandbox-sdk/ryotql";
import { table as pluginKitTable } from "@ryot-app/plugin-kit/ryotql";

const manifest = {
  kind: "script",
  capabilities: [],
  name: "Runtime alias identity",
  slug: "runtime-alias-identity",
  requiredPluginConfigKeys: [],
  requiredSystemConfigKeys: [],
};

export default {
  manifest,
  definitionType: "ryot:sandbox-script",
  input: Schema.Struct({}),
  output: Schema.Boolean,
  run: () => SdkEffect.succeed(SdkEffect === PluginKitEffect && sdkTable === pluginKitTable),
};
`;

const failureSource = `
import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";

export const manifest = defineManifest({
  kind: "script",
  capabilities: [],
  name: "Runner failure",
  slug: "runner-failure",
  requiredPluginConfigKeys: [],
  requiredSystemConfigKeys: [],
});

export default defineScript({
  manifest,
  output: Schema.Null,
  input: Schema.Struct({}),
  run: () => Effect.sync(() => {
    throw new Error("mapped execution failure execution-1");
  }),
});
`;

const limitsSource = `
import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";

export const manifest = defineManifest({
  kind: "script",
  capabilities: [],
  name: "Runner limits",
  slug: "runner-limits",
  requiredPluginConfigKeys: [],
  requiredSystemConfigKeys: [],
});

export default defineScript({
  manifest,
  output: Schema.Unknown,
  input: Schema.Struct({
    bytes: Schema.optional(Schema.Number),
    mode: Schema.Literals(["output", "logs"]),
  }),
  run: (input) => Effect.sync(() => {
    if (input.mode === "output") {
      return "x".repeat(input.bytes ?? ${SANDBOX_LIMITS.execution.resultBytes + 1});
    }
    for (let index = 0; index < ${SANDBOX_LIMITS.logs.entryCount}; index += 1) {
      console.log(index);
    }
    return null;
  }),
});
`;

const filesystemSource = `
import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";
import { readArtifact, readNamedArtifact, sandboxScratchManifestSchema, writeScratchChunks } from "@ryot-app/sandbox-sdk/filesystem";

export const manifest = defineManifest({
  kind: "script",
  name: "Filesystem",
  slug: "filesystem",
  requiredPluginConfigKeys: [],
  requiredSystemConfigKeys: [],
  capabilities: ["artifact-read", "scratch"],
});

export default defineScript({
  manifest,
  output: sandboxScratchManifestSchema,
  input: Schema.Struct({ chunkName: Schema.String, artifactKey: Schema.optional(Schema.String) }),
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
} from "@ryot-app/sandbox-sdk/core";
import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
import { jsonValueSchema } from "@ryot-app/sandbox-sdk/wire";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";

export const manifest = defineManifest({
  kind: "script",
  name: "Core host execution",
  slug: "core-host-execution",
  requiredPluginConfigKeys: [],
  requiredSystemConfigKeys: ["timezone"],
  capabilities: [
    "httpCall",
    "getCachedValue",
    "setCachedValue",
    "claimPersistentValue",
    "getSystemConfig",
    "getUserPreferences",
  ],
});

export default defineScript({
	manifest,
  input: Schema.Struct({ write: Schema.Boolean }),
  output: Schema.Struct({
    claim: cacheClaimSchema,
    config: jsonValueSchema,
    http: httpCallResponseSchema,
    preferences: userPreferencesSchema,
    after: Schema.NullOr(jsonValueSchema),
    before: Schema.NullOr(jsonValueSchema),
  }),
  run: (input, host, execution) => Effect.gen(function* () {
    const before = yield* host.getCachedValue("shared");
    if (input.write) {
      yield* host.setCachedValue("shared", { value: 42 }, 60);
    }
    const after = yield* host.getCachedValue("shared");
    const claim = yield* host.claimPersistentValue(
      "persistent", { owner: execution.sandboxScriptId }, 60,
    );
    const http = yield* host.httpCall("POST", "https://example.com/core", {
        body: "payload",
        headers: { Accept: "application/json" },
      });
    const config = yield* host.getSystemConfig(["timezone"]);
    const preferences = yield* host.getUserPreferences();
    return { after, before, claim, config, http, preferences };
  }),
});
`;

const approvedHostSource = `
import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
import { jsonValueSchema } from "@ryot-app/sandbox-sdk/wire";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";

export const manifest = defineManifest({
  kind: "script",
  name: "Filtered host",
  slug: "filtered-host",
  requiredPluginConfigKeys: [],
  requiredSystemConfigKeys: [],
  capabilities: ["getCachedValue"],
});

export default defineScript({
	manifest,
  input: Schema.Struct({}),
  output: Schema.Struct({ keys: Schema.Array(Schema.String), value: Schema.NullOr(jsonValueSchema) }),
  run: (_input, host) => Effect.gen(function* () {
    const value = yield* host.getCachedValue("redirect-check");
    return { keys: Object.keys(host).sort(), value };
  }),
});
`;

const hostBudgetSource = `
import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";

export const manifest = defineManifest({
  kind: "script",
  name: "Host budgets",
  slug: "host-budgets",
  requiredPluginConfigKeys: [],
  requiredSystemConfigKeys: [],
  capabilities: ["getCachedValue", "httpCall"],
});

export default defineScript({
	manifest,
	output: Schema.Unknown,
	input: Schema.Struct({ kind: Schema.Literals(["host", "http"]) }),
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
import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
import {
  createEventsResultDataSchema,
  entitySchemaRecordSchema,
  eventSchemaRecordSchema,
  integrationRecordSchema,
} from "@ryot-app/sandbox-sdk/core";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";
import { entityReadRecipe, executeRyotqlRecipe } from "@ryot-app/sandbox-sdk/ryotql";

export const manifest = defineManifest({
  kind: "script",
  requiredPluginConfigKeys: [],
  requiredSystemConfigKeys: [],
  name: "Domain host execution",
  slug: "domain-host-execution",
  capabilities: [
    "createEvents",
    "getEntitySchemas",
    "listEventSchemas",
    "executeRyotql",
    "getCurrentIntegration",
  ],
});

export default defineScript({
	manifest,
  input: Schema.Struct({}),
  output: Schema.Struct({
    queryRows: Schema.Number,
    integration: integrationRecordSchema,
    created: createEventsResultDataSchema,
    eventSchemas: Schema.Array(eventSchemaRecordSchema),
    entitySchemas: Schema.Array(entitySchemaRecordSchema),
  }),
  run: (_input, host) => Effect.gen(function* () {
    const integration = yield* host.getCurrentIntegration();
    const entitySchemas = yield* host.getEntitySchemas(["item"]);
    const eventSchemas = yield* host.listEventSchemas(["item"]);
    const created = yield* host.createEvents([
        { entityId: "entity-1", eventSchemaSlug: "event-schema-1", properties: { watched: true } },
      ]);
    const rows = yield* executeRyotqlRecipe(
      host.executeRyotql,
      entityReadRecipe({ entityIds: ["a", "b"] }),
    );
    return {
      created,
      integration,
      entitySchemas,
      queryRows: rows.items.length,
      eventSchemas: [...eventSchemas],
    };
  }),
});
`;

const dependencySource = (name: string, sdkImport: string) => `
import "${sdkImport}";
import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";

export const manifest = defineManifest({
  kind: "script",
  capabilities: [],
  requiredPluginConfigKeys: [],
  requiredSystemConfigKeys: [],
  name: "${name} dependency load",
  slug: "${name}-dependency-load",
});

export default defineScript({
	manifest,
  output: Schema.Null,
  input: Schema.Struct({}),
  run: () => Effect.succeed(null),
});
`;

const workflowHostSource = `
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";

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
    const journal = yield* host.replayJournal();
    return { journal, keys: Object.keys(host).sort() };
  }),
};
`;

const workflowNondeterminismSource = `
import { Effect as RuntimeEffect, Schema } from "@ryot-app/sandbox-sdk/effect";

const Effect = {
  as: RuntimeEffect.as,
  gen: RuntimeEffect.gen,
  succeed: RuntimeEffect.succeed,
};

const manifest = {
  kind: "workflow",
  capabilities: [],
  requiredPluginConfigKeys: [],
  requiredSystemConfigKeys: [],
  name: "Workflow nondeterminism",
  slug: "workflow-nondeterminism",
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
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";

const manifest = {
  kind: "script",
  capabilities: [],
  name: "Ambient script",
  slug: "ambient-script",
  requiredPluginConfigKeys: [],
  requiredSystemConfigKeys: [],
};

export default {
  manifest,
  output: Schema.Boolean,
  input: Schema.Struct({}),
  definitionType: "ryot:sandbox-script",
  run: () => Effect.sync(() => Date.now() > 0 && Math.random() >= 0 && performance.now() >= 0),
};
`;

const approvedYoutubeiDeterminismSource = `
import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";
import { createYoutubeMusicClient } from "@ryot-app/sandbox-sdk/youtubei";

export const manifest = defineManifest({
  kind: "script",
  capabilities: ["httpCall"],
  requiredPluginConfigKeys: [],
  requiredSystemConfigKeys: [],
  name: "Approved Youtubei determinism",
  slug: "approved-youtubei-determinism",
});

export default defineScript({
  manifest,
  output: Schema.String,
  input: Schema.Struct({}),
  run: (_input, host) => createYoutubeMusicClient(host, undefined, {
    retrievePlayer: false,
    retrieveInnertubeConfig: false,
  }).pipe(Effect.map((client) => String(client.session.context.client.visitorData))),
});
`;

const generatedNpmImportSource = `
import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";

export const manifest = defineManifest({
  kind: "script",
  capabilities: [],
  name: "Generated npm import",
  slug: "generated-npm-import",
  requiredPluginConfigKeys: [],
  requiredSystemConfigKeys: [],
});

export default defineScript({
	manifest,
  output: Schema.Null,
  input: Schema.Struct({}),
  run: () => Effect.promise(async () => {
    const load = Function('return im' + 'port("npm:zod")');
    await load();
    return null;
  }),
});
`;

const durableRoleSource = `
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";

export const manifest = {
  kind: "operation",
  name: "Durable role",
  slug: "durable-role",
  requiredPluginConfigKeys: [],
  requiredSystemConfigKeys: [],
  capabilities: ["getCachedValue"],
};

export default {
	manifest,
  output: Schema.Unknown,
	definitionType: "ryot:sandbox-script",
  input: Schema.Struct({ mode: Schema.String }),
  run: (input, host, execution) => Effect.gen(function* () {
    if (input.mode === "detached") {
      host.getCachedValue("detached");
      return { detached: true };
    }
    if (input.mode === "parallel") {
      const values = yield* Effect.all([
        host.getCachedValue("first"),
        host.getCachedValue("second"),
      ], { concurrency: "unbounded" });
      return { values, startedAt: execution.startedAt };
    }
    const first = yield* host.getCachedValue("first").pipe(
      Effect.catch(() => Effect.succeed("caught-pending")),
    );
    const second = yield* host.getCachedValue("second").pipe(
      Effect.catch((error) => Effect.succeed({ error: error.message, data: error.data })),
    );
    return { first, second, startedAt: execution.startedAt };
  }),
};
`;

const encodeRunnerRequest = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const decodeRunnerResponse = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown));
type RunnerCompiledModule = {
	readonly format: number;
	readonly javascript: string;
	readonly manifest: SandboxManifest;
};

type RunnerOptions = {
	readonly apiBase?: string;
	readonly scriptId?: string;
	readonly startedAt?: string;
	readonly moduleUrl?: string;
	readonly executionId?: string;
	readonly limits?: SandboxRunnerLimits;
	readonly workflowExecutionId?: string;
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

const runInDenoRequest = ({ context, compiled, options = {} }: RunnerRequest) =>
	Effect.scoped(
		Effect.gen(function* () {
			const runtime = dependencyRuntime;
			assert(runtime);
			assert(runnerPath);
			const path = yield* Path.Path;
			const filesystem = options.filesystem;
			const apiBase = options.apiBase ?? "http://127.0.0.1:1";
			const moduleUrl = yield* materializeSandboxCompiledModule(
				runtime,
				sha256Hex(compiled.javascript),
				compiled.javascript,
			).pipe(
				Effect.flatMap(path.toFileUrl),
				Effect.map((url) => url.href),
			);
			const request = `${encodeRunnerRequest({
				context,
				apiBase,
				token: "unused",
				metadata: compiled.manifest,
				compiledFormat: compiled.format,
				...(filesystem ? { filesystem } : {}),
				scriptId: options.scriptId ?? "script-1",
				apiFunctions: options.apiFunctions ?? [],
				moduleUrl: options.moduleUrl ?? moduleUrl,
				limits: options.limits ?? SANDBOX_RUNNER_LIMITS,
				executionId: options.executionId ?? "execution-1",
				startedAt: options.startedAt ?? "2026-08-06T00:00:00.000Z",
				...(options.workflowExecutionId
					? { workflowExecutionId: options.workflowExecutionId }
					: {}),
			})}\n`;
			const command = ChildProcess.make(
				"deno",
				[
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
					`--import-map=${runtime.importMapPath}`,
					`--v8-flags=--max-old-space-size=${SANDBOX_LIMITS.execution.denoHeapMiB}`,
					filesystem?.scratchDirectory
						? `--allow-write=${filesystem.scratchDirectory}`
						: "--deny-write",
					`--allow-read=${[
						runnerPath,
						runtime.directory,
						...(filesystem?.artifactPath ? [filesystem.artifactPath] : []),
						...Object.values(filesystem?.namedArtifactPaths ?? {}),
						...(filesystem?.scratchDirectory ? [filesystem.scratchDirectory] : []),
					].join(",")}`,
					runnerPath,
				],
				{
					stdout: "pipe",
					stderr: "pipe",
					extendEnv: false,
					stdin: Stream.succeed(new TextEncoder().encode(request)),
					env: { DENO_DIR: runtime.cacheDirectory, PATH: Bun.env["PATH"] ?? "/usr/bin:/bin" },
				},
			);
			const denoProcess = yield* command.pipe(
				Effect.mapError((error) => new SandboxRunError({ message: unknownToMessage(error) })),
			);
			yield* Effect.addFinalizer(() =>
				denoProcess.kill({ killSignal: "SIGKILL" }).pipe(Effect.ignore),
			);

			const [stdout, stderr, exitCode] = yield* Effect.all(
				[
					denoProcess.stdout.pipe(
						Stream.decodeText({ encoding: "utf-8" }),
						Stream.runFold(
							() => "",
							(a, b) => a + b,
						),
					),
					denoProcess.stderr.pipe(
						Stream.decodeText({ encoding: "utf-8" }),
						Stream.runFold(
							() => "",
							(a, b) => a + b,
						),
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
	).pipe(Effect.provide(BunServices.layer));

const runInDeno = (compiled: RunnerCompiledModule, context: unknown, options: RunnerOptions = {}) =>
	runInDenoRequest({ context, options, compiled });

const compileHostBridgeFixture = Effect.gen(function* () {
	const path = yield* Path.Path;
	const fs = yield* FileSystem.FileSystem;
	const entry = "test-fixtures/host-bridge.sandbox.ts";
	const sourcePath = yield* path.fromFileUrl(new URL(`./${entry}`, import.meta.url));
	const sourceText = yield* fs.readFileString(sourcePath);
	const [output] = yield* compilePluginSandboxSourceEntries({ [entry]: sourceText }, [
		{ entry, kind: "script" },
	]);
	assert(output);
	return output.compiled;
});

const startCoreHostBridge = (
	options: {
		readonly pluginConfigValue?: unknown;
		readonly systemConfigValue?: unknown;
		readonly replayJournalResult?: unknown;
		readonly getCachedValueResult?: unknown;
		readonly httpResponse?: (url: string) => unknown;
	} = {},
) =>
	Effect.gen(function* () {
		const runtime = yield* Effect.context();
		const runCache = new Map<string, unknown>();
		const executionScripts = new Map<string, string>();
		const persistentCache = new Map<string, unknown>();
		const calls: Array<{ fnName: string; executionId: string; args: readonly unknown[] }> = [];

		const server = yield* BunHttpServer.make({ port: 0, hostname: "127.0.0.1" });
		yield* HttpServer.serveEffect(
			HttpEffect.fromWebHandler((request) =>
				Effect.runPromiseWith(runtime)(
					Effect.gen(function* () {
						const parts = new URL(request.url).pathname.split("/").filter(Boolean);
						const executionId = decodeURIComponent(parts[1] ?? "");
						const fnName = decodeURIComponent(parts[2] ?? "");
						const body: unknown = yield* Effect.promise(() => request.json());
						const argsValue =
							body !== null && typeof body === "object" ? Reflect.get(body, "args") : undefined;
						const args: readonly unknown[] = Array.isArray(argsValue) ? argsValue : [];
						const scriptId = executionScripts.get(executionId) ?? "unknown";
						const cacheKey = `${scriptId}:${String(args[0])}`;
						calls.push({ args, fnName, executionId });

						let result: unknown;
						if (fnName === "getCachedValue") {
							result = options.getCachedValueResult ?? {
								success: true,
								data: runCache.has(cacheKey) ? runCache.get(cacheKey) : null,
							};
						} else if (fnName === "setCachedValue") {
							runCache.set(cacheKey, args[1]);
							result = { data: null, success: true };
						} else if (fnName === "claimPersistentValue") {
							if (persistentCache.has(cacheKey)) {
								result = {
									success: true,
									data: { claimed: false, value: persistentCache.get(cacheKey) ?? null },
								};
							} else {
								persistentCache.set(cacheKey, args[1]);
								result = { success: true, data: { claimed: true } };
							}
						} else if (fnName === "httpCall") {
							const customBody = options.httpResponse?.(String(args[1]));
							result = {
								success: true,
								data: {
									status: 200,
									headers: { "content-type": "application/json" },
									body:
										customBody === undefined
											? encodeRunnerRequest({ url: args[1], method: args[0], options: args[2] })
											: encodeRunnerRequest(customBody),
								},
							};
						} else if (fnName === "getPluginConfig") {
							const keys = Array.isArray(args[0]) ? args[0] : [];
							result = {
								success: true,
								data: Object.fromEntries(
									keys.map((requestedKey) => [
										requestedKey,
										options.pluginConfigValue ?? "plugin-value",
									]),
								),
							};
						} else if (fnName === "getSystemConfig") {
							const keys = Array.isArray(args[0]) ? args[0] : [];
							result = {
								success: true,
								data: Object.fromEntries(
									keys.map((requestedKey) => [
										requestedKey,
										options.systemConfigValue ?? "Etc/GMT",
									]),
								),
							};
						} else if (fnName === "getUserPreferences") {
							result = { success: true, data: { allowNsfw: false, disableIntegrations: true } };
						} else if (fnName === "replayJournal") {
							result = { success: true, data: options.replayJournalResult ?? [] };
						} else {
							result = { success: false, error: "Unknown function" };
						}

						return Response.json({ result });
					}),
				),
			),
		).pipe(Effect.provideService(HttpServer.HttpServer, server));
		const address = server.address;
		assert(address._tag !== "UnixPathAddress");

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
			expect(success).toMatchObject({ value: 42, success: true });

			const invalidInput = yield* runInDeno(compiled, { value: "wrong" });
			assert(invalidInput !== null && typeof invalidInput === "object");
			expect(Reflect.get(invalidInput, "error")).toMatchObject({
				phase: "input",
				message: expect.stringContaining("Definition input validation failed"),
			});

			const promiseManifest = {
				kind: "script",
				capabilities: [],
				requiredPluginConfigKeys: [],
				requiredSystemConfigKeys: [],
				name: "Promise definition rejection",
				slug: "promise-definition-rejection",
			} as const;
			const promiseManifestSource = yield* Schema.encodeUnknownEffect(
				Schema.fromJsonString(Schema.Unknown),
			)(promiseManifest);
			const promiseOutput = yield* runInDeno(
				{
					format: 1,
					manifest: promiseManifest,
					javascript: `import { Schema } from "@ryot-app/sandbox-sdk/effect";
export default {
	output: Schema.Boolean,
	input: Schema.Struct({}),
	run: () => Promise.resolve(true),
  manifest: ${promiseManifestSource},
  definitionType: "ryot:sandbox-script",
};`,
				},
				{},
			);
			assert(promiseOutput !== null && typeof promiseOutput === "object");
			expect(Reflect.get(promiseOutput, "error")).toEqual({
				phase: "execute",
				message: "Sandbox definition must return an Effect",
			});

			const unsupported = yield* runInDeno({ ...compiled, format: 2 }, { value: 42 });
			assert(unsupported !== null && typeof unsupported === "object");
			expect(Reflect.get(unsupported, "error")).toEqual({
				phase: "load",
				message: "Unsupported sandbox compiled format: 2",
			});
		}).pipe(Effect.provide(SandboxCompiler.layer)),
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

			assert(dependencyRuntime);
			const path = yield* Path.Path;
			const missingModulePath = `${dependencyRuntime.moduleDirectory}/${"0".repeat(64)}.mjs`;
			const missingResult = yield* runInDeno(
				compiled,
				{},
				{ moduleUrl: (yield* path.toFileUrl(missingModulePath)).href },
			);
			assert(missingResult !== null && typeof missingResult === "object");
			const missingError = Reflect.get(missingResult, "error");
			const encodedMissingError = encodeRunnerRequest(missingError);
			expect(missingError).toMatchObject({ phase: "load" });
			expect(encodedMissingError).not.toContain("file://");
			expect(encodedMissingError).not.toContain(dependencyRuntime.directory);

			const pathLeakSource = failureSource.replace(
				'throw new Error("mapped execution failure execution-1")',
				'throw new Error(new URL(".", import.meta.url).pathname)',
			);
			const pathLeakResult = yield* runInDeno(yield* compiler.compile(pathLeakSource), {});
			assert(pathLeakResult !== null && typeof pathLeakResult === "object");
			const encodedPathLeakError = encodeRunnerRequest(Reflect.get(pathLeakResult, "error"));
			expect(encodedPathLeakError).not.toContain(dependencyRuntime.moduleDirectory);
		}).pipe(Effect.provide(Layer.merge(SandboxCompiler.layer, BunServices.layer))),
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
		}).pipe(Effect.provide(SandboxCompiler.layer)),
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
				expect(success).toMatchObject({ success: true, value: { chunkFiles: ["chunk.json"] } });
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
				expect(named).toMatchObject({ success: true, value: { chunkFiles: ["named.json"] } });
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
			}).pipe(Effect.provide(Layer.merge(SandboxCompiler.layer, BunServices.layer))),
		),
	));

it("loads one compiled fixture for each approved SDK dependency without remote modules", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const compiler = yield* SandboxCompiler;
			for (const dependency of SANDBOX_RUNTIME_REGISTRY) {
				const compiled = yield* compiler.compile(
					dependencySource(dependency.name, dependency.sdkImport),
				);
				const result = yield* runInDeno(compiled, {});
				assert(result !== null && typeof result === "object");
				expect(Reflect.get(result, "error"), dependency.name).toBeUndefined();
				expect(result).toMatchObject({ value: null, success: true });
			}
		}).pipe(Effect.provide(SandboxCompiler.layer)),
	));

it("preserves Effect and RyotQL identity across SDK and plugin-kit aliases", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const result = yield* runInDeno(
				{
					format: 1,
					javascript: aliasIdentitySource,
					manifest: {
						kind: "script",
						capabilities: [],
						requiredPluginConfigKeys: [],
						requiredSystemConfigKeys: [],
						name: "Runtime alias identity",
						slug: "runtime-alias-identity",
					},
				},
				{},
			);
			expect(result).toMatchObject({ value: true, success: true });
		}),
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
		}).pipe(Effect.provide(SandboxCompiler.layer)),
	));

it("executes typed core host methods and builds the Deno host from approved capabilities", () =>
	Effect.runPromise(
		Effect.scoped(
			Effect.gen(function* () {
				const bridge = yield* startCoreHostBridge();
				const compiler = yield* SandboxCompiler;
				const compiled = yield* compiler.compile(coreHostSource);
				const approved = yield* compiler.compile(approvedHostSource);
				const apiBase = `http://127.0.0.1:${bridge.port}`;
				const apiFunctions = compiled.manifest.capabilities;

				bridge.register("execution-a-1", "script-a");
				const first = yield* runInDeno(
					compiled,
					{ write: true },
					{ apiBase, apiFunctions, scriptId: "script-a", executionId: "execution-a-1" },
				);
				assert(first !== null && typeof first === "object");
				expect(Reflect.get(first, "value")).toMatchObject({
					before: null,
					after: { value: 42 },
					claim: { claimed: true },
					config: { timezone: "Etc/GMT" },
					preferences: { allowNsfw: false, disableIntegrations: true },
				});

				bridge.register("execution-b-1", "script-b");
				const isolated = yield* runInDeno(
					compiled,
					{ write: false },
					{ apiBase, apiFunctions, scriptId: "script-b", executionId: "execution-b-1" },
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
					{ apiBase, apiFunctions, scriptId: "script-a", executionId: "execution-a-2" },
				);
				assert(persistent !== null && typeof persistent === "object");
				expect(Reflect.get(persistent, "value")).toMatchObject({
					after: { value: 42 },
					before: { value: 42 },
					http: { status: 200 },
					claim: { claimed: false, value: { owner: "script-a" } },
				});

				const approvedResult = yield* runInDeno(
					approved,
					{},
					{ apiBase, apiFunctions: ["getCachedValue", "setCachedValue", "getSystemConfig"] },
				);
				assert(approvedResult !== null && typeof approvedResult === "object");
				expect(Reflect.get(approvedResult, "value")).toEqual({
					value: null,
					keys: ["getCachedValue", "getSystemConfig", "setCachedValue"],
				});

				expect(new Set(bridge.calls.map((call) => call.fnName))).toEqual(new Set(apiFunctions));
			}).pipe(Effect.provide(SandboxCompiler.layer)),
		),
	));

it("rejects malformed private host wire responses", () =>
	Effect.runPromise(
		Effect.scoped(
			Effect.gen(function* () {
				const bridge = yield* startCoreHostBridge({ getCachedValueResult: { success: true } });
				const compiler = yield* SandboxCompiler;
				const compiled = yield* compiler.compile(approvedHostSource);
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
					message: expect.stringContaining("Missing key"),
				});
			}).pipe(Effect.provide(SandboxCompiler.layer)),
		),
	));

it(
	"loads every kernel script in Deno",
	() =>
		Effect.runPromise(
			Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem;
				const path = yield* Path.Path;
				const kernelFiles = Object.fromEntries(
					yield* Effect.forEach(kernelScripts, (script) =>
						Effect.gen(function* () {
							const filePath = yield* path.fromFileUrl(
								new URL(`../../../../${script.entry}`, import.meta.url),
							);
							const scriptSource = yield* fs.readFileString(filePath);
							return [script.entry, scriptSource] as const;
						}),
					),
				);
				const kernelOutputs = yield* compilePluginSandboxSourceEntries(kernelFiles, kernelScripts);
				yield* Effect.forEach(
					kernelOutputs,
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
			}).pipe(Effect.provide(BunServices.layer)),
		),
	120_000,
);

it(
	"executes a kernel-owned compiled host bridge fixture in Deno",
	() =>
		Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const bridge = yield* startCoreHostBridge({
						pluginConfigValue: "configured",
						httpResponse: () => ({ ready: true }),
					});
					const compiled = yield* compileHostBridgeFixture;
					const result = yield* runInDeno(
						compiled,
						{},
						{
							apiBase: `http://127.0.0.1:${bridge.port}`,
							apiFunctions: compiled.manifest.capabilities,
						},
					);
					assert(result !== null && typeof result === "object");
					expect(result).toMatchObject({ success: true });
					expect(Reflect.get(result, "value")).toMatchObject({
						cached: null,
						config: { fixtureValue: "configured" },
					});
					const cacheWrite = bridge.calls.find((call) => call.fnName === "setCachedValue");
					expect(cacheWrite?.args).toEqual(["fixture-key", { ready: true }, 60]);
				}).pipe(Effect.provide(BunServices.layer)),
			),
		),
	120_000,
);

it("keeps caught durable pending control flow pending and collects parallel calls in source order", () =>
	Effect.runPromise(
		Effect.scoped(
			Effect.gen(function* () {
				const bridge = yield* startCoreHostBridge({ replayJournalResult: [] });
				const manifest = {
					name: "Durable role",
					slug: "durable-role",
					kind: "operation" as const,
					requiredPluginConfigKeys: [] as const,
					requiredSystemConfigKeys: [] as const,
					capabilities: ["getCachedValue"] as const,
				};
				const options = {
					apiFunctions: ["replayJournal"],
					workflowExecutionId: "durable-parent",
					apiBase: `http://127.0.0.1:${bridge.port}`,
				};
				const caught = yield* runInDeno(
					{ manifest, format: 1, javascript: durableRoleSource },
					{ mode: "caught" },
					options,
				);
				const parallel = yield* runInDeno(
					{ manifest, format: 1, javascript: durableRoleSource },
					{ mode: "parallel" },
					options,
				);
				expect(caught).toMatchObject({
					success: true,
					value: {
						state: "pending",
						journalLength: 0,
						requests: [
							{
								index: 0,
								kind: "host",
								name: "getCachedValue",
								args: { args: ["first"], capability: "getCachedValue" },
							},
						],
					},
				});
				expect(parallel).toMatchObject({
					success: true,
					value: {
						journalLength: 0,
						state: "pending",
						requests: [
							{ index: 0, args: { args: ["first"] } },
							{ index: 1, args: { args: ["second"] } },
						],
					},
				});
				expect(bridge.calls.map(({ fnName }) => fnName)).toEqual([
					"replayJournal",
					"replayJournal",
				]);
			}),
		),
	));

it("replays durable host successes and typed failures without bridge redispatch", () =>
	Effect.runPromise(
		Effect.scoped(
			Effect.gen(function* () {
				const bridge = yield* startCoreHostBridge({
					replayJournalResult: [
						{
							value: { state: "success", value: "recorded" },
							request: {
								index: 0,
								kind: "host",
								name: "getCachedValue",
								args: { args: ["first"], capability: "getCachedValue" },
							},
						},
						{
							value: {
								state: "failure",
								error: { data: { code: 7 }, message: "recorded failure" },
							},
							request: {
								index: 1,
								kind: "host",
								name: "getCachedValue",
								args: { args: ["second"], capability: "getCachedValue" },
							},
						},
					],
				});
				const manifest = {
					name: "Durable role",
					slug: "durable-role",
					kind: "operation" as const,
					requiredPluginConfigKeys: [] as const,
					requiredSystemConfigKeys: [] as const,
					capabilities: ["getCachedValue"] as const,
				};
				const result = yield* runInDeno(
					{ manifest, format: 1, javascript: durableRoleSource },
					{ mode: "replay" },
					{
						apiFunctions: ["replayJournal"],
						workflowExecutionId: "durable-parent",
						apiBase: `http://127.0.0.1:${bridge.port}`,
					},
				);

				expect(result).toMatchObject({
					success: true,
					value: {
						journalLength: 2,
						state: "completed",
						output: {
							first: "recorded",
							startedAt: "2026-08-06T00:00:00.000Z",
							second: { data: { code: 7 }, error: "recorded failure" },
						},
					},
				});
				expect(bridge.calls.map(({ fnName }) => fnName)).toEqual(["replayJournal"]);
			}),
		),
	));

it("rejects a durable role that returns with detached host work", () =>
	Effect.runPromise(
		Effect.scoped(
			Effect.gen(function* () {
				const bridge = yield* startCoreHostBridge({ replayJournalResult: [] });
				const manifest = {
					name: "Durable role",
					slug: "durable-role",
					kind: "operation" as const,
					requiredPluginConfigKeys: [] as const,
					requiredSystemConfigKeys: [] as const,
					capabilities: ["getCachedValue"] as const,
				};
				const result = yield* runInDeno(
					{ manifest, format: 1, javascript: durableRoleSource },
					{ mode: "detached" },
					{
						apiFunctions: ["replayJournal"],
						workflowExecutionId: "durable-parent",
						apiBase: `http://127.0.0.1:${bridge.port}`,
					},
				);

				expect(result).toMatchObject({
					success: true,
					value: {
						state: "failed",
						journalLength: 0,
						error: "Sandbox body returned with detached or in-flight durable host work",
					},
				});
			}),
		),
	));

it("exposes only kernel-selected workflow host functions despite an empty manifest", () =>
	Effect.runPromise(
		Effect.scoped(
			Effect.gen(function* () {
				const bridge = yield* startCoreHostBridge({ replayJournalResult: [{ recorded: true }] });
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
					{ apiFunctions: ["replayJournal"], apiBase: `http://127.0.0.1:${bridge.port}` },
				);

				expect(result).toMatchObject({
					success: true,
					value: { keys: ["replayJournal"], journal: [{ recorded: true }] },
				});
				expect(bridge.calls).toEqual([
					expect.objectContaining({ args: [], fnName: "replayJournal" }),
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

				expect(result).toMatchObject({ value: 0, success: true });
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
			const workflowResult = yield* runInDeno(
				{ format: 1, manifest: workflowManifest, javascript: workflowNondeterminismSource },
				{ operation: "parse", timestamp: "2024-01-01T00:00:00.000Z" },
			);
			const scriptResult = yield* runInDeno(
				{ format: 1, manifest: scriptManifest, javascript: ambientScriptSource },
				{},
			);
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
			expect(scriptResult).toMatchObject({ value: true, success: true });
		}),
	));

it("resets approved Youtubei randomness for each replay", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const compiler = yield* SandboxCompiler;
			const compiled = yield* compiler.compile(approvedYoutubeiDeterminismSource);
			const run = (executionId: string) =>
				runInDeno(compiled, {}, { executionId, startedAt: "2026-08-06T00:00:00.000Z" });
			const first = yield* run("youtubei-replay");
			const second = yield* run("youtubei-replay");
			const other = yield* run("youtubei-other");
			assert(first !== null && typeof first === "object");
			assert(second !== null && typeof second === "object");
			assert(other !== null && typeof other === "object");
			expect(first).toMatchObject({ success: true, value: expect.any(String) });
			expect(second).toMatchObject({ success: true, value: expect.any(String) });
			expect(other).toMatchObject({ success: true, value: expect.any(String) });
			expect(Reflect.get(second, "value")).toBe(Reflect.get(first, "value"));
			expect(Reflect.get(other, "value")).not.toBe(Reflect.get(first, "value"));
		}).pipe(Effect.provide(SandboxCompiler.layer)),
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
			}).pipe(Effect.provide(SandboxCompiler.layer)),
		),
	));

const domainIntegrationRecord = {
	name: null,
	lot: "yank",
	userId: "user-1",
	isDisabled: false,
	minimumProgress: 2,
	syncOwnership: true,
	maximumProgress: 95,
	id: "integration-1",
	lastFinishedAt: null,
	provider: "lambda_yank",
	createdAt: "2024-01-01T00:00:00.000Z",
	updatedAt: "2024-01-01T00:00:00.000Z",
	providerSpecifics: { kind: "lambda_yank" },
	extraSettings: { disableOnContinuousErrors: false },
};

const domainEntitySchemaRecord = {
	id: "item",
	icon: "film",
	name: "Item",
	slug: "item",
	isBuiltin: true,
	pluginSlug: "plugin-1",
	propertiesSchema: { fields: {} },
	providers: [{ name: "Alpha", providerId: "alpha" }],
};

const domainEventSchemaRecord = {
	id: "watched",
	name: "Watched",
	slug: "watched",
	entitySchemaSlug: "item",
	propertiesSchema: { fields: {} },
};

const startDomainHostBridge = () =>
	Effect.gen(function* () {
		const createdEvents: unknown[][] = [];
		const runtime = yield* Effect.context();
		const server = yield* BunHttpServer.make({ port: 0, hostname: "127.0.0.1" });
		yield* HttpServer.serveEffect(
			HttpEffect.fromWebHandler((request) =>
				Effect.runPromiseWith(runtime)(
					Effect.gen(function* () {
						const parts = new URL(request.url).pathname.split("/").filter(Boolean);
						const fnName = decodeURIComponent(parts[2] ?? "");
						const body: unknown = yield* Effect.promise(() => request.json());
						const argsValue =
							body !== null && typeof body === "object" ? Reflect.get(body, "args") : undefined;
						const args: readonly unknown[] = Array.isArray(argsValue) ? argsValue : [];

						let result: unknown;
						if (fnName === "getCurrentIntegration") {
							result = { success: true, data: domainIntegrationRecord };
						} else if (fnName === "getEntitySchemas") {
							result = { success: true, data: [domainEntitySchemaRecord] };
						} else if (fnName === "listEventSchemas") {
							result = { success: true, data: [domainEventSchemaRecord] };
						} else if (fnName === "createEvents") {
							const items = args[0];
							createdEvents.push(Array.isArray(items) ? items : []);
							result = { success: true, data: { count: Array.isArray(items) ? items.length : 0 } };
						} else if (fnName === "executeRyotql") {
							result = {
								success: true,
								data: {
									data: {
										entities: {
											type: "rows",
											pageInfo: { limit: 20, hasMore: false, nextCursor: null },
											items: [
												{
													id: "a",
													properties: {},
													name: "Entity A",
													externalId: null,
													providerId: null,
													populatedAt: null,
													entitySchemaSlug: "item",
													createdAt: "2024-01-01T00:00:00.000Z",
													updatedAt: "2024-01-01T00:00:00.000Z",
												},
												{
													id: "b",
													properties: {},
													name: "Entity B",
													externalId: null,
													providerId: null,
													populatedAt: null,
													entitySchemaSlug: "item",
													createdAt: "2024-01-01T00:00:00.000Z",
													updatedAt: "2024-01-01T00:00:00.000Z",
												},
											],
										},
									},
								},
							};
						} else {
							result = { success: false, error: "Unknown function" };
						}

						return Response.json({ result });
					}),
				),
			),
		).pipe(Effect.provideService(HttpServer.HttpServer, server));
		const address = server.address;
		assert(address._tag !== "UnixPathAddress");

		return { createdEvents, port: address.port };
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
				expect(result).toMatchObject({
					value: {
						queryRows: 2,
						created: { count: 1 },
						entitySchemas: [{ id: "item", name: "Item" }],
						eventSchemas: [{ id: "watched", entitySchemaSlug: "item" }],
						integration: { id: "integration-1", provider: "lambda_yank" },
					},
				});
				expect(bridge.createdEvents).toHaveLength(1);
			}).pipe(Effect.provide(SandboxCompiler.layer)),
		),
	));

import { expect, it } from "@effect/vitest";
import { withTypeScriptProject, type TypeScriptProjectAccess } from "@ryot-app/typescript-compiler";
import { Effect } from "effect";

import { resolveSandboxCompilerDependencies } from "./compiler-dependencies";
import { SandboxCompilerFailure } from "./compiler-diagnostics";
import { createSandboxExecutionAnalyzer } from "./compiler-execution";
import { sandboxTypeScriptProject } from "./compiler-project";

const withProject = <A, E, R>(
	files: Readonly<Record<string, string>>,
	entries: ReadonlyArray<string>,
	use: (project: TypeScriptProjectAccess) => Effect.Effect<A, E, R>,
) =>
	Effect.gen(function* () {
		const { sdkEntries, tsserverPath } = yield* resolveSandboxCompilerDependencies;
		return yield* withTypeScriptProject(
			{
				files,
				entries,
				tsserverPath,
				virtualRoot: "/__ryot_sandbox__",
				projectKind: "sandbox capability test",
				configuration: {
					...sandboxTypeScriptProject,
					compilerOptions: {
						...sandboxTypeScriptProject.compilerOptions,
						paths: Object.fromEntries(
							Object.entries(sdkEntries).map(([specifier, entry]) => [specifier, [entry]]),
						),
					},
				},
			},
			use,
		);
	});

const analyzeEntries = (project: TypeScriptProjectAccess, entries: ReadonlyArray<string>) => {
	const analyze = createSandboxExecutionAnalyzer(project);
	return Effect.forEach(entries, (entry) => {
		const sourceFile = project.entrySourceFiles[entry];
		return sourceFile ? analyze(sourceFile) : Effect.die(`Missing entry source: ${entry}`);
	});
};

it.effect("collects direct host calls through helpers, references, closures, and branches", () =>
	Effect.gen(function* () {
		const entries = [
			"direct.sandbox.ts",
			"renamed-helper.sandbox.ts",
			"default-helper.sandbox.ts",
			"default-parameter.sandbox.ts",
			"closure-helper.sandbox.ts",
			"initializer.sandbox.ts",
		];
		const results = yield* withProject(
			{
				"closure-helper.sandbox.ts": `
import type { ScriptHost } from "@ryot-app/sandbox-sdk/core";
import { readCached } from "./helpers";

export default (host: Pick<ScriptHost, "getCachedValue">) => readCached(host);
`,
				"default-helper.sandbox.ts": `
import type { ScriptHost } from "@ryot-app/sandbox-sdk/core";
import readPersistent from "./helpers";

export default (host: Pick<ScriptHost, "getPersistentValue">) => readPersistent(host);
`,
				"renamed-helper.sandbox.ts": `
import type { ScriptHost } from "@ryot-app/sandbox-sdk/core";
import { readSettings as renamedRead } from "./helpers";

export default (host: Pick<ScriptHost, "getUserSettings">) => renamedRead(host);
`,
				"default-parameter.sandbox.ts": `
import type { ScriptHost } from "@ryot-app/sandbox-sdk/core";
import { createYoutubeMusicClient } from "@ryot-app/sandbox-sdk/youtubei";

const createWithDefault = (
  host: Pick<ScriptHost, "httpCall">,
  createClient = createYoutubeMusicClient,
) => createClient(host);

export default (host: Pick<ScriptHost, "httpCall">) => createWithDefault(host);
`,
				"helpers.ts": `
import type { ScriptHost } from "@ryot-app/sandbox-sdk/core";

export const readSettings = (host: Pick<ScriptHost, "getUserSettings">) => host.getUserSettings();
export const readCached = (host: Pick<ScriptHost, "getCachedValue">) => {
  const read = () => host.getCachedValue("cache");
  return read();
};
export default (host: Pick<ScriptHost, "getPersistentValue">) => host.getPersistentValue("key");
`,
				"direct.sandbox.ts": `
import type { ScriptHost } from "@ryot-app/sandbox-sdk/core";

export default (input: { useHttp: boolean }, host: Pick<ScriptHost, "httpCall" | "log">) => {
  const renamedHost = host;
  const send = renamedHost.httpCall;
  if (input.useHttp) send("GET", "https://example.com");
  else renamedHost.log([{ message: "branch", level: "info" }]);
  const shared = () => renamedHost.log([{ message: "closure", level: "info" }]);
  return shared();
};
`,
				"initializer.sandbox.ts": `
import type { ScriptHost } from "@ryot-app/sandbox-sdk/core";

declare const initializerHost: Pick<ScriptHost, "httpCall" | "log">;
const logDuringInitialization = (host: Pick<ScriptHost, "log">) =>
  host.log([{ message: "initialized", level: "info" }]);
const directInitialization = initializerHost.httpCall("GET", "https://example.com");
const helperInitialization = logDuringInitialization(initializerHost);
export default () => [directInitialization, helperInitialization];
`,
			},
			entries,
			(project) => analyzeEntries(project, entries),
		);

		expect(results.map(({ metadata }) => metadata.capabilities)).toEqual([
			["httpCall", "log"],
			["getUserSettings"],
			["getPersistentValue"],
			["httpCall"],
			["getCachedValue"],
			["httpCall", "log"],
		]);
		expect(results.map(({ diagnostics }) => diagnostics)).toEqual([[], [], [], [], [], []]);
	}),
);

it.effect("maps aliased intrinsic imports to their declared capabilities only", () =>
	Effect.gen(function* () {
		const entries = [
			"artifact.sandbox.ts",
			"artifact-range.sandbox.ts",
			"named-artifact.sandbox.ts",
			"scratch.sandbox.ts",
			"music.sandbox.ts",
			"history.sandbox.ts",
			"utility.sandbox.ts",
			"type-only.sandbox.ts",
			"unrelated.sandbox.ts",
		];
		const results = yield* withProject(
			{
				"utility.ts": `
export const normalize = (value: string) => value.trim();
`,
				"utility.sandbox.ts": `
import { normalize } from "./utility";

export default normalize(" text ");
`,
				"artifact-range.sandbox.ts": `
import { readArtifactRange as loadArtifactRange } from "@ryot-app/sandbox-sdk/filesystem";

export default loadArtifactRange(0, 1);
`,
				"named-artifact.sandbox.ts": `
import { readNamedArtifact as loadNamedArtifact } from "@ryot-app/sandbox-sdk/filesystem";

export default loadNamedArtifact("input.json");
`,
				"scratch.sandbox.ts": `
import { writeScratchChunks as writeChunks } from "@ryot-app/sandbox-sdk/filesystem";

export default writeChunks([{ name: "output.json", contents: "{}" }]);
`,
				"type-only.sandbox.ts": `
import { readArtifact } from "@ryot-app/sandbox-sdk/filesystem";

type ArtifactEffect = typeof readArtifact;
export const unusedType: ArtifactEffect | undefined = undefined;
`,
				"artifact.sandbox.ts": `
import { Effect } from "@ryot-app/sandbox-sdk/effect";
import { readArtifact as loadArtifact } from "@ryot-app/sandbox-sdk/filesystem";

export default loadArtifact.pipe(Effect.as(null));
`,
				"unrelated.sandbox.ts": `
const readArtifact = () => null;
const createYoutubeMusicClient = () => null;
const host = { httpCall: () => null };

export default () => {
  host.httpCall();
  readArtifact();
  createYoutubeMusicClient();
};
`,
				"music.sandbox.ts": `
import type { ScriptHost } from "@ryot-app/sandbox-sdk/core";
import { createYoutubeMusicClient as makeMusicClient } from "@ryot-app/sandbox-sdk/youtubei";

export default (host: Pick<ScriptHost, "httpCall">) => makeMusicClient(host);
`,
				"history.sandbox.ts": `
import type { ScriptHost } from "@ryot-app/sandbox-sdk/core";
import { createYoutubeHistoryClient as makeHistoryClient } from "@ryot-app/sandbox-sdk/youtubei";

export default (host: Pick<ScriptHost, "httpCall">) => makeHistoryClient(host, "cookie");
`,
			},
			entries,
			(project) => analyzeEntries(project, entries),
		);

		expect(results.map(({ metadata }) => metadata.capabilities)).toEqual([
			["artifact-read"],
			["artifact-read"],
			["artifact-read"],
			["scratch"],
			["httpCall"],
			["httpCall"],
			[],
			[],
			[],
		]);
		expect(results.map(({ diagnostics }) => diagnostics)).toEqual([
			[],
			[],
			[],
			[],
			[],
			[],
			[],
			[],
			[],
		]);
	}),
);

it.effect("keeps helper graphs and workflow dependency capabilities entry-local", () =>
	Effect.gen(function* () {
		const entries = [
			"network.sandbox.ts",
			"pure.sandbox.ts",
			"recursive.sandbox.ts",
			"workflow.sandbox.ts",
			"child.sandbox.ts",
			"wrapped-helper.sandbox.ts",
			"provider-helper.sandbox.ts",
		];
		const results = yield* withProject(
			{
				"pure.sandbox.ts": `
import { normalize } from "./shared";

export default normalize(" text ");
`,
				"first.ts": `
import type { ScriptHost } from "@ryot-app/sandbox-sdk/core";
import { second } from "./second";

export const first = (host: Pick<ScriptHost, "log">) => second(host);
`,
				"recursive.sandbox.ts": `
import type { ScriptHost } from "@ryot-app/sandbox-sdk/core";
import { first } from "./first";

export default (host: Pick<ScriptHost, "log">) => first(host);
`,
				"network.sandbox.ts": `
import type { ScriptHost } from "@ryot-app/sandbox-sdk/core";
import { request } from "./shared";

export default (host: Pick<ScriptHost, "httpCall">) => request(host);
`,
				"wrapped-helper.sandbox.ts": `
import type { ScriptHost } from "@ryot-app/sandbox-sdk/core";
import { wrappedRequest } from "./shared";

export default (host: Pick<ScriptHost, "httpCall">) => wrappedRequest({}, host);
`,
				"second.ts": `
import type { ScriptHost } from "@ryot-app/sandbox-sdk/core";
import { first } from "./first";

export const second = (host: Pick<ScriptHost, "log">) => {
  if (false) first(host);
  return host.log([{ message: "recursive graph", level: "info" }]);
};
`,
				"provider-helper.sandbox.ts": `
import type { ScriptHost } from "@ryot-app/sandbox-sdk/core";
import { usedProvider } from "./providers";

const parent = (host: Pick<ScriptHost, "httpCall" | "log">) =>
  usedProvider.run({ query: "", page: 1, pageSize: 20 }, host);

export default (host: Pick<ScriptHost, "httpCall" | "log">) => parent(host);
`,
				"workflow.sandbox.ts": `
import { defineManifest, defineScriptReference, defineWorkflow, Effect, Schema } from "@ryot-app/sandbox-sdk/workflow";

const manifest = defineManifest({ kind: "workflow", slug: "parent", name: "Parent" });
const child = defineScriptReference({ scriptSlug: "child", input: Schema.Unknown, output: Schema.Null });

export default defineWorkflow({
  manifest,
  input: Schema.Struct({}),
  output: Schema.Null,
  run: (_input, replay) => replay.activity("child", child, {}).pipe(Effect.as(null)),
});
`,
				"child.sandbox.ts": `
import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";
import { readNamedArtifact } from "@ryot-app/sandbox-sdk/filesystem";

const manifest = defineManifest({ kind: "script", slug: "child", name: "Child" });

export default defineScript({
  manifest,
  input: Schema.Struct({}),
  output: Schema.Null,
  run: (_input, host) => {
    void host.httpCall("GET", "https://example.com");
    return readNamedArtifact("child.json").pipe(Effect.as(null));
  },
});
`,
				"shared.ts": `
import type { ScriptHost } from "@ryot-app/sandbox-sdk/core";
import { Effect } from "@ryot-app/sandbox-sdk/effect";

export const request = (host: Pick<ScriptHost, "httpCall">) => host.httpCall("GET", "https://example.com");
export const wrappedRequest = Effect.fn(function* (
  _input: {},
  host: Pick<ScriptHost, "httpCall">,
) {
  yield* host.httpCall("GET", "https://example.com");
});
export const normalize = (value: string) => value.trim();
export const unused = Effect.fn("unused")((host: Pick<ScriptHost, "httpCall">) =>
  host.httpCall("GET", "https://unused.example.com"),
);
`,
				"providers.ts": `
import type { ScriptHost } from "@ryot-app/sandbox-sdk/core";
import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { Effect } from "@ryot-app/sandbox-sdk/effect";
import { defineProvider } from "@ryot-app/sandbox-sdk/provider";

const manifest = defineManifest({ kind: "provider", slug: "fixture", name: "Fixture" });

export const usedProvider = defineProvider({
  manifest,
  operation: "search",
  run: (_input, host: Pick<ScriptHost, "httpCall">) =>
    host.httpCall("GET", "https://example.com").pipe(Effect.as({ items: [] })),
});

export const unusedProvider = defineProvider({
  manifest,
  operation: "search",
  run: (_input, host: Pick<ScriptHost, "log">) =>
    host.log([{ message: "unused", level: "info" }]).pipe(Effect.as({ items: [] })),
});
`,
			},
			entries,
			(project) => analyzeEntries(project, entries),
		);

		expect(results[3]?.metadata.executableDependencies).toEqual([
			{ slug: "child", kind: "script" },
		]);
		expect(results[6]?.metadata.executableDependencies).toEqual([]);
		expect(results.map(({ metadata }) => metadata.capabilities)).toEqual([
			["httpCall"],
			[],
			["log"],
			[],
			["artifact-read", "httpCall"],
			["httpCall"],
			["httpCall"],
		]);
		expect(results.map(({ diagnostics }) => diagnostics)).toEqual([[], [], [], [], [], [], []]);
	}),
);

it.effect("allows finite indexed methods and rejects unbounded reflection and method aliases", () =>
	Effect.gen(function* () {
		const entries = [
			"finite-index.sandbox.ts",
			"unbounded-index.sandbox.ts",
			"reflective-escape.sandbox.ts",
			"config-alias.sandbox.ts",
			"executable-alias.sandbox.ts",
			"erased-helper.sandbox.ts",
		];
		const results = yield* withProject(
			{
				"reflective-escape.sandbox.ts": `
import type { ScriptHost } from "@ryot-app/sandbox-sdk/core";

export default (host: Pick<ScriptHost, "httpCall">) => Reflect.get(host, "httpCall");
`,
				"unbounded-index.sandbox.ts": `
import type { ScriptHost } from "@ryot-app/sandbox-sdk/core";

export default (host: Pick<ScriptHost, "httpCall"> & Record<string, unknown>, name: string) =>
  host[name];
`,
				"finite-index.sandbox.ts": `
import type { ScriptHost } from "@ryot-app/sandbox-sdk/core";

export default (host: Pick<ScriptHost, "httpCall" | "log">, name: "httpCall" | "log") => {
  const method = host[name];
  return method;
};
`,
				"erased-helper.sandbox.ts": `
import type { ScriptHost } from "@ryot-app/sandbox-sdk/core";

const forward = (value: unknown) => Reflect.get(value, "httpCall");

export default (host: Pick<ScriptHost, "httpCall">) => forward(host);
`,
				"config-alias.sandbox.ts": `
import type { ScriptHost } from "@ryot-app/sandbox-sdk/core";

export default (host: Pick<ScriptHost, "getPluginConfig">) => {
  const readConfig = host.getPluginConfig;
  return readConfig({ required: ["token"] });
};
`,
				"executable-alias.sandbox.ts": `
import { defineManifest, defineScriptReference, defineWorkflow, Effect, Schema } from "@ryot-app/sandbox-sdk/workflow";

const manifest = defineManifest({ kind: "workflow", slug: "alias", name: "Alias" });
const child = defineScriptReference({ scriptSlug: "child", input: Schema.Unknown, output: Schema.Null });

export default defineWorkflow({
  manifest,
  input: Schema.Struct({}),
  output: Schema.Null,
  run: (_input, replay) => {
    const runActivity = replay.activity;
    return runActivity("child", child, {}).pipe(Effect.as(null));
  },
});
`,
			},
			entries,
			(project) => analyzeEntries(project, entries),
		);

		expect(results[0]?.diagnostics).toEqual([]);
		expect(results[1]?.diagnostics).toEqual([
			expect.objectContaining({
				code: "RYOT_DEPENDENCY",
				message: "SDK host indexing requires statically finite operation names",
			}),
		]);
		expect(results[2]?.diagnostics).toEqual([
			expect.objectContaining({
				code: "RYOT_DEPENDENCY",
				message: "SDK hosts cannot escape to unresolved or external functions",
			}),
		]);
		expect(results[3]?.diagnostics).toEqual([
			expect.objectContaining({
				code: "RYOT_DEPENDENCY",
				message:
					"Configuration and executable SDK methods must be called directly; method aliases are unsupported",
			}),
		]);
		expect(results[4]?.diagnostics).toEqual([
			expect.objectContaining({
				code: "RYOT_DEPENDENCY",
				message:
					"Configuration and executable SDK methods must be called directly; method aliases are unsupported",
			}),
		]);
		expect(results[5]?.diagnostics).toEqual([
			expect.objectContaining({
				code: "RYOT_DEPENDENCY",
				message: "SDK helper forwarding must preserve resolved host operation types",
			}),
		]);
		expect(results.map(({ metadata }) => metadata.capabilities)).toEqual([
			["httpCall", "log"],
			[],
			[],
			["getPluginConfig"],
			[],
			[],
		]);
	}),
);

it.effect("rejects async initialization and fails at a deterministic analysis budget", () =>
	Effect.gen(function* () {
		const entries = ["async-initializer.sandbox.ts", "budget.sandbox.ts"];
		const outcome = yield* withProject(
			{
				"async-initializer.sandbox.ts": `
const initialized = await Promise.resolve("ready");
export default initialized;
`,
				"budget.sandbox.ts": `
import type { ScriptHost } from "@ryot-app/sandbox-sdk/core";

export default (host: Pick<ScriptHost, "httpCall">) => host.httpCall("GET", "https://example.com");
`,
			},
			entries,
			(project) => {
				const asyncEntry = project.entrySourceFiles["async-initializer.sandbox.ts"];
				const budgetEntry = project.entrySourceFiles["budget.sandbox.ts"];
				if (!asyncEntry || !budgetEntry) {
					return Effect.die("Missing analysis budget fixture entry");
				}
				const analyze = createSandboxExecutionAnalyzer(project);
				return Effect.gen(function* () {
					const asyncResult = yield* analyze(asyncEntry);
					const budgetFailure = yield* analyze(budgetEntry, 1).pipe(Effect.flip);
					return { asyncResult, budgetFailure };
				});
			},
		);

		expect(outcome.asyncResult.diagnostics).toEqual([
			expect.objectContaining({
				code: "RYOT_DEPENDENCY",
				message: "Asynchronous module initialization is unsupported",
			}),
		]);
		expect(outcome.budgetFailure).toBeInstanceOf(SandboxCompilerFailure);
		if (outcome.budgetFailure instanceof SandboxCompilerFailure) {
			expect(outcome.budgetFailure.diagnostics).toEqual([
				expect.objectContaining({ code: "RYOT_ANALYSIS_LIMIT" }),
			]);
		}
	}),
);

it.effect("rejects canonical Effect execution during module initialization", () =>
	Effect.gen(function* () {
		const entries = ["run-sync.sandbox.ts", "run-promise.sandbox.ts"];
		const results = yield* withProject(
			{
				"run-sync.sandbox.ts": `
import { Effect } from "@ryot-app/sandbox-sdk/effect";

const initialized = Effect.runSync(Effect.succeed("ready"));
export default initialized;
`,
				"run-promise.sandbox.ts": `
import { Effect } from "@ryot-app/sandbox-sdk/effect";

const initialized = Effect.runPromise(Effect.succeed("ready"));
export default initialized;
`,
			},
			entries,
			(project) => analyzeEntries(project, entries),
		);

		expect(results.map(({ diagnostics }) => diagnostics)).toEqual([
			[
				expect.objectContaining({
					code: "RYOT_DEPENDENCY",
					message: "Effect execution during module initialization is unsupported",
				}),
			],
			[
				expect.objectContaining({
					code: "RYOT_DEPENDENCY",
					message: "Effect execution during module initialization is unsupported",
				}),
			],
		]);
		expect(results.map(({ metadata }) => metadata.capabilities)).toEqual([[], []]);
	}),
);

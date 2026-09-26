import { expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";

import { compileSandboxPackageEntries } from "./compiler-builtins";
import { compileSandboxSource } from "./compiler-core";
import { validateCompiledSandboxManifest } from "./compiler-metadata";
import { sandboxCompilerPlatformLayer } from "./compiler-platform";
import { compilePluginSandboxSourceEntries } from "./compiler-plugins";

const source = (run: string) => `
import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";
import { read } from "./shared";
export const manifest = defineManifest({ kind: "script", slug: "entry", name: "Entry" });
export default defineScript({ manifest, input: Schema.Struct({ key: Schema.String }), output: Schema.Unknown, run: ${run} });
`;

const workflowFilesystemSource = `
import { readArtifact } from "@ryot-app/sandbox-sdk/filesystem";
import { defineManifest, defineWorkflow, Effect, Schema } from "@ryot-app/sandbox-sdk/workflow";
export const manifest = defineManifest({ kind: "workflow", slug: "workflow", name: "Workflow" });
export default defineWorkflow({ manifest, input: Schema.Struct({}), output: Schema.Null, run: () => readArtifact.pipe(Effect.as(null)) });
`;

it.layer(sandboxCompilerPlatformLayer)("execution dependency analysis", (test) => {
	test.effect.each(["policy", "workflow"])(
		"compiles a pure $0 helper without unused sibling effects through source and package paths",
		(kind) =>
			Effect.gen(function* () {
				const sourceEntry =
					kind === "policy"
						? `
import { defineAutomationPolicy, type AutomationPolicyResult } from "@ryot-app/sandbox-sdk/automation";
import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { Effect } from "@ryot-app/sandbox-sdk/effect";
import { readArtifact } from "@ryot-app/sandbox-sdk/filesystem";
import type { ScriptHost } from "@ryot-app/sandbox-sdk/core";

const allowed: AutomationPolicyResult = { action: "allow" };
export const manifest = defineManifest({ kind: "automation", slug: "pure-policy", name: "Pure policy", automationType: "policy", inputProjection: { event: { properties: [] } } });
export default defineAutomationPolicy({ manifest, run: () => {
  const helpers = {
    nested: {
      pure: () => Effect.succeed(allowed),
      unusedHttp: (host: Pick<ScriptHost, "httpCall">) => host.httpCall("GET", "https://unused.example.com").pipe(Effect.as(allowed)),
    },
    filesystem: () => readArtifact.pipe(Effect.as(allowed)),
  };
  const { nested } = helpers;
  return nested.pure();
} });
`
						: `
import { defineManifest, defineScriptReference, defineWorkflow, Effect, Schema, type WorkflowReplay } from "@ryot-app/sandbox-sdk/workflow";
import { readArtifact } from "@ryot-app/sandbox-sdk/filesystem";
import type { ScriptHost } from "@ryot-app/sandbox-sdk/core";

export const manifest = defineManifest({ kind: "workflow", slug: "pure-workflow", name: "Pure workflow" });
const reference = defineScriptReference({ scriptSlug: "unused", input: Schema.Unknown, output: Schema.Null });
export default defineWorkflow({ manifest, input: Schema.Struct({}), output: Schema.Null, run: () => {
  const helpers = {
    nested: {
      pure: () => Effect.succeed(null),
      unusedHttp: (host: Pick<ScriptHost, "httpCall">) => host.httpCall("GET", "https://unused.example.com"),
    },
    filesystem: () => readArtifact.pipe(Effect.as(null)),
    executable: (replay: WorkflowReplay) => replay.activity("unused", reference, {}).pipe(Effect.as(null)),
  };
  const { nested } = helpers;
  return nested.pure();
} });
`;
				const packageEntry =
					kind === "policy"
						? `
import { defineAutomationPolicy } from "@ryot-app/sandbox-sdk/automation";
import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { helpers } from "./helpers";

export const manifest = defineManifest({ kind: "automation", slug: "pure-policy", name: "Pure policy", automationType: "policy", inputProjection: { event: { properties: [] } } });
export default defineAutomationPolicy({ manifest, run: () => {
  const { nested } = helpers;
  return nested.pure();
} });
`
						: `
import { defineManifest, defineWorkflow, Effect, Schema } from "@ryot-app/sandbox-sdk/workflow";
import { helpers } from "./helpers";

export const manifest = defineManifest({ kind: "workflow", slug: "pure-workflow", name: "Pure workflow" });
export default defineWorkflow({ manifest, input: Schema.Struct({}), output: Schema.Null, run: () => {
  const { nested } = helpers;
  return nested.pure();
} });
`;
				const packageHelper =
					kind === "policy"
						? `
import { Effect } from "@ryot-app/sandbox-sdk/effect";
import { readArtifact } from "@ryot-app/sandbox-sdk/filesystem";
import type { ScriptHost } from "@ryot-app/sandbox-sdk/core";
import type { AutomationPolicyResult } from "@ryot-app/sandbox-sdk/automation";

const allowed: AutomationPolicyResult = { action: "allow" };
export const helpers = {
  nested: {
    pure: () => Effect.succeed(allowed),
    unusedHttp: (host: Pick<ScriptHost, "httpCall">) => host.httpCall("GET", "https://unused.example.com").pipe(Effect.as(allowed)),
  },
  filesystem: () => readArtifact.pipe(Effect.as(allowed)),
};
`
						: `
import { defineScriptReference, Effect, Schema, type WorkflowReplay } from "@ryot-app/sandbox-sdk/workflow";
import { readArtifact } from "@ryot-app/sandbox-sdk/filesystem";
import type { ScriptHost } from "@ryot-app/sandbox-sdk/core";

const reference = defineScriptReference({ scriptSlug: "unused", input: Schema.Unknown, output: Schema.Null });
export const helpers = {
  nested: {
    pure: () => Effect.succeed(null),
    unusedHttp: (host: Pick<ScriptHost, "httpCall">) => host.httpCall("GET", "https://unused.example.com"),
  },
  filesystem: () => readArtifact.pipe(Effect.as(null)),
  executable: (replay: WorkflowReplay) => replay.activity("unused", reference, {}).pipe(Effect.as(null)),
};
`;
				const sourceCompiled = yield* compileSandboxSource(sourceEntry);
				const [packageCompiled] = yield* compileSandboxPackageEntries(
					{
						entry: "backend/entry.sandbox.ts",
						files: {
							"backend/helpers.ts": packageHelper,
							"backend/entry.sandbox.ts": packageEntry,
						},
					},
					["backend/entry.sandbox.ts"],
				);

				const emptyFacts = {
					capabilities: [],
					oauthConnectionFields: [],
					executableDependencies: [],
					requiredPluginConfigKeys: [],
					optionalPluginConfigKeys: [],
				};
				expect(sourceCompiled.manifest).toMatchObject(emptyFacts);
				expect(packageCompiled?.compiled.manifest).toMatchObject(emptyFacts);
			}),
	);

	test.effect("rejects an automation policy capability inferred through a host helper", () =>
		Effect.gen(function* () {
			const compiled = yield* compileSandboxSource(`
import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
import { Schema } from "@ryot-app/sandbox-sdk/effect";
import type { ScriptHost } from "@ryot-app/sandbox-sdk/core";
const request = (host: Pick<ScriptHost, "httpCall">) => host.httpCall("GET", "https://example.com");
export const manifest = defineManifest({ kind: "script", slug: "entry", name: "Entry" });
export default defineScript({ manifest, input: Schema.Struct({}), output: Schema.Unknown, run: (_input, host) => request(host) });
`);
			const diagnostic = validateCompiledSandboxManifest({
				...compiled.manifest,
				kind: "automation",
				automationType: "policy",
				inputProjection: { event: { properties: [] } },
			});
			expect(compiled.manifest.capabilities).toEqual(["httpCall"]);
			expect(diagnostic?.code).toBe("RYOT_CAPABILITY");
			expect(
				validateCompiledSandboxManifest({
					...compiled.manifest,
					capabilities: [],
					kind: "automation",
					automationType: "policy",
					inputProjection: { event: { properties: [] } },
					executableDependencies: [{ kind: "workflow", slug: "workflow" }],
				})?.code,
			).toBe("RYOT_CAPABILITY");
		}),
	);
	test.effect.each(["source", "package"] as const)(
		"rejects workflow filesystem capabilities through the $0 entrypoint",
		(entrypoint) =>
			Effect.gen(function* () {
				const failure = yield* (
					entrypoint === "source"
						? compileSandboxSource(workflowFilesystemSource).pipe(Effect.asVoid)
						: compileSandboxPackageEntries(
								{
									entry: "workflow.sandbox.ts",
									files: { "workflow.sandbox.ts": workflowFilesystemSource },
								},
								["workflow.sandbox.ts"],
							).pipe(Effect.asVoid)
				).pipe(Effect.flip);
				expect(failure.diagnostics).toEqual(
					expect.arrayContaining([expect.objectContaining({ code: "RYOT_CAPABILITY" })]),
				);
			}),
	);
	test.effect.each(["single", "package"] as const)(
		"includes generated execution metadata in the $0 manifest size limit",
		(mode) =>
			Effect.gen(function* () {
				const keys = Array.from({ length: 200 }, (_, index) => `${index}-${"k".repeat(90)}`);
				const encodedKeys = yield* Schema.encodeEffect(
					Schema.fromJsonString(Schema.Array(Schema.String)),
				)(keys);
				const entry = source(
					`(_input, host) => host.getPluginConfig({ required: ${encodedKeys} })`,
				).replace('import { read } from "./shared";', "");
				const failure = yield* (
					mode === "single"
						? compileSandboxSource(entry).pipe(Effect.asVoid)
						: compilePluginSandboxSourceEntries({ "backend/entry.sandbox.ts": entry }, [
								{ kind: "script", entry: "backend/entry.sandbox.ts" },
							]).pipe(Effect.asVoid)
				).pipe(Effect.flip);
				expect(failure.diagnostics).toEqual([
					expect.objectContaining({ code: "RYOT_MANIFEST_SIZE" }),
				]);
			}),
	);
	test.effect("rejects an unbounded executable target", () =>
		Effect.gen(function* () {
			const failure = yield* compilePluginSandboxSourceEntries(
				{
					"backend/root.sandbox.ts": `
import { defineManifest, defineScriptReference, defineWorkflow, Schema } from "@ryot-app/sandbox-sdk/workflow";
export const manifest = defineManifest({ kind: "workflow", slug: "root", name: "Root" });
export default defineWorkflow({ manifest, input: Schema.Struct({ target: Schema.String }), output: Schema.String, run: (input, replay) => replay.activity("collect", defineScriptReference({ scriptSlug: input.target, input: Schema.Unknown, output: Schema.String }), {}) });
`,
				},
				[{ kind: "workflow", entry: "backend/root.sandbox.ts" }],
			).pipe(Effect.flip);
			expect(
				failure.diagnostics.some(
					(diagnostic) =>
						diagnostic.code === "RYOT_DEPENDENCY" &&
						diagnostic.message.includes("finite literal slugs"),
				),
			).toBe(true);
		}),
	);
	test.effect("rejects aliases of configuration methods", () =>
		Effect.gen(function* () {
			const failure = yield* compilePluginSandboxSourceEntries(
				{
					"backend/shared.ts": "export const read = () => null;",
					"backend/entry.sandbox.ts": source(
						'(_input, host) => { const getConfig = host.getPluginConfig; return getConfig({ required: ["token"] }); }',
					),
				},
				[{ kind: "script", entry: "backend/entry.sandbox.ts" }],
			).pipe(Effect.flip);
			expect(
				failure.diagnostics.some(
					(diagnostic) =>
						diagnostic.code === "RYOT_DEPENDENCY" &&
						diagnostic.message.includes("aliases are unsupported"),
				),
			).toBe(true);
		}),
	);
	test.effect("records bounded settings alternatives", () =>
		Effect.gen(function* () {
			const [result] = yield* compilePluginSandboxSourceEntries(
				{
					"backend/root.sandbox.ts": `
import { defineExecutableAlternatives, defineManifest, defineScriptReference, defineWorkflow, Effect, Schema, selectExecutable } from "@ryot-app/sandbox-sdk/workflow";
const alternatives = defineExecutableAlternatives({ id: "collector", stage: "settings", references: {
  api: defineScriptReference({ scriptSlug: "api", input: Schema.Unknown, output: Schema.String }),
  file: defineScriptReference({ scriptSlug: "file", input: Schema.Unknown, output: Schema.String }),
} });
export const manifest = defineManifest({ kind: "workflow", slug: "root", name: "Root" });
export default defineWorkflow({ manifest, input: Schema.Struct({ mode: Schema.String }), output: Schema.String, run: (input, replay) => replay.activity("collect", selectExecutable(alternatives, input.mode), {}) });
`,
				},
				[{ kind: "workflow", entry: "backend/root.sandbox.ts" }],
			);
			expect(result?.compiled.manifest.executableDependencies).toEqual([
				{
					slug: "api",
					kind: "script",
					selection: { key: "api", id: "collector", stage: "settings" },
				},
				{
					slug: "file",
					kind: "script",
					selection: { key: "file", id: "collector", stage: "settings" },
				},
			]);
		}),
	);
	test.effect("rejects destructured configuration method aliases", () =>
		Effect.gen(function* () {
			const failure = yield* compilePluginSandboxSourceEntries(
				{
					"backend/shared.ts": "export const read = () => null;",
					"backend/entry.sandbox.ts": source(
						'(_input, host) => { const { getPluginConfig: readConfig } = host; return readConfig({ required: ["token"] }); }',
					),
				},
				[{ kind: "script", entry: "backend/entry.sandbox.ts" }],
			).pipe(Effect.flip);
			expect(
				failure.diagnostics.some(
					(diagnostic) =>
						diagnostic.code === "RYOT_DEPENDENCY" &&
						diagnostic.message.includes("aliases are unsupported"),
				),
			).toBe(true);
		}),
	);
	test.effect("follows a default-exported helper expression", () =>
		Effect.gen(function* () {
			const [result] = yield* compilePluginSandboxSourceEntries(
				{
					"backend/entry.sandbox.ts": source("(_input, host) => read(host)").replace(
						'import { read } from "./shared";',
						'import read from "./shared";',
					),
					"backend/shared.ts": `
import type { ScriptHost } from "@ryot-app/sandbox-sdk/core";
export default (host: Pick<ScriptHost, "getPluginConfig">) => host.getPluginConfig({ required: ["token"], optional: ["threshold"] });
`,
				},
				[{ kind: "script", entry: "backend/entry.sandbox.ts" }],
			);
			expect(result?.compiled.manifest.requiredPluginConfigKeys).toEqual(["token"]);
			expect(result?.compiled.manifest.optionalPluginConfigKeys).toEqual(["threshold"]);
			expect(result?.compiled.manifest.capabilities).toEqual(["getPluginConfig"]);
		}),
	);
	test.effect("follows the used helper and separates optional reads", () =>
		Effect.gen(function* () {
			const [result] = yield* compilePluginSandboxSourceEntries(
				{
					"backend/entry.sandbox.ts": source("(_input, host) => read(host)"),
					"backend/shared.ts": `
import type { ScriptHost } from "@ryot-app/sandbox-sdk/core";
export const read = (host: Pick<ScriptHost, "getPluginConfig">) => host.getPluginConfig({ required: ["token"], optional: ["threshold"] });
export const unused = (host: Pick<ScriptHost, "getPluginConfig">) => host.getPluginConfig({ required: ["unused"] });
`,
				},
				[{ kind: "script", entry: "backend/entry.sandbox.ts" }],
			);
			expect(result?.compiled.manifest.requiredPluginConfigKeys).toEqual(["token"]);
			expect(result?.compiled.manifest.optionalPluginConfigKeys).toEqual(["threshold"]);
			expect(result?.compiled.manifest.capabilities).toEqual(["getPluginConfig"]);
		}),
	);

	test.effect("rejects a dynamic key with a source diagnostic", () =>
		Effect.gen(function* () {
			const error = yield* compilePluginSandboxSourceEntries(
				{
					"backend/shared.ts": "export const read = () => null;",
					"backend/entry.sandbox.ts": source(
						"(input, host) => host.getPluginConfig({ required: [input.key] })",
					),
				},
				[{ kind: "script", entry: "backend/entry.sandbox.ts" }],
			).pipe(Effect.flip);
			expect(
				error.diagnostics.some(
					(diagnostic) =>
						diagnostic.code === "RYOT_DEPENDENCY" && diagnostic.message.includes("finite"),
				),
			).toBe(true);
		}),
	);
});

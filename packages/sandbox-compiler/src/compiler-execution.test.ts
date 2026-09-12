import { expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";

import { compileSandboxSource } from "./compiler-core";
import { sandboxCompilerPlatformLayer } from "./compiler-platform";
import { compilePluginSandboxSourceEntries } from "./compiler-plugins";

const source = (run: string) => `
import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";
import { read } from "./shared";
export const manifest = defineManifest({ kind: "script", slug: "entry", name: "Entry", capabilities: ["getPluginConfig"] });
export default defineScript({ manifest, input: Schema.Struct({ key: Schema.String }), output: Schema.Unknown, run: ${run} });
`;

it.layer(sandboxCompilerPlatformLayer)("execution dependency analysis", (test) => {
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
export const manifest = defineManifest({ kind: "workflow", slug: "root", name: "Root", capabilities: [] });
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
export const manifest = defineManifest({ kind: "workflow", slug: "root", name: "Root", capabilities: [] });
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
import type { SandboxHost } from "@ryot-app/sandbox-sdk/core";
export default (host: SandboxHost<readonly ["getPluginConfig"]>) => host.getPluginConfig({ required: ["token"], optional: ["threshold"] });
`,
				},
				[{ kind: "script", entry: "backend/entry.sandbox.ts" }],
			);
			expect(result?.compiled.manifest.requiredPluginConfigKeys).toEqual(["token"]);
			expect(result?.compiled.manifest.optionalPluginConfigKeys).toEqual(["threshold"]);
		}),
	);
	test.effect("follows the used helper and separates optional reads", () =>
		Effect.gen(function* () {
			const [result] = yield* compilePluginSandboxSourceEntries(
				{
					"backend/entry.sandbox.ts": source("(_input, host) => read(host)"),
					"backend/shared.ts": `
import type { SandboxHost } from "@ryot-app/sandbox-sdk/core";
export const read = (host: SandboxHost<readonly ["getPluginConfig"]>) => host.getPluginConfig({ required: ["token"], optional: ["threshold"] });
export const unused = (host: SandboxHost<readonly ["getPluginConfig"]>) => host.getPluginConfig({ required: ["unused"] });
`,
				},
				[{ kind: "script", entry: "backend/entry.sandbox.ts" }],
			);
			expect(result?.compiled.manifest.requiredPluginConfigKeys).toEqual(["token"]);
			expect(result?.compiled.manifest.optionalPluginConfigKeys).toEqual(["threshold"]);
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

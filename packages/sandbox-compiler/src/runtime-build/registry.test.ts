import { BunServices } from "@effect/platform-bun";
import { expect, it } from "@effect/vitest";
import { SANDBOX_RUNTIME_REGISTRY } from "@ryot-app/sandbox-sdk/runtime-registry";
import { Effect } from "effect";

import { sandboxCompilerPlatformLayer } from "../compiler-platform";
import { compilePluginSandboxSourceEntries } from "../compiler-plugins";
import { resolveSandboxRuntimeRegistry } from "./registry";

it.layer(BunServices.layer)("resolveSandboxRuntimeRegistry", (test) => {
	test.effect("derives trusted runtime versions and filenames from installed manifests", () =>
		Effect.gen(function* () {
			const dependencies = yield* resolveSandboxRuntimeRegistry(Bun.fileURLToPath(import.meta.url));
			const byName = new Map(dependencies.map((dependency) => [dependency.name, dependency]));
			expect([...byName.keys()].sort()).toEqual([
				"cheerio",
				"dependency-runtime",
				"effect",
				"fast-xml-parser",
				"fflate",
				"filesystem",
				"markdown",
				"papaparse",
				"ryotql",
				"youtubei",
			]);
			for (const entry of SANDBOX_RUNTIME_REGISTRY) {
				const dependency = byName.get(entry.name);
				expect(dependency, entry.name).toBeDefined();
				expect(dependency?.runtimeFile).toBe(`${entry.name}-${dependency?.version}.mjs`);
				expect(dependency).toMatchObject({
					name: entry.name,
					aliases: entry.aliases,
					sdkImport: entry.sdkImport,
					packageName: entry.packageName,
				});
			}
		}),
	);
});

it.layer(sandboxCompilerPlatformLayer)("Markdown runtime imports", (test) => {
	test.effect("bundles literal text into core scripts and externalizes rich conversion", () =>
		Effect.gen(function* () {
			const compiled = yield* compilePluginSandboxSourceEntries(
				{
					"rich.sandbox.ts": `
import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";
import { normalizeMarkdown } from "@ryot-app/sandbox-sdk/markdown";
export const manifest = defineManifest({ kind: "script", slug: "rich", name: "Rich" });
export default defineScript({ manifest, input: Schema.String, output: Schema.String, run: (input) => Effect.succeed(normalizeMarkdown(input)) });
`,
					"plain.sandbox.ts": `
import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";
import { escapeMarkdownText } from "@ryot-app/sandbox-sdk/markdown-text";
export const manifest = defineManifest({ kind: "script", slug: "plain", name: "Plain" });
export default defineScript({ manifest, input: Schema.String, output: Schema.String, run: (input) => Effect.succeed(escapeMarkdownText(input)) });
`,
				},
				[
					{ kind: "script", entry: "plain.sandbox.ts" },
					{ kind: "script", entry: "rich.sandbox.ts" },
				],
			);
			expect(
				compiled.map(({ entry, compiled: module }) => [entry, module.manifest.runtimeImports]),
			).toEqual([
				["plain.sandbox.ts", ["@ryot-app/sandbox-sdk/effect"]],
				["rich.sandbox.ts", ["@ryot-app/sandbox-sdk/effect", "@ryot-app/sandbox-sdk/markdown"]],
			]);
			for (const { compiled: module } of compiled) {
				expect(module.manifest.capabilities).toEqual([]);
			}
		}),
	);
});

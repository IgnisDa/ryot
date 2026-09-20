import { assert, expect, layer } from "@effect/vitest";
import { hasValidExecutableDependencies } from "@ryot-app/contract/modules/plugins/execution";
import { pluginLoadLayer } from "@ryot-app/kernel-backend/lib/infrastructure/sandbox-runtime/plugin-load.test-support";
import { loadPluginSource } from "@ryot-app/kernel-backend/modules/plugins/source.test-support";
import { derivePluginSandboxScripts } from "@ryot-app/sandbox-compiler/plugin-manifest";
import { Effect } from "effect";

import mediaPlugin from "./plugin";

layer(pluginLoadLayer, { excludeTestServices: true })((test) => {
	test.effect(
		"keeps source and integration executable closures and accepted plans separate",
		() =>
			Effect.gen(function* () {
				const source = yield* loadPluginSource(
					new URL("..", import.meta.url).pathname,
					mediaPlugin,
				);
				const decoder = new TextDecoder("utf-8", { fatal: true });
				const files = Object.fromEntries(
					Object.entries(source.files)
						.filter(([path]) => path.startsWith("backend/") || path.startsWith("shared/"))
						.map(([path, content]) => [path, decoder.decode(content)]),
				);
				const compiled = yield* derivePluginSandboxScripts(files);
				const scripts = compiled.map(({ script }) => script);
				const manifest = { ...mediaPlugin, scripts };
				expect(hasValidExecutableDependencies(manifest)).toBe(true);
				const bySlug = new Map(scripts.map((script) => [script.slug, script]));
				const workflows = new Map<string, string>(
					mediaPlugin.workflows.map((workflow) => [workflow.slug, workflow.scriptSlug]),
				);
				const closure = (root: string) => {
					const visited = new Set<string>();
					const pending = [root];
					const selectors = new Set<string>();
					while (pending.length) {
						const slug = pending.pop();
						assert(slug);
						if (visited.has(slug)) {
							continue;
						}
						visited.add(slug);
						const script = bySlug.get(slug);
						assert(script);
						for (const dependency of script.executableDependencies) {
							if (dependency.selection?.stage === "settings") {
								selectors.add(dependency.selection.id);
							}
							if (dependency.kind === "script") {
								pending.push(dependency.slug);
							} else if (!dependency.slug.startsWith("kernel:")) {
								const target = workflows.get(dependency.slug);
								assert(target);
								pending.push(target);
							}
						}
					}
					return { scripts: [...visited], selectors: [...selectors].sort() };
				};
				const manual = closure("workflow.media-import");
				const integration = closure("workflow.media-integration");
				expect(manual.selectors).toEqual(["source-parser"]);
				expect(manual.scripts.filter((slug) => slug.startsWith("integration."))).toEqual([]);
				expect(integration.selectors).toEqual(["integration-adapter"]);
				for (const collector of [
					"import.spotify",
					"import.netflix",
					"import.trakt",
					"import.trakt-export",
				]) {
					expect(integration.scripts).not.toContain(collector);
				}
				for (const provider of mediaPlugin.integrationProviders) {
					if (provider.lot === "push") {
						continue;
					}
					expect(provider.scriptSlug).toBe("workflow.media-integration");
					assert(provider.plan);
					const selection = provider.plan.selections["integration-adapter"];
					assert("value" in selection);
					expect(integration.scripts).toContain(selection.value);
				}
			}),
		120_000,
	);
});

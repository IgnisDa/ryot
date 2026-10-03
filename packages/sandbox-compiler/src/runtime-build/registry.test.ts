import { BunServices } from "@effect/platform-bun";
import { expect, it } from "@effect/vitest";
import { SANDBOX_RUNTIME_REGISTRY } from "@ryot-app/sandbox-sdk/runtime-registry";
import { Effect } from "effect";

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

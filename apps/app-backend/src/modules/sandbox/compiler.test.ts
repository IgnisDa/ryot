import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import {
	compileSandboxSourceForTest as compile,
	validSandboxSource as validSource,
} from "./compiler-test-support";

const approvedDependencyImports = [
	"@ryot/sandbox-sdk/zod",
	"@ryot/sandbox-sdk/dayjs",
	"@ryot/sandbox-sdk/dayjs/custom-parse-format",
	"@ryot/sandbox-sdk/cheerio",
	"@ryot/sandbox-sdk/youtubei",
] as const;

const automationSource = `
import { defineManifest } from "@ryot/sandbox-sdk";
import { defineAutomation } from "@ryot/sandbox-sdk/automation";

export const manifest = defineManifest({
  kind: "automation",
  name: "Automation",
  slug: "automation.test",
  capabilities: [],
  requiredAppConfigKeys: [],
});

export default defineAutomation({
  manifest,
  run: async () => null,
});
`;

it.effect("compiles one SDK script to an inline-source-mapped ESM module", () =>
	Effect.gen(function* () {
		const compiled = yield* compile(
			validSource.replace(
				"export default defineScript",
				'throw new Error("compilation must not execute source");\n\nexport default defineScript',
			),
		);

		expect(compiled.format).toBe(1);
		expect(compiled.manifest).toEqual({
			kind: "script",
			capabilities: [],
			name: "Plain value",
			slug: "plain-value",
			requiredAppConfigKeys: [],
		});
		expect(compiled.javascript).toContain("export {");
		expect(compiled.javascript).toContain("sourceMappingURL=data:application/json;base64,");
	}),
);

it.effect("accepts a top-level driver record in the default script definition", () =>
	Effect.gen(function* () {
		const compiled = yield* compile(
			validSource.replace(
				"export default defineScript({ manifest, drivers: { main } });",
				"const drivers = { main };\n\nexport default defineScript({ manifest, drivers });",
			),
		);

		expect(compiled.manifest.slug).toBe("plain-value");
	}),
);

it.effect("compiles a typed automation definition", () =>
	Effect.gen(function* () {
		const compiled = yield* compile(automationSource);

		expect(compiled.manifest.kind).toBe("automation");
		expect(compiled.manifest.slug).toBe("automation.test");
		expect(compiled.javascript).toContain("ryot:sandbox-script");
	}),
);

it.effect(
	"rejects a provider manifest wrapped in defineScript despite suppressed type errors",
	() =>
		Effect.gen(function* () {
			const failure = yield* compile(
				validSource
					.replace(
						'kind: "script",',
						'kind: "provider",\n  providerInformation: { source: "test" },',
					)
					.replace(
						"export default defineScript",
						"// @ts-expect-error intentionally using the wrong definition helper\nexport default defineScript",
					),
			).pipe(Effect.flip);

			expect(failure.diagnostics).toEqual([
				expect.objectContaining({
					code: "RYOT_DEFINITION",
					message: 'Manifest kind "provider" must use defineProvider',
				}),
			]);
		}),
);

it.effect("rejects generic schemas for a standard provider driver", () =>
	Effect.gen(function* () {
		const failure = yield* compile(
			validSource
				.replace(
					'import { defineDriver, defineManifest, defineScript } from "@ryot/sandbox-sdk";',
					'import { defineDriver, defineManifest } from "@ryot/sandbox-sdk";\nimport { defineProvider } from "@ryot/sandbox-sdk/provider";',
				)
				.replace('kind: "script",', 'kind: "provider",\n  providerInformation: { source: "test" },')
				.replaceAll("main", "search")
				.replace(
					"export default defineScript",
					"// @ts-expect-error intentionally using generic provider schemas\nexport default defineProvider",
				),
		).pipe(Effect.flip);

		expect(failure.diagnostics).toEqual([
			expect.objectContaining({
				code: "RYOT_DEFINITION",
				message: 'Provider driver "search" must use defineProviderDriver(manifest, "search", ...)',
			}),
		]);
	}),
);

it.effect("externalizes every approved SDK runtime dependency", () =>
	Effect.gen(function* () {
		const source = `${approvedDependencyImports.map((specifier) => `import "${specifier}";`).join("\n")}\n${validSource}`;
		const compiled = yield* compile(source);
		const emittedModule = compiled.javascript.split("//# sourceMappingURL", 1)[0] ?? "";

		for (const specifier of approvedDependencyImports) {
			expect(emittedModule).toContain(`"${specifier}"`);
		}
		expect(emittedModule).not.toMatch(
			/\b(?:from|import)\s*["'](?:cheerio|dayjs|youtubei\.js|zod)(?:[/'"])/,
		);
		expect(new TextEncoder().encode(emittedModule).byteLength).toBeLessThan(128 * 1024);
	}),
);

it.effect("returns an actionable TypeScript diagnostic", () =>
	Effect.gen(function* () {
		const failure = yield* compile(validSource.replace("input.value,", '"wrong",')).pipe(
			Effect.flip,
		);

		expect(failure._tag).toBe("SandboxCompilationFailure");
		expect(failure.diagnostics.length).toBeGreaterThan(0);
		expect(failure.diagnostics[0]).toMatchObject({
			file: "script.ts",
			severity: "error",
		});
		expect(failure.diagnostics.some((diagnostic) => diagnostic.code.startsWith("TS"))).toBe(true);
	}),
);

it.effect("types a host method declared by the manifest capability tuple", () =>
	Effect.gen(function* () {
		const compiled = yield* compile(
			validSource.replace("capabilities: []", 'capabilities: ["getCachedValue"]').replace(
				"run: async (input) => input.value,",
				`run: async (input, host) => {
    const cached = await host.getCachedValue("answer");
    return cached.success && typeof cached.data === "number" ? cached.data : input.value;
  },`,
			),
		);

		expect(compiled.manifest.capabilities).toEqual(["getCachedValue"]);
	}),
);

it.effect("rejects a host method omitted from the manifest capability tuple", () =>
	Effect.gen(function* () {
		const failure = yield* compile(
			validSource.replace(
				"run: async (input) => input.value,",
				`run: async (input, host) => {
    await host.getCachedValue("answer");
    return input.value;
  },`,
			),
		).pipe(Effect.flip);

		expect(failure.diagnostics).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "TS2339",
					severity: "error",
					message: expect.stringContaining("getCachedValue"),
				}),
			]),
		);
	}),
);

it.effect("rejects a widened exported manifest that would expose undeclared host methods", () =>
	Effect.gen(function* () {
		const failure = yield* compile(
			validSource
				.replace("defineScript }", "defineScript, type SandboxManifest }")
				.replace(
					"export const manifest = defineManifest",
					"export const manifest: SandboxManifest = defineManifest",
				)
				.replace(
					"run: async (input) => input.value,",
					`run: async (input, host) => {
    await host.getCachedValue("answer");
    return input.value;
  },`,
				),
		).pipe(Effect.flip);

		expect(failure.diagnostics).toEqual([
			expect.objectContaining({
				code: "RYOT_MANIFEST",
				message: "The exported manifest must not have an explicit type annotation",
			}),
		]);
	}),
);

it.effect("rejects capability assertions that widen a static manifest tuple", () =>
	Effect.gen(function* () {
		const failure = yield* compile(
			validSource
				.replace("defineScript }", "defineScript, type SandboxManifest }")
				.replace("capabilities: []", 'capabilities: [] as SandboxManifest["capabilities"]')
				.replace(
					"run: async (input) => input.value,",
					`run: async (input, host) => {
    await host.getCachedValue("answer");
    return input.value;
  },`,
				),
		).pipe(Effect.flip);

		expect(failure.diagnostics).toEqual([
			expect.objectContaining({
				code: "RYOT_MANIFEST",
				message: "Manifest type assertions are not allowed",
			}),
		]);
	}),
);

it.effect("rejects a driver defined against a different manifest", () =>
	Effect.gen(function* () {
		const failure = yield* compile(
			validSource
				.replace(
					"const main = defineDriver(manifest,",
					`const driverManifest = defineManifest({
  kind: "script",
  name: "Driver manifest",
  slug: "driver-manifest",
  capabilities: ["getCachedValue"],
  requiredAppConfigKeys: [],
});

const main = defineDriver(driverManifest,`,
				)
				.replace(
					"run: async (input) => input.value,",
					`run: async (input, host) => {
    await host.getCachedValue("answer");
    return input.value;
  },`,
				),
		).pipe(Effect.flip);

		expect(failure.diagnostics).toEqual([
			expect.objectContaining({
				code: "RYOT_DEFINITION",
				message: 'defineDriver must receive the exported "manifest" identifier directly',
			}),
		]);
	}),
);

it.effect("rejects a block-local manifest shadowing the exported manifest", () =>
	Effect.gen(function* () {
		const failure = yield* compile(`
import { defineDriver, defineManifest, defineScript } from "@ryot/sandbox-sdk";
import * as z from "@ryot/sandbox-sdk/zod";

export const manifest = defineManifest({
  kind: "script",
  name: "Exported manifest",
  slug: "exported-manifest",
  capabilities: [],
  requiredAppConfigKeys: [],
});

const main = (() => {
  const manifest = defineManifest({
    kind: "script",
    name: "Shadow manifest",
    slug: "shadow-manifest",
    capabilities: ["getCachedValue"],
    requiredAppConfigKeys: [],
  });
  return defineDriver(manifest, {
    input: z.object({}),
    output: z.null(),
    run: async (_input, host) => {
      await host.getCachedValue("answer");
      return null;
    },
  });
})();

export default defineScript({ manifest, drivers: { main } });
`).pipe(Effect.flip);

		expect(failure.diagnostics).toEqual([
			expect.objectContaining({
				code: "RYOT_DEFINITION",
				message: "defineDriver must initialize a top-level const",
			}),
		]);
	}),
);

it.effect("rejects namespace helper calls that bypass the exported manifest", () =>
	Effect.gen(function* () {
		const failure = yield* compile(`
import * as sdk from "@ryot/sandbox-sdk";
import { defineManifest, defineScript } from "@ryot/sandbox-sdk";
import * as z from "@ryot/sandbox-sdk/zod";

export const manifest = defineManifest({
  kind: "script",
  name: "Exported manifest",
  slug: "exported-manifest",
  capabilities: [],
  requiredAppConfigKeys: [],
});

const driverManifest = sdk.defineManifest({
  kind: "script",
  name: "Driver manifest",
  slug: "driver-manifest",
  capabilities: ["getCachedValue"],
  requiredAppConfigKeys: [],
});
const main = sdk.defineDriver(driverManifest, {
  input: z.object({}),
  output: z.null(),
  run: async (_input, host) => {
    await host.getCachedValue("answer");
    return null;
  },
});

export default defineScript({ manifest, drivers: { main } });
`).pipe(Effect.flip);

		expect(failure.diagnostics).toEqual([
			expect.objectContaining({
				code: "RYOT_DEFINITION",
				message: "Every script driver must be a top-level defineDriver(manifest, ...) const",
			}),
		]);
	}),
);

it.effect("rejects manually constructed drivers outside defineDriver", () =>
	Effect.gen(function* () {
		const failure = yield* compile(`
import {
  defineManifest,
  defineScript,
  type SandboxHost,
} from "@ryot/sandbox-sdk";
import * as z from "@ryot/sandbox-sdk/zod";

export const manifest = defineManifest({
  kind: "script",
  name: "Manual driver",
  slug: "manual-driver",
  capabilities: [],
  requiredAppConfigKeys: [],
});

const main = {
  input: z.object({}),
  output: z.null(),
  run: async (_input: unknown, host: SandboxHost<["getCachedValue"]>) => {
    await host.getCachedValue("answer");
    return null;
  },
};

export default defineScript({ manifest, drivers: { main } });
`).pipe(Effect.flip);

		expect(failure.diagnostics).toEqual([
			expect.objectContaining({
				code: "RYOT_DEFINITION",
				message: "Every script driver must be a top-level defineDriver(manifest, ...) const",
			}),
		]);
	}),
);

it.effect("rejects direct package, runtime, URL, Node, Bun, and relative imports", () =>
	Effect.gen(function* () {
		for (const specifier of [
			"zod",
			"npm:zod@4.4.3",
			"deno:npm:zod@4.4.3",
			"@ryot/sandbox-sdk/testing",
			"https://example.com/module.ts",
			"node:fs",
			"bun:test",
			"./helper.ts",
		]) {
			const failure = yield* compile(`import "${specifier}";\n${validSource}`).pipe(Effect.flip);

			expect(failure.diagnostics).toEqual([
				expect.objectContaining({
					line: 1,
					code: "RYOT_IMPORT",
					message: expect.stringContaining(`Import "${specifier}" is not allowed`),
				}),
			]);
		}
	}),
);

it.effect("rejects computed dynamic imports before resolution", () =>
	Effect.gen(function* () {
		const failure = yield* compile(
			`${validSource}\nconst dependency = "@ryot/sandbox-sdk/dayjs";\nvoid import(dependency);`,
		).pipe(Effect.flip);

		expect(failure.diagnostics).toEqual([
			expect.objectContaining({
				code: "RYOT_IMPORT",
				message: "Dynamic imports are not allowed",
			}),
		]);
	}),
);

it.effect("rejects generated module loading and workers before bundling", () =>
	Effect.gen(function* () {
		for (const generatedModule of [
			"void Function('return import(\"npm:zod\")');",
			"void eval('require(\"node:fs\")');",
			'void new Worker("data:text/javascript,export default 1", { type: "module" });',
		]) {
			const failure = yield* compile(`${validSource}\n${generatedModule}`).pipe(Effect.flip);

			expect(failure.diagnostics).toEqual([
				expect.objectContaining({
					code: "RYOT_IMPORT",
					message: "Generated module loading and workers are not allowed",
				}),
			]);
		}
	}),
);

it.effect("rejects CommonJS require before bundling", () =>
	Effect.gen(function* () {
		const failure = yield* compile(
			`${validSource}\ndeclare const require: (path: string) => unknown;\nrequire("./package.json");`,
		).pipe(Effect.flip);

		expect(failure.diagnostics).toEqual([
			expect.objectContaining({
				code: "RYOT_IMPORT",
				message: "CommonJS require calls are not allowed",
			}),
		]);
	}),
);

it.effect("rejects a computed static manifest", () =>
	Effect.gen(function* () {
		const failure = yield* compile(
			validSource.replace('name: "Plain value"', 'name: ["Plain", "value"].join(" ")'),
		).pipe(Effect.flip);

		expect(failure.diagnostics).toEqual([
			expect.objectContaining({
				code: "RYOT_MANIFEST",
				message: "Manifest values must be JSON-safe literals",
			}),
		]);
	}),
);

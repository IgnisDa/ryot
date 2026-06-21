import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { SandboxCompiler } from "./compiler";

const validSource = `
import { defineDriver, defineManifest, defineScript, z } from "@ryot/sandbox-sdk";

export const manifest = defineManifest({
  kind: "script",
  name: "Plain value",
  slug: "plain-value",
  capabilities: [],
  requiredAppConfigKeys: [],
});

const main = defineDriver(manifest, {
  input: z.object({ value: z.number() }),
  output: z.number(),
  run: async (input) => input.value,
});

export default defineScript({ manifest, drivers: { main } });
`;

const compile = (source: string) =>
	Effect.gen(function* () {
		const compiler = yield* SandboxCompiler;
		return yield* compiler.compile(source);
	}).pipe(Effect.provide(SandboxCompiler.Default));

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
				.replace("defineScript, z }", "defineScript, type SandboxManifest, z }")
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
				.replace("defineScript, z }", "defineScript, type SandboxManifest, z }")
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
import { defineDriver, defineManifest, defineScript, z } from "@ryot/sandbox-sdk";

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
import { defineManifest, defineScript, z } from "@ryot/sandbox-sdk";

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
  z,
} from "@ryot/sandbox-sdk";

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

it.effect("rejects imports outside the SDK before resolution", () =>
	Effect.gen(function* () {
		const failure = yield* compile(`import "node:fs";\n${validSource}`).pipe(Effect.flip);

		expect(failure.diagnostics).toEqual([
			expect.objectContaining({
				line: 1,
				code: "RYOT_IMPORT",
				message: expect.stringContaining('Import "node:fs" is not allowed'),
			}),
		]);
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

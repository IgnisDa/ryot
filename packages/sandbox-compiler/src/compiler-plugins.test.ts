import { BunFileSystem } from "@effect/platform-bun";
import { expect, it } from "@effect/vitest";
import { sha256Hex } from "@ryot-app/ts-utils/crypto";
import { Effect } from "effect";

import { compilePluginSandboxEntries, compilePluginSandboxSourceEntries } from "./compiler-plugins";

const digest = sha256Hex;

it.effect(
	"compiles plugin scripts in deterministic order with package-local shared modules",
	() =>
		Effect.gen(function* () {
			const packageRoot = new URL("../test-fixtures/multi-file-plugin", import.meta.url).pathname;
			const scripts = [
				{ kind: "script", entry: "scripts/zeta.sandbox.ts" },
				{ kind: "script", entry: "scripts/alpha.sandbox.ts" },
			] as const;
			const first = yield* compilePluginSandboxEntries(packageRoot, scripts);
			const second = yield* compilePluginSandboxEntries(packageRoot, scripts.toReversed());

			expect(first.map(({ entry }) => entry)).toEqual([
				"scripts/alpha.sandbox.ts",
				"scripts/zeta.sandbox.ts",
			]);
			expect(first.map(({ compiled }) => digest(compiled.javascript))).toEqual(
				second.map(({ compiled }) => digest(compiled.javascript)),
			);
			for (const result of first) {
				expect(result.compiled.javascript).toContain("shared-value");
				expect(result.compiled.javascript).toContain('from "@ryot-app/sandbox-sdk/effect"');
				expect(result.compiled.javascript).not.toContain('from "../shared/value"');
				expect(Object.keys(result.compiled).sort()).toEqual(["format", "javascript", "manifest"]);
			}
			expect(first[0]?.compiled.manifest.requiredPluginConfigKeys).toEqual(["alpha-key"]);
			expect(first[0]?.compiled.manifest.requiredSystemConfigKeys).toEqual(["system-key"]);
		}).pipe(Effect.provide(BunFileSystem.layer)),
	10_000,
);

it.effect("compiles direct operation, workflow, and automation declarations", () =>
	Effect.gen(function* () {
		const operation = `
import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";
import { defineOperation } from "@ryot-app/sandbox-sdk/operation";

export const manifest = defineManifest({
	name: "Operation",
	slug: "operation",
	kind: "operation",
	capabilities: [],
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
});

export default defineOperation({
	manifest,
	input: Schema.Struct({}),
	output: Schema.String,
	run: () => Effect.die("unused"),
});
`;
		const automation = `
import { defineAutomation } from "@ryot-app/sandbox-sdk/automation";
import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { Effect } from "@ryot-app/sandbox-sdk/effect";

export const manifest = defineManifest({
	name: "Automation",
	slug: "automation",
	kind: "automation",
	capabilities: [],
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
});

export default defineAutomation({
	manifest,
	run: () => Effect.die("unused"),
});
`;
		const workflow = `
import { defineManifest, defineWorkflow, Effect, Schema } from "@ryot-app/sandbox-sdk/workflow";

export const manifest = defineManifest({
	name: "Workflow",
	slug: "workflow",
	kind: "workflow",
	capabilities: [],
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
});

export default defineWorkflow({
	manifest,
	input: Schema.Struct({}),
	output: Schema.String,
	run: () => Effect.succeed("unused"),
});
`;
		const compiled = yield* compilePluginSandboxSourceEntries(
			{
				"operation.sandbox.ts": operation,
				"automation.sandbox.ts": automation,
				"workflow.sandbox.ts": workflow,
			},
			[
				{ kind: "operation", entry: "operation.sandbox.ts" },
				{ kind: "automation", entry: "automation.sandbox.ts" },
				{ kind: "workflow", entry: "workflow.sandbox.ts" },
			],
		);

		expect(compiled.map(({ compiled: { manifest } }) => manifest.kind)).toEqual([
			"automation",
			"operation",
			"workflow",
		]);
		const workflowBundle = compiled.find(({ entry }) => entry === "workflow.sandbox.ts");
		expect(workflowBundle).toBeDefined();
		const javascript = workflowBundle?.compiled.javascript ?? "";
		const importedSchemaBindings = new Set(
			Array.from(
				javascript.matchAll(
					/import\s*\{([^}]*)\}\s*from\s*["'](?:@ryot-app\/sandbox-sdk\/effect|effect)["'];/g,
				),
			).flatMap(([, bindings = ""]) =>
				bindings.split(",").flatMap((binding) => {
					const [imported, local = imported] = binding.trim().split(/\s+as\s+/);
					return imported === "Schema" && local ? [local] : [];
				}),
			),
		);
		const usedSchemaBindings = Array.from(javascript.matchAll(/\b(Schema\d*)\s*\./g)).flatMap(
			([, binding]) => (binding ? [binding] : []),
		);
		expect(usedSchemaBindings.length).toBeGreaterThan(0);
		expect(usedSchemaBindings.every((binding) => importedSchemaBindings.has(binding))).toBe(true);
	}),
);

it.effect("rejects ambient nondeterminism in workflow-reachable source", () =>
	Effect.gen(function* () {
		const source = `
import { defineManifest, defineWorkflow, Effect, Schema } from "@ryot-app/sandbox-sdk/workflow";
import { nondeterministic } from "./shared";

export const manifest = defineManifest({
	name: "Workflow",
	slug: "workflow",
	kind: "workflow",
	capabilities: [],
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
});

export default defineWorkflow({
	manifest,
	input: Schema.Struct({}),
	output: Schema.Null,
	run: () => {
		void Date();
		void new Date();
		void Date.now();
		void Math.random();
		void crypto.randomUUID();
		void crypto.getRandomValues(new Uint8Array(1));
		void performance.now();
		nondeterministic();
		return Effect.succeed(null);
	},
});
`;
		const shared = `
export const nondeterministic = () => globalThis.Math.random();
`;
		const failure = yield* compilePluginSandboxSourceEntries(
			{ "workflow.sandbox.ts": source, "shared.ts": shared },
			[{ kind: "workflow", entry: "workflow.sandbox.ts" }],
		).pipe(Effect.flip);

		expect(failure.diagnostics).toHaveLength(8);
		expect(failure.diagnostics.every(({ code }) => code === "RYOT_WORKFLOW_DETERMINISM")).toBe(
			true,
		);
		expect(failure.diagnostics.map(({ message }) => message).join("\n")).toContain("Date.now");
		expect(failure.diagnostics.map(({ message }) => message).join("\n")).toContain("Math.random");
		expect(failure.diagnostics.map(({ message }) => message).join("\n")).toContain(
			"crypto.randomUUID",
		);
	}),
);

it.effect("accepts deterministic workflow date parsing and inert nondeterministic text", () =>
	Effect.gen(function* () {
		const source = `
import { defineManifest, defineWorkflow, Effect, Schema } from "@ryot-app/sandbox-sdk/workflow";

export const manifest = defineManifest({
	name: "Workflow",
	slug: "workflow",
	kind: "workflow",
	capabilities: [],
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
});

export default defineWorkflow({
	manifest,
	input: Schema.Struct({ timestamp: Schema.String }),
	output: Schema.Struct({ iso: Schema.String, parsed: Schema.Number, utc: Schema.Number }),
	run: (input) => {
		// Date.now() and Math.random() in comments are inert.
		const text = "crypto.randomUUID()";
		void text;
		return Effect.succeed({
			iso: new Date(input.timestamp).toISOString(),
			parsed: Date.parse(input.timestamp),
			utc: Date.UTC(2024, 0, 1),
		});
	},
});
`;
		const compiled = yield* compilePluginSandboxSourceEntries({ "workflow.sandbox.ts": source }, [
			{ kind: "workflow", entry: "workflow.sandbox.ts" },
		]);

		expect(compiled[0]?.compiled.manifest.kind).toBe("workflow");
	}),
);

it.effect("rejects unrestricted Effect imports in workflow-reachable source", () =>
	Effect.gen(function* () {
		const source = `
import { defineManifest, defineWorkflow, Effect, Schema } from "@ryot-app/sandbox-sdk/workflow";
import { nondeterministic } from "./shared";

export const manifest = defineManifest({
	name: "Workflow",
	slug: "workflow",
	kind: "workflow",
	capabilities: [],
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
});

export default defineWorkflow({
	manifest,
	input: Schema.Struct({}),
	output: Schema.String,
	run: () => Effect.succeed(nondeterministic),
});
`;
		const shared = `
import { Effect } from "@ryot-app/sandbox-sdk/effect";
export const nondeterministic = typeof Effect.clockWith;
`;
		const failure = yield* compilePluginSandboxSourceEntries(
			{ "workflow.sandbox.ts": source, "shared.ts": shared },
			[{ kind: "workflow", entry: "workflow.sandbox.ts" }],
		).pipe(Effect.flip);

		expect(failure.diagnostics).toEqual([
			expect.objectContaining({
				code: "RYOT_WORKFLOW_DETERMINISM",
				message: expect.stringContaining("@ryot-app/sandbox-sdk/workflow"),
			}),
		]);
	}),
);

// The rule matches the module specifier alone, never the imported bindings, so namespace and
// re-export forms cannot smuggle the unrestricted `Effect` into a workflow's graph. Narrowing it to
// inspect bindings would reopen exactly these two holes.
it.effect.each([
	{
		label: "namespace",
		shared: `
import * as Sdk from "@ryot-app/sandbox-sdk/effect";
export const nondeterministic = typeof Sdk.Effect.clockWith;
`,
	},
	{
		label: "re-export",
		shared: `
export * from "@ryot-app/sandbox-sdk/effect";
export const nondeterministic = "";
`,
	},
])("rejects $label access to unrestricted Effect in workflow-reachable source", ({ shared }) =>
	Effect.gen(function* () {
		const source = `
import { defineManifest, defineWorkflow, Effect, Schema } from "@ryot-app/sandbox-sdk/workflow";
import { nondeterministic } from "./shared";

export const manifest = defineManifest({
	name: "Workflow",
	slug: "workflow",
	kind: "workflow",
	capabilities: [],
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
});

export default defineWorkflow({
	manifest,
	input: Schema.Struct({}),
	output: Schema.String,
	run: () => Effect.succeed(nondeterministic),
});
`;
		const failure = yield* compilePluginSandboxSourceEntries(
			{ "workflow.sandbox.ts": source, "shared.ts": shared },
			[{ kind: "workflow", entry: "workflow.sandbox.ts" }],
		).pipe(Effect.flip);

		expect(failure.diagnostics).toEqual([
			expect.objectContaining({
				code: "RYOT_WORKFLOW_DETERMINISM",
				message: expect.stringContaining("@ryot-app/sandbox-sdk/workflow"),
			}),
		]);
	}),
);

it.effect("rejects workflow helpers that differ from the plugin declaration", () =>
	Effect.gen(function* () {
		const source = `
import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";
import { defineOperation } from "@ryot-app/sandbox-sdk/operation";

export const manifest = defineManifest({
	name: "Operation",
	slug: "operation",
	kind: "operation",
	capabilities: [],
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
});

export default defineOperation({
	manifest,
	input: Schema.Struct({}),
	output: Schema.String,
	run: () => Effect.die("unused"),
});
`;
		const failure = yield* compilePluginSandboxSourceEntries({ "entry.sandbox.ts": source }, [
			{ kind: "workflow", entry: "entry.sandbox.ts" },
		]).pipe(Effect.flip);

		expect(failure.diagnostics).toEqual([
			expect.objectContaining({
				code: "RYOT_DEFINITION",
				message: 'Plugin declaration kind "workflow" must use the matching definition helper',
			}),
		]);
	}),
);

it.effect("rejects a provider operation that differs from its plugin declaration", () =>
	Effect.gen(function* () {
		const source = `
import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { Effect } from "@ryot-app/sandbox-sdk/effect";
import { defineProvider } from "@ryot-app/sandbox-sdk/provider";

export const manifest = defineManifest({
	name: "Provider",
	slug: "provider",
	kind: "provider",
	capabilities: [],
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
});

export default defineProvider({
	manifest,
	operation: "details",
	run: () => Effect.die("unused"),
});
`;
		const failure = yield* compilePluginSandboxSourceEntries({ "provider.sandbox.ts": source }, [
			{ kind: "provider", providerOperation: "search", entry: "provider.sandbox.ts" },
		]).pipe(Effect.flip);

		expect(failure.diagnostics).toEqual([
			expect.objectContaining({
				code: "RYOT_DEFINITION",
				message:
					'Provider definition operation "details" does not match plugin declaration "search"',
			}),
		]);
	}),
);

it.effect("preserves provider search options metadata", () =>
	Effect.gen(function* () {
		const source = `
import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { Effect } from "@ryot-app/sandbox-sdk/effect";
import { defineProvider } from "@ryot-app/sandbox-sdk/provider";

export const manifest = defineManifest({
	kind: "provider",
	capabilities: [],
	name: "Provider Search",
	slug: "provider.search",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	searchOptionsSchema: {
		unknownKeys: "strict",
		fields: {
			passRawQuery: {
				type: "boolean",
				label: "Pass raw query",
				description: "Pass the query without modification",
			},
		},
	},
});

export default defineProvider({
	manifest,
	operation: "search",
	run: () => Effect.die("unused"),
});
`;
		const compiled = yield* compilePluginSandboxSourceEntries({ "provider.sandbox.ts": source }, [
			{ kind: "provider", providerOperation: "search", entry: "provider.sandbox.ts" },
		]);

		const compiledManifest = compiled[0]?.compiled.manifest;
		if (compiledManifest?.kind !== "provider") {
			throw new Error("Expected a compiled provider manifest");
		}
		expect(compiledManifest.searchOptionsSchema).toEqual({
			unknownKeys: "strict",
			fields: {
				passRawQuery: {
					type: "boolean",
					label: "Pass raw query",
					description: "Pass the query without modification",
				},
			},
		});
	}),
);

it.effect("rejects obsolete multi-driver definitions with a clear diagnostic", () =>
	Effect.gen(function* () {
		const source = `
import { defineDriver, defineManifest, defineOperation } from "@ryot-app/sandbox-sdk/driver";

export const manifest = defineManifest({
	capabilities: [],
	kind: "operation",
	name: "Old operation",
	slug: "old-operation",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
});

const main = defineDriver(manifest, {});
export default defineOperation({ manifest, drivers: { main } });
`;
		const failure = yield* compilePluginSandboxSourceEntries({ "old.sandbox.ts": source }, [
			{ kind: "operation", entry: "old.sandbox.ts" },
		]).pipe(Effect.flip);

		expect(failure.diagnostics).toEqual([
			expect.objectContaining({
				code: "RYOT_DEFINITION",
				message: "defineDriver is obsolete; export one direct definition helper call instead",
			}),
		]);
	}),
);

it.effect("rejects a manifest value that is an imported identifier", () =>
	Effect.gen(function* () {
		const shared = `
export const TYPE_CHOICES = [
	{ value: "bug", label: "Bug" },
	{ value: "dark", label: "Dark" },
] as const;
`;
		const source = `
import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { Effect } from "@ryot-app/sandbox-sdk/effect";
import { defineProvider } from "@ryot-app/sandbox-sdk/provider";

import { TYPE_CHOICES } from "./shared";

export const manifest = defineManifest({
	kind: "provider",
	capabilities: [],
	name: "Move search",
	slug: "move.search",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	searchOptionsSchema: {
		unknownKeys: "strict",
		fields: {
			typeNames: {
				label: "Types",
				type: "enum-array",
				description: "Only include moves that have every selected type",
				choices: { kind: "static", values: TYPE_CHOICES },
			},
		},
	},
});

export default defineProvider({
	manifest,
	operation: "search",
	run: () => Effect.die("unused"),
});
`;
		const failure = yield* compilePluginSandboxSourceEntries(
			{ "shared.ts": shared, "move-search.sandbox.ts": source },
			[{ kind: "provider", providerOperation: "search", entry: "move-search.sandbox.ts" }],
		).pipe(Effect.flip);

		expect(failure.diagnostics).toEqual([
			expect.objectContaining({
				code: "RYOT_MANIFEST",
				file: "move-search.sandbox.ts",
				message: "Manifest values must be JSON-safe literals",
			}),
		]);
	}),
);

const sharedRootScript = `
import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { Effect } from "@ryot-app/sandbox-sdk/effect";
import { defineOperation } from "@ryot-app/sandbox-sdk/operation";
import { Schema } from "@ryot-app/plugin-kit/effect";

import { rowSlug } from "../shared/row";

export const manifest = defineManifest({
	capabilities: [],
	name: "Operation",
	slug: "operation",
	kind: "operation",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
});

export default defineOperation({
	manifest,
	output: Schema.String,
	input: Schema.Struct({}),
	run: () => Effect.succeed(rowSlug),
});
`;

it.effect("compiles a backend entry that imports a shared source", () =>
	Effect.gen(function* () {
		const compiled = yield* compilePluginSandboxSourceEntries(
			{
				"backend/operation.sandbox.ts": sharedRootScript,
				"shared/row.ts": `
import { Schema } from "@ryot-app/plugin-kit/effect";
import { IsoDateString } from "@ryot-app/plugin-kit/ryotql";
import { EntitySchemaSlug } from "@ryot-app/plugin-kit/schema";

export const Row = Schema.Struct({ at: IsoDateString, slug: EntitySchemaSlug });
export const rowSlug = "shared-row";
`,
			},
			[{ kind: "operation", entry: "backend/operation.sandbox.ts" }],
		);

		const javascript = compiled[0]?.compiled.javascript ?? "";
		expect(javascript).toContain("shared-row");
		expect(javascript).toContain('from "@ryot-app/plugin-kit/ryotql"');
		expect(javascript).not.toContain('from "../shared/row"');
	}),
);

it.effect("rejects a shared source that imports the sandbox SDK", () =>
	Effect.gen(function* () {
		const failure = yield* compilePluginSandboxSourceEntries(
			{
				"backend/operation.sandbox.ts": sharedRootScript,
				"shared/row.ts": `
import { Effect } from "@ryot-app/sandbox-sdk/effect";

export const rowSlug = Effect.runSync(Effect.succeed("shared-row"));
`,
			},
			[{ kind: "operation", entry: "backend/operation.sandbox.ts" }],
		).pipe(Effect.flip);

		expect(failure.diagnostics).toHaveLength(1);
		expect(failure.diagnostics[0]?.code).toBe("RYOT_IMPORT");
		expect(failure.diagnostics[0]?.message).toContain("@ryot-app/sandbox-sdk/effect");
		expect(failure.diagnostics[0]?.message).toContain("plugin shared sources");
	}),
);

it.effect("rejects a shared source that imports a backend source", () =>
	Effect.gen(function* () {
		const failure = yield* compilePluginSandboxSourceEntries(
			{
				"backend/operation.sandbox.ts": sharedRootScript,
				"backend/label.ts": 'export const label = "backend-label";',
				"shared/row.ts": `
import { label } from "../backend/label";

export const rowSlug = label;
`,
			},
			[{ kind: "operation", entry: "backend/operation.sandbox.ts" }],
		).pipe(Effect.flip);

		expect(failure.diagnostics).toHaveLength(1);
		expect(failure.diagnostics[0]?.code).toBe("RYOT_IMPORT");
		expect(failure.diagnostics[0]?.message).toContain("../backend/label");
		expect(failure.diagnostics[0]?.message).toContain("plugin shared sources");
	}),
);

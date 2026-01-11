import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { compilePluginSandboxEntries, compilePluginSandboxSourceEntries } from "./compiler-plugins";

const digest = (value: string) => {
	const hasher = new Bun.CryptoHasher("sha256");
	hasher.update(value);
	return hasher.digest("hex");
};

it.effect(
	"compiles plugin scripts in deterministic order with package-local shared modules",
	() =>
		Effect.gen(function* () {
			const packageRoot = new URL("../test-fixtures/multi-file-plugin", import.meta.url).pathname;
			const scripts = [
				{
					kind: "script",
					entry: "scripts/zeta.sandbox.ts",
				},
				{
					kind: "script",
					entry: "scripts/alpha.sandbox.ts",
				},
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
				expect(result.compiled.javascript).toContain('from "@ryot/sandbox-sdk/effect"');
				expect(result.compiled.javascript).not.toContain('from "../shared/value"');
				expect(Object.keys(result.compiled).sort()).toEqual(["format", "javascript", "manifest"]);
			}
		}),
	10_000,
);

it.effect("compiles direct activity, operation, workflow, and automation declarations", () =>
	Effect.gen(function* () {
		const activity = `
import { defineActivity } from "@ryot/sandbox-sdk/activity";
import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot/sandbox-sdk/effect";

export const manifest = defineManifest({
	name: "Activity",
	slug: "activity",
	kind: "activity",
	capabilities: ["httpCall"],
	requiredAppConfigKeys: [],
});

export default defineActivity({
	manifest,
	input: Schema.Struct({}),
	output: Schema.String,
	run: () => Effect.die("unused"),
});
`;
		const operation = `
import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot/sandbox-sdk/effect";
import { defineOperation } from "@ryot/sandbox-sdk/operation";

export const manifest = defineManifest({
	name: "Operation",
	slug: "operation",
	kind: "operation",
	capabilities: [],
	requiredAppConfigKeys: [],
});

export default defineOperation({
	manifest,
	input: Schema.Struct({}),
	output: Schema.String,
	run: () => Effect.die("unused"),
});
`;
		const automation = `
import { defineAutomation } from "@ryot/sandbox-sdk/automation";
import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { Effect } from "@ryot/sandbox-sdk/effect";

export const manifest = defineManifest({
	name: "Automation",
	slug: "automation",
	kind: "automation",
	capabilities: [],
	requiredAppConfigKeys: [],
});

export default defineAutomation({
	manifest,
	run: () => Effect.die("unused"),
});
`;
		const workflow = `
import { defineManifest, defineWorkflow, Effect, Schema } from "@ryot/sandbox-sdk/workflow";

export const manifest = defineManifest({
	name: "Workflow",
	slug: "workflow",
	kind: "workflow",
	capabilities: [],
	requiredAppConfigKeys: [],
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
				"activity.sandbox.ts": activity,
				"operation.sandbox.ts": operation,
				"automation.sandbox.ts": automation,
				"workflow.sandbox.ts": workflow,
			},
			[
				{ kind: "activity", entry: "activity.sandbox.ts" },
				{ kind: "operation", entry: "operation.sandbox.ts" },
				{ kind: "automation", entry: "automation.sandbox.ts" },
				{ kind: "workflow", entry: "workflow.sandbox.ts" },
			],
		);

		expect(compiled.map(({ compiled: { manifest } }) => manifest.kind)).toEqual([
			"activity",
			"automation",
			"operation",
			"workflow",
		]);
		const workflowBundle = compiled.find(({ entry }) => entry === "workflow.sandbox.ts");
		expect(workflowBundle).toBeDefined();
		const javascript = workflowBundle?.compiled.javascript ?? "";
		const importedSchemaBindings = new Set(
			Array.from(
				javascript.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']@ryot\/sandbox-sdk\/effect["'];/g),
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
import { defineManifest, defineWorkflow, Effect, Schema } from "@ryot/sandbox-sdk/workflow";
import { nondeterministic } from "./shared";

export const manifest = defineManifest({
	name: "Workflow",
	slug: "workflow",
	kind: "workflow",
	capabilities: [],
	requiredAppConfigKeys: [],
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
import { defineManifest, defineWorkflow, Effect, Schema } from "@ryot/sandbox-sdk/workflow";

export const manifest = defineManifest({
	name: "Workflow",
	slug: "workflow",
	kind: "workflow",
	capabilities: [],
	requiredAppConfigKeys: [],
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
import { defineManifest, defineWorkflow, Effect, Schema } from "@ryot/sandbox-sdk/workflow";
import { nondeterministic } from "./shared";

export const manifest = defineManifest({
	name: "Workflow",
	slug: "workflow",
	kind: "workflow",
	capabilities: [],
	requiredAppConfigKeys: [],
});

export default defineWorkflow({
	manifest,
	input: Schema.Struct({}),
	output: Schema.String,
	run: () => Effect.succeed(nondeterministic),
});
`;
		const shared = `
import { Effect } from "@ryot/sandbox-sdk/effect";
export const nondeterministic = typeof Effect.clockWith;
`;
		const failure = yield* compilePluginSandboxSourceEntries(
			{ "workflow.sandbox.ts": source, "shared.ts": shared },
			[{ kind: "workflow", entry: "workflow.sandbox.ts" }],
		).pipe(Effect.flip);

		expect(failure.diagnostics).toEqual([
			expect.objectContaining({
				code: "RYOT_WORKFLOW_DETERMINISM",
				message: expect.stringContaining("@ryot/sandbox-sdk/workflow"),
			}),
		]);
	}),
);

it.effect("rejects workflow helpers that differ from the plugin declaration", () =>
	Effect.gen(function* () {
		const source = `
import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot/sandbox-sdk/effect";
import { defineOperation } from "@ryot/sandbox-sdk/operation";

export const manifest = defineManifest({
	name: "Operation",
	slug: "operation",
	kind: "operation",
	capabilities: [],
	requiredAppConfigKeys: [],
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
import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { Effect } from "@ryot/sandbox-sdk/effect";
import { defineProvider } from "@ryot/sandbox-sdk/provider";

export const manifest = defineManifest({
	name: "Provider",
	slug: "provider",
	kind: "provider",
	capabilities: [],
	requiredAppConfigKeys: [],
});

export default defineProvider({
	manifest,
	operation: "details",
	run: () => Effect.die("unused"),
});
`;
		const failure = yield* compilePluginSandboxSourceEntries({ "provider.sandbox.ts": source }, [
			{
				kind: "provider",
				providerOperation: "search",
				entry: "provider.sandbox.ts",
			},
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

it.effect("rejects obsolete multi-driver definitions with a clear diagnostic", () =>
	Effect.gen(function* () {
		const source = `
import { defineDriver, defineManifest, defineOperation } from "@ryot/sandbox-sdk/driver";

export const manifest = defineManifest({
	name: "Old operation",
	slug: "old-operation",
	kind: "operation",
	capabilities: [],
	requiredAppConfigKeys: [],
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

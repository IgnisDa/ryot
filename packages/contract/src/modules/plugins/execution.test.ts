import { expect, it } from "vitest";

import {
	hasValidExecutableDependencies,
	selectSourcePlan,
	sourcePlanConfigKeys,
} from "./execution";
import type { SandboxExecutionMetadata } from "./execution-metadata";

const script = (
	slug: string,
	requiredPluginConfigKeys: string[],
	executableDependencies: SandboxExecutionMetadata["executableDependencies"] = [],
) => ({
	slug,
	name: slug,
	capabilities: [],
	executableDependencies,
	kind: "script" as const,
	requiredPluginConfigKeys,
	oauthConnectionFields: [],
	optionalPluginConfigKeys: [],
	entry: `backend/${slug}.sandbox.ts`,
});

const manifest = {
	workflows: [{ slug: "import", scriptSlug: "root" }],
	scripts: [
		{
			...script(
				"root",
				["common"],
				[
					{
						slug: "api",
						kind: "script",
						selection: { key: "api", id: "collector", stage: "settings" },
					},
					{
						slug: "list",
						kind: "script",
						selection: { key: "list", id: "collector", stage: "settings" },
					},
					{
						slug: "file",
						kind: "script",
						selection: { key: "file", id: "collector", stage: "settings" },
					},
					{
						kind: "script",
						slug: "record",
						selection: { key: "record", id: "provider", stage: "record" },
					},
				],
			),
			kind: "workflow" as const,
			capabilities: [] as const,
		},
		script("api", ["token"]),
		script("list", ["token"]),
		{ ...script("file", []), optionalPluginConfigKeys: ["defaulted"] },
		script("record", ["recordToken"]),
	],
};

it("selects API and file plans without source effects or record prerequisites", () => {
	const source = {
		workflowSlug: "import",
		plan: { selections: { collector: { field: "mode", cases: { api: "api", export: "file" } } } },
	};
	expect(selectSourcePlan(source, { mode: "export" })).toEqual({
		operation: "import",
		selection: { collector: "file" },
	});
	expect(sourcePlanConfigKeys(manifest, source)).toEqual(["common"]);
	expect(sourcePlanConfigKeys(manifest, source, { mode: "api" })).toEqual(["common", "token"]);
	expect(sourcePlanConfigKeys(manifest, source, { mode: "export" })).toEqual(["common"]);
	expect(() => selectSourcePlan(source, { mode: "unsupported" })).toThrow(
		'Source plan selection "collector" has no case for "mode"',
	);
});

it("limits unconditional requirements to the source's declared alternatives", () => {
	const source = {
		workflowSlug: "import",
		plan: { selections: { collector: { field: "mode", cases: { user: "api", list: "list" } } } },
	};
	expect(sourcePlanConfigKeys(manifest, source)).toEqual(["common", "token"]);
});

it("validates integration plans against finite settings and linked executable choices", () => {
	const provider = {
		slug: "sync",
		name: "Sync",
		scriptSlug: "root",
		description: "Sync",
		lot: "sink" as const,
		plan: { selections: { collector: { field: "mode", cases: { api: "api", export: "file" } } } },
		settingsSchema: {
			fields: {
				mode: {
					label: "Mode",
					description: "Mode",
					type: "enum" as const,
					choices: { kind: "static" as const, values: [{ value: "api" }, { value: "export" }] },
				},
			},
		},
	};
	const executable = {
		...manifest,
		importSources: [],
		integrationProviders: [provider],
		scripts: manifest.scripts.map((entry) => Object.assign({}, entry, { kind: "script" as const })),
	};
	expect(hasValidExecutableDependencies(executable)).toBe(true);
	const booleanPlan = {
		selections: { collector: { field: "mode", cases: { true: "api", false: "file" } } },
	};
	expect(
		hasValidExecutableDependencies({
			...executable,
			integrationProviders: [
				{
					...provider,
					plan: booleanPlan,
					settingsSchema: {
						fields: { mode: { label: "Mode", type: "boolean", description: "Mode" } },
					},
				},
			],
		}),
	).toBe(true);
	expect(selectSourcePlan({ plan: booleanPlan, workflowSlug: "root" }, { mode: false })).toEqual({
		operation: "root",
		selection: { collector: "file" },
	});
	const { plan: _plan, ...unplanned } = provider;
	expect(hasValidExecutableDependencies({ ...executable, integrationProviders: [unplanned] })).toBe(
		false,
	);
	expect(
		hasValidExecutableDependencies({
			...executable,
			integrationProviders: [
				{
					...provider,
					plan: { selections: { collector: { field: "mode", cases: { api: "api" } } } },
				},
			],
		}),
	).toBe(false);
	expect(
		hasValidExecutableDependencies({
			...executable,
			integrationProviders: [
				{ ...provider, plan: { selections: { collector: { value: "missing" } } } },
			],
		}),
	).toBe(false);
	expect(
		hasValidExecutableDependencies({
			...executable,
			integrationProviders: [
				{
					...provider,
					settingsSchema: {
						fields: { mode: { label: "Mode", type: "string", description: "Mode" } },
					},
				},
			],
		}),
	).toBe(false);
});

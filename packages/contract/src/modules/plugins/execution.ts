import { Schema } from "effect";

import { strictStruct } from "../../schema/utils";
import type { IngestionPlan } from "../imports/ingestion";
import type {
	PluginImportSource,
	PluginIntegrationProvider,
	PluginScript,
	PluginWorkflow,
} from "./manifest";

type ExecutableManifest = {
	readonly scripts: ReadonlyArray<PluginScript>;
	readonly workflows: ReadonlyArray<PluginWorkflow>;
	readonly importSources: ReadonlyArray<PluginImportSource>;
	readonly integrationProviders: ReadonlyArray<PluginIntegrationProvider>;
};

const name = Schema.String.pipe(Schema.check(Schema.isMinLength(1)));

export const KERNEL_EVENT_CREATE_WORKFLOW = "kernel:event-create";
export const KERNEL_EVENT_STREAM_WORKFLOW = "kernel:event-stream-work";
export const KERNEL_PROCESS_IMPORT_CHUNKS_WORKFLOW = "kernel:process-import-chunks";
export const KERNEL_ENTITY_IMPORT_WORKFLOW = "kernel:entity-import";
export const KERNEL_PROVIDER_ENTITY_POPULATION_WORKFLOW = "kernel:provider-entity-population";

export const kernelWorkflowTargets = [
	KERNEL_EVENT_CREATE_WORKFLOW,
	KERNEL_EVENT_STREAM_WORKFLOW,
	KERNEL_PROCESS_IMPORT_CHUNKS_WORKFLOW,
	KERNEL_ENTITY_IMPORT_WORKFLOW,
	KERNEL_PROVIDER_ENTITY_POPULATION_WORKFLOW,
];

export const SourcePlanSelection = Schema.Union([
	strictStruct({ value: name }),
	strictStruct({ field: name, cases: Schema.Record(name, name) }),
]);

export const SourcePlan = strictStruct({ selections: Schema.Record(name, SourcePlanSelection) });

export type SourcePlan = Schema.Schema.Type<typeof SourcePlan>;

export const selectSourcePlan = (
	source: { readonly workflowSlug: string; readonly plan?: SourcePlan | undefined },
	settings: Readonly<Record<string, unknown>>,
): IngestionPlan => ({
	operation: source.workflowSlug,
	selection: Object.fromEntries(
		Object.entries(source.plan?.selections ?? {}).map(([id, selection]) => {
			if ("value" in selection) {
				return [id, selection.value];
			}
			const value = settings[selection.field];
			const selector =
				typeof value === "string" || typeof value === "boolean" ? String(value) : undefined;
			const key =
				selector !== undefined && Object.hasOwn(selection.cases, selector)
					? selection.cases[selector]
					: undefined;
			if (key === undefined) {
				throw new Error(`Source plan selection "${id}" has no case for "${selection.field}"`);
			}
			return [id, key];
		}),
	),
});

export const hasReachableExternalEffects = (
	manifest: Pick<ExecutableManifest, "scripts" | "workflows">,
	rootSlug: string,
): boolean | undefined => {
	const scripts = new Map(manifest.scripts.map((script) => [script.slug, script]));
	const workflows = new Map(
		manifest.workflows.map((workflow) => [workflow.slug, workflow.scriptSlug]),
	);
	const dependencyCount = manifest.scripts.reduce(
		(count, script) => count + script.executableDependencies.length,
		0,
	);
	const traversalLimit = manifest.scripts.length + dependencyCount;
	const pending = [rootSlug];
	const visited = new Set<string>();
	let traversalCount = 0;
	let hasExternalEffect = false;

	while (pending.length > 0) {
		const slug = pending.pop();
		if (slug === undefined || visited.has(slug)) {
			continue;
		}
		if (traversalCount >= traversalLimit) {
			return undefined;
		}
		traversalCount += 1;
		const script = scripts.get(slug);
		if (!script) {
			return undefined;
		}
		visited.add(slug);
		hasExternalEffect ||= script.capabilities.some(
			(capability) => capability === "httpCall" || capability === "sendNotification",
		);

		for (const dependency of script.executableDependencies) {
			if (traversalCount >= traversalLimit) {
				return undefined;
			}
			traversalCount += 1;
			if (dependency.kind === "script") {
				if (scripts.get(dependency.slug)?.kind !== "script") {
					return undefined;
				}
				pending.push(dependency.slug);
				continue;
			}
			if (kernelWorkflowTargets.includes(dependency.slug)) {
				// Kernel workflows own their durable retry guarantees.
				continue;
			}
			const workflowScriptSlug = workflows.get(dependency.slug);
			if (workflowScriptSlug === undefined) {
				return undefined;
			}
			if (scripts.get(workflowScriptSlug)?.kind !== "workflow") {
				return undefined;
			}
			pending.push(workflowScriptSlug);
		}
	}

	return hasExternalEffect;
};

export const sourcePlanConfigKeys = (
	manifest: Pick<ExecutableManifest, "scripts" | "workflows">,
	source: { readonly workflowSlug: string; readonly plan?: SourcePlan | undefined },
	settings?: Readonly<Record<string, unknown>>,
): string[] => {
	const selections =
		settings === undefined
			? Object.fromEntries(
					Object.entries(source.plan?.selections ?? {}).flatMap(([id, selection]) =>
						"value" in selection ? [[id, selection.value]] : [],
					),
				)
			: selectSourcePlan(source, settings).selection;
	const scripts = new Map(manifest.scripts.map((script) => [script.slug, script]));
	const workflows = new Map(
		manifest.workflows.map((workflow) => [workflow.slug, workflow.scriptSlug]),
	);
	const visit = (slug: string, path: ReadonlySet<string>): Set<string> => {
		if (path.has(slug)) {
			return new Set();
		}
		const script = scripts.get(slug);
		if (!script) {
			return new Set();
		}
		const keys = new Set(script.requiredPluginConfigKeys);
		const nextPath = new Set([...path, slug]);
		const alternatives = new Map<string, Map<string, Set<string>>>();
		for (const dependency of script.executableDependencies) {
			if (dependency.selection?.stage === "record") {
				continue;
			}
			if (dependency.selection) {
				const declaredSelection = source.plan?.selections[dependency.selection.id];
				if (
					declaredSelection &&
					"cases" in declaredSelection &&
					!Object.values(declaredSelection.cases).includes(dependency.selection.key)
				) {
					continue;
				}
			}
			const target =
				dependency.kind === "workflow" ? workflows.get(dependency.slug) : dependency.slug;
			const required = target ? visit(target, nextPath) : new Set<string>();
			if (!dependency.selection) {
				for (const key of required) {
					keys.add(key);
				}
				continue;
			}
			const selected = selections[dependency.selection.id];
			if (selected !== undefined) {
				if (selected === dependency.selection.key) {
					for (const key of required) {
						keys.add(key);
					}
				}
				continue;
			}
			const group = alternatives.get(dependency.selection.id) ?? new Map<string, Set<string>>();
			const branch = group.get(dependency.selection.key) ?? new Set<string>();
			for (const key of required) {
				branch.add(key);
			}
			group.set(dependency.selection.key, branch);
			alternatives.set(dependency.selection.id, group);
		}
		for (const group of alternatives.values()) {
			const branches = [...group.values()];
			for (const key of branches[0] ?? []) {
				if (branches.every((branch) => branch.has(key))) {
					keys.add(key);
				}
			}
		}
		return keys;
	};
	const root = workflows.get(source.workflowSlug);
	return root ? [...visit(root, new Set())].sort() : [];
};

export const hasValidExecutableDependencies = (manifest: ExecutableManifest): boolean => {
	const scripts = new Map(manifest.scripts.map((script) => [script.slug, script]));
	const workflows = new Map(
		manifest.workflows.map((workflow) => [workflow.slug, workflow.scriptSlug]),
	);
	for (const script of manifest.scripts) {
		for (const dependency of script.executableDependencies) {
			if (dependency.kind === "script") {
				const target = scripts.get(dependency.slug);
				if (target?.kind !== "script") {
					return false;
				}
			} else if (
				!workflows.has(dependency.slug) &&
				!kernelWorkflowTargets.includes(dependency.slug)
			) {
				return false;
			}
		}
	}
	const sources = [
		...manifest.importSources.map((source) => ({
			...source,
			settingsSchema: source.inputSchema,
			root: workflows.get(source.workflowSlug),
		})),
		...manifest.integrationProviders.flatMap((provider) =>
			provider.lot === "push" ? [] : [{ ...provider, root: provider.scriptSlug }],
		),
	];
	for (const source of sources) {
		const pending = [source.root];
		const visited = new Set<string>();
		const choices = new Map<string, Set<string>>();
		while (pending.length) {
			const slug = pending.pop();
			if (!slug || visited.has(slug)) {
				continue;
			}
			visited.add(slug);
			for (const dependency of scripts.get(slug)?.executableDependencies ?? []) {
				if (dependency.selection?.stage === "record") {
					continue;
				}
				if (dependency.selection) {
					const keys = choices.get(dependency.selection.id) ?? new Set<string>();
					keys.add(dependency.selection.key);
					choices.set(dependency.selection.id, keys);
				}
				pending.push(
					dependency.kind === "script" ? dependency.slug : workflows.get(dependency.slug),
				);
			}
		}
		for (const id of choices.keys()) {
			if (!Object.hasOwn(source.plan?.selections ?? {}, id)) {
				return false;
			}
		}
		for (const [id, selection] of Object.entries(source.plan?.selections ?? {})) {
			const keys = choices.get(id);
			const selected = "value" in selection ? [selection.value] : Object.values(selection.cases);
			if (!keys || selected.some((key) => !keys.has(key))) {
				return false;
			}
			if ("field" in selection) {
				const field = source.settingsSchema.fields[selection.field];
				let values: ReadonlyArray<string> | undefined;
				if (field?.type === "enum" && field.choices.kind === "static") {
					values = field.choices.values.map(({ value }) => value);
				}
				if (field?.type === "boolean") {
					values = ["true", "false"];
				}
				if (
					!values ||
					values.length === 0 ||
					Object.keys(selection.cases).length !== values.length ||
					values.some((value) => !Object.hasOwn(selection.cases, value))
				) {
					return false;
				}
			}
		}
	}
	return true;
};

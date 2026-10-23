import { Schema } from "effect";

import type { AppSchema } from "../../schema/property-schema";
import { isAppSchemaPathEffectivelyRequired } from "../../schema/property-schema";
import { IngestionBlockReason, IngestionPlan } from "../imports/ingestion";
import type { SourcePlan } from "./execution";
import { kernelWorkflowTargets, selectSourcePlan } from "./execution";
import { SandboxSourceExecutionMetadata } from "./execution-metadata";
import { PluginOAuthProvider } from "./manifest";

export const IngestionReadinessMetadata = Schema.Struct({
	availableConfigKeys: Schema.Array(Schema.String),
	workflows: Schema.Array(Schema.Struct({ slug: Schema.String, scriptSlug: Schema.String })),
	scripts: Schema.Array(
		Schema.Struct({ slug: Schema.String, ...SandboxSourceExecutionMetadata.fields }),
	),
	oauthProviders: Schema.Array(
		Schema.Struct({
			slug: PluginOAuthProvider.fields.slug,
			clientIdConfigKey: PluginOAuthProvider.fields.clientIdConfigKey,
			clientSecretConfigKey: PluginOAuthProvider.fields.clientSecretConfigKey,
		}),
	),
});
export type IngestionReadinessMetadata = typeof IngestionReadinessMetadata.Type;

export const IngestionReadiness = Schema.Struct({
	ready: Schema.Boolean,
	plan: Schema.NullOr(IngestionPlan),
	blockReasons: Schema.Array(IngestionBlockReason),
});
export type IngestionReadiness = typeof IngestionReadiness.Type;

export const evaluateIngestionReadiness = (input: {
	readonly metadata: IngestionReadinessMetadata;
	readonly operation: string;
	readonly kind: "script" | "workflow";
	readonly sourcePlan?: SourcePlan | undefined;
	readonly settingsSchema: AppSchema;
	readonly settings?: Readonly<Record<string, unknown>> | undefined;
	readonly connectedFields?: ReadonlyArray<string> | undefined;
	readonly acceptedPlan?: IngestionPlan | undefined;
}): IngestionReadiness => {
	const settings =
		input.settings === undefined
			? undefined
			: Object.fromEntries([
					...Object.entries(input.settingsSchema.fields).flatMap(([key, property]) =>
						property.defaultValue === undefined ? [] : [[key, property.defaultValue]],
					),
					...Object.entries(input.settings).filter(([, value]) => value !== undefined),
				]);
	const source = { plan: input.sourcePlan, workflowSlug: input.operation };
	const plan = settings === undefined ? null : selectSourcePlan(source, settings);
	if (
		input.acceptedPlan &&
		(!plan ||
			input.acceptedPlan.operation !== plan.operation ||
			Object.keys(input.acceptedPlan.selection).length !== Object.keys(plan.selection).length ||
			Object.entries(plan.selection).some(([id, key]) => input.acceptedPlan?.selection[id] !== key))
	) {
		throw new Error("Accepted ingestion plan does not match selected settings");
	}
	const selections =
		plan?.selection ??
		Object.fromEntries(
			Object.entries(input.sourcePlan?.selections ?? {}).flatMap(([id, selection]) =>
				"value" in selection ? [[id, selection.value]] : [],
			),
		);
	const scripts = new Map(input.metadata.scripts.map((script) => [script.slug, script]));
	const workflows = new Map(
		input.metadata.workflows.map((workflow) => [workflow.slug, workflow.scriptSlug]),
	);
	const visit = (
		kind: "script" | "workflow",
		operation: string,
		path: ReadonlySet<string>,
	): Set<string> => {
		if (kind === "workflow" && kernelWorkflowTargets.includes(operation)) {
			return new Set();
		}
		const slug = kind === "workflow" ? workflows.get(operation) : operation;
		const script = slug === undefined ? undefined : scripts.get(slug);
		if (!script) {
			throw new Error(`Ingestion operation is unavailable: ${operation}`);
		}
		if (path.has(script.slug)) {
			return new Set();
		}
		const facts = new Set([
			...script.requiredPluginConfigKeys.map((key) => `config:${key}`),
			...script.oauthConnectionFields.map((field) => `connection:${field}`),
		]);
		const alternatives = new Map<string, Map<string, Set<string>>>();
		const choices = new Map<string, Set<string>>();
		const nextPath = new Set([...path, script.slug]);
		for (const dependency of script.executableDependencies) {
			if (dependency.selection?.stage !== "settings") {
				continue;
			}
			const keys = choices.get(dependency.selection.id) ?? new Set<string>();
			keys.add(dependency.selection.key);
			choices.set(dependency.selection.id, keys);
		}
		for (const [id, keys] of choices) {
			const key = selections[id];
			if (key !== undefined && (typeof key !== "string" || !keys.has(key))) {
				throw new Error(`Ingestion plan has an unsupported selection: ${id}`);
			}
		}
		for (const dependency of script.executableDependencies) {
			const selection = dependency.selection;
			if (selection?.stage === "record") {
				continue;
			}
			const declared = selection && input.sourcePlan?.selections[selection.id];
			if (
				selection &&
				declared &&
				"cases" in declared &&
				!Object.values(declared.cases).includes(selection.key)
			) {
				continue;
			}
			if (
				selection &&
				selections[selection.id] !== undefined &&
				selections[selection.id] !== selection.key
			) {
				continue;
			}
			const branch = visit(dependency.kind, dependency.slug, nextPath);
			if (!selection || selections[selection.id] !== undefined) {
				for (const fact of branch) {
					facts.add(fact);
				}
			} else {
				if (plan) {
					throw new Error(`Ingestion plan is missing selection: ${selection.id}`);
				}
				const group = alternatives.get(selection.id) ?? new Map<string, Set<string>>();
				const combined = group.get(selection.key) ?? new Set<string>();
				for (const fact of branch) {
					combined.add(fact);
				}
				group.set(selection.key, combined);
				alternatives.set(selection.id, group);
			}
		}
		for (const group of alternatives.values()) {
			const branches = [...group.values()];
			for (const fact of branches[0] ?? []) {
				if (branches.every((branch) => branch.has(fact))) {
					facts.add(fact);
				}
			}
		}
		return facts;
	};
	const reasons = new Map<string, IngestionBlockReason>();
	const add = (reason: IngestionBlockReason) => reasons.set(`${reason.code}:${reason.key}`, reason);
	const available = new Set(input.metadata.availableConfigKeys);
	for (const fact of visit(input.kind, input.operation, new Set())) {
		if (fact.startsWith("config:")) {
			const key = fact.slice("config:".length);
			if (!available.has(key)) {
				add({ key, code: "configuration-required" });
			}
			continue;
		}
		const field = fact.slice("connection:".length);
		const property = input.settingsSchema.fields[field];
		if (property?.type !== "string" || property.format?.kind !== "oauth-connection") {
			throw new Error(`Ingestion OAuth field is not declared: ${field}`);
		}
		const needsConnection =
			settings === undefined
				? property.validation?.required === true
				: isAppSchemaPathEffectivelyRequired(input.settingsSchema, [field], settings) ||
					(settings[field] !== undefined && settings[field] !== null);
		if (!needsConnection) {
			continue;
		}
		const providerSlug = property.format.provider;
		const provider = input.metadata.oauthProviders.find(({ slug }) => slug === providerSlug);
		if (!provider) {
			throw new Error(`Ingestion OAuth provider is not declared: ${field}`);
		}
		for (const key of [provider.clientIdConfigKey, provider.clientSecretConfigKey]) {
			if (!available.has(key)) {
				add({ key, code: "oauth-client-required" });
			}
		}
		if (settings !== undefined && !input.connectedFields?.includes(field)) {
			add({ key: field, code: "connection-required" });
		}
	}
	const blockReasons = [...reasons.values()].sort(
		(left, right) => left.code.localeCompare(right.code) || left.key.localeCompare(right.key),
	);
	return { plan, blockReasons, ready: blockReasons.length === 0 };
};

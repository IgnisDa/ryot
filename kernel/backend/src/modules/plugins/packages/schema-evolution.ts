import type { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import type { AppPropertyDefinition, AppSchema } from "@ryot-app/contract/schema/property-schema";
import { isAppPropertyRequired } from "@ryot-app/contract/schema/property-schema";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { Data, Effect } from "effect";

export type SchemaEvolutionIssue = {
	readonly path: string;
	readonly code:
		| "enum_narrowed"
		| "schema_changed"
		| "schema_removed"
		| "property_changed"
		| "property_removed"
		| "property_type_changed"
		| "required_property_added";
};

type PropertySchemaDefinition = { readonly slug: string; readonly propertiesSchema: AppSchema };

export class SchemaEvolutionError extends Data.TaggedError("SchemaEvolutionError")<{
	readonly issues: ReadonlyArray<SchemaEvolutionIssue>;
}> {}

const structuralProperty = (property: AppPropertyDefinition) => {
	if (property.type === "enum" || property.type === "enum-array") {
		const { choices: _choices, ...rest } = property;
		return rest;
	}
	if (property.type === "object") {
		const { properties: _properties, ...rest } = property;
		return rest;
	}
	if (property.type === "array") {
		const { items: _items, ...rest } = property;
		return rest;
	}
	return property;
};

const comparableProperty = (property: AppPropertyDefinition) => {
	const { label: _label, description: _description, ...behavior } = structuralProperty(property);
	return behavior;
};

const compareProperty = (
	path: string,
	previous: AppPropertyDefinition,
	next: AppPropertyDefinition,
	issues: Array<SchemaEvolutionIssue>,
) => {
	if (previous.type !== next.type) {
		issues.push({ path, code: "property_type_changed" });
		return;
	}
	if (
		(previous.type === "enum" || previous.type === "enum-array") &&
		(next.type === "enum" || next.type === "enum-array")
	) {
		const previousChoices = previous.choices;
		const nextChoices = next.choices;
		if (
			(previousChoices.kind === "dynamic" &&
				(nextChoices.kind !== "dynamic" || previousChoices.source !== nextChoices.source)) ||
			(previousChoices.kind === "static" && nextChoices.kind === "dynamic") ||
			(previousChoices.kind === "static" &&
				nextChoices.kind === "static" &&
				previousChoices.values.some(
					(choice) => !nextChoices.values.some((nextChoice) => nextChoice.value === choice.value),
				))
		) {
			issues.push({ path, code: "enum_narrowed" });
		}
	}
	if (previous.type === "object" && next.type === "object") {
		compareFields(path, previous.properties, next.properties, issues);
	}
	if (previous.type === "array" && next.type === "array") {
		compareProperty(`${path}[]`, previous.items, next.items, issues);
	}
	if (stableStringify(comparableProperty(previous)) !== stableStringify(comparableProperty(next))) {
		issues.push({ path, code: "property_changed" });
	}
};

const compareFields = (
	path: string,
	previous: AppSchema["fields"],
	next: AppSchema["fields"],
	issues: Array<SchemaEvolutionIssue>,
) => {
	for (const [key, previousProperty] of Object.entries(previous)) {
		const propertyPath = `${path}.${key}`;
		const nextProperty = next[key];
		if (!nextProperty) {
			issues.push({ path: propertyPath, code: "property_removed" });
			continue;
		}
		compareProperty(propertyPath, previousProperty, nextProperty, issues);
	}
	for (const [key, nextProperty] of Object.entries(next)) {
		if (!previous[key] && isAppPropertyRequired(nextProperty)) {
			issues.push({ path: `${path}.${key}`, code: "required_property_added" });
		}
	}
};

const compareAppSchema = (
	path: string,
	previous: AppSchema,
	next: AppSchema,
	issues: Array<SchemaEvolutionIssue>,
) => {
	compareFields(path, previous.fields, next.fields, issues);
	if (
		stableStringify({ rules: previous.rules, unknownKeys: previous.unknownKeys }) !==
		stableStringify({ rules: next.rules, unknownKeys: next.unknownKeys })
	) {
		issues.push({ path, code: "schema_changed" });
	}
};

const compareDefinitions = (
	kind: string,
	previous: ReadonlyArray<PropertySchemaDefinition>,
	next: ReadonlyArray<PropertySchemaDefinition>,
	issues: Array<SchemaEvolutionIssue>,
) => {
	const nextBySlug = new Map(next.map((definition) => [definition.slug, definition]));
	for (const previousDefinition of previous) {
		const path = `${kind}:${previousDefinition.slug}`;
		const nextDefinition = nextBySlug.get(previousDefinition.slug);
		if (!nextDefinition) {
			issues.push({ path, code: "schema_removed" });
			continue;
		}
		compareAppSchema(
			path,
			previousDefinition.propertiesSchema,
			nextDefinition.propertiesSchema,
			issues,
		);
	}
};

export const validateAdditiveSchemaEvolution = (previous: PluginManifest, next: PluginManifest) =>
	Effect.gen(function* () {
		const issues: Array<SchemaEvolutionIssue> = [];
		if (previous.metadata.packageId !== next.metadata.packageId) {
			issues.push({ code: "schema_changed", path: "metadata.packageId" });
		}
		for (const entity of previous.entitySchemas) {
			const candidate = next.entitySchemas.find(({ slug }) => slug === entity.slug);
			if (
				candidate &&
				stableStringify(entity.mergeIdentityProperties ?? []) !==
					stableStringify(candidate.mergeIdentityProperties ?? [])
			) {
				issues.push({
					code: "schema_changed",
					path: `entity:${entity.slug}.mergeIdentityProperties`,
				});
			}
		}
		for (const relationship of previous.relationshipSchemas) {
			const candidate = next.relationshipSchemas.find(({ slug }) => slug === relationship.slug);
			if (
				candidate &&
				(relationship.sourceEntitySchemaSlug !== candidate.sourceEntitySchemaSlug ||
					relationship.targetEntitySchemaSlug !== candidate.targetEntitySchemaSlug)
			) {
				issues.push({
					code: "schema_changed",
					path: `relationship:${relationship.slug}.endpoints`,
				});
			}
		}
		for (const provider of previous.providers) {
			const candidate = next.providers.find(({ slug }) => slug === provider.slug);
			if (candidate && provider.rootEntitySchemaSlug !== candidate.rootEntitySchemaSlug) {
				issues.push({
					code: "schema_changed",
					path: `provider:${provider.slug}.rootEntitySchemaSlug`,
				});
			}
		}
		if (previous.userSettingsSchema) {
			if (!next.userSettingsSchema) {
				issues.push({ path: "userSettings", code: "schema_removed" });
			} else {
				compareAppSchema(
					"userSettings",
					previous.userSettingsSchema,
					next.userSettingsSchema,
					issues,
				);
			}
		}
		compareDefinitions("entity", previous.entitySchemas, next.entitySchemas, issues);
		for (const entity of previous.entitySchemas) {
			const candidate = next.entitySchemas.find(({ slug }) => slug === entity.slug);
			compareDefinitions(
				`event:${entity.slug}`,
				entity.eventSchemas,
				candidate?.eventSchemas ?? [],
				issues,
			);
		}
		compareDefinitions(
			"relationship",
			previous.relationshipSchemas,
			next.relationshipSchemas,
			issues,
		);
		compareDefinitions("signal", previous.signalSchemas, next.signalSchemas, issues);
		if (issues.length > 0) {
			return yield* new SchemaEvolutionError({ issues });
		}
		return yield* Effect.void;
	});

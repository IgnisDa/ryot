import type { AppPropertyDefinition, AppSchema } from "@ryot/contract/schema/property-schema";
import { isAppPropertyRequired } from "@ryot/contract/schema/property-schema";
import type { PluginManifest } from "@ryot/plugin-kit/manifest";
import { stableStringify } from "@ryot/ts-utils/json";
import { Data, Effect } from "effect";

export type SchemaEvolutionIssue = {
	readonly code:
		| "enum_narrowed"
		| "schema_changed"
		| "schema_removed"
		| "property_changed"
		| "property_removed"
		| "property_type_changed"
		| "required_property_added";
	readonly path: string;
};

export class SchemaEvolutionError extends Data.TaggedError("SchemaEvolutionError")<{
	readonly issues: ReadonlyArray<SchemaEvolutionIssue>;
}> {}

type PropertySchemaDefinition = {
	readonly slug: string;
	readonly propertiesSchema: AppSchema;
};

const comparableProperty = (property: AppPropertyDefinition) => {
	if (property.type === "enum" || property.type === "enum-array") {
		const { options: _options, ...rest } = property;
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

const compareProperty = (
	path: string,
	previous: AppPropertyDefinition,
	next: AppPropertyDefinition,
	issues: Array<SchemaEvolutionIssue>,
) => {
	if (previous.type !== next.type) {
		issues.push({ code: "property_type_changed", path });
		return;
	}
	if (
		(previous.type === "enum" || previous.type === "enum-array") &&
		(next.type === "enum" || next.type === "enum-array") &&
		previous.options.some((option) => !next.options.includes(option))
	) {
		issues.push({ code: "enum_narrowed", path });
	}
	if (previous.type === "object" && next.type === "object") {
		compareFields(path, previous.properties, next.properties, issues);
	}
	if (previous.type === "array" && next.type === "array") {
		compareProperty(`${path}[]`, previous.items, next.items, issues);
	}
	if (stableStringify(comparableProperty(previous)) !== stableStringify(comparableProperty(next))) {
		issues.push({ code: "property_changed", path });
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
			issues.push({ code: "property_removed", path: propertyPath });
			continue;
		}
		compareProperty(propertyPath, previousProperty, nextProperty, issues);
	}
	for (const [key, nextProperty] of Object.entries(next)) {
		if (!previous[key] && isAppPropertyRequired(nextProperty)) {
			issues.push({ code: "required_property_added", path: `${path}.${key}` });
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
		issues.push({ code: "schema_changed", path });
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
			issues.push({ code: "schema_removed", path });
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

const eventSchemas = (manifest: PluginManifest) =>
	manifest.entitySchemas.flatMap((entitySchema) =>
		entitySchema.eventSchemas.map((eventSchema) => ({
			...eventSchema,
			slug: `${entitySchema.slug}:${eventSchema.slug}`,
		})),
	);

export const validateAdditiveSchemaEvolution = (previous: PluginManifest, next: PluginManifest) =>
	Effect.gen(function* () {
		const issues: Array<SchemaEvolutionIssue> = [];
		compareDefinitions("entity", previous.entitySchemas, next.entitySchemas, issues);
		compareDefinitions("event", eventSchemas(previous), eventSchemas(next), issues);
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

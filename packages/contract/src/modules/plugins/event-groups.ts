import { Schema } from "effect";

import type { AppPropertyDefinition, AppSchema } from "../../schema/property-schema";
import { strictStruct } from "../../schema/utils";

const propertyNames = Schema.Array(Schema.NonEmptyString).check(
	Schema.makeFilter((values) => new Set(values).size === values.length),
);

export const PluginEventGroup = strictStruct({
	scope: Schema.Literal("session"),
	immutableProperties: propertyNames,
	keyProperties: propertyNames.check(Schema.isMinLength(1)),
	immutableFields: Schema.Tuple([Schema.Literal("sessionEntityId")]),
	dependents: Schema.NonEmptyArray(
		strictStruct({
			minimumCount: Schema.Literal(1),
			matchEntity: Schema.Literal(true),
			preserveMatch: Schema.Literal(true),
			eventSchemaSlug: Schema.NonEmptyString,
			matchProperties: propertyNames.check(Schema.isMinLength(1)),
		}),
	).check(
		Schema.makeFilter(
			(values) => new Set(values.map((value) => value.eventSchemaSlug)).size === values.length,
		),
	),
});

export type PluginEventGroup = typeof PluginEventGroup.Type;

const scalarKind = (property: undefined | AppPropertyDefinition): string | undefined => {
	if (
		!property ||
		property.type === "array" ||
		property.type === "object" ||
		property.type === "enum-array"
	) {
		return undefined;
	}
	if (property.type === "string") {
		return `string:${property.reference?.kind ?? "value"}`;
	}
	if (property.type === "enum") {
		return property.choices.kind === "static"
			? `enum:${JSON.stringify(property.choices.values.map(({ value }) => value).sort())}`
			: undefined;
	}
	return property.type;
};

export const pluginEventGroupIssue = (
	eventSchemas: ReadonlyArray<{
		readonly slug: string;
		readonly propertiesSchema: AppSchema;
		readonly eventGroup?: undefined | PluginEventGroup;
	}>,
): string | undefined => {
	const claimed = new Set<string>();
	for (const anchor of eventSchemas) {
		const group = anchor.eventGroup;
		if (!group) {
			continue;
		}
		for (const key of group.keyProperties) {
			if (scalarKind(anchor.propertiesSchema.fields[key]) === undefined) {
				return `Event group ${anchor.slug} key ${key} must be a declared scalar property`;
			}
		}
		for (const key of group.immutableProperties) {
			if (!Object.hasOwn(anchor.propertiesSchema.fields, key)) {
				return `Event group ${anchor.slug} immutable property ${key} is not declared`;
			}
		}
		for (const dependent of group.dependents) {
			const target = eventSchemas.find(({ slug }) => slug === dependent.eventSchemaSlug);
			if (!target || target.eventGroup || claimed.has(target.slug)) {
				return `Event group ${anchor.slug} dependent ${dependent.eventSchemaSlug} must name one unclaimed non-anchor schema in the same entity schema`;
			}
			claimed.add(target.slug);
			if (!group.keyProperties.every((key) => dependent.matchProperties.includes(key))) {
				return `Event group ${anchor.slug} dependent matches must include every key property`;
			}
			for (const key of dependent.matchProperties) {
				const sourceKind = scalarKind(anchor.propertiesSchema.fields[key]);
				if (
					sourceKind === undefined ||
					sourceKind !== scalarKind(target.propertiesSchema.fields[key])
				) {
					return `Event group ${anchor.slug} match ${key} must have compatible declared scalar types and references`;
				}
			}
		}
	}
	return undefined;
};

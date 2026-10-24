import type {
	AuthoredBrowseField,
	AuthoredEntitySchemaBrowse,
} from "@ryot-app/contract/modules/filters/browse";
import type { TableReference } from "@ryot-app/contract/modules/ryotql/language";
import { RelationshipSchemaSlug } from "@ryot-app/contract/schema/brands";
import {
	and,
	castText,
	column,
	countDistinct,
	eq,
	jsonPath,
	literal,
	maximum,
	table,
} from "@ryot-app/ryotql";
import { propertyFilterFields } from "@ryot-app/ryotql-recipes/property-filter-fields";
import { Result } from "effect";

import { exercisePropertiesSchema } from "./schemas/property";

const subject = table("entity", "subject");

const exerciseSets = (entity: TableReference) => {
	const workoutSet = table("event", "browseWorkoutSet");
	return {
		workoutSet,
		where: and(
			eq(column(workoutSet, "entityId"), column(entity, "id")),
			eq(column(workoutSet, "eventSchemaSlug"), literal("workout-set")),
			eq(column(workoutSet, "eventSchemaPluginId"), column(entity, "entitySchemaPluginId")),
		),
	};
};

export const timesPerformed = (entity: TableReference) => {
	const { where, workoutSet } = exerciseSets(entity);
	return countDistinct(workoutSet, column(workoutSet, "sessionEntityId"), { where });
};

const exerciseProperties = ["kind", "level", "force", "mechanic"] as const;

const exercisePropertyFields = (): readonly AuthoredBrowseField[] =>
	Result.getOrThrow(
		propertyFilterFields(
			exercisePropertiesSchema,
			exerciseProperties.map((property) => ({ property, field: property })),
		),
	).map((filterField) => {
		if (!("choices" in filterField)) {
			throw new Error(`Exercise property '${filterField.key}' must declare choices`);
		}
		return {
			kind: "value",
			key: filterField.key,
			type: filterField.type,
			label: filterField.label,
			choices: filterField.choices,
			expression: castText(jsonPath(column(subject, "properties"), filterField.key)),
		};
	});

const exerciseRelationshipField = (key: string, label: string, slug: string) =>
	({
		key,
		label,
		kind: "relationship",
		direction: "outgoing",
		relationship: { owner: { kind: "self" }, slug: RelationshipSchemaSlug.make(slug) },
	}) as const;

const exerciseBrowse = (): AuthoredEntitySchemaBrowse => {
	const { where, workoutSet } = exerciseSets(subject);
	return {
		fields: [
			...exercisePropertyFields(),
			exerciseRelationshipField("muscles", "Muscles", "exercise-targets"),
			exerciseRelationshipField("equipment", "Equipment", "exercise-uses-equipment"),
			{
				type: "date",
				kind: "value",
				key: "lastPerformed",
				label: "Last performed",
				expression: maximum(workoutSet, column(workoutSet, "occurredAt"), { where }),
				sort: { descending: "Recently performed", ascending: "Least recently performed" },
			},
			{
				kind: "value",
				type: "number",
				key: "timesPerformed",
				label: "Times performed",
				expression: timesPerformed(subject),
				sort: { ascending: "Least performed", descending: "Most performed" },
			},
		],
	};
};

const workoutTemplateBrowse = (): AuthoredEntitySchemaBrowse => ({
	fields: [
		{
			type: "date",
			kind: "value",
			key: "created",
			label: "Created",
			expression: column(subject, "createdAt"),
			sort: { ascending: "Oldest created", descending: "Newest created" },
		},
	],
});

export const fitnessBrowse = (slug: string) => {
	if (slug === "exercise") {
		return exerciseBrowse();
	}
	return slug === "workout-template" ? workoutTemplateBrowse() : undefined;
};

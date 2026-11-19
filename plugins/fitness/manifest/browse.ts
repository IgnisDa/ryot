import type {
	AuthoredBrowseField,
	AuthoredEntitySchemaBrowse,
} from "@ryot-app/contract/modules/filters/browse";
import type { ManifestText } from "@ryot-app/contract/modules/plugins/manifest-text";
import type { TableReference } from "@ryot-app/contract/modules/ryotql/authored";
import {
	EntitySchemaSlug,
	EventSchemaSlug,
	RelationshipSchemaSlug,
} from "@ryot-app/contract/schema/brands";
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
import { Array as Arr } from "effect";

import {
	exerciseForces,
	exerciseKinds,
	exerciseLevels,
	exerciseMechanics,
} from "../shared/exercise-kinds";
import {
	exerciseForceLabels,
	exerciseKindLabels,
	exerciseLevelLabels,
	exerciseMechanicLabels,
} from "../shared/exercise-labels";
import { catalogMessage } from "../shared/messages.generated";
import { startedAt, workoutTotals } from "../shared/workout-list-recipes";

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

const exercisePropertyField = <Value extends string>(
	key: string,
	label: ManifestText,
	values: Arr.NonEmptyReadonlyArray<Value>,
	labels: Readonly<Record<Value, ManifestText>>,
): AuthoredBrowseField => ({
	key,
	label,
	type: "enum",
	kind: "value",
	expression: castText(jsonPath(column(subject, "properties"), key)),
	choices: Arr.map(values, (value) => ({ value, label: labels[value] })),
});

const exercisePropertyFields = (): readonly AuthoredBrowseField[] => [
	exercisePropertyField("kind", catalogMessage("property.kind"), exerciseKinds, exerciseKindLabels),
	exercisePropertyField(
		"level",
		catalogMessage("property.level"),
		exerciseLevels,
		exerciseLevelLabels,
	),
	exercisePropertyField(
		"force",
		catalogMessage("property.force"),
		exerciseForces,
		exerciseForceLabels,
	),
	exercisePropertyField(
		"mechanic",
		catalogMessage("property.mechanic"),
		exerciseMechanics,
		exerciseMechanicLabels,
	),
];

const exerciseRelationshipField = (key: string, label: ManifestText, slug: string) =>
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
			exerciseRelationshipField(
				"muscles",
				catalogMessage("browse.field.muscles"),
				"exercise-targets",
			),
			exerciseRelationshipField(
				"equipment",
				catalogMessage("browse.field.equipment"),
				"exercise-uses-equipment",
			),
			{
				type: "date",
				kind: "value",
				key: "lastPerformed",
				label: catalogMessage("browse.field.last-performed"),
				expression: maximum(workoutSet, column(workoutSet, "occurredAt"), { where }),
				sort: {
					defaultDirection: "desc",
					label: catalogMessage("browse.field.last-performed"),
					ascending: catalogMessage("browse.sort.oldest-first"),
					descending: catalogMessage("browse.sort.newest-first"),
				},
			},
			{
				kind: "value",
				type: "number",
				key: "timesPerformed",
				expression: timesPerformed(subject),
				label: catalogMessage("browse.field.times-performed"),
				sort: {
					defaultDirection: "desc",
					descending: catalogMessage("browse.sort.most-first"),
					label: catalogMessage("browse.field.times-performed"),
					ascending: catalogMessage("browse.sort.fewest-first"),
				},
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
			expression: column(subject, "createdAt"),
			label: catalogMessage("browse.field.created"),
			sort: {
				defaultDirection: "desc",
				label: catalogMessage("browse.field.created"),
				ascending: catalogMessage("browse.sort.oldest-first"),
				descending: catalogMessage("browse.sort.newest-first"),
			},
		},
	],
});
const workoutBrowse = (): AuthoredEntitySchemaBrowse => {
	const totals = workoutTotals(subject, "browseWorkoutTotals");
	return {
		fields: [
			{
				type: "date",
				kind: "value",
				key: "startedAt",
				expression: startedAt(subject),
				label: catalogMessage("browse.field.started"),
			},
			{
				kind: "value",
				type: "number",
				key: "exerciseCount",
				expression: totals.exerciseCount,
				label: catalogMessage("browse.field.exercise-count"),
			},
			{
				kind: "value",
				type: "number",
				key: "setCount",
				expression: totals.setCount,
				label: catalogMessage("property.sets"),
			},
			{
				kind: "value",
				type: "number",
				key: "personalBests",
				expression: totals.personalBests,
				label: catalogMessage("property.personal-bests"),
			},
			{
				key: "template",
				kind: "relationship",
				direction: "outgoing",
				label: catalogMessage("browse.field.template"),
				relationship: {
					owner: { kind: "self" },
					slug: RelationshipSchemaSlug.make("workout-to-workout-template"),
				},
			},
			{
				key: "exercises",
				kind: "session-event",
				label: catalogMessage("property.exercises"),
				event: {
					owner: { kind: "self" },
					slug: EventSchemaSlug.make("workout-set"),
					entitySchemaSlug: EntitySchemaSlug.make("exercise"),
				},
			},
		],
	};
};
export const fitnessBrowse = (slug: string) => {
	if (slug === "workout") {
		return workoutBrowse();
	}
	if (slug === "exercise") {
		return exerciseBrowse();
	}
	return slug === "workout-template" ? workoutTemplateBrowse() : undefined;
};

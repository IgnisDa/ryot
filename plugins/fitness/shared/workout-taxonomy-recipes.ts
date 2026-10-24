import { Result, Schema } from "@ryot-app/plugin-kit/effect";
import {
	and,
	ascending,
	castText,
	coalesce,
	column,
	conditional,
	count,
	defineRecipe,
	entitySchemaPredicate,
	eq,
	inArray,
	jsonArrayExists,
	jsonArrayFirst,
	jsonElement,
	jsonPath,
	literal,
	type Recipe,
	schemaOwnerPredicate,
	selectedField,
	selectedInclude,
	selectedOptionalRow,
	selectedRows,
	table,
} from "@ryot-app/plugin-kit/ryotql";
import { EntityId, EventId, type PluginIdentityReference } from "@ryot-app/plugin-kit/schema";

import { property, propertyJson, propertyNumber } from "./entity-selections";
import { muscleSetWeight } from "./fitness-metrics";
import { exerciseTargetRoleSchema } from "./taxonomy";
import { WorkoutExercisePropertiesSchema } from "./workout-taxonomy";

type Table = ReturnType<typeof table>;
const targetIdentity = () => castText(jsonPath(jsonElement(), "entityId"));

export const occurrenceHasTaxonomy = (
	occurrence: Table,
	target: Table,
	kind: "targets" | "equipment",
) =>
	jsonArrayExists(
		propertyJson(occurrence, kind),
		eq(kind === "targets" ? targetIdentity() : castText(jsonElement()), column(target, "id")),
	);

export const recordedTargetRole = (occurrence: Table, target: Table) =>
	jsonArrayFirst(propertyJson(occurrence, "targets"), {
		orderBy: [ascending(targetIdentity())],
		where: eq(targetIdentity(), column(target, "id")),
		select: castText(jsonPath(jsonElement(), "role")),
	});

export const recordedMuscleSetWeight = (occurrence: Table, target: Table) =>
	coalesce(
		jsonArrayFirst(propertyJson(occurrence, "targets"), {
			orderBy: [ascending(targetIdentity())],
			where: eq(targetIdentity(), column(target, "id")),
			select: conditional(
				eq(castText(jsonPath(jsonElement(), "role")), literal("stabilizer")),
				literal(muscleSetWeight("stabilizer")),
				conditional(
					eq(castText(jsonPath(jsonElement(), "role")), literal("secondary")),
					literal(muscleSetWeight("secondary")),
					literal(muscleSetWeight("primary")),
				),
			),
		}),
		literal(muscleSetWeight("primary")),
	);

export const occurrenceSets = (set: Table, occurrence: Table) =>
	and(
		eq(column(set, "userId"), column(occurrence, "userId")),
		eq(column(set, "eventSchemaPluginId"), column(occurrence, "eventSchemaPluginId")),
		eq(column(set, "eventSchemaSlug"), literal("workout-set")),
		eq(column(set, "entityId"), column(occurrence, "entityId")),
		eq(column(set, "sessionEntityId"), column(occurrence, "sessionEntityId")),
		eq(propertyNumber(set, "exerciseOrder"), propertyNumber(occurrence, "exerciseOrder")),
		eq(property(set, "exerciseKind"), property(occurrence, "exerciseKind")),
	);

export const workoutEvidenceRevisionRecipe = defineRecipe((workoutId: string) => {
	const scope = table("eventScope", "workoutEvidenceScope");
	return {
		map: ({ scope: revision }) => Result.succeed(revision?.revision ?? 0),
		queries: {
			scope: selectedOptionalRow(scope, {
				orderBy: [ascending(column(scope, "id"))],
				selection: { revision: selectedField(column(scope, "revision"), Schema.Int) },
				where: and(
					schemaOwnerPredicate(scope, "eventSchemaPluginId", { kind: "self" }),
					eq(column(scope, "entityId"), literal(workoutId)),
				),
			}),
		},
	};
});

export const workoutOccurrencesRecipe = defineRecipe(
	(input: {
		readonly workoutId: string;
		readonly after?: string | undefined;
		readonly reference: PluginIdentityReference;
	}) => {
		const occurrence = table("event", "workoutOccurrence");
		return {
			map: ({ occurrences }) => Result.succeed(occurrences),
			queries: {
				occurrences: selectedRows(occurrence, {
					limit: 100,
					after: input.after,
					orderBy: [ascending(column(occurrence, "id"))],
					where: and(
						schemaOwnerPredicate(occurrence, "eventSchemaPluginId", input.reference),
						eq(column(occurrence, "eventSchemaSlug"), literal("workout-exercise")),
						eq(column(occurrence, "sessionEntityId"), literal(input.workoutId)),
					),
					selection: {
						id: selectedField(column(occurrence, "id"), EventId),
						entityId: selectedField(column(occurrence, "entityId"), EntityId),
						occurredAt: selectedField(column(occurrence, "occurredAt"), Schema.String),
						sessionEntityId: selectedField(column(occurrence, "sessionEntityId"), EntityId),
						properties: selectedField(
							column(occurrence, "properties"),
							WorkoutExercisePropertiesSchema,
						),
					},
				}),
			},
		};
	},
);

export const workoutTaxonomyRecipe = defineRecipe(
	(input: {
		readonly after?: string | undefined;
		readonly workoutIds: readonly string[];
		readonly reference: PluginIdentityReference;
	}) => {
		const occurrence = table("event", "recordedWorkoutOccurrence");
		const set = table("event", "recordedWorkoutSet");
		const target = table("entity", "recordedTarget");
		const equipment = table("entity", "recordedEquipment");
		return {
			map: ({ taxonomy }) => Result.succeed(taxonomy),
			queries: {
				taxonomy: selectedRows(occurrence, {
					limit: 100,
					after: input.after,
					orderBy: [ascending(column(occurrence, "id"))],
					where: and(
						schemaOwnerPredicate(occurrence, "eventSchemaPluginId", input.reference),
						eq(column(occurrence, "eventSchemaSlug"), literal("workout-exercise")),
						inArray(column(occurrence, "sessionEntityId"), input.workoutIds.map(literal)),
					),
					selection: {
						id: selectedField(column(occurrence, "id"), Schema.String),
						exerciseId: selectedField(column(occurrence, "entityId"), Schema.String),
						workoutId: selectedField(column(occurrence, "sessionEntityId"), Schema.String),
						exerciseOrder: selectedField(
							propertyNumber(occurrence, "exerciseOrder"),
							Schema.Finite,
						),
						setCount: selectedField(
							count(set, { where: occurrenceSets(set, occurrence) }),
							Schema.Finite,
						),
					},
					include: {
						equipment: selectedInclude(equipment, {
							limit: 100,
							orderBy: [ascending(column(equipment, "id"))],
							selection: {
								id: selectedField(column(equipment, "id"), Schema.String),
								name: selectedField(column(equipment, "name"), Schema.String),
							},
							where: and(
								entitySchemaPredicate(equipment, "exercise-equipment", input.reference),
								occurrenceHasTaxonomy(occurrence, equipment, "equipment"),
							),
						}),
						targets: selectedInclude(target, {
							limit: 100,
							orderBy: [ascending(column(target, "id"))],
							where: and(
								entitySchemaPredicate(target, "exercise-target", input.reference),
								occurrenceHasTaxonomy(occurrence, target, "targets"),
							),
							selection: {
								id: selectedField(column(target, "id"), Schema.String),
								name: selectedField(column(target, "name"), Schema.String),
								role: selectedField(
									recordedTargetRole(occurrence, target),
									Schema.NullOr(exerciseTargetRoleSchema),
								),
							},
						}),
					},
				}),
			},
		};
	},
);

export type WorkoutTaxonomy = Recipe.Success<typeof workoutTaxonomyRecipe>["items"][number];

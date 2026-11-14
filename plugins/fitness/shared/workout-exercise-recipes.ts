import { Result, Schema } from "@ryot-app/plugin-kit/effect";
import {
	and,
	ascending,
	column,
	contains,
	count,
	defineRecipe,
	descending,
	entitySchemaPredicate,
	eq,
	exists,
	first,
	inArray,
	isNotNull,
	join,
	JsonValue,
	literal,
	parameters,
	type Recipe,
	relationshipSchemaPredicate,
	schemaOwnerPredicate,
	selectedField,
	selectedRows,
	table,
} from "@ryot-app/plugin-kit/ryotql";
import { EntityId, type PluginIdentityReference } from "@ryot-app/plugin-kit/schema";

import { property, propertyJson } from "./entity-selections";
import {
	exerciseForces,
	exerciseForceSchema,
	exerciseKinds,
	exerciseKindSchema,
	exerciseLevels,
	exerciseLevelSchema,
	exerciseMechanics,
	exerciseMechanicSchema,
} from "./exercise-kinds";
import { fitnessLibraryLinkExists } from "./library-recipes";
import {
	effectiveTaxonomyLink,
	exerciseEquipmentInclude,
	exerciseTargetInclude,
} from "./taxonomy-recipes";
import { WorkoutEditorMediaSchema } from "./workout-set";

type Table = Parameters<typeof column>[0];
const rowLimit = 100;
export const membershipPropertiesSchema = Schema.Record(Schema.String, JsonValue);
export const WorkoutExercisePickerSortSchema = Schema.Literals([
	"name",
	"recently-added",
	"times-performed",
]);

export const WorkoutExercisePickerFiltersSchema = Schema.Struct({
	search: Schema.optional(Schema.String),
	exerciseIds: Schema.optional(Schema.Array(EntityId)),
	sort: Schema.optional(WorkoutExercisePickerSortSchema),
	targetIds: Schema.optional(Schema.Array(Schema.String)),
	kinds: Schema.optional(Schema.Array(exerciseKindSchema)),
	forces: Schema.optional(Schema.Array(exerciseForceSchema)),
	levels: Schema.optional(Schema.Array(exerciseLevelSchema)),
	equipmentIds: Schema.optional(Schema.Array(Schema.String)),
	collectionIds: Schema.optional(Schema.Array(Schema.String)),
	mechanics: Schema.optional(Schema.Array(exerciseMechanicSchema)),
});
const exerciseTaxonomyFilter = (
	exercise: Table,
	input: {
		readonly entitySlug: string;
		readonly entityAlias: string;
		readonly relationshipSlug: string;
		readonly relationshipAlias: string;
		readonly ids: Parameters<typeof inArray>[1];
	},
) => {
	const relationship = table("relationship", input.relationshipAlias);
	const entity = table("entity", input.entityAlias);
	return exists(relationship, {
		joins: [
			join("inner", entity, eq(column(relationship, "targetEntityId"), column(entity, "id"))),
		],
		where: and(
			eq(
				column(relationship, "relationshipSchemaPluginId"),
				column(exercise, "entitySchemaPluginId"),
			),
			eq(column(entity, "entitySchemaPluginId"), column(exercise, "entitySchemaPluginId")),
			effectiveTaxonomyLink(relationship),
			eq(column(relationship, "sourceEntityId"), column(exercise, "id")),
			eq(column(relationship, "relationshipSchemaSlug"), literal(input.relationshipSlug)),
			eq(column(entity, "entitySchemaSlug"), literal(input.entitySlug)),
			inArray(column(entity, "id"), input.ids),
		),
	});
};
const pickerArray = (label: string) => ({
	label,
	type: "array" as const,
	description: `Only include exercises selected by ${label}`,
	items: { label: "ID", type: "string" as const, description: "Selected entity ID" },
});
const pickerParameters = parameters({
	fields: {
		targetIds: pickerArray("Muscles"),
		exerciseIds: pickerArray("Exercises"),
		equipmentIds: pickerArray("Equipment"),
		collectionIds: pickerArray("Collections"),
		search: {
			type: "string",
			label: "Search",
			defaultValue: "",
			description: "Exercise name contains this text",
		},
		forces: {
			label: "Forces",
			type: "enum-array",
			description: "Exercise forces",
			choices: { kind: "static", values: exerciseForces.map((value) => ({ value })) },
		},
		kinds: {
			label: "Kinds",
			type: "enum-array",
			description: "Exercise measurement kinds",
			choices: { kind: "static", values: exerciseKinds.map((value) => ({ value })) },
		},
		levels: {
			label: "Levels",
			type: "enum-array",
			description: "Exercise experience levels",
			choices: { kind: "static", values: exerciseLevels.map((value) => ({ value })) },
		},
		mechanics: {
			type: "enum-array",
			label: "Mechanics",
			description: "Exercise mechanics",
			choices: { kind: "static", values: exerciseMechanics.map((value) => ({ value })) },
		},
		sort: {
			type: "enum",
			label: "Order",
			defaultValue: "times-performed",
			description: "Exercise picker ordering",
			choices: {
				kind: "static",
				values: [{ value: "name" }, { value: "recently-added" }, { value: "times-performed" }],
			},
		},
	},
});
const exercisePickerWhere = (reference: PluginIdentityReference, exercise: Table) => {
	const membership = table("relationship", "pickerCollectionMembership");
	return and(
		entitySchemaPredicate(exercise, "exercise", reference),
		fitnessLibraryLinkExists(exercise, "pickerLibrary"),
		contains(column(exercise, "name"), pickerParameters.value("search")),
		pickerParameters.whenSet(
			"exerciseIds",
			inArray(column(exercise, "id"), pickerParameters.list("exerciseIds")),
		),
		pickerParameters.whenSet(
			"kinds",
			inArray(property(exercise, "kind"), pickerParameters.list("kinds")),
		),
		pickerParameters.whenSet(
			"forces",
			inArray(property(exercise, "force"), pickerParameters.list("forces")),
		),
		pickerParameters.whenSet(
			"levels",
			inArray(property(exercise, "level"), pickerParameters.list("levels")),
		),
		pickerParameters.whenSet(
			"mechanics",
			inArray(property(exercise, "mechanic"), pickerParameters.list("mechanics")),
		),
		pickerParameters.whenSet(
			"targetIds",
			exerciseTaxonomyFilter(exercise, {
				entityAlias: "pickerTarget",
				entitySlug: "exercise-target",
				relationshipSlug: "exercise-targets",
				ids: pickerParameters.list("targetIds"),
				relationshipAlias: "pickerTargetRelationship",
			}),
		),
		pickerParameters.whenSet(
			"equipmentIds",
			exerciseTaxonomyFilter(exercise, {
				entityAlias: "pickerEquipment",
				entitySlug: "exercise-equipment",
				ids: pickerParameters.list("equipmentIds"),
				relationshipSlug: "exercise-uses-equipment",
				relationshipAlias: "pickerEquipmentRelationship",
			}),
		),
		pickerParameters.whenSet(
			"collectionIds",
			exists(membership, {
				where: and(
					relationshipSchemaPredicate(membership, "member-of", { kind: "kernel" }),
					eq(column(membership, "sourceEntityId"), column(exercise, "id")),
					inArray(column(membership, "targetEntityId"), pickerParameters.list("collectionIds")),
				),
			}),
		),
	);
};

export const membershipField = (
	exercise: Table,
	reference: PluginIdentityReference,
	field: "createdAt" | "properties",
) => {
	const relationship = table("relationship", "pickerMembershipRelationship");
	const library = table("entity", "pickerMembershipLibrary");
	return first(relationship, {
		select: column(relationship, field),
		orderBy: [ascending(column(relationship, "id"))],
		joins: [
			join("inner", library, eq(column(relationship, "targetEntityId"), column(library, "id"))),
		],
		where: and(
			isNotNull(column(relationship, "userId")),
			relationshipSchemaPredicate(relationship, "in-fitness-library", reference),
			eq(column(relationship, "sourceEntityId"), column(exercise, "id")),
			entitySchemaPredicate(library, "fitness-library", reference),
		),
	});
};

const workoutSetCount = (exercise: Table, reference: PluginIdentityReference) => {
	const workoutSet = table("event", "pickerWorkoutSetCount");
	return count(workoutSet, {
		where: and(
			schemaOwnerPredicate(workoutSet, "eventSchemaPluginId", reference),
			eq(column(workoutSet, "entityId"), column(exercise, "id")),
			eq(column(workoutSet, "eventSchemaSlug"), literal("workout-set")),
		),
	});
};
export const workoutExercisePickerRecipe = (input: {
	readonly reference: PluginIdentityReference;
}) => {
	const exercise = table("entity", "pickerExercise");
	const orderBy = pickerParameters.choice("sort", {
		name: [ascending(column(exercise, "name")), ascending(column(exercise, "id"))],
		"times-performed": [
			descending(workoutSetCount(exercise, input.reference)),
			ascending(column(exercise, "id")),
		],
		"recently-added": [
			descending(membershipField(exercise, input.reference, "createdAt")),
			ascending(column(exercise, "id")),
		],
	});
	return defineRecipe({
		parameters: pickerParameters.schema,
		map: ({ exercises }) => Result.succeed(exercises),
		queries: {
			exercises: selectedRows(exercise, {
				orderBy,
				limit: rowLimit,
				where: exercisePickerWhere(input.reference, exercise),
				include: {
					targets: exerciseTargetInclude(exercise),
					equipment: exerciseEquipmentInclude(exercise),
				},
				selection: {
					id: selectedField(column(exercise, "id"), EntityId),
					name: selectedField(column(exercise, "name"), Schema.String),
					kind: selectedField(property(exercise, "kind"), Schema.NullOr(exerciseKindSchema)),
					images: selectedField(
						propertyJson(exercise, "images"),
						Schema.NullOr(WorkoutEditorMediaSchema),
					),
					videos: selectedField(
						propertyJson(exercise, "videos"),
						Schema.NullOr(WorkoutEditorMediaSchema),
					),
					instructions: selectedField(
						propertyJson(exercise, "instructions"),
						Schema.NullOr(Schema.Array(Schema.String)),
					),
					membershipProperties: selectedField(
						membershipField(exercise, input.reference, "properties"),
						Schema.NullOr(membershipPropertiesSchema),
					),
				},
			}),
		},
	});
};
export const workoutExerciseCollectionOptionsRecipe = (() => {
	const collection = table("entity", "pickerCollectionOption");
	return defineRecipe({
		map: ({ collections }) => Result.succeed(collections),
		queries: {
			collections: selectedRows(collection, {
				limit: rowLimit,
				where: entitySchemaPredicate(collection, "collection", { kind: "kernel" }),
				orderBy: [ascending(column(collection, "name")), ascending(column(collection, "id"))],
				selection: {
					id: selectedField(column(collection, "id"), EntityId),
					name: selectedField(column(collection, "name"), Schema.String),
				},
			}),
		},
	});
})();
export type WorkoutExercisePickerResult = Recipe.Success<
	ReturnType<typeof workoutExercisePickerRecipe>
>;

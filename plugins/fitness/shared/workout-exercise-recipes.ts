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
	exerciseForceSchema,
	exerciseKindSchema,
	exerciseLevelSchema,
	exerciseMechanicSchema,
} from "./exercise-kinds";
import { fitnessLibraryLinkExists } from "./library-recipes";
import {
	effectiveTaxonomyLink,
	exerciseEquipmentInclude,
	exerciseTargetInclude,
} from "./taxonomy-recipes";
import { WorkoutEditorMediaSchema } from "./workout-set";

type Table = ReturnType<typeof table>;

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

type WorkoutExercisePickerInput = typeof WorkoutExercisePickerFiltersSchema.Type & {
	readonly after?: string | undefined;
	readonly reference: PluginIdentityReference;
};

const exerciseTaxonomyFilter = (
	exercise: Table,
	input: {
		readonly entityAlias: string;
		readonly entitySlug: string;
		readonly ids: readonly string[];
		readonly relationshipAlias: string;
		readonly relationshipSlug: string;
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
			inArray(column(entity, "id"), input.ids.map(literal)),
		),
	});
};

const exercisePickerWhere = (input: WorkoutExercisePickerInput, exercise: Table) => {
	const search = input.search?.trim();
	const predicates = [
		entitySchemaPredicate(exercise, "exercise", input.reference),
		fitnessLibraryLinkExists(exercise, "pickerLibrary"),
		...(search ? [contains(column(exercise, "name"), literal(search))] : []),
		...(input.exerciseIds?.length
			? [inArray(column(exercise, "id"), input.exerciseIds.map(literal))]
			: []),
		...(input.kinds?.length ? [inArray(property(exercise, "kind"), input.kinds.map(literal))] : []),
		...(input.forces?.length
			? [inArray(property(exercise, "force"), input.forces.map(literal))]
			: []),
		...(input.levels?.length
			? [inArray(property(exercise, "level"), input.levels.map(literal))]
			: []),
		...(input.mechanics?.length
			? [inArray(property(exercise, "mechanic"), input.mechanics.map(literal))]
			: []),
	];
	if (input.targetIds?.length) {
		predicates.push(
			exerciseTaxonomyFilter(exercise, {
				ids: input.targetIds,
				entityAlias: "pickerTarget",
				entitySlug: "exercise-target",
				relationshipSlug: "exercise-targets",
				relationshipAlias: "pickerTargetRelationship",
			}),
		);
	}
	if (input.equipmentIds?.length) {
		predicates.push(
			exerciseTaxonomyFilter(exercise, {
				ids: input.equipmentIds,
				entityAlias: "pickerEquipment",
				entitySlug: "exercise-equipment",
				relationshipSlug: "exercise-uses-equipment",
				relationshipAlias: "pickerEquipmentRelationship",
			}),
		);
	}
	if (input.collectionIds?.length) {
		const relationship = table("relationship", "pickerCollectionRelationship");
		const collection = table("entity", "pickerCollection");
		predicates.push(
			exists(collection, {
				joins: [
					join(
						"inner",
						relationship,
						eq(column(relationship, "targetEntityId"), column(collection, "id")),
					),
				],
				where: and(
					inArray(column(collection, "id"), input.collectionIds.map(literal)),
					entitySchemaPredicate(collection, "collection", { kind: "kernel" }),
					eq(column(relationship, "sourceEntityId"), column(exercise, "id")),
					relationshipSchemaPredicate(relationship, "member-of", { kind: "kernel" }),
				),
			}),
		);
	}
	return and(...predicates);
};

export const membershipField = (
	exercise: Table,
	reference: PluginIdentityReference,
	field: "properties" | "createdAt",
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

export const workoutExercisePickerRecipe = defineRecipe((input: WorkoutExercisePickerInput) => {
	const exercise = table("entity", "pickerExercise");
	const sort = input.sort ?? "times-performed";
	const orderBy = () => {
		if (sort === "recently-added") {
			return [
				descending(membershipField(exercise, input.reference, "createdAt")),
				ascending(column(exercise, "id")),
			];
		}
		if (sort === "name") {
			return [ascending(column(exercise, "name")), ascending(column(exercise, "id"))];
		}
		return [
			descending(workoutSetCount(exercise, input.reference)),
			ascending(column(exercise, "id")),
		];
	};
	return {
		map: ({ exercises }) => Result.succeed(exercises),
		queries: {
			exercises: selectedRows(exercise, {
				limit: rowLimit,
				after: input.after,
				orderBy: orderBy(),
				where: exercisePickerWhere(input, exercise),
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
	};
});

export const workoutExerciseCollectionOptionsRecipe = defineRecipe(
	(input: { readonly after?: string | undefined } = {}) => {
		const collection = table("entity", "pickerCollectionOption");
		return {
			map: ({ collections }) => Result.succeed(collections),
			queries: {
				collections: selectedRows(collection, {
					limit: rowLimit,
					after: input.after,
					where: entitySchemaPredicate(collection, "collection", { kind: "kernel" }),
					orderBy: [ascending(column(collection, "name")), ascending(column(collection, "id"))],
					selection: {
						id: selectedField(column(collection, "id"), EntityId),
						name: selectedField(column(collection, "name"), Schema.String),
					},
				}),
			},
		};
	},
);

export type WorkoutExercisePickerResult = Recipe.Success<typeof workoutExercisePickerRecipe>;

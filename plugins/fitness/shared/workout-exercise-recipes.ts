import { Result, Schema } from "@ryot-app/plugin-kit/effect";
import {
	and,
	ascending,
	column,
	contains,
	defineRecipe,
	descending,
	eq,
	exists,
	first,
	JsonValue,
	join,
	isNotNull,
	literal,
	relationshipSchemaPredicate,
	selectedField,
	selectedRows,
	table,
	type Recipe,
	entitySchemaPredicate,
} from "@ryot-app/plugin-kit/ryotql";
import {
	EntityId,
	LocalAssetLocator,
	RemoteAssetLocator,
	S3AssetLocator,
	type PluginIdentityReference,
} from "@ryot-app/plugin-kit/schema";

import { property, propertyJson } from "./entity-selections";
import { exerciseKindSchema, type ExerciseKind } from "./exercise-kinds";
import { fitnessLibraryLinkExists } from "./library-recipes";

type Table = ReturnType<typeof table>;

const rowLimit = 100;
const membershipPropertiesSchema = Schema.Record(Schema.String, JsonValue);
const assetLocators = Schema.Array(
	Schema.Union([LocalAssetLocator, RemoteAssetLocator, S3AssetLocator]),
);

const exercisePickerWhere = (
	input: {
		readonly collectionId?: string | undefined;
		readonly equipmentId?: string | undefined;
		readonly kind?: ExerciseKind | undefined;
		readonly reference: PluginIdentityReference;
		readonly search?: string | undefined;
		readonly targetId?: string | undefined;
	},
	exercise: Table,
) => {
	const search = input.search?.trim();
	const predicates = [
		entitySchemaPredicate(exercise, "exercise", input.reference),
		fitnessLibraryLinkExists(exercise, "pickerLibrary"),
		...(search ? [contains(column(exercise, "name"), literal(search))] : []),
		...(input.kind === undefined ? [] : [eq(property(exercise, "kind"), literal(input.kind))]),
	];
	if (input.targetId !== undefined) {
		const relationship = table("relationship", "pickerTargetRelationship");
		const target = table("entity", "pickerTarget");
		predicates.push(
			exists(relationship, {
				joins: [
					join("inner", target, eq(column(relationship, "targetEntityId"), column(target, "id"))),
				],
				where: and(
					eq(
						column(relationship, "relationshipSchemaPluginId"),
						column(exercise, "entitySchemaPluginId"),
					),
					eq(column(target, "entitySchemaPluginId"), column(exercise, "entitySchemaPluginId")),
					eq(column(relationship, "sourceEntityId"), column(exercise, "id")),
					eq(column(relationship, "relationshipSchemaSlug"), literal("exercise-targets")),
					eq(column(target, "entitySchemaSlug"), literal("exercise-target")),
					eq(column(target, "id"), literal(input.targetId)),
				),
			}),
		);
	}
	if (input.equipmentId !== undefined) {
		const relationship = table("relationship", "pickerEquipmentRelationship");
		const equipment = table("entity", "pickerEquipment");
		predicates.push(
			exists(relationship, {
				joins: [
					join(
						"inner",
						equipment,
						eq(column(relationship, "targetEntityId"), column(equipment, "id")),
					),
				],
				where: and(
					eq(
						column(relationship, "relationshipSchemaPluginId"),
						column(exercise, "entitySchemaPluginId"),
					),
					eq(column(equipment, "entitySchemaPluginId"), column(exercise, "entitySchemaPluginId")),
					eq(column(relationship, "sourceEntityId"), column(exercise, "id")),
					eq(column(relationship, "relationshipSchemaSlug"), literal("exercise-uses-equipment")),
					eq(column(equipment, "entitySchemaSlug"), literal("exercise-equipment")),
					eq(column(equipment, "id"), literal(input.equipmentId)),
				),
			}),
		);
	}
	if (input.collectionId !== undefined) {
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
					eq(column(collection, "id"), literal(input.collectionId)),
					entitySchemaPredicate(collection, "collection", { kind: "kernel" }),
					eq(column(relationship, "sourceEntityId"), column(exercise, "id")),
					relationshipSchemaPredicate(relationship, "member-of", { kind: "kernel" }),
				),
			}),
		);
	}
	return and(...predicates);
};

const membershipField = (
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

export const workoutExercisePickerRecipe = defineRecipe(
	(input: {
		readonly after?: string | undefined;
		readonly collectionId?: string | undefined;
		readonly equipmentId?: string | undefined;
		readonly kind?: ExerciseKind | undefined;
		readonly reference: PluginIdentityReference;
		readonly search?: string | undefined;
		readonly targetId?: string | undefined;
		readonly sort?: "name" | "recently-added" | undefined;
	}) => {
		const exercise = table("entity", "pickerExercise");
		return {
			map: ({ exercises }) => Result.succeed(exercises),
			queries: {
				exercises: selectedRows(exercise, {
					limit: rowLimit,
					after: input.after,
					where: exercisePickerWhere(input, exercise),
					orderBy:
						input.sort === "recently-added"
							? [
									descending(membershipField(exercise, input.reference, "createdAt")),
									ascending(column(exercise, "id")),
								]
							: [ascending(column(exercise, "name")), ascending(column(exercise, "id"))],
					selection: {
						id: selectedField(column(exercise, "id"), EntityId),
						name: selectedField(column(exercise, "name"), Schema.String),
						kind: selectedField(property(exercise, "kind"), Schema.NullOr(exerciseKindSchema)),
						images: selectedField(propertyJson(exercise, "images"), Schema.NullOr(assetLocators)),
						videos: selectedField(propertyJson(exercise, "videos"), Schema.NullOr(assetLocators)),
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
	},
);

export type WorkoutExercisePickerResult = Recipe.Success<typeof workoutExercisePickerRecipe>;

import { Result, Schema } from "@ryot-app/plugin-kit/effect";
import {
	and,
	ascending,
	column,
	defineRecipe,
	eq,
	exists,
	isNull,
	join,
	literal,
	not,
	or,
	selectedField,
	selectedRows,
	table,
} from "@ryot-app/plugin-kit/ryotql";
import { EntityId } from "@ryot-app/plugin-kit/schema";

import { property } from "./entity-selections";
import { exerciseTargetKindSchema, exerciseTargetRoleSchema } from "./taxonomy";

type Table = ReturnType<typeof table>;
type TaxonomyListInput = Pick<Parameters<typeof selectedRows>[1], "after" | "limit"> & {
	readonly name?: string | undefined;
};
type ExerciseTaxonomyInput = Pick<Parameters<typeof selectedRows>[1], "after" | "limit"> & {
	readonly exerciseId: string;
};

const taxonomyWhere = (entity: Table, schemaSlug: string, input: TaxonomyListInput) =>
	and(
		eq(column(entity, "entitySchemaSlug"), literal(schemaSlug)),
		...(input.name ? [eq(column(entity, "name"), literal(input.name))] : []),
	);

const effectiveLink = (relationship: Table) => {
	const shared = table("relationship", "sharedTaxonomyRelationship");
	return or(
		isNull(column(relationship, "userId")),
		not(
			exists(shared, {
				where: and(
					isNull(column(shared, "userId")),
					eq(column(shared, "sourceEntityId"), column(relationship, "sourceEntityId")),
					eq(column(shared, "targetEntityId"), column(relationship, "targetEntityId")),
					eq(
						column(shared, "relationshipSchemaSlug"),
						column(relationship, "relationshipSchemaSlug"),
					),
				),
			}),
		),
	);
};

export const targetListRecipe = defineRecipe((input: TaxonomyListInput) => {
	const target = table("entity", "exerciseTarget");
	return {
		map: ({ targets }) => Result.succeed(targets),
		queries: {
			targets: selectedRows(target, {
				after: input.after,
				limit: input.limit,
				orderBy: [ascending(column(target, "name"))],
				where: taxonomyWhere(target, "exercise-target", input),
				selection: {
					id: selectedField(column(target, "id"), EntityId),
					name: selectedField(column(target, "name"), Schema.String),
					kind: selectedField(property(target, "kind"), exerciseTargetKindSchema),
					userId: selectedField(column(target, "userId"), Schema.NullOr(Schema.String)),
				},
			}),
		},
	};
});

export const equipmentListRecipe = defineRecipe((input: TaxonomyListInput) => {
	const equipmentTable = table("entity", "exerciseEquipment");
	return {
		map: ({ equipment }) => Result.succeed(equipment),
		queries: {
			equipment: selectedRows(equipmentTable, {
				after: input.after,
				limit: input.limit,
				orderBy: [ascending(column(equipmentTable, "name"))],
				where: taxonomyWhere(equipmentTable, "exercise-equipment", input),
				selection: {
					id: selectedField(column(equipmentTable, "id"), EntityId),
					name: selectedField(column(equipmentTable, "name"), Schema.String),
					userId: selectedField(column(equipmentTable, "userId"), Schema.NullOr(Schema.String)),
				},
			}),
		},
	};
});

export const exerciseTargetsRecipe = defineRecipe((input: ExerciseTaxonomyInput) => {
	const relationship = table("relationship", "exerciseTargetRelationship");
	const target = table("entity", "exerciseTarget");
	return {
		map: ({ targets }) => Result.succeed(targets),
		queries: {
			targets: selectedRows(relationship, {
				after: input.after,
				limit: input.limit,
				orderBy: [ascending(column(target, "name")), ascending(column(relationship, "id"))],
				joins: [
					join("inner", target, eq(column(relationship, "targetEntityId"), column(target, "id"))),
				],
				where: and(
					effectiveLink(relationship),
					eq(column(relationship, "sourceEntityId"), literal(input.exerciseId)),
					eq(column(relationship, "relationshipSchemaSlug"), literal("exercise-targets")),
					eq(column(target, "entitySchemaSlug"), literal("exercise-target")),
				),
				selection: {
					id: selectedField(column(target, "id"), EntityId),
					name: selectedField(column(target, "name"), Schema.String),
					kind: selectedField(property(target, "kind"), exerciseTargetKindSchema),
					relationshipId: selectedField(column(relationship, "id"), Schema.String),
					userId: selectedField(column(relationship, "userId"), Schema.NullOr(Schema.String)),
					role: selectedField(
						property(relationship, "role"),
						Schema.NullOr(exerciseTargetRoleSchema),
					),
				},
			}),
		},
	};
});

export const exerciseEquipmentRecipe = defineRecipe((input: ExerciseTaxonomyInput) => {
	const relationship = table("relationship", "exerciseEquipmentRelationship");
	const equipmentTable = table("entity", "exerciseEquipment");
	return {
		map: ({ equipment }) => Result.succeed(equipment),
		queries: {
			equipment: selectedRows(relationship, {
				after: input.after,
				limit: input.limit,
				orderBy: [ascending(column(equipmentTable, "name")), ascending(column(relationship, "id"))],
				joins: [
					join(
						"inner",
						equipmentTable,
						eq(column(relationship, "targetEntityId"), column(equipmentTable, "id")),
					),
				],
				where: and(
					effectiveLink(relationship),
					eq(column(relationship, "sourceEntityId"), literal(input.exerciseId)),
					eq(column(relationship, "relationshipSchemaSlug"), literal("exercise-uses-equipment")),
					eq(column(equipmentTable, "entitySchemaSlug"), literal("exercise-equipment")),
				),
				selection: {
					id: selectedField(column(equipmentTable, "id"), EntityId),
					name: selectedField(column(equipmentTable, "name"), Schema.String),
					relationshipId: selectedField(column(relationship, "id"), Schema.String),
					userId: selectedField(column(relationship, "userId"), Schema.NullOr(Schema.String)),
				},
			}),
		},
	};
});

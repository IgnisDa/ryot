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
	selectedInclude,
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

const exerciseLinkSlugs = {
	target: { entity: "exercise-target", relationship: "exercise-targets" },
	equipment: { entity: "exercise-equipment", relationship: "exercise-uses-equipment" },
} as const;

const exerciseLink = (
	kind: keyof typeof exerciseLinkSlugs,
	relationship: Table,
	linked: Table,
	exerciseId: Parameters<typeof eq>[1],
) => ({
	joins: [join("inner", linked, eq(column(relationship, "targetEntityId"), column(linked, "id")))],
	where: and(
		effectiveLink(relationship),
		eq(column(relationship, "sourceEntityId"), exerciseId),
		eq(
			column(relationship, "relationshipSchemaSlug"),
			literal(exerciseLinkSlugs[kind].relationship),
		),
		eq(column(linked, "entitySchemaSlug"), literal(exerciseLinkSlugs[kind].entity)),
	),
});

export const exerciseTargetInclude = (exercise: Table) => {
	const relationship = table("relationship", "exerciseTargetRelationship");
	const target = table("entity", "exerciseTarget");
	return selectedInclude(relationship, {
		limit: 100,
		...exerciseLink("target", relationship, target, column(exercise, "id")),
		orderBy: [ascending(column(target, "name")), ascending(column(relationship, "id"))],
		selection: {
			name: selectedField(column(target, "name"), Schema.String),
			role: selectedField(property(relationship, "role"), Schema.NullOr(exerciseTargetRoleSchema)),
		},
	});
};

export const exerciseEquipmentInclude = (exercise: Table) => {
	const relationship = table("relationship", "exerciseEquipmentRelationship");
	const equipment = table("entity", "exerciseEquipment");
	return selectedInclude(relationship, {
		limit: 100,
		...exerciseLink("equipment", relationship, equipment, column(exercise, "id")),
		orderBy: [ascending(column(equipment, "name")), ascending(column(relationship, "id"))],
		selection: {
			id: selectedField(column(equipment, "id"), Schema.String),
			name: selectedField(column(equipment, "name"), Schema.String),
		},
	});
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
				...exerciseLink("target", relationship, target, literal(input.exerciseId)),
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
				...exerciseLink("equipment", relationship, equipmentTable, literal(input.exerciseId)),
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

import { Result, Schema } from "@ryot-app/plugin-kit/effect";
import {
	and,
	ascending,
	column,
	defineRecipe,
	entitySchemaPredicate,
	eq,
	exists,
	isNull,
	join,
	literal,
	not,
	or,
	parameters,
	pluginId,
	selectedField,
	selectedInclude,
	selectedRows,
	table,
} from "@ryot-app/plugin-kit/ryotql";
import { EntityId, type PluginIdentityReference } from "@ryot-app/plugin-kit/schema";

import { property } from "./entity-selections";
import { exerciseTargetKindSchema, exerciseTargetRoleSchema } from "./taxonomy";

type Table = Parameters<typeof column>[0];
export const effectiveTaxonomyLink = (relationship: Table) => {
	const shared = table("relationship", "sharedTaxonomyRelationship");
	return or(
		isNull(column(relationship, "userId")),
		not(
			exists(shared, {
				where: and(
					eq(
						column(shared, "relationshipSchemaPluginId"),
						column(relationship, "relationshipSchemaPluginId"),
					),
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
	owner: Parameters<typeof eq>[1],
) => ({
	joins: [join("inner", linked, eq(column(relationship, "targetEntityId"), column(linked, "id")))],
	where: and(
		eq(column(relationship, "relationshipSchemaPluginId"), owner),
		eq(column(linked, "entitySchemaPluginId"), owner),
		effectiveTaxonomyLink(relationship),
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
		...exerciseLink(
			"target",
			relationship,
			target,
			column(exercise, "id"),
			column(exercise, "entitySchemaPluginId"),
		),
		orderBy: [ascending(column(target, "name")), ascending(column(relationship, "id"))],
		selection: {
			id: selectedField(column(target, "id"), Schema.String),
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
		...exerciseLink(
			"equipment",
			relationship,
			equipment,
			column(exercise, "id"),
			column(exercise, "entitySchemaPluginId"),
		),
		orderBy: [ascending(column(equipment, "name")), ascending(column(relationship, "id"))],
		selection: {
			id: selectedField(column(equipment, "id"), Schema.String),
			name: selectedField(column(equipment, "name"), Schema.String),
		},
	});
};
export const targetListRecipe = (input: { readonly reference: PluginIdentityReference }) => {
	const inputParameters = parameters({
		fields: { name: { label: "name", type: "string", description: "name for this selection" } },
	});
	const target = table("entity", "exerciseTarget");
	return defineRecipe({
		parameters: inputParameters.schema,
		map: ({ targets }) => Result.succeed(targets),
		queries: {
			targets: selectedRows(target, {
				limit: 100,
				orderBy: [ascending(column(target, "name"))],
				where: and(
					entitySchemaPredicate(target, "exercise-target", input.reference),
					inputParameters.whenSet(
						"name",
						eq(column(target, "name"), inputParameters.value("name")),
					),
				),
				selection: {
					id: selectedField(column(target, "id"), EntityId),
					name: selectedField(column(target, "name"), Schema.String),
					kind: selectedField(property(target, "kind"), exerciseTargetKindSchema),
					userId: selectedField(column(target, "userId"), Schema.NullOr(Schema.String)),
				},
			}),
		},
	});
};
export const equipmentListRecipe = (input: { readonly reference: PluginIdentityReference }) => {
	const inputParameters = parameters({
		fields: { name: { label: "name", type: "string", description: "name for this selection" } },
	});
	const equipmentTable = table("entity", "exerciseEquipment");
	return defineRecipe({
		parameters: inputParameters.schema,
		map: ({ equipment }) => Result.succeed(equipment),
		queries: {
			equipment: selectedRows(equipmentTable, {
				limit: 100,
				orderBy: [ascending(column(equipmentTable, "name"))],
				where: and(
					entitySchemaPredicate(equipmentTable, "exercise-equipment", input.reference),
					inputParameters.whenSet(
						"name",
						eq(column(equipmentTable, "name"), inputParameters.value("name")),
					),
				),
				selection: {
					id: selectedField(column(equipmentTable, "id"), EntityId),
					name: selectedField(column(equipmentTable, "name"), Schema.String),
					userId: selectedField(column(equipmentTable, "userId"), Schema.NullOr(Schema.String)),
				},
			}),
		},
	});
};
export const exerciseTargetsRecipe = (input: { readonly reference: PluginIdentityReference }) => {
	const inputParameters = parameters({
		fields: {
			exerciseId: {
				type: "string",
				label: "exerciseId",
				validation: { required: true },
				description: "exerciseId for this selection",
			},
		},
	});
	const relationship = table("relationship", "exerciseTargetRelationship");
	const target = table("entity", "exerciseTarget");
	return defineRecipe({
		parameters: inputParameters.schema,
		map: ({ targets }) => Result.succeed(targets),
		queries: {
			targets: selectedRows(relationship, {
				limit: 100,
				orderBy: [ascending(column(target, "name")), ascending(column(relationship, "id"))],
				...exerciseLink(
					"target",
					relationship,
					target,
					inputParameters.value("exerciseId"),
					pluginId(input.reference),
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
	});
};
export const exerciseEquipmentRecipe = (input: { readonly reference: PluginIdentityReference }) => {
	const inputParameters = parameters({
		fields: {
			exerciseId: {
				type: "string",
				label: "exerciseId",
				validation: { required: true },
				description: "exerciseId for this selection",
			},
		},
	});
	const relationship = table("relationship", "exerciseEquipmentRelationship");
	const equipmentTable = table("entity", "exerciseEquipment");
	return defineRecipe({
		parameters: inputParameters.schema,
		map: ({ equipment }) => Result.succeed(equipment),
		queries: {
			equipment: selectedRows(relationship, {
				limit: 100,
				orderBy: [ascending(column(equipmentTable, "name")), ascending(column(relationship, "id"))],
				...exerciseLink(
					"equipment",
					relationship,
					equipmentTable,
					inputParameters.value("exerciseId"),
					pluginId(input.reference),
				),
				selection: {
					id: selectedField(column(equipmentTable, "id"), EntityId),
					name: selectedField(column(equipmentTable, "name"), Schema.String),
					relationshipId: selectedField(column(relationship, "id"), Schema.String),
					userId: selectedField(column(relationship, "userId"), Schema.NullOr(Schema.String)),
				},
			}),
		},
	});
};

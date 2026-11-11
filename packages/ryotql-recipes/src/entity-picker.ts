import { PluginEntityEditor } from "@ryot-app/contract/modules/plugins/manifest";
import {
	type EntitySchemaReference,
	ownerIdentityReference,
} from "@ryot-app/contract/modules/plugins/references";
import { EntityId } from "@ryot-app/contract/schema/brands";
import { AppSchema } from "@ryot-app/contract/schema/property-schema";
import {
	and,
	ascending,
	column,
	contains,
	defineRecipe,
	entitySchemaPredicate,
	eq,
	inArray,
	literal,
	type Recipe,
	schemaOwnerPredicate,
	selectedField,
	selectedOptionalRow,
	selectedRows,
	table,
} from "@ryot-app/ryotql";
import { parameters } from "@ryot-app/ryotql/authoring";
import { Result, Schema } from "effect";

const ENTITY_PICKER_PAGE_SIZE = 30;

export const entityPickerSchemaRecipe = (input: { readonly schema: EntitySchemaReference }) => {
	const definition = table("entitySchema", "pickerSchema");
	return defineRecipe({
		map: ({ definition: found }) => Result.succeed(found ?? null),
		queries: {
			definition: selectedOptionalRow(definition, {
				orderBy: [ascending(column(definition, "id"))],
				where: and(
					eq(column(definition, "slug"), literal(input.schema.slug)),
					schemaOwnerPredicate(definition, "pluginId", ownerIdentityReference(input.schema.owner)),
				),
				selection: {
					name: selectedField(column(definition, "name"), Schema.String),
					propertiesSchema: selectedField(column(definition, "propertiesSchema"), AppSchema),
					editor: selectedField(column(definition, "editor"), Schema.NullOr(PluginEntityEditor)),
				},
			}),
		},
	});
};

export type EntityPickerSchema = Recipe.Success<ReturnType<typeof entityPickerSchemaRecipe>>;

export const entityPickerEntitiesRecipe = (input: { readonly schema: EntitySchemaReference }) => {
	const recipeParameters = parameters({
		fields: {
			query: { label: "query", type: "string", defaultValue: "", description: "Query query" },
		},
	});

	const entity = table("entity", "pickerEntity");

	return defineRecipe({
		parameters: recipeParameters.schema,
		map: ({ entities }) => Result.succeed(entities),
		queries: {
			entities: selectedRows(entity, {
				limit: ENTITY_PICKER_PAGE_SIZE,
				orderBy: [ascending(column(entity, "name")), ascending(column(entity, "id"))],
				selection: {
					id: selectedField(column(entity, "id"), EntityId),
					name: selectedField(column(entity, "name"), Schema.String),
				},
				where: and(
					entitySchemaPredicate(
						entity,
						input.schema.slug,
						ownerIdentityReference(input.schema.owner),
					),
					contains(column(entity, "name"), recipeParameters.value("query")),
				),
			}),
		},
	});
};

export type EntityPickerEntitiesPage = Recipe.Success<
	ReturnType<typeof entityPickerEntitiesRecipe>
>;

export const entityPickerMaterializedRecipe = (input: {
	readonly schema: EntitySchemaReference;
}) => {
	const recipeParameters = parameters({
		fields: {
			providerId: {
				type: "string",
				label: "providerId",
				description: "Query argument",
				validation: { required: true },
			},
			externalIds: {
				type: "array",
				label: "externalIds",
				description: "Query argument",
				validation: { required: true },
				items: {
					type: "string",
					label: "Value",
					validation: { required: true },
					description: "Query argument value",
				},
			},
		},
	});

	const entity = table("entity", "pickerMaterialized");
	return defineRecipe({
		parameters: recipeParameters.schema,
		map: ({ materialized }) => Result.succeed(materialized),
		queries: {
			materialized: selectedRows(entity, {
				limit: 100,
				maxLimit: 100,
				orderBy: [ascending(column(entity, "id"))],
				selection: { externalId: selectedField(column(entity, "externalId"), Schema.String) },
				where: and(
					entitySchemaPredicate(
						entity,
						input.schema.slug,
						ownerIdentityReference(input.schema.owner),
					),
					eq(column(entity, "providerId"), recipeParameters.value("providerId")),
					inArray(column(entity, "externalId"), recipeParameters.list("externalIds")),
				),
			}),
		},
	});
};

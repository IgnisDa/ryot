import { PluginEntityEditor } from "@ryot-app/contract/modules/plugins/manifest";
import {
	type EntitySchemaReference,
	ownerIdentityReference,
} from "@ryot-app/contract/modules/plugins/references";
import { EntityId, type SandboxProviderId } from "@ryot-app/contract/schema/brands";
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
	schemaOwnerPredicate,
	selectedField,
	selectedOptionalRow,
	selectedRows,
	table,
	type Recipe,
} from "@ryot-app/ryotql";
import { Result, Schema } from "effect";

const ENTITY_PICKER_PAGE_SIZE = 30;

export const entityPickerSchemaRecipe = defineRecipe(
	(input: { readonly schema: EntitySchemaReference }) => {
		const definition = table("entitySchema", "pickerSchema");
		return {
			map: ({ definition: found }) => Result.succeed(found ?? null),
			queries: {
				definition: selectedOptionalRow(definition, {
					orderBy: [ascending(column(definition, "id"))],
					where: and(
						eq(column(definition, "slug"), literal(input.schema.slug)),
						schemaOwnerPredicate(
							definition,
							"pluginId",
							ownerIdentityReference(input.schema.owner),
						),
					),
					selection: {
						name: selectedField(column(definition, "name"), Schema.String),
						propertiesSchema: selectedField(column(definition, "propertiesSchema"), AppSchema),
						editor: selectedField(column(definition, "editor"), Schema.NullOr(PluginEntityEditor)),
					},
				}),
			},
		};
	},
);

export type EntityPickerSchema = Recipe.Success<typeof entityPickerSchemaRecipe>;

export const entityPickerEntitiesRecipe = defineRecipe(
	(input: {
		readonly query: string;
		readonly after?: string | undefined;
		readonly schema: EntitySchemaReference;
	}) => {
		const entity = table("entity", "pickerEntity");
		const query = input.query.trim();
		return {
			map: ({ entities }) => Result.succeed(entities),
			queries: {
				entities: selectedRows(entity, {
					after: input.after,
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
						...(query === "" ? [] : [contains(column(entity, "name"), literal(query))]),
					),
				}),
			},
		};
	},
);

export type EntityPickerEntitiesPage = Recipe.Success<typeof entityPickerEntitiesRecipe>;

export const entityPickerMaterializedRecipe = defineRecipe(
	(input: {
		readonly schema: EntitySchemaReference;
		readonly providerId: SandboxProviderId;
		readonly externalIds: readonly [string, ...string[]];
	}) => {
		const entity = table("entity", "pickerMaterialized");
		return {
			map: ({ materialized }) =>
				Result.succeed(new Set(materialized.items.map(({ externalId }) => externalId))),
			queries: {
				materialized: selectedRows(entity, {
					limit: input.externalIds.length,
					orderBy: [ascending(column(entity, "id"))],
					selection: { externalId: selectedField(column(entity, "externalId"), Schema.String) },
					where: and(
						entitySchemaPredicate(
							entity,
							input.schema.slug,
							ownerIdentityReference(input.schema.owner),
						),
						eq(column(entity, "providerId"), literal(input.providerId)),
						inArray(column(entity, "externalId"), input.externalIds.map(literal)),
					),
				}),
			},
		};
	},
);

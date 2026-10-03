import type { PluginIdentityReference } from "@ryot-app/contract/modules/plugins/references";
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
	join,
	literal,
	pluginId,
	schemaOwnerPredicate,
	selectedField,
	selectedOptionalRow,
	selectedRows,
	table,
} from "@ryot-app/ryotql";
import { Result, Schema } from "effect";

const ENTITY_EDITOR_PAGE_SIZE = 100;

const Properties = Schema.Record(Schema.String, Schema.Unknown);

export const entityEditorEntityDefinitionRecipe = defineRecipe(
	(input: { readonly slug: string; readonly reference: PluginIdentityReference }) => {
		const definition = table("entitySchema", "editorEntityDefinition");
		return {
			map: ({ definition: found }) =>
				found === undefined
					? Result.fail(new Error("Entity schema not found"))
					: Result.succeed(found),
			queries: {
				definition: selectedOptionalRow(definition, {
					orderBy: [ascending(column(definition, "id"))],
					where: and(
						eq(column(definition, "slug"), literal(input.slug)),
						eq(column(definition, "pluginId"), pluginId(input.reference)),
					),
					selection: {
						name: selectedField(column(definition, "name"), Schema.String),
						propertiesSchema: selectedField(column(definition, "propertiesSchema"), AppSchema),
					},
				}),
			},
		};
	},
);

export const entityEditorRelationshipDefinitionsRecipe = defineRecipe(
	(input: { readonly slugs: readonly string[]; readonly reference: PluginIdentityReference }) => {
		const definition = table("relationshipSchema", "editorRelationshipDefinition");
		return {
			map: ({ definitions }) => Result.succeed(definitions.items),
			queries: {
				definitions: selectedRows(definition, {
					limit: ENTITY_EDITOR_PAGE_SIZE,
					orderBy: [ascending(column(definition, "slug")), ascending(column(definition, "id"))],
					where: and(
						inArray(column(definition, "slug"), input.slugs.map(literal)),
						eq(column(definition, "pluginId"), pluginId(input.reference)),
					),
					selection: {
						name: selectedField(column(definition, "name"), Schema.String),
						slug: selectedField(column(definition, "slug"), Schema.String),
						propertiesSchema: selectedField(column(definition, "propertiesSchema"), AppSchema),
						targetEntitySchemaSlug: selectedField(
							column(definition, "targetEntitySchemaSlug"),
							Schema.NullOr(Schema.String),
						),
					},
				}),
			},
		};
	},
);

export const entityEditorEntityRecipe = defineRecipe(
	(input: {
		readonly entityId: string;
		readonly entitySchemaSlug: string;
		readonly reference: PluginIdentityReference;
	}) => {
		const entity = table("entity", "editorEntity");
		return {
			map: ({ entity: found }) => Result.succeed(found ?? null),
			queries: {
				entity: selectedOptionalRow(entity, {
					orderBy: [ascending(column(entity, "id"))],
					where: and(
						entitySchemaPredicate(entity, input.entitySchemaSlug, input.reference),
						eq(column(entity, "id"), literal(input.entityId)),
					),
					selection: {
						name: selectedField(column(entity, "name"), Schema.String),
						properties: selectedField(column(entity, "properties"), Properties),
						updatedAt: selectedField(column(entity, "updatedAt"), Schema.String),
					},
				}),
			},
		};
	},
);

export const entityEditorRelationshipsRecipe = defineRecipe(
	(input: {
		readonly slugs: readonly string[];
		readonly sourceEntityId: string;
		readonly after?: string | undefined;
		readonly reference: PluginIdentityReference;
	}) => {
		const relationship = table("relationship", "editorRelationship");
		const target = table("entity", "editorRelationshipTarget");
		return {
			map: ({ relationships }) => Result.succeed(relationships),
			queries: {
				relationships: selectedRows(relationship, {
					after: input.after,
					limit: ENTITY_EDITOR_PAGE_SIZE,
					orderBy: [ascending(column(relationship, "id"))],
					joins: [
						join("inner", target, eq(column(relationship, "targetEntityId"), column(target, "id"))),
					],
					where: and(
						eq(column(relationship, "sourceEntityId"), literal(input.sourceEntityId)),
						inArray(column(relationship, "relationshipSchemaSlug"), input.slugs.map(literal)),
						schemaOwnerPredicate(relationship, "relationshipSchemaPluginId", input.reference),
					),
					selection: {
						name: selectedField(column(target, "name"), Schema.String),
						properties: selectedField(column(relationship, "properties"), Properties),
						entityId: selectedField(column(relationship, "targetEntityId"), EntityId),
						slug: selectedField(column(relationship, "relationshipSchemaSlug"), Schema.String),
						userId: selectedField(column(relationship, "userId"), Schema.NullOr(Schema.String)),
					},
				}),
			},
		};
	},
);

export const entityEditorCandidatesRecipe = defineRecipe(
	(input: {
		readonly search: string;
		readonly entitySchemaSlug: string;
		readonly after?: string | undefined;
		readonly reference: PluginIdentityReference;
	}) => {
		const entity = table("entity", "editorCandidate");
		const search = input.search.trim();
		return {
			map: ({ candidates }) => Result.succeed(candidates),
			queries: {
				candidates: selectedRows(entity, {
					after: input.after,
					limit: ENTITY_EDITOR_PAGE_SIZE,
					orderBy: [ascending(column(entity, "name")), ascending(column(entity, "id"))],
					selection: {
						id: selectedField(column(entity, "id"), EntityId),
						name: selectedField(column(entity, "name"), Schema.String),
					},
					where: and(
						entitySchemaPredicate(entity, input.entitySchemaSlug, input.reference),
						...(search === "" ? [] : [contains(column(entity, "name"), literal(search))]),
					),
				}),
			},
		};
	},
);

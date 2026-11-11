import { PluginEntityEditor } from "@ryot-app/contract/modules/plugins/manifest";
import type { PluginIdentityReference } from "@ryot-app/contract/modules/plugins/references";
import { relationshipEnds } from "@ryot-app/contract/modules/relationships/orientation";
import { EntityId } from "@ryot-app/contract/schema/brands";
import { AppSchema } from "@ryot-app/contract/schema/property-schema";
import {
	and,
	ascending,
	column,
	conditional,
	defineRecipe,
	entitySchemaPredicate,
	eq,
	inArray,
	isNotNull,
	isNull,
	join,
	literal,
	pluginId,
	schemaOwnerPredicate,
	selectedField,
	selectedOptionalRow,
	selectedRows,
	table,
} from "@ryot-app/ryotql";
import { parameters } from "@ryot-app/ryotql/authoring";
import { Result, Schema } from "effect";

const ENTITY_EDITOR_PAGE_SIZE = 100;

const Properties = Schema.Record(Schema.String, Schema.Unknown);

export const entityEditorEntityDefinitionRecipe = (input: {
	readonly slug: string;
	readonly reference: PluginIdentityReference;
}) => {
	const recipeParameters = parameters({ fields: {} });

	const definition = table("entitySchema", "editorEntityDefinition");
	return defineRecipe({
		parameters: recipeParameters.schema,
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
					editor: selectedField(column(definition, "editor"), Schema.NullOr(PluginEntityEditor)),
				},
			}),
		},
	});
};

export const entityEditorRelationshipDefinitionsRecipe = (input: {
	readonly slugs: readonly string[];
	readonly reference: PluginIdentityReference;
}) => {
	const recipeParameters = parameters({ fields: {} });

	const definition = table("relationshipSchema", "editorRelationshipDefinition");
	return defineRecipe({
		parameters: recipeParameters.schema,
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
					sourceEntitySchemaSlug: selectedField(
						column(definition, "sourceEntitySchemaSlug"),
						Schema.NullOr(Schema.String),
					),
					targetEntitySchemaSlug: selectedField(
						column(definition, "targetEntitySchemaSlug"),
						Schema.NullOr(Schema.String),
					),
				},
			}),
		},
	});
};

export const entityEditorEntityRecipe = (input: {
	readonly entitySchemaSlug: string;
	readonly reference: PluginIdentityReference;
}) => {
	const recipeParameters = parameters({
		fields: {
			entityId: {
				type: "string",
				label: "entityId",
				description: "Query entityId",
				validation: { required: true },
			},
		},
	});

	const entity = table("entity", "editorEntity");
	return defineRecipe({
		parameters: recipeParameters.schema,
		map: ({ entity: found }) => Result.succeed(found ?? null),
		queries: {
			entity: selectedOptionalRow(entity, {
				orderBy: [ascending(column(entity, "id"))],
				where: and(
					entitySchemaPredicate(entity, input.entitySchemaSlug, input.reference),
					eq(column(entity, "id"), recipeParameters.value("entityId")),
				),
				selection: {
					name: selectedField(column(entity, "name"), Schema.String),
					properties: selectedField(column(entity, "properties"), Properties),
					updatedAt: selectedField(column(entity, "updatedAt"), Schema.String),
					canEdit: selectedField(
						conditional(
							and(isNotNull(column(entity, "userId")), isNull(column(entity, "providerId"))),
							literal(true),
							literal(false),
						),
						Schema.Boolean,
					),
				},
			}),
		},
	});
};

export const entityEditorRelationshipsRecipe = (input: {
	readonly slugs: readonly string[];
	readonly direction: "outgoing" | "incoming";
	readonly reference: PluginIdentityReference;
}) => {
	const recipeParameters = parameters({
		fields: {
			entityId: {
				type: "string",
				label: "entityId",
				description: "Query entityId",
				validation: { required: true },
			},
		},
	});

	const relationship = table("relationship", "editorRelationship");
	const related = table("entity", "editorRelationshipRelated");
	const ends = relationshipEnds(input.direction);
	const ownEnd = `${ends.anchor}EntityId` as const;
	const relatedEnd = `${ends.related}EntityId` as const;
	return defineRecipe({
		parameters: recipeParameters.schema,
		map: ({ relationships }) => Result.succeed(relationships),
		queries: {
			relationships: selectedRows(relationship, {
				limit: ENTITY_EDITOR_PAGE_SIZE,
				orderBy: [ascending(column(relationship, "id"))],
				joins: [
					join("inner", related, eq(column(relationship, relatedEnd), column(related, "id"))),
				],
				where: and(
					eq(column(relationship, ownEnd), recipeParameters.value("entityId")),
					inArray(column(relationship, "relationshipSchemaSlug"), input.slugs.map(literal)),
					schemaOwnerPredicate(relationship, "relationshipSchemaPluginId", input.reference),
				),
				selection: {
					name: selectedField(column(related, "name"), Schema.String),
					entityId: selectedField(column(relationship, relatedEnd), EntityId),
					properties: selectedField(column(relationship, "properties"), Properties),
					slug: selectedField(column(relationship, "relationshipSchemaSlug"), Schema.String),
					userId: selectedField(column(relationship, "userId"), Schema.NullOr(Schema.String)),
				},
			}),
		},
	});
};

export const entityEditorTargetsRecipe = (input: {
	readonly entitySchemaSlug: string;
	readonly reference: PluginIdentityReference;
}) => {
	const recipeParameters = parameters({
		fields: {
			entityIds: {
				type: "array",
				label: "Entities",
				description: "Entity IDs",
				validation: { required: true },
				items: {
					label: "ID",
					type: "string",
					description: "Entity ID",
					validation: { required: true },
				},
			},
		},
	});

	const entity = table("entity", "editorTarget");
	return defineRecipe({
		parameters: recipeParameters.schema,
		map: ({ targets }) => Result.succeed(targets.items),
		queries: {
			targets: selectedRows(entity, {
				limit: 1000,
				maxLimit: 1000,
				orderBy: [ascending(column(entity, "id"))],
				selection: {
					id: selectedField(column(entity, "id"), EntityId),
					name: selectedField(column(entity, "name"), Schema.String),
				},
				where: and(
					entitySchemaPredicate(entity, input.entitySchemaSlug, input.reference),
					inArray(column(entity, "id"), recipeParameters.list("entityIds")),
				),
			}),
		},
	});
};

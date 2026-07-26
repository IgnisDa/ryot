import { Schema } from "@ryot-app/plugin-kit/effect";
import {
	and,
	castBoolean,
	castJson,
	castNumber,
	castText,
	column,
	eq,
	exists,
	join,
	jsonPath,
	literal,
	selectedField,
	table,
} from "@ryot-app/plugin-kit/ryotql";
import {
	EntityId,
	EntitySchemaSlug,
	PopulationStatus,
	TranslationStatus,
} from "@ryot-app/plugin-kit/schema";

export type Table = ReturnType<typeof table>;

export const entityId = (entity: Table, id: string) => eq(column(entity, "id"), literal(id));

export const entitySchema = (entity: Table, slug: string) =>
	eq(column(entity, "entitySchemaSlug"), literal(slug));

export const entitySyncSelection = (entity: Table) => ({
	populationStatus: selectedField(column(entity, "populationStatus"), PopulationStatus),
	translationStatus: selectedField(column(entity, "translationStatus"), TranslationStatus),
});

export const entityIdentitySelection = (entity: Table) => ({
	id: selectedField(column(entity, "id"), EntityId),
	name: selectedField(column(entity, "name"), Schema.String),
	schemaSlug: selectedField(column(entity, "entitySchemaSlug"), EntitySchemaSlug),
	...entitySyncSelection(entity),
});

export const propertyJson = (entity: Table, property: string) =>
	castJson(jsonPath(column(entity, "properties"), property));

export const propertyText = (entity: Table, property: string) =>
	castText(jsonPath(column(entity, "properties"), property));

export const propertyNumber = (entity: Table, property: string) =>
	castNumber(jsonPath(column(entity, "properties"), property));

export const propertyBoolean = (entity: Table, property: string) =>
	castBoolean(jsonPath(column(entity, "properties"), property));

export const relationshipTo = (relationship: Table, parent: Table, child: Table, schema: string) =>
	and(
		eq(column(relationship, "sourceEntityId"), column(parent, "id")),
		eq(column(relationship, "targetEntityId"), column(child, "id")),
		eq(column(relationship, "relationshipSchemaSlug"), literal(schema)),
	);

export const libraryLinkExists = (entity: Table, alias: string, slug: string) => {
	const library = table("entity", alias);
	const relationship = table("relationship", `${alias}Relationship`);
	return exists(library, {
		joins: [
			join(
				"inner",
				relationship,
				eq(column(relationship, "targetEntityId"), column(library, "id")),
			),
		],
		where: and(
			entitySchema(library, "library"),
			eq(column(relationship, "sourceEntityId"), column(entity, "id")),
			eq(column(relationship, "relationshipSchemaSlug"), literal(slug)),
		),
	});
};

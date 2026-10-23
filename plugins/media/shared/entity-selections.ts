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

import { entitySchemaIs, sameSchemaOwner } from "./lifecycle-expressions";

export type Table = ReturnType<typeof table>;

export const entityId = (entity: Table, id: string) => eq(column(entity, "id"), literal(id));

export const entitySyncSelection = (entity: Table) => ({
	populationStatus: selectedField(column(entity, "populationStatus"), PopulationStatus),
	translationStatus: selectedField(column(entity, "translationStatus"), TranslationStatus),
	relatedPopulationStatus: selectedField(
		column(entity, "relatedPopulationStatus"),
		PopulationStatus,
	),
});

export const entityIdentitySelection = (entity: Table) => ({
	id: selectedField(column(entity, "id"), EntityId),
	name: selectedField(column(entity, "name"), Schema.String),
	schemaSlug: selectedField(column(entity, "entitySchemaSlug"), EntitySchemaSlug),
	...entitySyncSelection(entity),
});

type PropertyPath =
	Parameters<typeof jsonPath> extends readonly [unknown, ...infer Path] ? Path : never;

export const propertyJson = (entity: Table, ...path: PropertyPath) =>
	castJson(jsonPath(column(entity, "properties"), ...path));

export const propertyText = (entity: Table, ...path: PropertyPath) =>
	castText(jsonPath(column(entity, "properties"), ...path));

export const propertyNumber = (entity: Table, ...path: PropertyPath) =>
	castNumber(jsonPath(column(entity, "properties"), ...path));

export const propertyBoolean = (entity: Table, ...path: PropertyPath) =>
	castBoolean(jsonPath(column(entity, "properties"), ...path));

export const libraryLinkExists = (entity: Table, alias: string, slug: string) => {
	const mediaLibrary = table("entity", alias);
	const relationship = table("relationship", `${alias}Relationship`);
	return exists(mediaLibrary, {
		joins: [
			join(
				"inner",
				relationship,
				eq(column(relationship, "targetEntityId"), column(mediaLibrary, "id")),
			),
		],
		where: and(
			entitySchemaIs(mediaLibrary, "media-library"),
			sameSchemaOwner(mediaLibrary, "entitySchemaPluginId", entity),
			sameSchemaOwner(relationship, "relationshipSchemaPluginId", entity),
			eq(column(relationship, "sourceEntityId"), column(entity, "id")),
			eq(column(relationship, "relationshipSchemaSlug"), literal(slug)),
		),
	});
};

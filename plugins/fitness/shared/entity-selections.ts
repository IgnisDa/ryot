import { Schema } from "@ryot-app/plugin-kit/effect";
import {
	castDate,
	castNumber,
	castText,
	column,
	jsonPath,
	selectedField,
	type table,
} from "@ryot-app/plugin-kit/ryotql";
import { EntityId, EntitySchemaSlug } from "@ryot-app/plugin-kit/schema";

type Table = ReturnType<typeof table>;

export const entityIdentitySelection = (entity: Table) => ({
	id: selectedField(column(entity, "id"), EntityId),
	name: selectedField(column(entity, "name"), Schema.String),
	schemaSlug: selectedField(column(entity, "entitySchemaSlug"), EntitySchemaSlug),
});

export const property = (source: Table, path: string) =>
	castText(jsonPath(column(source, "properties"), path));

export const propertyDate = (source: Table, path: string) =>
	castDate(jsonPath(column(source, "properties"), path));

export const propertyNumber = (source: Table, path: string) =>
	castNumber(jsonPath(column(source, "properties"), path));

export const workoutDatesSelection = (entity: Table) => ({
	endedAt: selectedField(propertyDate(entity, "endedAt"), Schema.NullOr(Schema.String)),
	startedAt: selectedField(propertyDate(entity, "startedAt"), Schema.NullOr(Schema.String)),
});

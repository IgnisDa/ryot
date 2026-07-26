import type { EntityRecord, EventRecord } from "@ryot/sandbox-sdk/core";
import { Schema } from "@ryot/sandbox-sdk/effect";
import {
	decodeRyotqlQuery,
	ryotqlDateFieldValueSchema,
	ryotqlJsonFieldValueSchema,
	ryotqlNullFieldValueSchema,
	ryotqlRowsResultSchema,
	ryotqlTextFieldValueSchema,
} from "@ryot/sandbox-sdk/ryotql";

const strictStruct = <Fields extends Schema.Struct.Fields>(fields: Fields) =>
	Schema.Struct(fields).annotate({ parseOptions: { onExcessProperty: "error" as const } });

const nullableText = Schema.Union([ryotqlNullFieldValueSchema, ryotqlTextFieldValueSchema]);
const nullableDate = Schema.Union([ryotqlDateFieldValueSchema, ryotqlNullFieldValueSchema]);

const entityRowSchema = strictStruct({
	providerId: nullableText,
	externalId: nullableText,
	populatedAt: nullableDate,
	id: ryotqlTextFieldValueSchema,
	name: ryotqlTextFieldValueSchema,
	createdAt: ryotqlDateFieldValueSchema,
	updatedAt: ryotqlDateFieldValueSchema,
	properties: ryotqlJsonFieldValueSchema,
	entitySchemaSlug: ryotqlTextFieldValueSchema,
});

const eventRowSchema = strictStruct({
	sessionEntityId: nullableText,
	id: ryotqlTextFieldValueSchema,
	entityId: ryotqlTextFieldValueSchema,
	createdAt: ryotqlDateFieldValueSchema,
	updatedAt: ryotqlDateFieldValueSchema,
	occurredAt: ryotqlDateFieldValueSchema,
	properties: ryotqlJsonFieldValueSchema,
	eventSchemaSlug: ryotqlTextFieldValueSchema,
	entitySchemaSlug: ryotqlTextFieldValueSchema,
});

const entityIdRowSchema = strictStruct({ entityId: ryotqlTextFieldValueSchema });

export type MediaProgressEvent = Pick<
	EventRecord,
	"createdAt" | "id" | "occurredAt" | "properties"
>;

export const decodeEntityReadResponse = (response: unknown): EntityRecord => {
	const row = decodeRyotqlQuery(response, "entities", ryotqlRowsResultSchema(entityRowSchema))
		.items[0];
	if (!row) {
		throw new Error("Entity not found");
	}
	return {
		id: row.id.value,
		name: row.name.value,
		updatedAt: row.updatedAt.value,
		createdAt: row.createdAt.value,
		properties: row.properties.value,
		entitySchemaSlug: row.entitySchemaSlug.value,
		providerId: row.providerId.kind === "text" ? row.providerId.value : null,
		externalId: row.externalId.kind === "text" ? row.externalId.value : null,
		populatedAt: row.populatedAt.kind === "date" ? row.populatedAt.value : null,
	};
};

export const decodeProgressEvents = (response: unknown): readonly MediaProgressEvent[] =>
	decodeRyotqlQuery(response, "events", ryotqlRowsResultSchema(eventRowSchema)).items.map(
		(row) => ({
			id: row.id.value,
			createdAt: row.createdAt.value,
			occurredAt: row.occurredAt.value,
			properties: row.properties.value,
		}),
	);

export const decodeEntityIds = (response: unknown, queryName: string) =>
	decodeRyotqlQuery(response, queryName, ryotqlRowsResultSchema(entityIdRowSchema)).items.map(
		(row) => row.entityId.value,
	);

export const decodeEntityId = (response: unknown, queryName: string) =>
	decodeEntityIds(response, queryName)[0] ?? null;

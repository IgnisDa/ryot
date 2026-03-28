import { TranslationStatus } from "@ryot/contract/modules/entities/schemas";
import {
	DateFieldValue,
	JsonFieldValue,
	NullFieldValue,
	TextFieldValue,
	rowsResultSchema,
} from "@ryot/contract/modules/ryotql/language";
import { EntityId, EntitySchemaSlug, SandboxProviderId } from "@ryot/contract/schema/brands";
import { strictStruct } from "@ryot/contract/schema/utils";
import {
	and,
	ascending,
	column,
	document,
	eq,
	field,
	inArray,
	literal,
	rows,
	table,
} from "@ryot/ryotql";
import { DateTime, Option, Result, Schema } from "effect";

const entityInterestResponse = strictStruct({
	data: strictStruct({
		entities: rowsResultSchema(
			strictStruct({
				id: TextFieldValue,
				properties: JsonFieldValue,
				entitySchemaSlug: TextFieldValue,
				providerId: Schema.Union([TextFieldValue, NullFieldValue]),
				externalId: Schema.Union([TextFieldValue, NullFieldValue]),
				populatedAt: Schema.Union([DateFieldValue, NullFieldValue]),
				translationStatus: strictStruct({ value: TranslationStatus, kind: Schema.Literal("text") }),
			}),
		),
	}),
});

export const EntityInterestRow = strictStruct({
	id: EntityId,
	properties: Schema.Unknown,
	entitySchemaSlug: EntitySchemaSlug,
	translationStatus: TranslationStatus,
	externalId: Schema.NullOr(Schema.String),
	populatedAt: Schema.NullOr(Schema.String),
	providerId: Schema.NullOr(SandboxProviderId),
});
export type EntityInterestRow = typeof EntityInterestRow.Type;

const decodeEntityInterestResult = Schema.decodeUnknownResult(entityInterestResponse);

const normalizePopulatedAt = (value: typeof DateFieldValue.Type | typeof NullFieldValue.Type) => {
	if (value.kind === "null") {
		return Result.succeed(null);
	}
	const parsed = DateTime.make(value.value);
	return Option.isSome(parsed)
		? Result.succeed(DateTime.formatIso(parsed.value))
		: Result.fail(new Error("Expected RyotQL populatedAt to be a valid date"));
};

export const buildEntityDetailDocument = (input: {
	readonly entityId: string;
	readonly entitySchemaSlug: string;
}) => {
	const entity = table("entity", "entity");
	return document({
		entity: rows(entity, {
			limit: 1,
			orderBy: [ascending(column(entity, "id"))],
			where: and(
				eq(column(entity, "id"), literal(input.entityId)),
				eq(column(entity, "entitySchemaSlug"), literal(input.entitySchemaSlug)),
			),
			fields: [
				field("id", column(entity, "id")),
				field("name", column(entity, "name")),
				field("createdAt", column(entity, "createdAt")),
				field("updatedAt", column(entity, "updatedAt")),
				field("properties", column(entity, "properties")),
				field("externalId", column(entity, "externalId")),
				field("populatedAt", column(entity, "populatedAt")),
				field("entitySchemaSlug", column(entity, "entitySchemaSlug")),
				field("providerId", column(entity, "providerId")),
				field("translationStatus", column(entity, "translationStatus")),
			],
		}),
	});
};

export const buildEntityInterestDocument = (input: {
	readonly entityIds: readonly [string, ...string[]];
}) => {
	const entity = table("entity", "entity");
	return document({
		entities: rows(entity, {
			limit: input.entityIds.length,
			orderBy: [ascending(column(entity, "id"))],
			where: inArray(
				column(entity, "id"),
				input.entityIds.map((entityId) => literal(entityId)),
			),
			fields: [
				field("id", column(entity, "id")),
				field("properties", column(entity, "properties")),
				field("externalId", column(entity, "externalId")),
				field("populatedAt", column(entity, "populatedAt")),
				field("entitySchemaSlug", column(entity, "entitySchemaSlug")),
				field("providerId", column(entity, "providerId")),
				field("translationStatus", column(entity, "translationStatus")),
			],
		}),
	});
};

export const decodeEntityInterestResponse = (response: unknown) =>
	Result.flatMap(decodeEntityInterestResult(response), ({ data }) =>
		Result.all(
			data.entities.items.map((row) =>
				Result.map(
					normalizePopulatedAt(row.populatedAt),
					(populatedAt) =>
						({
							populatedAt,
							properties: row.properties.value,
							id: EntityId.make(row.id.value),
							translationStatus: row.translationStatus.value,
							externalId: row.externalId.kind === "text" ? row.externalId.value : null,
							entitySchemaSlug: EntitySchemaSlug.make(row.entitySchemaSlug.value),
							providerId:
								row.providerId.kind === "text" && row.providerId.value
									? SandboxProviderId.make(row.providerId.value)
									: null,
						}) satisfies EntityInterestRow,
				),
			),
		),
	);

import { TextFieldValue, rowsResultSchema } from "@ryot/contract/modules/ryotql/language";
import type { EntitySchemaSlug, SandboxProviderId } from "@ryot/contract/schema/brands";
import { strictStruct } from "@ryot/contract/schema/utils";
import {
	and,
	ascending,
	column,
	document,
	eq,
	exists,
	field,
	inArray,
	join,
	literal,
	rows,
	table,
} from "@ryot/ryotql";
import { Result, Schema } from "effect";

const providerEntityLinkWire = strictStruct({
	externalId: TextFieldValue,
});

const providerEntityLinksResponse = strictStruct({
	data: strictStruct({ links: rowsResultSchema(providerEntityLinkWire) }),
});

export const ProviderEntityLink = strictStruct({
	externalId: Schema.String,
});
export type ProviderEntityLink = typeof ProviderEntityLink.Type;

export const buildProviderEntityLinksDocument = (input: {
	readonly providerId: SandboxProviderId;
	readonly entitySchemaSlug: EntitySchemaSlug;
	readonly externalIds: readonly [string, ...string[]];
}) => {
	const entity = table("entity", "entity");
	const library = table("entity", "library");
	const relationship = table("relationship", "inLibrary");

	return document({
		links: rows(entity, {
			limit: input.externalIds.length,
			orderBy: [ascending(column(entity, "id"))],
			fields: [field("externalId", column(entity, "externalId"))],
			where: and(
				eq(column(entity, "entitySchemaSlug"), literal(input.entitySchemaSlug)),
				eq(column(entity, "providerId"), literal(input.providerId)),
				inArray(
					column(entity, "externalId"),
					input.externalIds.map((externalId) => literal(externalId)),
				),
				exists(relationship, {
					joins: [
						join(
							"inner",
							library,
							eq(column(relationship, "targetEntityId"), column(library, "id")),
						),
					],
					where: and(
						eq(column(relationship, "sourceEntityId"), column(entity, "id")),
						eq(column(relationship, "relationshipSchemaSlug"), literal("in-library")),
						eq(column(library, "entitySchemaSlug"), literal("library")),
					),
				}),
			),
		}),
	});
};

const decodeProviderEntityLinksResult = Schema.decodeUnknownResult(providerEntityLinksResponse);

export const decodeProviderEntityLinksResponse = (response: unknown) =>
	Result.map(decodeProviderEntityLinksResult(response), ({ data }) =>
		data.links.items.map(
			(row) => ({ externalId: row.externalId.value }) satisfies ProviderEntityLink,
		),
	);

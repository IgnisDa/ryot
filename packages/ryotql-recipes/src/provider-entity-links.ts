import { TextFieldValue, rowsResultSchema } from "@ryot/contract/modules/ryotql/language";
import type { SandboxProviderId } from "@ryot/contract/schema/brands";
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
	readonly externalIds: readonly [string, ...string[]];
}) => {
	const entity = table("entity", "entity");

	return document({
		links: rows(entity, {
			limit: input.externalIds.length,
			orderBy: [ascending(column(entity, "id"))],
			fields: [field("externalId", column(entity, "externalId"))],
			where: and(
				eq(column(entity, "providerId"), literal(input.providerId)),
				inArray(
					column(entity, "externalId"),
					input.externalIds.map((externalId) => literal(externalId)),
				),
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

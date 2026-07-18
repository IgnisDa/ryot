import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { Effect } from "@ryot/sandbox-sdk/effect";
import { defineProvider } from "@ryot/sandbox-sdk/provider";

import { asRecord, stringValue } from "../../script-helpers/records";
import {
	escapeGraphqlString,
	firstGraphqlErrorMessage,
	getHardcoverApiKey,
	hardcoverGql,
	idValue,
} from "../hardcover-shared";

export const manifest = defineManifest({
	kind: "provider",
	name: "Hardcover",
	slug: "company.hardcover",
	capabilities: ["httpCall", "getPluginConfig"],
	requiredPluginConfigKeys: ["hardcoverApiKey"],
	requiredSystemConfigKeys: [],
});

export const search = defineProvider({
	manifest,
	operation: "search",
	run: (input, host) =>
		getHardcoverApiKey(host).pipe(
			Effect.flatMap((apiKey) => {
				// Hardcover uses a GraphQL publishers query since there is no search API for publishers.
				const graphqlQuery = `
query {
  publishers(
    limit: ${input.pageSize},
    offset: ${(input.page - 1) * input.pageSize},
    where: { name: { _ilike: "%${escapeGraphqlString(input.query).replace(/%/g, "\\%")}%" } }
  ) {
    id
    name
  }
}
`;
				return hardcoverGql(
					host,
					{ query: graphqlQuery },
					apiKey,
					"Hardcover publisher search request failed",
				).pipe(
					Effect.map((payloadValue) => {
						const payload = asRecord(payloadValue);
						const errorMessage = firstGraphqlErrorMessage(payload);
						if (errorMessage) {
							throw new Error(`Hardcover GraphQL error: ${errorMessage}`);
						}
						const publishers = asRecord(payload?.["data"])?.["publishers"];
						const items = (Array.isArray(publishers) ? publishers : []).flatMap((publisher) => {
							const record = asRecord(publisher);
							const externalId = idValue(record?.["id"]);
							const name = stringValue(record?.["name"]);
							if (!externalId || !name) {
								return [];
							}
							return [
								{
									externalId,
									titleProperty: { kind: "text" as const, value: name },
									imageProperty: { kind: "null" as const, value: null },
									calloutProperty: { kind: "null" as const, value: null },
									primarySubtitleProperty: { kind: "null" as const, value: null },
									secondarySubtitleProperty: { kind: "null" as const, value: null },
								},
							];
						});
						return {
							items,
							details: {
								totalItems: items.length + (input.page - 1) * input.pageSize,
								nextPage: items.length === input.pageSize ? input.page + 1 : null,
							},
						};
					}),
				);
			}),
		),
});

export const details = defineProvider({
	manifest,
	operation: "details",
	run: (input, host) => {
		if (!/^\d+$/.test(input.externalId)) {
			throw new Error("externalId must be a numeric Hardcover publisher id");
		}
		const publisherId = Number(input.externalId);
		if (!Number.isSafeInteger(publisherId)) {
			throw new Error("externalId must be a safe integer Hardcover publisher id");
		}
		const graphqlQuery = `
query GetHardcoverPublisherDetails($id: Int!) {
  publishers_by_pk(id: $id) {
    id
    name
    url
    editions { book { id title } }
  }
}
`;
		return getHardcoverApiKey(host)
			.pipe(
				Effect.flatMap((apiKey) =>
					hardcoverGql(
						host,
						{ query: graphqlQuery, variables: { id: publisherId } },
						apiKey,
						"Hardcover publisher details request failed",
					),
				),
			)
			.pipe(
				Effect.map((payloadValue) => {
					const payload = asRecord(payloadValue);
					const errorMessage = firstGraphqlErrorMessage(payload);
					if (errorMessage) {
						throw new Error(`Hardcover publisher details GraphQL error: ${errorMessage}`);
					}
					const publisherData = asRecord(asRecord(payload?.["data"])?.["publishers_by_pk"]);
					if (!publisherData) {
						throw new Error("Hardcover returned no publisher data");
					}
					const name = stringValue(publisherData["name"]);
					if (!name) {
						throw new Error("Hardcover publisher data is missing name");
					}
					const editions = publisherData["editions"];
					const mediaEntities = (Array.isArray(editions) ? editions : []).flatMap((edition) => {
						const book = asRecord(asRecord(edition)?.["book"]);
						const bookId = idValue(book?.["id"]);
						if (!bookId) {
							return [];
						}
						return [
							{
								externalId: bookId,
								providerSlug: "book.hardcover",
								relationshipProperties: { roles: ["Publisher"] },
								name: stringValue(book?.["title"]) ?? "Loading...",
							},
						];
					});
					return {
						name,
						properties: {
							images: [],
							alternateNames: [],
							website: stringValue(publisherData["url"]),
						},
						relatedEntityGroups: [
							{
								entities: mediaEntities,
								direction: "outgoing" as const,
								synchronization: "authoritative" as const,
								relationshipSchemaSlug: "company-to-book",
							},
						],
					};
				}),
			);
	},
});

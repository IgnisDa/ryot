import { defineManifest } from "@ryot/sandbox-sdk/core";
import { defineProvider, defineProviderDriver } from "@ryot/sandbox-sdk/provider";

import { asRecord, numberValue, stringValue } from "../../script-helpers/records";
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
	slug: "person.hardcover",
	providerInformation: { source: "hardcover" },
	capabilities: ["httpCall", "getAppConfigValue"],
	requiredAppConfigKeys: ["books.hardcoverApiKey"],
});

export const search = defineProviderDriver(manifest, "search", (input, host) =>
	getHardcoverApiKey(host).then((apiKey) => {
		const graphqlQuery = `
query {
  search(
    page: ${input.page},
    per_page: ${input.pageSize},
    query: "${escapeGraphqlString(input.query)}",
    query_type: "author"
  ) {
    results
  }
}
`;
		return hardcoverGql(
			host,
			{ query: graphqlQuery },
			apiKey,
			"Hardcover person search request failed",
		).then((payloadValue) => {
			const payload = asRecord(payloadValue);
			const resultsData = asRecord(asRecord(asRecord(payload?.["data"])?.["search"])?.["results"]);
			if (!resultsData) {
				throw new Error("Hardcover returned invalid response structure");
			}
			const found = numberValue(resultsData["found"]);
			const totalItems = found === null ? 0 : Math.max(0, Math.trunc(found));
			const hits = resultsData["hits"];
			const items = (Array.isArray(hits) ? hits : []).flatMap((hit) => {
				const doc = asRecord(asRecord(hit)?.["document"]);
				const externalId = idValue(doc?.["id"]);
				const name = stringValue(doc?.["name"]);
				if (!doc || !externalId || !name) {
					return [];
				}
				const image = stringValue(asRecord(doc["image"])?.["url"]);
				return [
					{
						externalId,
						titleProperty: { kind: "text" as const, value: name },
						calloutProperty: { kind: "null" as const, value: null },
						primarySubtitleProperty: { kind: "null" as const, value: null },
						secondarySubtitleProperty: { kind: "null" as const, value: null },
						imageProperty: image
							? { kind: "image" as const, value: { type: "remote" as const, url: image } }
							: { kind: "null" as const, value: null },
					},
				];
			});
			return {
				items,
				details: {
					totalItems,
					nextPage: input.page * input.pageSize < totalItems ? input.page + 1 : null,
				},
			};
		});
	}),
);

export const details = defineProviderDriver(manifest, "details", (input, host) => {
	if (!/^\d+$/.test(input.externalId)) {
		throw new Error("externalId must be a numeric Hardcover author id");
	}
	const authorId = Number(input.externalId);
	if (!Number.isSafeInteger(authorId)) {
		throw new Error("externalId must be a safe integer Hardcover author id");
	}
	const graphqlQuery = `
query GetHardcoverAuthorDetails($id: Int!) {
  authors_by_pk(id: $id) {
    id
    bio
    name
    slug
    links
    born_date
    death_date
    image { url }
    alternate_names
    contributions { contribution book { id title } }
  }
}
`;
	return getHardcoverApiKey(host)
		.then((apiKey) =>
			hardcoverGql(
				host,
				{ query: graphqlQuery, variables: { id: authorId } },
				apiKey,
				"Hardcover author details request failed",
			),
		)
		.then((payloadValue) => {
			const payload = asRecord(payloadValue);
			const errorMessage = firstGraphqlErrorMessage(payload);
			if (errorMessage) {
				throw new Error(`Hardcover author details GraphQL error: ${errorMessage}`);
			}
			const authorData = asRecord(asRecord(payload?.["data"])?.["authors_by_pk"]);
			if (!authorData) {
				throw new Error("Hardcover returned no author data");
			}
			const name = stringValue(authorData["name"]);
			if (!name) {
				throw new Error("Hardcover author data is missing name");
			}
			const image = stringValue(asRecord(authorData["image"])?.["url"]);
			const slug = stringValue(authorData["slug"]);
			const links = authorData["links"];
			const website =
				(Array.isArray(links) ? links : [])
					.map((link) => stringValue(asRecord(link)?.["url"]))
					.find((url) => url) ?? null;
			const alternateNamesValue = authorData["alternate_names"];
			const alternateNames = (
				Array.isArray(alternateNamesValue) ? alternateNamesValue : []
			).flatMap((value) => (typeof value === "string" && value.trim() ? [value] : []));
			const contributions = authorData["contributions"];
			const mediaEntities = (Array.isArray(contributions) ? contributions : []).flatMap(
				(contribution) => {
					const contrib = asRecord(contribution);
					const book = asRecord(contrib?.["book"]);
					const bookId = idValue(book?.["id"]);
					if (!bookId) {
						return [];
					}
					return [
						{
							externalId: bookId,
							scriptSlug: "book.hardcover",
							name: stringValue(book?.["title"]) ?? "Loading...",
							relationshipProperties: {
								roles: [stringValue(contrib?.["contribution"]) ?? "Author"],
							},
						},
					];
				},
			);
			return {
				name,
				relatedEntityGroups: [
					{
						entities: mediaEntities,
						direction: "outgoing" as const,
						relationshipSchemaSlug: "person-to-book",
						synchronization: "authoritative" as const,
					},
				],
				properties: {
					website,
					alternateNames,
					sourceUrl: slug ? `https://hardcover.app/authors/${slug}` : null,
					images: image ? [{ type: "remote" as const, url: image }] : [],
					description: typeof authorData["bio"] === "string" ? authorData["bio"] : null,
					birthDate: typeof authorData["born_date"] === "string" ? authorData["born_date"] : null,
					deathDate: typeof authorData["death_date"] === "string" ? authorData["death_date"] : null,
				},
			};
		});
});

export default defineProvider({ manifest, drivers: { search, details } });

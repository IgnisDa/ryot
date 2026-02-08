import { defineManifest } from "@ryot/sandbox-sdk/core";
import { defineProvider, defineProviderDriver } from "@ryot/sandbox-sdk/provider";

import {
	type UnknownRecord,
	asRecord,
	numberValue,
	stringValue,
} from "../../../script-helpers/records";
import {
	createRoleAccumulator,
	type RoleRelatedEntity,
} from "../../../script-helpers/role-accumulator";
import { toTitleCase } from "../../../script-helpers/title-case";
import {
	escapeGraphqlString,
	firstGraphqlErrorMessage,
	getHardcoverApiKey,
	hardcoverGql,
	idValue,
} from "../../hardcover-shared";

export const manifest = defineManifest({
	kind: "provider",
	name: "Hardcover",
	slug: "book.hardcover",
	providerInformation: { source: "hardcover" },
	capabilities: ["httpCall", "getAppConfigValue"],
	requiredAppConfigKeys: ["books.hardcoverApiKey"],
});

const collectImages = (imageField: unknown, imagesArray: unknown) => {
	const imageSet = new Set<string>();
	const primary = stringValue(asRecord(imageField)?.["url"]);
	if (primary) {
		imageSet.add(primary);
	}
	if (Array.isArray(imagesArray)) {
		for (const image of imagesArray) {
			const url = stringValue(asRecord(image)?.["url"]);
			if (url) {
				imageSet.add(url);
			}
		}
	}
	return [...imageSet];
};

const collectGenres = (cachedTags: unknown) => {
	const record = asRecord(cachedTags);
	const genreArray = record?.["Genre"];
	if (!Array.isArray(genreArray)) {
		return [];
	}
	const genreSet = new Set<string>();
	for (const genreItem of genreArray) {
		const tag = asRecord(genreItem)?.["tag"];
		if (typeof tag !== "string") {
			continue;
		}
		const titleTag = toTitleCase(tag.trim());
		if (titleTag) {
			genreSet.add(titleTag);
		}
	}
	return [...genreSet];
};

const collectPeople = (contributions: unknown): RoleRelatedEntity[] => {
	if (!Array.isArray(contributions)) {
		return [];
	}
	const accumulator = createRoleAccumulator();
	for (const contribution of contributions) {
		const contrib = asRecord(contribution);
		if (!contrib) {
			continue;
		}
		const personIdentifier = idValue(contrib["author_id"]);
		if (!personIdentifier) {
			continue;
		}
		const role = stringValue(contrib["contribution"]) ?? "Author";
		accumulator.add({
			externalId: personIdentifier,
			scriptSlug: "person.hardcover",
			relationshipProperties: { roles: [role] },
			name: stringValue(asRecord(contrib["author"])?.["name"]) ?? "Loading...",
		});
	}
	return accumulator.entities;
};

export const search = defineProviderDriver(manifest, "search", (input, host) =>
	getHardcoverApiKey(host).then((apiKey) => {
		const graphqlQuery = `
query {
  search(
    page: ${input.page},
    per_page: ${input.pageSize},
    query: "${escapeGraphqlString(input.query)}",
    query_type: "book"
  ) {
    results
  }
}
`;
		return hardcoverGql(
			host,
			{ query: graphqlQuery },
			apiKey,
			"Hardcover search request failed",
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
				const title = stringValue(doc?.["title"]);
				if (!doc || !externalId || !title) {
					return [];
				}
				const releaseYear = numberValue(doc["release_year"]);
				const image = stringValue(asRecord(doc["image"])?.["url"]);
				return [
					{
						externalId,
						titleProperty: { kind: "text" as const, value: title },
						calloutProperty: { kind: "null" as const, value: null },
						secondarySubtitleProperty: { kind: "null" as const, value: null },
						imageProperty: image
							? { kind: "image" as const, value: { type: "remote" as const, url: image } }
							: { kind: "null" as const, value: null },
						primarySubtitleProperty:
							releaseYear === null
								? { kind: "null" as const, value: null }
								: { kind: "number" as const, value: releaseYear },
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

const collectBookGroupsAndPublishers = (
	accumulator: ReturnType<typeof createRoleAccumulator>,
	bookSeries: unknown,
) => {
	if (!Array.isArray(bookSeries)) {
		return;
	}
	for (const entry of bookSeries) {
		const record = asRecord(entry);
		const seriesRecord = asRecord(record?.["series"]);
		if (seriesRecord) {
			const seriesId = idValue(seriesRecord["id"]);
			if (seriesId) {
				accumulator.add({
					externalId: seriesId,
					scriptSlug: "book-group.hardcover",
					relationshipProperties: { roles: ["Member"] },
					name: stringValue(seriesRecord["name"]) ?? "Loading...",
				});
			}
		}
		const publisherRecord = asRecord(record?.["publisher"]);
		const publisherId = idValue(publisherRecord?.["id"]);
		if (!publisherRecord || !publisherId) {
			continue;
		}
		accumulator.add({
			externalId: publisherId,
			scriptSlug: "company.hardcover",
			relationshipProperties: { roles: ["Publisher"] },
			name: stringValue(publisherRecord["name"]) ?? "Loading...",
		});
	}
};

export const details = defineProviderDriver(manifest, "details", (input, host) => {
	if (!/^\d+$/.test(input.externalId)) {
		throw new Error("externalId must be a numeric Hardcover book id");
	}
	const bookId = Number(input.externalId);
	if (!Number.isSafeInteger(bookId)) {
		throw new Error("externalId must be a safe integer Hardcover book id");
	}
	const graphqlQuery = `
query GetHardcoverBookDetails($id: Int!) {
  books_by_pk(id: $id) {
    id
    slug
    pages
    title
    description
    release_date
    release_year
    image { url }
    images { url }
    cached_tags
    contributions {
      contribution
      author_id
      author { name }
    }
    book_series {
      series {
        id
        name
      }
      publisher {
        id
        name
      }
    }
  }
}
`;
	return getHardcoverApiKey(host)
		.then((apiKey) =>
			hardcoverGql(
				host,
				{ query: graphqlQuery, variables: { id: bookId } },
				apiKey,
				"Hardcover details request failed",
			),
		)
		.then((payloadValue) => {
			const payload = asRecord(payloadValue);
			const errorMessage = firstGraphqlErrorMessage(payload);
			if (errorMessage) {
				throw new Error(`Hardcover details GraphQL error: ${errorMessage}`);
			}
			const bookData = asRecord(asRecord(payload?.["data"])?.["books_by_pk"]);
			if (!bookData) {
				throw new Error("Hardcover returned no book data");
			}
			const title = typeof bookData["title"] === "string" ? bookData["title"] : "";
			if (!title) {
				throw new Error("Hardcover book data is missing title");
			}
			const externalId =
				typeof bookData["id"] === "string" && bookData["id"].trim()
					? bookData["id"]
					: input.externalId;
			const pages = numberValue(bookData["pages"]);
			const releaseYear = numberValue(bookData["release_year"]);
			const slug = stringValue(bookData["slug"]);
			const sourceUrl = slug
				? `https://hardcover.app/books/${slug}`
				: `https://hardcover.app/books/${externalId}`;

			const accumulator = createRoleAccumulator(collectPeople(bookData["contributions"]));
			collectBookGroupsAndPublishers(accumulator, bookData["book_series"]);

			return {
				name: title,
				relatedEntityGroups: [
					{
						direction: "incoming" as const,
						synchronization: "additive" as const,
						relationshipSchemaSlug: "person-to-book",
						entities: accumulator.entities.filter(
							(entity) => entity.scriptSlug === "person.hardcover",
						),
					},
					{
						direction: "incoming" as const,
						synchronization: "additive" as const,
						relationshipSchemaSlug: "company-to-book",
						entities: accumulator.entities.filter(
							(entity) => entity.scriptSlug === "company.hardcover",
						),
					},
					{
						direction: "incoming" as const,
						synchronization: "additive" as const,
						relationshipSchemaSlug: "book-group-to-book",
						entities: accumulator.entities.filter(
							(entity) => entity.scriptSlug === "book-group.hardcover",
						),
					},
				],
				properties: {
					pages: pages === null ? null : Math.max(0, Math.trunc(pages)),
					sourceUrl,
					unlinkedCreators: [],
					publishYear: releaseYear,
					genres: collectGenres(bookData["cached_tags"]),
					publishDate: stringValue(bookData["release_date"]),
					description: typeof bookData["description"] === "string" ? bookData["description"] : null,
					images: collectImages(bookData["image"], bookData["images"]).map((url) => ({
						url,
						type: "remote" as const,
					})),
				},
			};
		});
});

const resolveIsbnBookId = (payload: UnknownRecord | null) => {
	const editions = asRecord(payload?.["data"])?.["editions"];
	const firstEdition = asRecord(Array.isArray(editions) ? editions[0] : undefined);
	return idValue(firstEdition?.["book_id"]);
};

export const resolve = defineProviderDriver(manifest, "resolve", (input, host) => {
	if (input.identifierType !== "isbn") {
		throw new Error("Hardcover resolve supports only isbn identifiers");
	}
	const isbnQueries = [
		"query ResolveHardcoverBookByIsbn10($isbn: String!) { editions(where: { isbn_10: { _eq: $isbn } }) { book_id } }",
		"query ResolveHardcoverBookByIsbn13($isbn: String!) { editions(where: { isbn_13: { _eq: $isbn } }) { book_id } }",
	];
	const lookup = (apiKey: string, index: number): Promise<{ externalId: string | null }> => {
		const query = isbnQueries[index];
		if (query === undefined) {
			return Promise.resolve({ externalId: null });
		}
		return hardcoverGql(
			host,
			{ query, variables: { isbn: input.value } },
			apiKey,
			"Hardcover ISBN lookup failed",
		).then((payloadValue) => {
			const bookId = resolveIsbnBookId(asRecord(payloadValue));
			return bookId ? { externalId: bookId } : lookup(apiKey, index + 1);
		});
	};
	return getHardcoverApiKey(host).then((apiKey) => lookup(apiKey, 0));
});

export default defineProvider({ manifest, drivers: { search, details, resolve } });

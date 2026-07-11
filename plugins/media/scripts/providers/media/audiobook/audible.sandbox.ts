import { defineManifest } from "@ryot/sandbox-sdk/core";
import { Effect } from "@ryot/sandbox-sdk/effect";
import { defineProvider, defineProviderDriver } from "@ryot/sandbox-sdk/provider";

import { cleanHtmlDescription } from "../../../script-helpers/clean-html-description";
import { asRecord, numberValue, stringValue, trimmedString } from "../../../script-helpers/records";
import { createRoleAccumulator } from "../../../script-helpers/role-accumulator";
import { toTitleCase } from "../../../script-helpers/title-case";
import {
	audibleFetchJson,
	type AudibleHost,
	parseReleaseDate,
	parseReleaseYear,
} from "../../audible-shared";

export const manifest = defineManifest({
	kind: "provider",
	name: "Audible",
	slug: "audiobook.audible",
	capabilities: ["httpCall"],
	requiredAppConfigKeys: [],
	providerInformation: { source: "audible" },
});

const CATALOG_URL = "https://api.audible.com/1.0/catalog/products";

const SIMILARITY_TYPES = [
	"InTheSameSeries",
	"RawSimilarities",
	"ByTheSameAuthor",
	"NextInSameSeries",
	"ByTheSameNarrator",
];

const productImageUrl = (product: Record<string, unknown>, order: readonly string[]) => {
	const images = asRecord(product["product_images"]);
	for (const size of order) {
		const url = stringValue(images?.[size]);
		if (url) {
			return url;
		}
	}
	return null;
};

const fetchSuggestions = (host: AudibleHost, externalId: string) => {
	const suggestionByKey = new Map<
		string,
		{ name: string; externalId: string; scriptSlug: string }
	>();
	const fetchType = (index: number): Effect.Effect<void, unknown> => {
		const similarityType = SIMILARITY_TYPES[index];
		if (similarityType === undefined) {
			return Effect.void;
		}
		const params = new URLSearchParams({
			response_groups: "media",
			similarity_type: similarityType,
		});
		return audibleFetchJson(
			host,
			`${CATALOG_URL}/${externalId}/sims?${params.toString()}`,
			`Audible ${similarityType} suggestions request failed`,
			"Audible",
		).pipe(
			Effect.flatMap((payloadValue) => {
				const products = asRecord(payloadValue)?.["similar_products"];
				for (const product of Array.isArray(products) ? products : []) {
					const record = asRecord(product);
					const relatedExternalId = stringValue(record?.["asin"]);
					const name = stringValue(record?.["title"]);
					if (!relatedExternalId || !name) {
						continue;
					}
					suggestionByKey.set(`audiobook.audible:${relatedExternalId}`, {
						name,
						externalId: relatedExternalId,
						scriptSlug: "audiobook.audible",
					});
				}
				return fetchType(index + 1);
			}),
		);
	};
	return fetchType(0).pipe(Effect.map(() => [...suggestionByKey.values()]));
};

export const search = defineProviderDriver(manifest, "search", (input, host) => {
	const params = new URLSearchParams({
		title: input.query,
		products_sort_by: "Relevance",
		num_results: String(input.pageSize),
		page: String(input.page - 1),
		response_groups: "media,product_attrs",
	});
	return audibleFetchJson(
		host,
		`${CATALOG_URL}?${params.toString()}`,
		"Audible search request failed",
		"Audible",
	).pipe(
		Effect.map((payloadValue) => {
			const payload = asRecord(payloadValue);
			const totalItems = numberValue(payload?.["total_results"]) ?? 0;
			const products = payload?.["products"];
			const items = (Array.isArray(products) ? products : []).flatMap((product) => {
				const record = asRecord(product);
				const externalId = trimmedString(record?.["asin"]);
				const title = stringValue(record?.["title"]);
				if (!record || !externalId || !title) {
					return [];
				}
				const publishYear = parseReleaseYear(record["release_date"]);
				const imageUrl = productImageUrl(record, ["500", "2400"]);
				return [
					{
						externalId,
						titleProperty: { kind: "text" as const, value: title },
						calloutProperty: { kind: "null" as const, value: null },
						secondarySubtitleProperty: { kind: "null" as const, value: null },
						imageProperty: imageUrl
							? { kind: "image" as const, value: { type: "remote" as const, url: imageUrl } }
							: { kind: "null" as const, value: null },
						primarySubtitleProperty:
							publishYear === null
								? { kind: "null" as const, value: null }
								: { kind: "number" as const, value: publishYear },
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
		}),
	);
});

const collectGenres = (categoryLadders: unknown) => {
	const genreSet = new Set<string>();
	for (const ladder of Array.isArray(categoryLadders) ? categoryLadders : []) {
		const steps = asRecord(ladder)?.["ladder"];
		for (const step of Array.isArray(steps) ? steps : []) {
			const name = trimmedString(asRecord(step)?.["name"]);
			for (const part of name.split(" & ")) {
				const genre = toTitleCase(part.trim());
				if (genre) {
					genreSet.add(genre);
				}
			}
		}
	}
	return [...genreSet];
};

const collectContributors = (
	accumulator: ReturnType<typeof createRoleAccumulator>,
	unlinkedCreators: Array<{ role: string; name: string }>,
	contributors: unknown,
	role: string,
) => {
	for (const contributor of Array.isArray(contributors) ? contributors : []) {
		const record = asRecord(contributor);
		if (!record) {
			continue;
		}
		const relatedName = trimmedString(record["name"]);
		const asin = trimmedString(record["asin"]);
		if (asin) {
			accumulator.add({
				name: relatedName,
				externalId: asin,
				scriptSlug: "person.audible",
				relationshipProperties: { roles: [role] },
			});
		} else {
			unlinkedCreators.push({ role, name: relatedName });
		}
	}
};

const providerRatingValue = (rating: Record<string, unknown> | null) => {
	const numReviews = numberValue(rating?.["num_reviews"]) ?? 0;
	if (numReviews <= 0) {
		return null;
	}
	const average = asRecord(rating?.["overall_distribution"])?.["display_average_rating"];
	if (average == null) {
		return null;
	}
	const parsed = Number(average);
	return Number.isFinite(parsed) ? parsed : null;
};

export const details = defineProviderDriver(manifest, "details", (input, host) => {
	const params = new URLSearchParams({
		image_sizes: "2400",
		response_groups:
			"contributors,category_ladders,media,product_attrs,product_extended_attrs,series,rating",
	});
	return Effect.gen(function* () {
		const [payloadValue, suggestions] = yield* Effect.all(
			[
				audibleFetchJson(
					host,
					`${CATALOG_URL}/${input.externalId}?${params.toString()}`,
					"Audible details request failed",
					"Audible",
				),
				fetchSuggestions(host, input.externalId),
			],
			{ concurrency: "unbounded" },
		);
		const product = asRecord(asRecord(payloadValue)?.["product"]);
		if (!product) {
			return yield* Effect.fail(new Error("Audible returned no product data"));
		}
		const title = stringValue(product["title"]);
		if (!title) {
			return yield* Effect.fail(new Error("Audible product is missing title"));
		}

		const imageUrl = productImageUrl(product, ["2400", "500"]);
		const runtime = numberValue(product["runtime_length_min"]);
		const rating = asRecord(product["rating"]);
		const rawIsNsfw = product["is_adult_product"];

		const accumulator = createRoleAccumulator();
		const unlinkedCreators: Array<{ role: string; name: string }> = [];
		collectContributors(accumulator, unlinkedCreators, product["authors"], "Author");
		collectContributors(accumulator, unlinkedCreators, product["narrators"], "Narrator");

		for (const series of Array.isArray(product["series"]) ? product["series"] : []) {
			const record = asRecord(series);
			const seriesExternalId = stringValue(record?.["asin"]);
			if (!seriesExternalId) {
				continue;
			}
			accumulator.add({
				externalId: seriesExternalId,
				scriptSlug: "audiobook-group.audible",
				relationshipProperties: { roles: ["Member"] },
				name: stringValue(record?.["title"]) ?? "Loading...",
			});
		}

		return {
			name: title,
			relatedEntityGroups: [
				{
					direction: "incoming" as const,
					synchronization: "authoritative" as const,
					relationshipSchemaSlug: "person-to-audiobook",
					entities: accumulator.entities.filter((entity) => entity.scriptSlug === "person.audible"),
				},
				{
					direction: "incoming" as const,
					synchronization: "additive" as const,
					relationshipSchemaSlug: "audiobook-group-to-audiobook",
					entities: accumulator.entities.filter(
						(entity) => entity.scriptSlug === "audiobook-group.audible",
					),
				},
				{
					entities: suggestions,
					direction: "outgoing" as const,
					synchronization: "authoritative" as const,
					relationshipSchemaSlug: "media-suggestion",
				},
			],
			properties: {
				runtime: runtime === null ? null : Math.trunc(runtime),
				unlinkedCreators,
				genres: collectGenres(product["category_ladders"]),
				providerRating: providerRatingValue(rating),
				publishYear: parseReleaseYear(product["release_date"]),
				publishDate: parseReleaseDate(product["release_date"]),
				sourceUrl: `https://www.audible.com/pd/${input.externalId}`,
				isNsfw: typeof rawIsNsfw === "boolean" ? rawIsNsfw : null,
				images: imageUrl ? [{ type: "remote" as const, url: imageUrl }] : [],
				description: cleanHtmlDescription(
					product["publisher_summary"] ?? product["merchandising_summary"] ?? null,
				),
			},
		};
	});
});

export default defineProvider({ manifest, drivers: { search, details } });

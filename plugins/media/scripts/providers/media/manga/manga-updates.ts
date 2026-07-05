import { load } from "@ryot/sandbox-sdk/cheerio";
import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { DateTime, Effect, Option } from "@ryot/sandbox-sdk/effect";
import { defineProvider } from "@ryot/sandbox-sdk/provider";

import {
	type UnknownRecord,
	asRecord,
	numberValue,
	recordsValue,
	stringValue,
} from "../../../script-helpers/records";
import {
	imageUrlValue,
	mangaUpdatesGet,
	mangaUpdatesGetOptional,
	mangaUpdatesPost,
	searchTotalItems,
	type MangaUpdatesHost,
} from "../../manga-updates-shared";

export const manifest = defineManifest({
	kind: "provider",
	name: "MangaUpdates",
	requiredAppConfigKeys: [],
	capabilities: ["httpCall"],
	slug: "manga.manga-updates",
});

const parsePublishYear = (value: unknown) => {
	const trimmed = stringValue(value);
	if (!trimmed) {
		return null;
	}
	const parsed = DateTime.make(trimmed);
	if (Option.isNone(parsed)) {
		return null;
	}
	return DateTime.toDateUtc(parsed.value).getFullYear();
};

export const search = defineProvider({
	manifest,
	operation: "search",
	run: (input, host) =>
		mangaUpdatesPost(
			host,
			"/series/search",
			{ search: input.query, perpage: input.pageSize, page: input.page },
			"search",
		).pipe(
			Effect.map((payloadValue) => {
				const payload = asRecord(payloadValue);
				const totalItems = searchTotalItems(payload);
				const results = payload?.["results"];
				const items = (Array.isArray(results) ? results : []).flatMap((item) => {
					const itemRecord = asRecord(item);
					const record = asRecord(itemRecord?.["record"]);
					if (!record) {
						return [];
					}
					const idValue = numberValue(record["series_id"]);
					const seriesId = idValue === null ? null : Math.trunc(idValue);
					if (seriesId === null || seriesId <= 0) {
						return [];
					}
					const title = stringValue(itemRecord?.["hit_title"]);
					if (!title) {
						return [];
					}
					const image = imageUrlValue(record["image"]);
					const publishYear = parsePublishYear(record["year"]);
					return [
						{
							externalId: String(seriesId),
							titleProperty: { kind: "text" as const, value: title },
							calloutProperty: { kind: "null" as const, value: null },
							secondarySubtitleProperty: { kind: "null" as const, value: null },
							primarySubtitleProperty:
								publishYear === null
									? { kind: "null" as const, value: null }
									: { kind: "number" as const, value: publishYear },
							imageProperty:
								image === null
									? { kind: "null" as const, value: null }
									: { kind: "image" as const, value: { type: "remote" as const, url: image } },
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
		),
});

const extractStatus = (input: unknown) => {
	if (typeof input !== "string") {
		return { volumes: null, productionStatus: null };
	}
	const $ = load(`<span>${input}</span>`);
	$("br").replaceWith("\n");
	const fullText = $("span").text().trim();
	const firstLine = (fullText.split("\n")[0] ?? "").trim();
	if (!firstLine) {
		return { volumes: null, productionStatus: null };
	}
	const parts = firstLine.split(/\s+/).filter(Boolean);
	const firstToken = parts[0];
	const statusToken = parts[2];
	const parsedVolumes = Number(firstToken);
	const volumes = Number.isFinite(parsedVolumes) ? Math.max(0, Math.trunc(parsedVolumes)) : null;
	const productionStatus =
		statusToken?.startsWith("(") && statusToken.endsWith(")") && statusToken.length > 2
			? statusToken.slice(1, -1)
			: null;
	return { volumes, productionStatus };
};

const collectGenres = (genres: unknown, categories: unknown) => {
	const genreSet = new Set<string>();
	for (const genreEntry of recordsValue(genres)) {
		const genre = stringValue(genreEntry["genre"]);
		if (genre) {
			genreSet.add(genre);
		}
	}
	for (const categoryEntry of recordsValue(categories)) {
		const category = stringValue(categoryEntry["category"]);
		if (category) {
			genreSet.add(category);
		}
	}
	return [...genreSet];
};

const collectImages = (image: unknown) => {
	const url = imageUrlValue(image);
	return url ? [{ type: "remote" as const, url }] : [];
};

const collectSuggestions = (host: MangaUpdatesHost, payload: UnknownRecord | null) => {
	const sourceIdValue = numberValue(payload?.["series_id"]);
	const sourceId = sourceIdValue === null ? null : Math.trunc(sourceIdValue);
	const seriesIds = new Set<number>();
	const addCandidate = (value: unknown) => {
		const idValue = numberValue(value);
		const seriesId = idValue === null ? null : Math.trunc(idValue);
		if (seriesId !== null && seriesId > 0 && seriesId !== sourceId) {
			seriesIds.add(seriesId);
		}
	};
	for (const recommendation of recordsValue(payload?.["recommendations"])) {
		addCandidate(recommendation["series_id"]);
	}
	for (const relatedSeries of recordsValue(payload?.["related_series"])) {
		addCandidate(relatedSeries["related_series_id"]);
	}
	return Effect.all(
		[...seriesIds].map((seriesId) =>
			mangaUpdatesGetOptional(host, `/series/${encodeURIComponent(String(seriesId))}`),
		),
	).pipe(
		Effect.map((responses) =>
			responses.flatMap((value) => {
				const record = asRecord(value);
				const idValue = numberValue(record?.["series_id"]);
				const name = stringValue(record?.["title"]);
				if (idValue === null || !name) {
					return [];
				}
				return [
					{ name, externalId: String(Math.trunc(idValue)), providerSlug: "manga.manga-updates" },
				];
			}),
		),
	);
};

export const details = defineProvider({
	manifest,
	operation: "details",
	run: (input, host) =>
		Effect.gen(function* () {
			const payloadValue = yield* mangaUpdatesGet(
				host,
				`/series/${encodeURIComponent(input.externalId)}`,
				"details",
			);
			const payload = asRecord(payloadValue);
			const title = typeof payload?.["title"] === "string" ? payload["title"] : "";
			if (!title) {
				return yield* Effect.fail({ message: "MangaUpdates payload is missing title" });
			}
			const { volumes, productionStatus } = extractStatus(payload?.["status"]);
			const url = payload?.["url"];
			const description = payload?.["description"];
			const suggestions = yield* collectSuggestions(host, payload);
			return {
				name: title,
				relatedEntityGroups: [
					{
						entities: suggestions,
						direction: "outgoing" as const,
						synchronization: "authoritative" as const,
						relationshipSchemaSlug: "media-suggestion",
					},
				],
				properties: {
					volumes,
					productionStatus,
					sourceUrl: typeof url === "string" ? url : null,
					images: collectImages(payload?.["image"]),
					publishYear: parsePublishYear(payload?.["year"]),
					chapters: numberValue(payload?.["latest_chapter"]),
					providerRating: numberValue(payload?.["bayesian_rating"]),
					description: typeof description === "string" ? description : null,
					genres: collectGenres(payload?.["genres"], payload?.["categories"]),
				},
			};
		}),
});

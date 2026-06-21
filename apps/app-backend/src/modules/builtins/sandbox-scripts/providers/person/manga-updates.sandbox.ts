import { defineManifest } from "@ryot/sandbox-sdk";
import { defineProvider, defineProviderDriver } from "@ryot/sandbox-sdk/provider";

import {
	asRecord,
	imageUrlValue,
	mangaUpdatesGet,
	mangaUpdatesPost,
	numberValue,
	searchTotalItems,
	stringValue,
} from "../manga-updates-shared";

export const manifest = defineManifest({
	kind: "provider",
	name: "MangaUpdates",
	requiredAppConfigKeys: [],
	capabilities: ["httpCall"],
	slug: "person.manga-updates",
	providerInformation: { source: "manga-updates" },
});

export const search = defineProviderDriver(manifest, "search", (input, host) =>
	mangaUpdatesPost(
		host,
		"/authors/search",
		{ search: input.query, page: input.page, perpage: input.pageSize },
		"person search",
	).then((payloadValue) => {
		const payload = asRecord(payloadValue);
		const totalItems = searchTotalItems(payload);
		const results = payload?.["results"];
		const items = (Array.isArray(results) ? results : []).flatMap((item) => {
			const itemRecord = asRecord(item);
			const record = asRecord(itemRecord?.["record"]);
			if (!record) {
				return [];
			}
			const idValue = numberValue(record["id"]);
			if (idValue === null) {
				return [];
			}
			const name = stringValue(itemRecord?.["hit_name"]);
			if (!name) {
				return [];
			}
			return [
				{
					externalId: String(Math.trunc(idValue)),
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
				totalItems,
				nextPage: input.page * input.pageSize < totalItems ? input.page + 1 : null,
			},
		};
	}),
);

const formatBirthday = (birthday: unknown) => {
	const record = asRecord(birthday);
	if (!record) {
		return null;
	}
	const dayValue = numberValue(record["day"]);
	const yearValue = numberValue(record["year"]);
	const monthValue = numberValue(record["month"]);
	if (yearValue === null || monthValue === null || dayValue === null) {
		return null;
	}
	const day = Math.trunc(dayValue);
	const year = Math.trunc(yearValue);
	const month = Math.trunc(monthValue);
	if (year <= 0 || month < 1 || month > 12 || day < 1 || day > 31) {
		return null;
	}
	return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
};

export const details = defineProviderDriver(manifest, "details", (input, host) =>
	mangaUpdatesGet(host, `/authors/${encodeURIComponent(input.externalId)}`, "person details").then(
		(payloadValue) => {
			const payload = asRecord(payloadValue);
			if (!payload) {
				throw new Error("MangaUpdates returned no person data");
			}
			const name = stringValue(payload["name"]);
			if (!name) {
				throw new Error("MangaUpdates person data is missing name");
			}
			const image = imageUrlValue(payload["image"]);
			return mangaUpdatesPost(
				host,
				`/authors/${encodeURIComponent(input.externalId)}/series`,
				{ orderby: "year" },
				"person series",
			).then((seriesPayloadValue) => {
				const seriesPayload = asRecord(seriesPayloadValue);
				const seriesList = seriesPayload?.["series_list"];
				const mediaEntities = (Array.isArray(seriesList) ? seriesList : []).flatMap((series) => {
					const record = asRecord(series);
					const idValue = numberValue(record?.["series_id"]);
					if (idValue === null) {
						return [];
					}
					return [
						{
							scriptSlug: "manga.manga-updates",
							relationshipProperties: { roles: ["Author"] },
							externalId: String(Math.trunc(idValue)),
							name: stringValue(record?.["title"]) ?? "Loading...",
						},
					];
				});
				return {
					name,
					relatedEntityGroups: [
						{
							entities: mediaEntities,
							direction: "outgoing" as const,
							synchronization: "authoritative" as const,
							relationshipSchemaSlug: "person-to-manga",
						},
					],
					properties: {
						description: null,
						alternateNames: [],
						gender: stringValue(payload["gender"]),
						birthPlace: stringValue(payload["birthplace"]),
						birthDate: formatBirthday(payload["birthday"]),
						images: image ? [{ type: "remote" as const, url: image }] : [],
						sourceUrl: `https://www.mangaupdates.com/authors/${encodeURIComponent(input.externalId)}`,
					},
				};
			});
		},
	),
);

export default defineProvider({ manifest, drivers: { search, details } });

import { defineManifest } from "@ryot/sandbox-sdk";
import { defineProvider, defineProviderDriver } from "@ryot/sandbox-sdk/provider";

import { getUserIsNsfw } from "../../script-helpers/host";
import {
	type UnknownRecord,
	asRecord,
	numberValue,
	recordsValue,
	stringValue,
} from "../../script-helpers/records";
import type { RoleRelatedEntity } from "../../script-helpers/role-accumulator";
import {
	firstTranslationValue,
	getImageUrl,
	getLocalizedImageUrl,
	getTmdbAccessToken,
	orderedTranslationCandidates,
	parseTranslationLanguage,
	tmdbGet,
} from "../tmdb-shared";

export const manifest = defineManifest({
	name: "TMDB",
	kind: "provider",
	slug: "person.tmdb",
	requiredAppConfigKeys: ["moviesAndShows.tmdbAccessToken"],
	providerInformation: { source: "tmdb", canonicalLanguage: "en" },
	capabilities: ["httpCall", "getAppConfigValue", "getUserPreferences"],
});

export const search = defineProviderDriver(manifest, "search", (input, host) =>
	getTmdbAccessToken(host)
		.then((token) =>
			getUserIsNsfw(host).then((showNsfw) =>
				tmdbGet(
					host,
					"/search/person",
					{
						language: "en-US",
						query: input.query,
						page: String(input.page),
						include_adult: showNsfw ? "true" : "false",
					},
					token,
				),
			),
		)
		.then((data) => {
			const results = recordsValue(data["results"]);
			const totalItems = numberValue(data["total_results"]) ?? results.length;
			const totalPages = numberValue(data["total_pages"]) ?? 1;
			const items = results
				.flatMap((person) => {
					const id = numberValue(person["id"]);
					const name = stringValue(person["name"]);
					if (id === null || !name) {
						return [];
					}
					const image = getImageUrl(person["profile_path"]);
					return [
						{
							externalId: String(Math.trunc(id)),
							titleProperty: { kind: "text" as const, value: name },
							calloutProperty: { kind: "null" as const, value: null },
							primarySubtitleProperty: { kind: "null" as const, value: null },
							secondarySubtitleProperty: { kind: "null" as const, value: null },
							imageProperty: image
								? { kind: "image" as const, value: { type: "remote" as const, url: image } }
								: { kind: "null" as const, value: null },
						},
					];
				})
				.slice(0, input.pageSize);
			return {
				items,
				details: { totalItems, nextPage: input.page < totalPages ? input.page + 1 : null },
			};
		}),
);

const collectCredits = (combinedCredits: UnknownRecord) => {
	const relatedEntities = new Map<string, RoleRelatedEntity>();
	const addMedia = (media: UnknownRecord, fallbackRole: string) => {
		const id = numberValue(media["id"]);
		const mediaType = stringValue(media["media_type"]);
		let scriptSlug: string | null = null;
		if (mediaType === "movie") {
			scriptSlug = "movie.tmdb";
		} else if (mediaType === "tv") {
			scriptSlug = "show.tmdb";
		}
		if (id === null || !scriptSlug) {
			return;
		}
		const externalId = String(Math.trunc(id));
		const role = stringValue(media["job"]) ?? fallbackRole;
		const key = `${scriptSlug}:${externalId}`;
		const existing = relatedEntities.get(key);
		if (existing) {
			existing.relationshipProperties.roles = [
				...new Set([...existing.relationshipProperties.roles, role]),
			];
			return;
		}
		relatedEntities.set(key, {
			externalId,
			scriptSlug,
			name: stringValue(media["title"]) ?? stringValue(media["name"]) ?? "Loading...",
			relationshipProperties: { roles: [role] },
		});
	};

	for (const media of recordsValue(combinedCredits["cast"])) {
		addMedia(media, "Actor");
	}
	for (const media of recordsValue(combinedCredits["crew"])) {
		addMedia(media, "Production");
	}
	return [...relatedEntities.values()];
};

export const details = defineProviderDriver(manifest, "details", (input, host) => {
	if (!/^\d+$/.test(input.externalId)) {
		throw new Error("externalId must be a numeric TMDB person ID");
	}
	return getTmdbAccessToken(host)
		.then((token) =>
			Promise.all([
				tmdbGet(
					host,
					`/person/${input.externalId}`,
					{
						append_to_response: "images",
						language: manifest.providerInformation.canonicalLanguage,
					},
					token,
				),
				tmdbGet(
					host,
					`/person/${input.externalId}/combined_credits`,
					{ language: manifest.providerInformation.canonicalLanguage },
					token,
				),
			]),
		)
		.then(([personData, combinedCredits]) => {
			const name = stringValue(personData["name"]);
			if (!name) {
				throw new Error("TMDB returned no name for this person");
			}
			const imageUrls = new Set<string>();
			const mainProfile = getImageUrl(personData["profile_path"]);
			if (mainProfile) {
				imageUrls.add(mainProfile);
			}
			const images = asRecord(personData["images"]);
			for (const profile of recordsValue(images?.["profiles"])) {
				const url = getImageUrl(profile["file_path"]);
				if (url) {
					imageUrls.add(url);
				}
			}
			const genderValue = numberValue(personData["gender"]);
			const genders: Readonly<Record<number, string>> = {
				1: "Female",
				2: "Male",
				3: "Non-Binary",
			};
			const gender = genderValue === null ? null : (genders[Math.trunc(genderValue)] ?? null);
			const alternateNames = Array.isArray(personData["also_known_as"])
				? personData["also_known_as"].filter(
						(value): value is string => typeof value === "string" && Boolean(value.trim()),
					)
				: [];
			const relatedEntities = collectCredits(combinedCredits);
			return {
				name,
				relatedEntityGroups: [
					{
						direction: "outgoing" as const,
						synchronization: "authoritative" as const,
						relationshipSchemaSlug: "person-to-movie",
						entities: relatedEntities.filter(({ scriptSlug }) => scriptSlug === "movie.tmdb"),
					},
					{
						direction: "outgoing" as const,
						synchronization: "authoritative" as const,
						relationshipSchemaSlug: "person-to-show",
						entities: relatedEntities.filter(({ scriptSlug }) => scriptSlug === "show.tmdb"),
					},
				],
				properties: {
					gender,
					alternateNames,
					website: stringValue(personData["homepage"]),
					birthDate: stringValue(personData["birthday"]),
					deathDate: stringValue(personData["deathday"]),
					description: stringValue(personData["biography"]),
					birthPlace: stringValue(personData["place_of_birth"]),
					sourceUrl: `https://www.themoviedb.org/person/${input.externalId}`,
					images: [...imageUrls].map((url) => ({ type: "remote" as const, url })),
				},
			};
		});
});

const translate = defineProviderDriver(manifest, "translate", (input, host) => {
	if (!/^\d+$/.test(input.externalId)) {
		throw new Error("externalId must be a numeric TMDB person ID");
	}
	const { langCode, region } = parseTranslationLanguage(input.language);
	return getTmdbAccessToken(host)
		.then((token) =>
			Promise.all([
				tmdbGet(host, `/person/${input.externalId}/translations`, {}, token),
				tmdbGet(host, `/person/${input.externalId}/images`, {}, token).catch(() => ({})),
			]),
		)
		.then(([translationsData, imagesData]) => {
			const candidates = orderedTranslationCandidates(translationsData, langCode, region);
			const name = firstTranslationValue(candidates, (data) => data["name"]);
			const description = firstTranslationValue(candidates, (data) => data["biography"]);
			const imageUrl = getLocalizedImageUrl(imagesData, "profiles", langCode);
			const properties: Record<string, string | Array<{ type: "remote"; url: string }>> = {};
			if (description) {
				properties["description"] = description;
			}
			if (imageUrl) {
				properties["images"] = [{ type: "remote", url: imageUrl }];
			}
			return {
				...(name ? { name } : {}),
				...(Object.keys(properties).length > 0 ? { properties } : {}),
			};
		});
});

export default defineProvider({ manifest, drivers: { search, details, translate } });

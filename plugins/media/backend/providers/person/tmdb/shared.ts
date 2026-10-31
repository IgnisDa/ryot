import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { defineProvider } from "@ryot-app/plugin-backend-sdk/provider";
import { asRecord } from "@ryot-app/plugin-backend-sdk/wire";

import { getUserAllowNsfw } from "../../../lib/host";
import { normalizePlainDescription } from "../../../lib/plain-description";
import { numberValue, recordsValue, stringValue, type UnknownRecord } from "../../../lib/records";
import { createRoleAccumulator } from "../../../lib/role-accumulator";
import {
	firstTranslationValue,
	getImageUrl,
	getLocalizedImageUrl,
	getTmdbAccessToken,
	orderedTranslationCandidates,
	parseTranslationLanguage,
	tmdbGet,
} from "../../../lib/vendors/tmdb";

export const manifest = defineManifest({ name: "TMDB", kind: "provider", slug: "person.tmdb" });

export const search = defineProvider({
	manifest,
	operation: "search",
	run: (input, host) =>
		getTmdbAccessToken(host).pipe(
			Effect.flatMap((token) =>
				getUserAllowNsfw(host).pipe(
					Effect.flatMap((allowNsfw) =>
						tmdbGet(
							host,
							"/search/person",
							{
								language: "en-US",
								query: input.query,
								page: String(input.page),
								include_adult: allowNsfw ? "true" : "false",
							},
							token,
						),
					),
				),
			),
			Effect.map((data) => {
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
								title: name,
								externalId: String(Math.trunc(id)),
								...(image === null ? {} : { imageUrl: image }),
							},
						];
					})
					.slice(0, input.pageSize);
				return {
					items,
					details: { totalItems, nextPage: input.page < totalPages ? input.page + 1 : null },
				};
			}),
		),
});

const collectCredits = (combinedCredits: UnknownRecord) => {
	const related = createRoleAccumulator();
	const addMedia = (
		media: UnknownRecord,
		fallbackRole: string,
		character: null | string = null,
	) => {
		const id = numberValue(media["id"]);
		const mediaType = stringValue(media["media_type"]);
		let providerSlug: null | string = null;
		if (mediaType === "movie") {
			providerSlug = "movie.tmdb";
		} else if (mediaType === "tv") {
			providerSlug = "show.tmdb";
		}
		if (id === null || !providerSlug) {
			return;
		}
		const externalId = String(Math.trunc(id));
		const role = stringValue(media["job"]) ?? fallbackRole;
		related.add({
			externalId,
			providerSlug,
			name: stringValue(media["title"]) ?? stringValue(media["name"]) ?? "Loading...",
			relationshipProperties: { roles: [role], ...(character === null ? {} : { character }) },
		});
	};

	for (const media of recordsValue(combinedCredits["cast"])) {
		addMedia(media, "Actor", stringValue(media["character"]));
	}
	for (const media of recordsValue(combinedCredits["crew"])) {
		addMedia(media, "Production");
	}
	return related.entities;
};

export const details = defineProvider({
	manifest,
	operation: "details",
	run: (input, host) => {
		if (!/^\d+$/.test(input.externalId)) {
			throw new Error("externalId must be a numeric TMDB person ID");
		}
		return getTmdbAccessToken(host).pipe(
			Effect.flatMap((token) =>
				Effect.all(
					[
						tmdbGet(
							host,
							`/person/${input.externalId}`,
							{ language: "en", append_to_response: "images" },
							token,
						),
						tmdbGet(
							host,
							`/person/${input.externalId}/combined_credits`,
							{ language: "en" },
							token,
						),
					],
					{ concurrency: "unbounded" },
				),
			),
			Effect.map(([personData, combinedCredits]) => {
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
					2: "Male",
					1: "Female",
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
							entities: relatedEntities.filter(({ providerSlug }) => providerSlug === "movie.tmdb"),
						},
						{
							direction: "outgoing" as const,
							relationshipSchemaSlug: "person-to-show",
							synchronization: "authoritative" as const,
							entities: relatedEntities.filter(({ providerSlug }) => providerSlug === "show.tmdb"),
						},
					],
					properties: {
						gender,
						alternateNames,
						website: stringValue(personData["homepage"]),
						birthDate: stringValue(personData["birthday"]),
						deathDate: stringValue(personData["deathday"]),
						birthPlace: stringValue(personData["place_of_birth"]),
						description: normalizePlainDescription(personData["biography"]),
						sourceUrl: `https://www.themoviedb.org/person/${input.externalId}`,
						images: [...imageUrls].map((url) => ({
							url,
							type: "remote" as const,
							purpose: "profile" as const,
						})),
					},
				};
			}),
		);
	},
});

export const translate = defineProvider({
	manifest,
	operation: "translate",
	run: (input, host) => {
		if (!/^\d+$/.test(input.externalId)) {
			throw new Error("externalId must be a numeric TMDB person ID");
		}
		const { region, langCode } = parseTranslationLanguage(input.language);
		return getTmdbAccessToken(host).pipe(
			Effect.flatMap((token) =>
				Effect.all(
					[
						tmdbGet(host, `/person/${input.externalId}/translations`, {}, token),
						tmdbGet(host, `/person/${input.externalId}/images`, {}, token).pipe(
							Effect.orElseSucceed(() => ({})),
						),
					],
					{ concurrency: "unbounded" },
				),
			),
			Effect.map(([translationsData, imagesData]) => {
				const candidates = orderedTranslationCandidates(translationsData, langCode, region);
				const name = firstTranslationValue(candidates, (data) => data["name"]);
				const description = normalizePlainDescription(
					firstTranslationValue(candidates, (data) => data["biography"]),
				);
				const imageUrl = getLocalizedImageUrl(imagesData, "profiles", langCode);
				const properties: Record<
					string,
					string | Array<{ url: string; type: "remote"; purpose: "profile" }>
				> = {};
				if (description) {
					properties["description"] = description;
				}
				if (imageUrl) {
					properties["images"] = [{ url: imageUrl, type: "remote", purpose: "profile" }];
				}
				const result: { name?: string; properties?: typeof properties } = {};
				if (name) {
					result.name = name;
				}
				if (Object.keys(properties).length > 0) {
					result.properties = properties;
				}
				return result;
			}),
		);
	},
});

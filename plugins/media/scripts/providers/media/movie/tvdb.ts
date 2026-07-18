import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { Effect } from "@ryot/sandbox-sdk/effect";
import { defineProvider } from "@ryot/sandbox-sdk/provider";

import { parsePublishYear } from "../../../script-helpers/parse-publish-year";
import { asRecord, numberValue, recordsValue, stringValue } from "../../../script-helpers/records";
import {
	bcp47ToTvdb,
	buildTranslationResult,
	collectCompanies,
	collectGenres,
	collectImages,
	collectPeople,
	getLocalizedArtwork,
	getTranslationFields,
	searchTvdb,
	tvdbGet,
	tvdbGetOptional,
} from "../../tvdb-shared";

export const manifest = defineManifest({
	name: "TVDB",
	kind: "provider",
	slug: "movie.tvdb",
	requiredPluginConfigKeys: ["tvdbApiKey"],
	requiredSystemConfigKeys: [],
	capabilities: ["httpCall", "getCachedValue", "setCachedValue", "getPluginConfig"],
});

export const search = defineProvider({
	manifest,
	operation: "search",
	run: (input, host) => searchTvdb(host, input, { type: "movie", nameKeys: ["name", "title"] }),
});

export const details = defineProvider({
	manifest,
	operation: "details",
	run: (input, host) => {
		if (!/^\d+$/.test(input.externalId)) {
			return Effect.fail(new Error("externalId must be a numeric TVDB movie ID"));
		}
		const language = bcp47ToTvdb("en");
		return Effect.gen(function* () {
			const [data, translationData] = yield* Effect.all([
				tvdbGet(host, `/movies/${input.externalId}/extended`),
				tvdbGetOptional(host, `/movies/${input.externalId}/translations/${language}`),
			]);
			const movie = asRecord(data["data"]);
			if (!movie) {
				return yield* Effect.fail(new Error("TVDB returned no data for this movie"));
			}

			const translation = getTranslationFields(translationData);
			const fallbackTitle = stringValue(movie["name"]) ?? stringValue(movie["title"]);
			const title = translation.name ?? fallbackTitle;
			if (!title) {
				return yield* Effect.fail(new Error("TVDB returned no title for this movie"));
			}

			const images = collectImages([movie["image"], movie["image_url"]], movie["artworks"]);
			const genres = collectGenres(movie["genres"]);
			const firstAired = stringValue(movie["firstAired"]);
			const publishYear = parsePublishYear(movie["year"]) ?? parsePublishYear(firstAired);
			const averageRuntime = numberValue(movie["averageRuntime"]);
			const runtime =
				averageRuntime !== null && averageRuntime > 0 ? Math.trunc(averageRuntime) : null;
			const slug = stringValue(movie["slug"]);
			const sourceUrl = slug ? `https://thetvdb.com/movies/${slug}` : null;

			const groupRelatedEntities = recordsValue(movie["lists"])
				.filter((list) => list["is_official"] === true || list["isOfficial"] === true)
				.flatMap((list) => {
					const idNumber = numberValue(list["id"]);
					const groupExternalId =
						idNumber !== null ? String(Math.trunc(idNumber)) : stringValue(list["id"]);
					if (!groupExternalId) {
						return [];
					}
					return [
						{
							externalId: groupExternalId,
							providerSlug: "movie-group.tvdb",
							name: stringValue(list["name"]) ?? "Loading...",
							relationshipProperties: { roles: ["Member"] },
						},
					];
				});

			const people = collectPeople(movie["characters"]);
			const relatedEntities = people.relatedEntities.map((entity) => ({
				name: entity.name,
				externalId: entity.externalId,
				providerSlug: entity.providerSlug,
				relationshipProperties: entity.relationshipProperties,
			}));
			const unlinkedCreators = people.unlinkedCreators;
			const companies = collectCompanies(movie["companies"]).map((entity) => ({
				name: entity.name,
				externalId: entity.externalId,
				providerSlug: entity.providerSlug,
				relationshipProperties: entity.relationshipProperties,
			}));

			return {
				name: title,
				relatedEntityGroups: [
					{
						direction: "incoming",
						synchronization: "additive",
						entities: relatedEntities,
						relationshipSchemaSlug: "person-to-movie",
					},
					{
						direction: "incoming",
						synchronization: "additive",
						entities: companies,
						relationshipSchemaSlug: "company-to-movie",
					},
					{
						direction: "incoming",
						synchronization: "additive",
						entities: groupRelatedEntities,
						relationshipSchemaSlug: "movie-group-to-movie",
					},
				],
				properties: {
					images,
					genres,
					runtime,
					sourceUrl,
					publishYear,
					unlinkedCreators,
					description: translation.description ?? stringValue(movie["overview"]),
				},
			};
		});
	},
});

export const translate = defineProvider({
	manifest,
	operation: "translate",
	run: (input, host) => {
		if (!/^\d+$/.test(input.externalId)) {
			return Effect.fail(new Error("externalId must be a numeric TVDB movie ID"));
		}
		const providerLanguage = bcp47ToTvdb(input.language);
		return Effect.all([
			tvdbGetOptional(host, `/movies/${input.externalId}/translations/${providerLanguage}`),
			tvdbGet(host, `/movies/${input.externalId}/extended`).pipe(
				Effect.catch(() => Effect.succeed(null)),
			),
		]).pipe(
			Effect.map(([translationData, detailsData]) => {
				const image = getLocalizedArtwork(
					detailsData ? asRecord(detailsData["data"])?.["artworks"] : null,
					providerLanguage,
				);
				return buildTranslationResult(translationData, image);
			}),
		);
	},
});

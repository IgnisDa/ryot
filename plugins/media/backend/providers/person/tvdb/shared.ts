import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { defineProvider } from "@ryot-app/plugin-backend-sdk/provider";
import { asRecord } from "@ryot-app/plugin-backend-sdk/wire";

import { normalizePlainDescription } from "../../../lib/plain-description";
import { numberValue, recordsValue, stringValue } from "../../../lib/records";
import { createRoleAccumulator } from "../../../lib/role-accumulator";
import {
	bcp47ToTvdb,
	buildTranslationResult,
	getTranslationFields,
	searchTvdb,
	tvdbGet,
	tvdbGetOptional,
} from "../../../lib/vendors/tvdb";

export const manifest = defineManifest({ name: "TVDB", kind: "provider", slug: "person.tvdb" });

export const search = defineProvider({
	manifest,
	operation: "search",
	run: (input, host) => searchTvdb(host, input, { type: "person", nameKeys: ["name"] }),
});

const toExternalId = (value: unknown) => {
	const parsed = numberValue(value);
	return parsed !== null ? String(Math.trunc(parsed)) : stringValue(value);
};

const TVDB_GENDER_MAP: Readonly<Record<number, string>> = { 1: "Male", 3: "Other", 2: "Female" };

export const details = defineProvider({
	manifest,
	operation: "details",
	run: (input, host) => {
		if (!/^\d+$/.test(input.externalId)) {
			throw new Error("externalId must be a numeric TVDB person ID");
		}
		const language = bcp47ToTvdb("en");
		return Effect.all(
			[
				tvdbGet(host, `/people/${input.externalId}/extended`),
				tvdbGetOptional(host, `/people/${input.externalId}/translations/${language}`),
			],
			{ concurrency: "unbounded" },
		).pipe(
			Effect.map(([data, translationData]) => {
				const person = asRecord(data["data"]);
				if (!person) {
					throw new Error("TVDB returned no data for this person");
				}
				const translation = getTranslationFields(translationData);
				const name = translation.name ?? stringValue(person["name"]);
				if (!name) {
					throw new Error("TVDB returned no name for this person");
				}
				const image = stringValue(person["image"]);
				const rawGender = person["gender"];
				const gender = typeof rawGender === "number" ? (TVDB_GENDER_MAP[rawGender] ?? null) : null;
				const biographies = person["biographies"];
				const firstBiography = Array.isArray(biographies)
					? stringValue(asRecord(biographies[0])?.["biography"])
					: null;
				const description = normalizePlainDescription(translation.description ?? firstBiography);
				const slug = stringValue(person["slug"]);
				const movies = createRoleAccumulator();
				const shows = createRoleAccumulator();
				for (const character of recordsValue(person["characters"])) {
					const role =
						stringValue(character["peopleType"]) ??
						stringValue(character["people_type"]) ??
						"Actor";
					const characterName = stringValue(character["name"]);
					const movieExternalId = toExternalId(character["movieId"] ?? character["movie_id"]);
					if (movieExternalId !== null) {
						const movieName = stringValue(asRecord(character["movie"])?.["name"]) ?? "Loading...";
						movies.add({
							name: movieName,
							providerSlug: "movie.tvdb",
							externalId: movieExternalId,
							relationshipProperties: {
								roles: [role],
								...(characterName === null ? {} : { character: characterName }),
							},
						});
					}
					const seriesExternalId = toExternalId(character["seriesId"] ?? character["series_id"]);
					if (seriesExternalId !== null) {
						const showName = stringValue(asRecord(character["series"])?.["name"]) ?? "Loading...";
						shows.add({
							name: showName,
							providerSlug: "show.tvdb",
							externalId: seriesExternalId,
							relationshipProperties: {
								roles: [role],
								...(characterName === null ? {} : { character: characterName }),
							},
						});
					}
				}
				return {
					name,
					relatedEntityGroups: [
						{
							entities: movies.entities,
							direction: "outgoing" as const,
							synchronization: "authoritative" as const,
							relationshipSchemaSlug: "person-to-movie",
						},
						{
							entities: shows.entities,
							direction: "outgoing" as const,
							relationshipSchemaSlug: "person-to-show",
							synchronization: "authoritative" as const,
						},
					],
					properties: {
						gender,
						description,
						alternateNames: [],
						birthDate: stringValue(person["birth"]),
						deathDate: stringValue(person["death"]),
						birthPlace: stringValue(person["birthPlace"]),
						images: image
							? [{ url: image, type: "remote" as const, purpose: "profile" as const }]
							: [],
						sourceUrl: slug
							? `https://www.thetvdb.com/people/${slug}`
							: `https://www.thetvdb.com/people/${input.externalId}`,
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
			throw new Error("externalId must be a numeric TVDB person ID");
		}
		const providerLanguage = bcp47ToTvdb(input.language);
		return tvdbGetOptional(
			host,
			`/people/${input.externalId}/translations/${providerLanguage}`,
		).pipe(
			Effect.map((translationData) => {
				const result = buildTranslationResult(translationData, null);
				const description = normalizePlainDescription(result.properties?.["description"]);
				if (!description) {
					return result;
				}
				const properties = { description };
				return result.name === undefined ? { properties } : { properties, name: result.name };
			}),
		);
	},
});

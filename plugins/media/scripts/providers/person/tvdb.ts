import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { Effect } from "@ryot/sandbox-sdk/effect";
import { defineProvider } from "@ryot/sandbox-sdk/provider";

import { asRecord, numberValue, recordsValue, stringValue } from "../../script-helpers/records";
import type { RoleRelatedEntity } from "../../script-helpers/role-accumulator";
import {
	bcp47ToTvdb,
	buildTranslationResult,
	getTranslationFields,
	searchTvdb,
	tvdbGet,
	tvdbGetOptional,
} from "../tvdb-shared";

export const manifest = defineManifest({
	name: "TVDB",
	kind: "provider",
	slug: "person.tvdb",
	requiredAppConfigKeys: ["moviesAndShows.tvdbApiKey"],
	capabilities: ["httpCall", "getCachedValue", "setCachedValue", "getAppConfigValue"],
});

export const search = defineProvider({
	manifest,
	operation: "search",
	run: (input, host) => searchTvdb(host, input, { type: "person", nameKeys: ["name"] }),
});

const toExternalId = (value: unknown) => {
	const parsed = numberValue(value);
	return parsed !== null ? String(Math.trunc(parsed)) : stringValue(value);
};

const addMedia = (entities: Map<string, RoleRelatedEntity>, entity: RoleRelatedEntity) => {
	const existing = entities.get(entity.externalId);
	if (!existing) {
		entities.set(entity.externalId, entity);
		return;
	}
	const [role] = entity.relationshipProperties.roles;
	if (role !== undefined && !existing.relationshipProperties.roles.includes(role)) {
		existing.relationshipProperties.roles.push(role);
	}
};

const TVDB_GENDER_MAP: Readonly<Record<number, string>> = { 1: "Male", 2: "Female", 3: "Other" };

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
				const description = translation.description ?? firstBiography;
				const slug = stringValue(person["slug"]);
				const movieById = new Map<string, RoleRelatedEntity>();
				const showById = new Map<string, RoleRelatedEntity>();
				for (const character of recordsValue(person["characters"])) {
					const role =
						stringValue(character["peopleType"]) ??
						stringValue(character["people_type"]) ??
						"Actor";
					const movieExternalId = toExternalId(character["movieId"] ?? character["movie_id"]);
					if (movieExternalId !== null) {
						const movieName = stringValue(asRecord(character["movie"])?.["name"]) ?? "Loading...";
						addMedia(movieById, {
							name: movieName,
							providerSlug: "movie.tvdb",
							externalId: movieExternalId,
							relationshipProperties: { roles: [role] },
						});
					}
					const seriesExternalId = toExternalId(character["seriesId"] ?? character["series_id"]);
					if (seriesExternalId !== null) {
						const showName = stringValue(asRecord(character["series"])?.["name"]) ?? "Loading...";
						addMedia(showById, {
							name: showName,
							providerSlug: "show.tvdb",
							externalId: seriesExternalId,
							relationshipProperties: { roles: [role] },
						});
					}
				}
				return {
					name,
					relatedEntityGroups: [
						{
							direction: "outgoing" as const,
							synchronization: "authoritative" as const,
							entities: [...movieById.values()],
							relationshipSchemaSlug: "person-to-movie",
						},
						{
							direction: "outgoing" as const,
							synchronization: "authoritative" as const,
							entities: [...showById.values()],
							relationshipSchemaSlug: "person-to-show",
						},
					],
					properties: {
						gender,
						description,
						alternateNames: [],
						images: image ? [{ type: "remote" as const, url: image }] : [],
						birthDate: stringValue(person["birth"]),
						deathDate: stringValue(person["death"]),
						sourceUrl: slug
							? `https://www.thetvdb.com/people/${slug}`
							: `https://www.thetvdb.com/people/${input.externalId}`,
						birthPlace: stringValue(person["birthPlace"]),
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
		).pipe(Effect.map((translationData) => buildTranslationResult(translationData, null)));
	},
});

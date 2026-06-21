import type {
	ProviderDetailsInput,
	ProviderDetailsRelatedEntity,
	ProviderDetailsResult,
} from "@ryot/sandbox-sdk/provider";

import {
	asRecord,
	collectGenres,
	collectImages,
	collectSuggestions,
	numberValue,
	parsePublishYear,
	recordsValue,
	stringValue,
	tmdbGet,
	type TmdbHost,
	type UnknownRecord,
} from "../../tmdb-shared";

type RelatedEntityWithRoles = Omit<ProviderDetailsRelatedEntity, "relationshipProperties"> & {
	relationshipProperties: { roles: string[] };
};

const collectCompanies = (productionCompanies: unknown) => {
	const companies = new Map<string, RelatedEntityWithRoles>();
	for (const company of recordsValue(productionCompanies)) {
		const idValue = numberValue(company["id"]);
		if (idValue === null) {
			continue;
		}
		const id = Math.trunc(idValue);
		const key = `company.tmdb:${id}`;
		const name = stringValue(company["name"]) ?? "Loading...";
		const existing = companies.get(key);
		if (existing) {
			existing.relationshipProperties.roles = [
				...new Set([...existing.relationshipProperties.roles, "Production Company"]),
			];
			if (existing.name === "Loading..." && name !== "Loading...") {
				existing.name = name;
			}
			continue;
		}
		companies.set(key, {
			name,
			scriptSlug: "company.tmdb",
			externalId: String(id),
			relationshipProperties: { roles: ["Production Company"] },
		});
	}
	return [...companies.values()];
};

const collectPeople = (cast: unknown, crew: unknown) => {
	const relatedEntities = new Map<string, RelatedEntityWithRoles>();
	const unlinkedCreators: Array<{ name: string; role: string }> = [];
	const unlinkedKeys = new Set<string>();
	const addRelatedEntity = (relatedEntity: RelatedEntityWithRoles) => {
		const key = `${relatedEntity.scriptSlug}:${relatedEntity.externalId}`;
		const existing = relatedEntities.get(key);
		if (!existing) {
			relatedEntities.set(key, relatedEntity);
			return;
		}
		existing.relationshipProperties.roles = [
			...new Set([
				...existing.relationshipProperties.roles,
				...relatedEntity.relationshipProperties.roles,
			]),
		];
		if (existing.name === "Loading..." && relatedEntity.name !== "Loading...") {
			existing.name = relatedEntity.name;
		}
	};
	const addUnlinkedCreator = (name: string, role: string) => {
		const key = `${name}:${role}`;
		if (!unlinkedKeys.has(key)) {
			unlinkedKeys.add(key);
			unlinkedCreators.push({ name, role });
		}
	};
	const addPerson = (person: UnknownRecord, role: string) => {
		const name = stringValue(person["name"]) ?? "Loading...";
		const id = numberValue(person["id"]);
		if (id === null) {
			addUnlinkedCreator(name, role);
			return;
		}
		addRelatedEntity({
			name,
			scriptSlug: "person.tmdb",
			relationshipProperties: { roles: [role] },
			externalId: String(Math.trunc(id)),
		});
	};

	for (const member of recordsValue(cast).slice(0, 15)) {
		addPerson(member, stringValue(member["known_for_department"]) ?? "Acting");
	}
	const notableJobs = new Set(["Director", "Producer", "Screenplay", "Writer", "Story"]);
	for (const member of recordsValue(crew)) {
		const job = stringValue(member["job"]);
		if (job && notableJobs.has(job)) {
			addPerson(member, job);
		}
	}
	return { relatedEntities: [...relatedEntities.values()], unlinkedCreators };
};

const buildDetailsResult = (
	input: ProviderDetailsInput,
	movieData: UnknownRecord,
	creditsData: UnknownRecord,
	imagesData: UnknownRecord,
	recommendationsData: UnknownRecord,
): ProviderDetailsResult => {
	const title = stringValue(movieData["title"]);
	if (!title) {
		throw new Error("TMDB returned no title for this movie");
	}
	const runtimeValue = numberValue(movieData["runtime"]);
	const runtime = runtimeValue !== null && runtimeValue > 0 ? Math.trunc(runtimeValue) : null;
	const voteAverage = numberValue(movieData["vote_average"]);
	const providerRating = voteAverage !== null && voteAverage > 0 ? voteAverage * 10 : null;
	const collection = asRecord(movieData["belongs_to_collection"]);
	const collectionIdValue = numberValue(collection?.["id"]);
	const collectionId = collectionIdValue === null ? null : String(Math.trunc(collectionIdValue));
	const groups = collectionId
		? [
				{
					externalId: collectionId,
					scriptSlug: "movie-group.tmdb",
					relationshipProperties: { roles: ["Member"] },
					name: stringValue(collection?.["name"]) ?? "Loading...",
				},
			]
		: [];
	const { relatedEntities: people, unlinkedCreators } = collectPeople(
		creditsData["cast"],
		creditsData["crew"],
	);
	return {
		name: title,
		relatedEntityGroups: [
			{
				entities: people,
				direction: "incoming",
				synchronization: "additive",
				relationshipSchemaSlug: "person-to-movie",
			},
			{
				direction: "incoming",
				synchronization: "additive",
				relationshipSchemaSlug: "company-to-movie",
				entities: collectCompanies(movieData["production_companies"]),
			},
			{
				entities: groups,
				direction: "incoming",
				synchronization: "additive",
				relationshipSchemaSlug: "movie-group-to-movie",
			},
			{
				direction: "outgoing",
				synchronization: "authoritative",
				relationshipSchemaSlug: "media-suggestion",
				entities: collectSuggestions(recommendationsData["results"], {
					scriptSlug: "movie.tmdb",
					nameKeys: ["title", "original_title"],
				}),
			},
		],
		properties: {
			runtime,
			providerRating,
			unlinkedCreators,
			isNsfw: movieData["adult"] === true ? true : null,
			genres: collectGenres(movieData["genres"]),
			description: stringValue(movieData["overview"]),
			productionStatus: stringValue(movieData["status"]),
			publishYear: parsePublishYear(movieData["release_date"]),
			sourceUrl: `https://www.themoviedb.org/movie/${input.externalId}`,
			images: collectImages(
				movieData["poster_path"],
				movieData["backdrop_path"],
				imagesData["posters"],
				imagesData["backdrops"],
			),
		},
	};
};

export const getTmdbMovieDetails = (
	input: ProviderDetailsInput,
	host: TmdbHost,
	language: string,
	token: string,
) => {
	if (!/^\d+$/.test(input.externalId)) {
		return Promise.reject(new Error("externalId must be a numeric TMDB movie ID"));
	}
	return Promise.all([
		tmdbGet(host, `/movie/${input.externalId}`, { language }, token),
		tmdbGet(host, `/movie/${input.externalId}/credits`, { language }, token),
		tmdbGet(host, `/movie/${input.externalId}/images`, {}, token),
		tmdbGet(host, `/movie/${input.externalId}/recommendations`, { language }, token),
	]).then(([movieData, creditsData, imagesData, recommendationsData]) =>
		buildDetailsResult(input, movieData, creditsData, imagesData, recommendationsData),
	);
};

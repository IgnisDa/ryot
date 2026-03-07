import type {
	ProviderDetailsChildEntity,
	ProviderDetailsInput,
	ProviderDetailsRelatedEntity,
	ProviderDetailsResult,
} from "@ryot/sandbox-sdk/provider";

import {
	collectGenres,
	collectImages,
	collectSuggestions,
	getImageUrl,
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

const collectCompanies = (networks: unknown, productionCompanies: unknown) => {
	const companies = new Map<string, RelatedEntityWithRoles>();
	const addCompany = (company: UnknownRecord, role: string) => {
		const idValue = numberValue(company["id"]);
		if (idValue === null) {
			return;
		}
		const id = Math.trunc(idValue);
		const name = stringValue(company["name"]) ?? "Loading...";
		const key = `company.tmdb:${id}`;
		const existing = companies.get(key);
		if (existing) {
			existing.relationshipProperties.roles = [
				...new Set([...existing.relationshipProperties.roles, role]),
			];
			if (existing.name === "Loading..." && name !== "Loading...") {
				existing.name = name;
			}
			return;
		}
		companies.set(key, {
			name,
			scriptSlug: "company.tmdb",
			externalId: String(id),
			relationshipProperties: { roles: [role] },
		});
	};

	for (const network of recordsValue(networks)) {
		addCompany(network, "Network");
	}
	for (const company of recordsValue(productionCompanies)) {
		addCompany(company, "Production Company");
	}
	return [...companies.values()];
};

const collectPeople = (cast: unknown, crew: unknown, createdBy: unknown) => {
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

	for (const creator of recordsValue(createdBy)) {
		addPerson(creator, "Creator");
	}
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

const buildSeason = (
	parentShowExternalId: string,
	seasonData: UnknownRecord,
): ProviderDetailsChildEntity | null => {
	const idValue = numberValue(seasonData["id"]);
	if (idValue === null || idValue <= 0) {
		return null;
	}
	const seasonNumberValue = numberValue(seasonData["season_number"]);
	const seasonNumber = seasonNumberValue === null ? 0 : Math.trunc(seasonNumberValue);
	const posterUrl = getImageUrl(seasonData["poster_path"]);
	const childEntities = recordsValue(seasonData["episodes"]).flatMap((episode) => {
		const episodeId = numberValue(episode["id"]);
		if (episodeId === null || episodeId <= 0) {
			return [];
		}
		const episodeNumberValue = numberValue(episode["episode_number"]);
		const episodeNumber = episodeNumberValue === null ? 0 : Math.trunc(episodeNumberValue);
		const runtimeValue = numberValue(episode["runtime"]);
		const runtime = runtimeValue !== null && runtimeValue > 0 ? Math.trunc(runtimeValue) : null;
		const imageUrl = getImageUrl(episode["still_path"]);
		return [
			{
				entitySchemaSlug: "show-episode",
				externalId: String(Math.trunc(episodeId)),
				name: stringValue(episode["name"]) ?? `Episode ${episodeNumber}`,
				properties: {
					runtime,
					seasonNumber,
					episodeNumber,
					parentShowExternalId,
					description: stringValue(episode["overview"]),
					publishDate: stringValue(episode["air_date"]),
					...(imageUrl ? { images: [{ type: "remote" as const, url: imageUrl }] } : {}),
				},
			},
		];
	});
	return {
		childEntities,
		entitySchemaSlug: "show-season",
		externalId: String(Math.trunc(idValue)),
		name: stringValue(seasonData["name"]) ?? `Season ${seasonNumber}`,
		properties: {
			seasonNumber,
			parentShowExternalId,
			description: stringValue(seasonData["overview"]),
			releaseDate: stringValue(seasonData["air_date"]),
			...(posterUrl ? { images: [{ type: "remote" as const, url: posterUrl }] } : {}),
		},
	};
};

const buildDetailsResult = (
	input: ProviderDetailsInput,
	showData: UnknownRecord,
	imagesData: UnknownRecord,
	creditsData: UnknownRecord,
	recommendationsData: UnknownRecord,
	seasonDataList: readonly UnknownRecord[],
): ProviderDetailsResult => {
	const title = stringValue(showData["name"]);
	if (!title) {
		throw new Error("TMDB returned no name for this show");
	}
	const childEntities = seasonDataList.flatMap((season) => {
		const child = buildSeason(input.externalId, season);
		return child ? [child] : [];
	});
	const totalEpisodes = childEntities.reduce(
		(count, season) => count + (season.childEntities?.length ?? 0),
		0,
	);
	const voteAverage = numberValue(showData["vote_average"]);
	const providerRating = voteAverage !== null && voteAverage > 0 ? voteAverage * 10 : null;
	const { relatedEntities: people, unlinkedCreators } = collectPeople(
		creditsData["cast"],
		creditsData["crew"],
		showData["created_by"],
	);
	return {
		name: title,
		childEntities,
		relatedEntityGroups: [
			{
				entities: people,
				direction: "incoming",
				synchronization: "additive",
				relationshipSchemaSlug: "person-to-show",
			},
			{
				direction: "incoming",
				synchronization: "additive",
				relationshipSchemaSlug: "company-to-show",
				entities: collectCompanies(showData["networks"], showData["production_companies"]),
			},
			{
				direction: "outgoing",
				synchronization: "authoritative",
				relationshipSchemaSlug: "media-suggestion",
				entities: collectSuggestions(recommendationsData["results"], {
					scriptSlug: "show.tmdb",
					nameKeys: ["name", "original_name"],
				}),
			},
		],
		properties: {
			providerRating,
			totalEpisodes,
			unlinkedCreators,
			totalSeasons: childEntities.length,
			isNsfw: showData["adult"] === true ? true : null,
			genres: collectGenres(showData["genres"]),
			description: stringValue(showData["overview"]),
			productionStatus: stringValue(showData["status"]),
			sourceUrl: `https://www.themoviedb.org/tv/${input.externalId}`,
			publishYear: parsePublishYear(showData["first_air_date"]),
			images: collectImages(
				showData["poster_path"],
				showData["backdrop_path"],
				imagesData["posters"],
				imagesData["backdrops"],
			),
		},
	};
};

export const getTmdbShowDetails = (
	input: ProviderDetailsInput,
	host: TmdbHost,
	language: string,
	token: string,
): Promise<ProviderDetailsResult> => {
	if (!/^\d+$/.test(input.externalId)) {
		return Promise.reject(new Error("externalId must be a numeric TMDB show ID"));
	}
	return Promise.all([
		tmdbGet(host, `/tv/${input.externalId}`, { language }, token),
		tmdbGet(host, `/tv/${input.externalId}/images`, {}, token),
		tmdbGet(host, `/tv/${input.externalId}/credits`, { language }, token),
		tmdbGet(host, `/tv/${input.externalId}/recommendations`, { language }, token),
	]).then(([showData, imagesData, creditsData, recommendationsData]) => {
		const seasonNumbers = recordsValue(showData["seasons"]).flatMap((season) => {
			const value = numberValue(season["season_number"]);
			return value === null ? [] : [Math.trunc(value)];
		});
		const batches = Array.from({ length: Math.ceil(seasonNumbers.length / 5) }, (_, index) =>
			seasonNumbers.slice(index * 5, index * 5 + 5),
		);
		return batches
			.reduce<Promise<UnknownRecord[]>>(
				(seasons, batch) =>
					seasons.then((loaded) =>
						Promise.all(
							batch.map((number) =>
								tmdbGet(host, `/tv/${input.externalId}/season/${number}`, { language }, token),
							),
						).then((results) => [...loaded, ...results]),
					),
				Promise.resolve([]),
			)
			.then((seasonDataList) =>
				buildDetailsResult(
					input,
					showData,
					imagesData,
					creditsData,
					recommendationsData,
					seasonDataList,
				),
			);
	});
};

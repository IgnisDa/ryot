function parseJsonResponse(responseBody) {
	try {
		return JSON.parse(responseBody);
	} catch {
		throw new Error("TMDB returned invalid JSON");
	}
}

const TMDB_BASE_URL = "https://api.themoviedb.org/3";
const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/original";

async function getUserIsNsfw() {
	const preferencesResult = await getUserPreferences();
	if (!preferencesResult?.success) {
		return false;
	}
	return preferencesResult?.data?.isNsfw === true;
}

async function getTmdbAccessToken() {
	const resp = await getAppConfigValue("providers.tmdbAccessToken");
	if (!resp?.success) {
		throw new Error(resp?.error ?? "Failed to retrieve TMDB access token");
	}

	const token = typeof resp.data === "string" ? resp.data.trim() : null;
	if (!token) {
		throw new Error(
			"TMDB access token is not configured. Set MOVIES_AND_SHOWS_TMDB_ACCESS_TOKEN in your environment.",
		);
	}

	return token;
}

function getImageUrl(path) {
	if (typeof path !== "string" || !path.trim()) {
		return null;
	}
	return `${TMDB_IMAGE_BASE}${path.trim()}`;
}

function parsePublishYear(dateStr, dayjs) {
	if (typeof dateStr !== "string" || !dateStr.trim()) {
		return null;
	}
	const d = dayjs(dateStr.trim());
	return d.isValid() && d.year() > 0 ? d.year() : null;
}

async function tmdbGet(path, params, token) {
	const query = new URLSearchParams(params);
	const url = `${TMDB_BASE_URL}${path}?${query.toString()}`;
	const response = await httpCall("GET", url, {
		headers: { Authorization: `Bearer ${token}` },
	});

	if (!response?.success) {
		throw new Error(response?.error ?? `TMDB request failed: ${path}`);
	}

	const payload = parseJsonResponse(response.data.body);

	if (typeof payload?.status_code === "number" && payload.status_code !== 1) {
		throw new Error(payload.status_message ?? `TMDB API error (status ${payload.status_code})`);
	}

	return payload;
}

function collectImages(posterPath, backdropPath, postersArray, backdropsArray) {
	const seen = new Set();
	const images = [];

	const addImage = (path) => {
		const url = getImageUrl(path);
		if (url && !seen.has(url)) {
			seen.add(url);
			images.push({ type: "remote", url });
		}
	};

	addImage(posterPath);
	addImage(backdropPath);

	if (Array.isArray(postersArray)) {
		for (const item of postersArray) {
			addImage(item?.file_path);
		}
	}

	if (Array.isArray(backdropsArray)) {
		for (const item of backdropsArray) {
			addImage(item?.file_path);
		}
	}

	return images;
}

function collectGenres(genresArray) {
	if (!Array.isArray(genresArray)) {
		return [];
	}

	const genres = [];
	for (const g of genresArray) {
		const name = typeof g?.name === "string" ? g.name.trim() : "";
		if (name) {
			genres.push(name);
		}
	}

	return genres;
}

function collectSuggestions(results) {
	if (!Array.isArray(results)) {
		return [];
	}

	const suggestionByKey = new Map();
	for (const result of results) {
		const externalId =
			typeof result?.id === "number" && Number.isFinite(result.id)
				? String(Math.trunc(result.id))
				: null;
		if (!externalId) {
			continue;
		}

		let name = null;
		if (typeof result?.title === "string" && result.title.trim()) {
			name = result.title.trim();
		} else if (typeof result?.original_title === "string" && result.original_title.trim()) {
			name = result.original_title.trim();
		}
		if (!name) {
			continue;
		}

		suggestionByKey.set(`movie.tmdb:${externalId}`, {
			name,
			externalId,
			scriptSlug: "movie.tmdb",
		});
	}

	return [...suggestionByKey.values()];
}

async function fetchTrendingItems(path, language, token) {
	const results = [];
	for (const page of [1, 2, 3]) {
		const data = await tmdbGet(path, { language, page: String(page) }, token);
		if (Array.isArray(data?.results)) {
			results.push(...data.results);
		}
	}

	return collectSuggestions(results).map((item) => ({
		name: item.name,
		externalId: item.externalId,
	}));
}

function collectCompanies(productionCompanies) {
	if (!Array.isArray(productionCompanies)) {
		return [];
	}

	const companyByKey = new Map();

	for (const company of productionCompanies) {
		const id =
			typeof company?.id === "number" && Number.isFinite(company.id)
				? Math.trunc(company.id)
				: null;
		if (id === null) {
			continue;
		}

		const name =
			typeof company?.name === "string" && company.name.trim() ? company.name.trim() : "Loading...";

		const key = `company.tmdb:${id}`;
		const existing = companyByKey.get(key);
		if (existing) {
			const roles = new Set([
				...(Array.isArray(existing.relationshipProperties.roles)
					? existing.relationshipProperties.roles
					: []),
				"Production Company",
			]);
			existing.relationshipProperties.roles = [...roles];
			if (existing.name === "Loading..." && name !== "Loading...") {
				existing.name = name;
			}
			continue;
		}

		companyByKey.set(key, {
			name,
			externalId: String(id),
			scriptSlug: "company.tmdb",
			relationshipProperties: {
				roles: ["Production Company"],
			},
		});
	}

	return [...companyByKey.values()];
}

function collectPeople(cast, crew) {
	const relatedEntityByKey = new Map();
	const unlinkedCreators = [];
	const unlinkedByKey = new Set();

	const addRelatedEntity = (relatedEntity) => {
		const key = `${relatedEntity.scriptSlug}:${relatedEntity.externalId}`;
		const existing = relatedEntityByKey.get(key);
		if (!existing) {
			relatedEntityByKey.set(key, relatedEntity);
			return;
		}

		const roles = new Set([
			...(Array.isArray(existing.relationshipProperties.roles)
				? existing.relationshipProperties.roles
				: []),
			...(Array.isArray(relatedEntity.relationshipProperties.roles)
				? relatedEntity.relationshipProperties.roles
				: []),
		]);
		existing.relationshipProperties.roles = [...roles];
		if (existing.name === "Loading..." && relatedEntity.name !== "Loading...") {
			existing.name = relatedEntity.name;
		}
	};

	const addUnlinkedCreator = (name, role) => {
		const key = `${name}:${role}`;
		if (unlinkedByKey.has(key)) {
			return;
		}
		unlinkedByKey.add(key);
		unlinkedCreators.push({ name, role });
	};

	const castList = Array.isArray(cast) ? cast : [];
	for (const member of castList.slice(0, 15)) {
		const name =
			typeof member?.name === "string" && member.name.trim() ? member.name.trim() : "Loading...";
		const id =
			typeof member?.id === "number" && Number.isFinite(member.id) ? Math.trunc(member.id) : null;
		const role =
			typeof member?.known_for_department === "string" && member.known_for_department.trim()
				? member.known_for_department.trim()
				: "Acting";
		if (id !== null) {
			addRelatedEntity({
				name,
				externalId: String(id),
				scriptSlug: "person.tmdb",
				relationshipProperties: {
					roles: [role],
				},
			});
		} else {
			addUnlinkedCreator(name, role);
		}
	}

	const NOTABLE_JOBS = new Set(["Director", "Producer", "Screenplay", "Writer", "Story"]);

	const crewList = Array.isArray(crew) ? crew : [];
	for (const member of crewList) {
		const name =
			typeof member?.name === "string" && member.name.trim() ? member.name.trim() : "Loading...";
		const job = typeof member?.job === "string" ? member.job.trim() : "";
		if (!job || !NOTABLE_JOBS.has(job)) {
			continue;
		}
		const id =
			typeof member?.id === "number" && Number.isFinite(member.id) ? Math.trunc(member.id) : null;
		if (id !== null) {
			addRelatedEntity({
				name,
				externalId: String(id),
				scriptSlug: "person.tmdb",
				relationshipProperties: {
					roles: [job],
				},
			});
		} else {
			addUnlinkedCreator(name, job);
		}
	}

	return { relatedEntities: [...relatedEntityByKey.values()], unlinkedCreators };
}

driver("search", async function (context) {
	const { z } = await import("npm:zod");
	const { default: dayjs } = await import("npm:dayjs");

	const {
		query,
		page: currentPage,
		pageSize,
	} = z
		.object({
			query: z.string().trim().min(1, "query is required"),
			page: z.coerce.number().min(1).transform(Math.floor).catch(1),
			pageSize: z.coerce.number().min(1).max(100).transform(Math.floor).catch(20),
		})
		.parse(context ?? {});

	const token = await getTmdbAccessToken();
	const showNsfw = await getUserIsNsfw();
	const data = await tmdbGet(
		"/search/movie",
		{
			query,
			language: "en-US",
			page: String(currentPage),
			include_adult: showNsfw ? "true" : "false",
		},
		token,
	);

	const results = Array.isArray(data?.results) ? data.results : [];
	const totalItems =
		typeof data?.total_results === "number" && Number.isFinite(data.total_results)
			? data.total_results
			: results.length;
	const totalPages =
		typeof data?.total_pages === "number" && Number.isFinite(data.total_pages)
			? data.total_pages
			: 1;

	const items = results
		.map((movie) => {
			const id =
				typeof movie?.id === "number" && Number.isFinite(movie.id)
					? String(Math.trunc(movie.id))
					: null;
			if (!id) {
				return null;
			}

			const title =
				typeof movie?.title === "string" && movie.title.trim() ? movie.title.trim() : null;
			if (!title) {
				return null;
			}

			const publishYear = parsePublishYear(movie?.release_date, dayjs);
			const image = getImageUrl(movie?.poster_path);

			return {
				externalId: id,
				calloutProperty: { kind: "null", value: null },
				titleProperty: { kind: "text", value: title },
				primarySubtitleProperty:
					publishYear === null
						? { kind: "null", value: null }
						: { kind: "number", value: publishYear },
				secondarySubtitleProperty: { kind: "null", value: null },
				imageProperty:
					image === null
						? { kind: "null", value: null }
						: { kind: "image", value: { type: "remote", url: image } },
			};
		})
		.filter((item) => item !== null)
		.slice(0, pageSize);

	return {
		items,
		details: {
			totalItems,
			nextPage: currentPage < totalPages ? currentPage + 1 : null,
		},
	};
});

driver("trending", async function (_context, { metadata }) {
	const language = metadata?.providerInformation?.canonicalLanguage ?? "en";
	const token = await getTmdbAccessToken();
	const items = await fetchTrendingItems("/trending/movie/day", language, token);
	return { items };
});

driver("details", async function (context, { metadata }) {
	const { z } = await import("npm:zod");
	const { default: dayjs } = await import("npm:dayjs");

	const { externalId } = z
		.object({
			externalId: z.string().trim().min(1, "externalId is required"),
		})
		.parse(context ?? {});

	const language = metadata?.providerInformation?.canonicalLanguage ?? "en";

	if (!/^\d+$/.test(externalId)) {
		throw new Error("externalId must be a numeric TMDB movie ID");
	}

	const token = await getTmdbAccessToken();

	const [movieData, creditsData, imagesData, recommendationsData] = await Promise.all([
		tmdbGet(`/movie/${externalId}`, { language }, token),
		tmdbGet(`/movie/${externalId}/credits`, { language }, token),
		tmdbGet(`/movie/${externalId}/images`, {}, token),
		tmdbGet(`/movie/${externalId}/recommendations`, { language }, token),
	]);

	const title =
		typeof movieData?.title === "string" && movieData.title.trim() ? movieData.title.trim() : null;
	if (!title) {
		throw new Error("TMDB returned no title for this movie");
	}

	const images = collectImages(
		movieData?.poster_path,
		movieData?.backdrop_path,
		imagesData?.posters,
		imagesData?.backdrops,
	);

	const runtime =
		typeof movieData?.runtime === "number" &&
		Number.isFinite(movieData.runtime) &&
		movieData.runtime > 0
			? Math.trunc(movieData.runtime)
			: null;

	const providerRating =
		typeof movieData?.vote_average === "number" &&
		Number.isFinite(movieData.vote_average) &&
		movieData.vote_average > 0
			? movieData.vote_average * 10
			: null;

	let collectionId = null;
	if (movieData?.belongs_to_collection && typeof movieData.belongs_to_collection === "object") {
		if (
			typeof movieData.belongs_to_collection.id === "number" &&
			Number.isFinite(movieData.belongs_to_collection.id)
		) {
			collectionId = String(Math.trunc(movieData.belongs_to_collection.id));
		}
	}
	const groups = collectionId
		? [
				{
					name:
						typeof movieData.belongs_to_collection?.name === "string" &&
						movieData.belongs_to_collection.name.trim()
							? movieData.belongs_to_collection.name.trim()
							: "Loading...",
					externalId: collectionId,
					scriptSlug: "movie-group.tmdb",
					relationshipProperties: {
						roles: ["Member"],
					},
				},
			]
		: [];

	const { relatedEntities: peopleRelatedEntities, unlinkedCreators } = collectPeople(
		creditsData?.cast,
		creditsData?.crew,
	);

	const companies = collectCompanies(movieData?.production_companies);
	const suggestions = collectSuggestions(recommendationsData?.results);

	return {
		name: title,
		relatedEntityGroups: [
			{
				direction: "incoming",
				synchronization: "additive",
				entities: peopleRelatedEntities,
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
				entities: groups,
				relationshipSchemaSlug: "movie-group-to-movie",
			},
			{
				direction: "outgoing",
				synchronization: "authoritative",
				entities: suggestions,
				relationshipSchemaSlug: "media-suggestion",
			},
		],
		properties: {
			images,
			runtime,
			providerRating,
			unlinkedCreators,
			isNsfw: movieData?.adult === true ? true : null,
			genres: collectGenres(movieData?.genres),
			sourceUrl: `https://www.themoviedb.org/movie/${externalId}`,
			publishYear: parsePublishYear(movieData?.release_date, dayjs),
			description:
				typeof movieData?.overview === "string" && movieData.overview.trim()
					? movieData.overview.trim()
					: null,
			productionStatus:
				typeof movieData?.status === "string" && movieData.status.trim()
					? movieData.status.trim()
					: null,
		},
	};
});

driver("resolve", async function (context) {
	if (context?.identifierType !== "imdb") {
		throw new Error("TMDB movie resolve supports only imdb identifiers");
	}
	const value = typeof context.value === "string" ? context.value.trim() : "";
	if (!value) {
		throw new Error("TMDB movie resolve requires a non-empty imdb value");
	}

	const token = await getTmdbAccessToken();
	const payload = await tmdbGet(
		`/find/${encodeURIComponent(value)}`,
		{ external_source: "imdb_id" },
		token,
	);

	const movieId = payload?.movie_results?.[0]?.id;
	if (typeof movieId === "number" && Number.isFinite(movieId)) {
		return { externalId: String(Math.trunc(movieId)) };
	}

	return { externalId: null };
});

driver("translate", async function (context) {
	const { z } = await import("npm:zod");

	const { externalId, language } = z
		.object({
			language: z.string().trim().min(1, "language is required"),
			externalId: z.string().trim().min(1, "externalId is required"),
		})
		.parse(context ?? {});

	if (!/^\d+$/.test(externalId)) {
		throw new Error("externalId must be a numeric TMDB movie ID");
	}

	const [langPart, regionPart] = language.split("-");
	const langCode = langPart.trim().toLowerCase();
	const region = regionPart ? regionPart.trim().toUpperCase() : null;

	const token = await getTmdbAccessToken();

	const [translationsData, imagesData] = await Promise.all([
		tmdbGet(`/movie/${externalId}/translations`, {}, token),
		tmdbGet(`/movie/${externalId}/images`, { include_image_language: langCode }, token),
	]);

	const translations = Array.isArray(translationsData?.translations)
		? translationsData.translations
		: [];
	const matchesLanguage = (entry) =>
		typeof entry?.iso_639_1 === "string" && entry.iso_639_1.toLowerCase() === langCode;
	const candidates = translations.filter(matchesLanguage);
	const regionMatch = region
		? candidates.find(
				(entry) =>
					typeof entry?.iso_3166_1 === "string" && entry.iso_3166_1.toUpperCase() === region,
			)
		: null;
	const match = regionMatch ?? candidates[0] ?? null;

	const name =
		typeof match?.data?.title === "string" && match.data.title.trim()
			? match.data.title.trim()
			: null;
	const description =
		typeof match?.data?.overview === "string" && match.data.overview.trim()
			? match.data.overview.trim()
			: null;

	const posters = Array.isArray(imagesData?.posters) ? imagesData.posters : [];
	const localizedPoster = posters.find(
		(poster) =>
			typeof poster?.iso_639_1 === "string" && poster.iso_639_1.toLowerCase() === langCode,
	);
	const imageUrl = localizedPoster ? getImageUrl(localizedPoster.file_path) : null;

	const result = {};
	if (name) {
		result.name = name;
	}
	const properties = {};
	if (description) {
		properties.description = description;
	}
	if (imageUrl) {
		properties.images = [{ type: "remote", url: imageUrl }];
	}
	if (Object.keys(properties).length > 0) {
		result.properties = properties;
	}

	return result;
});

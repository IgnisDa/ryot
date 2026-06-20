function parseJsonResponse(responseBody) {
	try {
		return JSON.parse(responseBody);
	} catch {
		throw new Error("TVDB returned invalid JSON");
	}
}

const TVDB_BASE_URL = "https://api4.thetvdb.com/v4";
const TOKEN_CACHE_KEY = "tvdb_access_token";

async function getTvdbApiKey() {
	const resp = await getAppConfigValue("providers.tvdbApiKey");
	if (!resp?.success) {
		throw new Error(resp?.error ?? "Failed to retrieve TVDB API key");
	}
	const key = typeof resp.data === "string" ? resp.data.trim() : null;
	if (!key) {
		throw new Error(
			"TVDB API key is not configured. Set MOVIES_AND_SHOWS_TVDB_API_KEY in your environment.",
		);
	}
	return key;
}

async function getTvdbAccessToken() {
	const cached = await getCachedValue(TOKEN_CACHE_KEY);
	if (cached?.success && typeof cached.data === "string" && cached.data) {
		return cached.data;
	}

	const apiKey = await getTvdbApiKey();
	const response = await httpCall("POST", `${TVDB_BASE_URL}/login`, {
		body: JSON.stringify({ apikey: apiKey }),
		headers: { "Content-Type": "application/json" },
	});

	if (!response?.success) {
		throw new Error(response?.error ?? "TVDB login request failed");
	}

	const payload = parseJsonResponse(response.data.body);
	if (payload?.status !== "success" || !payload?.data?.token) {
		throw new Error("TVDB login returned no token");
	}

	const accessToken = `Bearer ${payload.data.token}`;
	// TVDB tokens are valid for 30 days; cache for 23 hours as a safety buffer.
	const cacheResult = await setCachedValue(TOKEN_CACHE_KEY, accessToken, 23 * 60 * 60);
	if (!cacheResult?.success) {
		console.warn(`TVDB token cache write failed: ${cacheResult?.error}`);
	}

	return accessToken;
}

async function tvdbRequest(path, params, options) {
	const token = await getTvdbAccessToken();
	const query =
		params && Object.keys(params).length > 0 ? `?${new URLSearchParams(params).toString()}` : "";
	const url = `${TVDB_BASE_URL}${path}${query}`;
	const response = await httpCall("GET", url, {
		headers: { Authorization: token },
	});

	if (!response?.success) {
		const status = response?.data?.status;
		if (options?.allowMissing && (status === 400 || status === 404)) {
			return null;
		}
		throw new Error(response?.error ?? `TVDB request failed: ${path}`);
	}

	const payload = parseJsonResponse(response.data.body);
	if (payload?.status && payload.status !== "success") {
		throw new Error(`TVDB API error: ${payload.message ?? payload.status}`);
	}

	return payload;
}

async function tvdbGet(path, params) {
	return tvdbRequest(path, params, { allowMissing: false });
}

async function tvdbGetOptional(path, params) {
	return tvdbRequest(path, params, { allowMissing: true });
}

function getString(value) {
	return typeof value === "string" ? value.trim() : "";
}

function getNullableString(value) {
	const parsed = getString(value);
	return parsed.length > 0 ? parsed : null;
}

function getCanonicalLanguage(metadata) {
	return metadata?.providerInformation?.canonicalLanguage ?? "en";
}

const TVDB_LANGUAGE_MAP = {
	en: "eng",
	es: "spa",
	fr: "fra",
	de: "deu",
	it: "ita",
	pt: "por",
	ja: "jpn",
	ko: "kor",
	zh: "zho",
	ru: "rus",
	nl: "nld",
	pl: "pol",
	sv: "swe",
	da: "dan",
	fi: "fin",
	nb: "nob",
	tr: "tur",
	cs: "ces",
};
function bcp47ToTvdb(language) {
	const base = typeof language === "string" ? language.trim().toLowerCase().split("-")[0] : "";
	return TVDB_LANGUAGE_MAP[base] ?? base;
}

function getTranslationRecord(payload) {
	const data = payload?.data;
	if (Array.isArray(data)) {
		return data.find((entry) => entry?.isPrimary === true) ?? data[0] ?? null;
	}
	return data && typeof data === "object" ? data : null;
}

function getTranslationFields(payload) {
	const record = getTranslationRecord(payload);
	return {
		name: getNullableString(record?.name),
		description: getNullableString(record?.overview),
	};
}

function getLocalizedArtwork(artworks, language) {
	if (!Array.isArray(artworks)) {
		return null;
	}

	const artwork = artworks.find(
		(art) => getString(art?.language) === language && getString(art?.image),
	);
	const image = getNullableString(artwork?.image);
	return image ? { type: "remote", url: image } : null;
}

function getObjectProperties(value) {
	if (value && typeof value === "object" && !Array.isArray(value)) {
		return value;
	}
	throw new Error("properties must be an object for TVDB show translation");
}

function getStringProperty(properties, key) {
	const value = properties[key];
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

function getTranslationRequest(input) {
	if (!/^\d+$/.test(input.externalId)) {
		throw new Error("externalId must be a numeric TVDB ID");
	}

	if (input.entitySchemaSlug === "show") {
		return {
			detailsPath: `/series/${input.externalId}/extended`,
			translationPath: `/series/${input.externalId}/translations/${input.language}`,
		};
	}

	const properties = getObjectProperties(input.properties);
	const parentShowExternalId = getStringProperty(properties, "parentShowExternalId");
	if (!parentShowExternalId || !/^\d+$/.test(parentShowExternalId)) {
		throw new Error("parentShowExternalId must be a numeric TVDB show ID");
	}

	if (input.entitySchemaSlug === "show-season") {
		return {
			detailsPath: `/seasons/${input.externalId}/extended`,
			translationPath: `/seasons/${input.externalId}/translations/${input.language}`,
		};
	}

	if (input.entitySchemaSlug === "show-episode") {
		return {
			detailsPath: `/episodes/${input.externalId}/extended`,
			translationPath: `/episodes/${input.externalId}/translations/${input.language}`,
		};
	}

	throw new Error("show.tvdb translate supports only show, show-season, and show-episode");
}

function buildTranslationResult(translationData, detailsData, language) {
	const { name, description } = getTranslationFields(translationData);
	const data = detailsData?.data;
	const artwork = data?.artworks ?? data?.artwork;
	const image = getLocalizedArtwork(artwork, language);
	const result = {};
	if (name) {
		result.name = name;
	}
	const properties = {};
	if (description) {
		properties.description = description;
	}
	if (image) {
		properties.images = [image];
	}
	if (Object.keys(properties).length > 0) {
		result.properties = properties;
	}
	return result;
}

function parsePublishYear(str, dayjs) {
	if (typeof str !== "string" || !str.trim()) {
		return null;
	}
	const d = dayjs(str.trim());
	return d.isValid() && d.year() > 0 ? d.year() : null;
}

function collectImages(mainImage, artworks) {
	const seen = new Set();
	const images = [];

	const addImage = (url) => {
		if (typeof url === "string" && url.trim() && !seen.has(url)) {
			seen.add(url);
			images.push({ type: "remote", url });
		}
	};

	addImage(mainImage);

	if (Array.isArray(artworks)) {
		for (const art of artworks) {
			addImage(art?.image);
		}
	}

	return images;
}

function collectGenres(genresArray) {
	if (!Array.isArray(genresArray)) {
		return [];
	}
	return genresArray
		.map((g) => (typeof g?.name === "string" ? g.name.trim() : ""))
		.filter((name) => name.length > 0);
}

function collectCompanies(companiesObj) {
	if (!companiesObj || typeof companiesObj !== "object") {
		return [];
	}

	const companyByKey = new Map();

	const roleMap = {
		studio: "Studio",
		network: "Network",
		production: "Production Company",
		distributor: "Distributor",
		special_effects: "Special Effects",
	};

	for (const [key, role] of Object.entries(roleMap)) {
		const list = companiesObj[key];
		if (!Array.isArray(list)) {
			continue;
		}

		for (const company of list) {
			const id =
				typeof company?.id === "number" && Number.isFinite(company.id)
					? Math.trunc(company.id)
					: null;
			if (id === null) {
				continue;
			}

			const name =
				typeof company?.name === "string" && company.name.trim()
					? company.name.trim()
					: "Loading...";

			const companyKey = `company.tvdb:${id}`;
			const existing = companyByKey.get(companyKey);
			if (existing) {
				const roles = new Set([
					...(Array.isArray(existing.relationshipProperties.roles)
						? existing.relationshipProperties.roles
						: []),
					role,
				]);
				existing.relationshipProperties.roles = [...roles];
				if (existing.name === "Loading..." && name !== "Loading...") {
					existing.name = name;
				}
				continue;
			}

			companyByKey.set(companyKey, {
				name,
				externalId: String(id),
				scriptSlug: "company.tvdb",
				relationshipProperties: {
					roles: [role],
				},
			});
		}
	}

	return [...companyByKey.values()];
}

function collectPeople(characters) {
	if (!Array.isArray(characters)) {
		return { relatedEntities: [], unlinkedCreators: [] };
	}

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

	for (const chr of characters.slice(0, 20)) {
		const name =
			typeof chr?.personName === "string" && chr.personName.trim()
				? chr.personName.trim()
				: "Loading...";
		const role =
			typeof chr?.peopleType === "string" && chr.peopleType.trim() ? chr.peopleType.trim() : "Cast";
		const peopleId =
			typeof chr?.peopleId === "number" && Number.isFinite(chr.peopleId)
				? Math.trunc(chr.peopleId)
				: null;
		if (peopleId !== null) {
			addRelatedEntity({
				name,
				externalId: String(peopleId),
				scriptSlug: "person.tvdb",
				relationshipProperties: {
					roles: [role],
				},
			});
		} else {
			addUnlinkedCreator(name, role);
		}
	}

	return {
		relatedEntities: [...relatedEntityByKey.values()],
		unlinkedCreators,
	};
}

function buildSeason(parentShowExternalId, seasonData) {
	const id =
		typeof seasonData?.id === "number" && Number.isFinite(seasonData.id) && seasonData.id > 0
			? Math.trunc(seasonData.id)
			: null;
	if (id === null) {
		return null;
	}

	const seasonNumber =
		typeof seasonData?.number === "number" && Number.isFinite(seasonData.number)
			? Math.trunc(seasonData.number)
			: 0;

	const yearStr =
		typeof seasonData?.year === "string" && /^\d{4}$/.test(seasonData.year.trim())
			? seasonData.year.trim()
			: null;
	const publishDate = yearStr ? `${yearStr}-01-01` : null;

	const posterImages = [];
	if (typeof seasonData?.image === "string" && seasonData.image.trim()) {
		posterImages.push(seasonData.image.trim());
	}
	if (Array.isArray(seasonData?.artwork)) {
		for (const art of seasonData.artwork) {
			if (typeof art?.image === "string" && art.image.trim()) {
				posterImages.push(art.image.trim());
			}
		}
	}

	const episodeList = Array.isArray(seasonData?.episodes) ? seasonData.episodes : [];
	const childEntities = episodeList
		.map((ep) => {
			const epId =
				typeof ep?.id === "number" && Number.isFinite(ep.id) && ep.id > 0
					? Math.trunc(ep.id)
					: null;
			if (epId === null) {
				return null;
			}
			const epName = typeof ep?.name === "string" && ep.name.trim() ? ep.name.trim() : null;
			const epRuntime =
				typeof ep?.runtime === "number" && Number.isFinite(ep.runtime) && ep.runtime > 0
					? Math.trunc(ep.runtime)
					: null;
			const epOverview =
				typeof ep?.overview === "string" && ep.overview.trim() ? ep.overview.trim() : null;
			const epNumber =
				typeof ep?.number === "number" && Number.isFinite(ep.number) ? Math.trunc(ep.number) : 0;
			const epPublishDate =
				typeof ep?.aired === "string" && ep.aired.trim() ? ep.aired.trim() : null;
			const epImage = typeof ep?.image === "string" && ep.image.trim() ? ep.image.trim() : null;

			return {
				entitySchemaSlug: "show-episode",
				externalId: String(epId),
				name: epName ?? `Episode ${epNumber}`,
				properties: {
					seasonNumber,
					runtime: epRuntime,
					parentShowExternalId,
					description: epOverview,
					episodeNumber: epNumber,
					publishDate: epPublishDate,
					...(epImage ? { images: [{ type: "remote", url: epImage }] } : {}),
				},
			};
		})
		.filter((episode) => episode !== null);

	const posterImage = posterImages[0] ?? null;

	return {
		childEntities,
		externalId: String(id),
		name: `Season ${seasonNumber}`,
		entitySchemaSlug: "show-season",
		properties: {
			seasonNumber,
			parentShowExternalId,
			releaseDate: publishDate,
			...(posterImage ? { images: [{ type: "remote", url: posterImage }] } : {}),
		},
	};
}

driver("search", async function (context) {
	const { z } = await import("npm:zod");
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

	const offset = (currentPage - 1) * pageSize;

	const data = await tvdbGet("/search", {
		query,
		type: "series",
		offset: String(offset),
		limit: String(pageSize),
	});

	const results = Array.isArray(data?.data) ? data.data : [];
	const totalItems =
		typeof data?.links?.total_items === "number" && Number.isFinite(data.links.total_items)
			? data.links.total_items
			: results.length + offset;
	const hasNext = data?.links?.next != null;

	const items = results
		.map((item) => {
			const id =
				typeof item?.tvdb_id === "string" && item.tvdb_id.trim() ? item.tvdb_id.trim() : null;
			if (!id) {
				return null;
			}

			const title =
				typeof item?.name === "string" && item.name.trim()
					? item.name.trim()
					: typeof item?.title === "string" && item.title.trim()
						? item.title.trim()
						: null;
			if (!title) {
				return null;
			}

			const imageUrl = item?.poster ?? item?.image_url ?? null;
			const image = typeof imageUrl === "string" && imageUrl.trim() ? imageUrl.trim() : null;

			return {
				externalId: id,
				calloutProperty: { kind: "null", value: null },
				titleProperty: { kind: "text", value: title },
				primarySubtitleProperty: { kind: "null", value: null },
				secondarySubtitleProperty: { kind: "null", value: null },
				imageProperty:
					image === null
						? { kind: "null", value: null }
						: { kind: "image", value: { type: "remote", url: image } },
			};
		})
		.filter((item) => item !== null);

	return {
		items,
		details: {
			totalItems,
			nextPage: hasNext ? currentPage + 1 : null,
		},
	};
});

driver("details", async function (context, { metadata }) {
	const { z } = await import("npm:zod");
	const dayjsModule = await import("npm:dayjs");
	const dayjs = dayjsModule.default;

	const { externalId } = z
		.object({
			externalId: z.string().trim().min(1, "externalId is required"),
		})
		.parse(context ?? {});

	if (!/^\d+$/.test(externalId)) {
		throw new Error("externalId must be a numeric TVDB series ID");
	}

	const language = bcp47ToTvdb(getCanonicalLanguage(metadata));
	const [data, translationData] = await Promise.all([
		tvdbGet(`/series/${externalId}/extended`),
		tvdbGetOptional(`/series/${externalId}/translations/${language}`),
	]);
	const show = data?.data;
	if (!show) {
		throw new Error("TVDB returned no data for this series");
	}

	const translation = getTranslationFields(translationData);
	const fallbackTitle =
		typeof show?.name === "string" && show.name.trim() ? show.name.trim() : null;
	const title = translation.name ?? fallbackTitle;
	if (!title) {
		throw new Error("TVDB returned no name for this series");
	}

	const images = collectImages(show?.image, show?.artworks);
	const genres = collectGenres(show?.genres);
	const { relatedEntities: peopleRelatedEntities, unlinkedCreators } = collectPeople(
		show?.characters,
	);

	const firstAired =
		typeof show?.firstAired === "string" && show.firstAired.trim() ? show.firstAired.trim() : null;

	const publishYear =
		parsePublishYear(typeof show?.year === "string" ? show.year : null, dayjs) ??
		parsePublishYear(firstAired, dayjs);

	// Deduplicate seasons by number, keeping the first ID encountered per number.
	const seasonsRaw = Array.isArray(show?.seasons) ? show.seasons : [];
	const seasonIdByNumber = new Map();
	for (const s of seasonsRaw) {
		const num =
			typeof s?.number === "number" && Number.isFinite(s.number) ? Math.trunc(s.number) : null;
		const id = typeof s?.id === "number" && Number.isFinite(s.id) ? Math.trunc(s.id) : null;
		if (num !== null && id !== null && !seasonIdByNumber.has(num)) {
			seasonIdByNumber.set(num, id);
		}
	}

	const seasonIds = Array.from(seasonIdByNumber.values());

	const BATCH_SIZE = 5;
	const allSeasonResponses = [];
	for (let i = 0; i < seasonIds.length; i += BATCH_SIZE) {
		const batch = seasonIds.slice(i, i + BATCH_SIZE);
		const batchResults = await Promise.all(batch.map((sid) => tvdbGet(`/seasons/${sid}/extended`)));
		allSeasonResponses.push(...batchResults);
	}

	const officialSeasons = allSeasonResponses
		.map((r) => r?.data)
		.filter((s) => s != null && typeof s?.type === "object" && s.type?.type === "official")
		.sort(
			(a, b) =>
				(typeof a?.number === "number" ? a.number : 0) -
				(typeof b?.number === "number" ? b.number : 0),
		);

	const childEntities = officialSeasons
		.map((season) => buildSeason(externalId, season))
		.filter((season) => season !== null);
	const totalEpisodes = childEntities.reduce(
		(count, season) => count + season.childEntities.length,
		0,
	);

	const slug = typeof show?.slug === "string" && show.slug.trim() ? show.slug.trim() : null;
	const sourceUrl = slug
		? `https://thetvdb.com/series/${slug}`
		: `https://thetvdb.com/series/${externalId}`;

	const relatedEntities = [...peopleRelatedEntities, ...collectCompanies(show?.companies)];

	return {
		name: title,
		childEntities,
		relatedEntities,
		properties: {
			images,
			genres,
			sourceUrl,
			publishYear,
			totalEpisodes,
			totalSeasons: childEntities.length,
			unlinkedCreators,
			description:
				translation.description ??
				(typeof show?.overview === "string" && show.overview.trim() ? show.overview.trim() : null),
		},
	};
});

driver("translate", async function (context) {
	const { z } = await import("npm:zod");

	const { externalId, language, properties, entitySchemaSlug } = z
		.object({
			properties: z.unknown().optional(),
			language: z.string().trim().min(1, "language is required"),
			externalId: z.string().trim().min(1, "externalId is required"),
			entitySchemaSlug: z.string().trim().min(1, "entitySchemaSlug is required"),
		})
		.parse(context ?? {});

	const providerLanguage = bcp47ToTvdb(language);
	const request = getTranslationRequest({
		externalId,
		properties,
		entitySchemaSlug,
		language: providerLanguage,
	});
	const [translationData, detailsData] = await Promise.all([
		tvdbGetOptional(request.translationPath),
		tvdbGet(request.detailsPath).catch(() => null),
	]);

	return buildTranslationResult(translationData, detailsData, providerLanguage);
});

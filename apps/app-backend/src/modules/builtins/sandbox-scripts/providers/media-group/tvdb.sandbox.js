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

async function tvdbRequest(path, options) {
	const token = await getTvdbAccessToken();
	const response = await httpCall("GET", `${TVDB_BASE_URL}${path}`, {
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
	return payload?.data ?? payload;
}

async function tvdbGet(path) {
	return tvdbRequest(path, { allowMissing: false });
}

async function tvdbGetOptional(path) {
	return tvdbRequest(path, { allowMissing: true });
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

function getTranslationRecord(value) {
	const data = value?.data ?? value;
	if (Array.isArray(data)) {
		return data.find((entry) => entry?.isPrimary === true) ?? data[0] ?? null;
	}
	return data && typeof data === "object" ? data : null;
}

function getTranslationFields(value) {
	const record = getTranslationRecord(value);
	return {
		name: getNullableString(record?.name),
		description: getNullableString(record?.overview),
	};
}

function buildTranslationResult(value) {
	const { name, description } = getTranslationFields(value);
	const result = {};
	if (name) {
		result.name = name;
	}
	const properties = {};
	if (description) {
		properties.description = description;
	}
	if (Object.keys(properties).length > 0) {
		result.properties = properties;
	}
	return result;
}

driver("search", function () {
	throw new Error("TVDB does not support movie group search");
});

driver("details", async function (context, { metadata }) {
	const { z } = await import("npm:zod");

	const { externalId } = z
		.object({ externalId: z.string().trim().min(1, "externalId is required") })
		.parse(context ?? {});

	if (!/^\d+$/.test(externalId)) {
		throw new Error("externalId must be a numeric TVDB list ID");
	}

	const language = bcp47ToTvdb(getCanonicalLanguage(metadata));
	const [data, translationData] = await Promise.all([
		tvdbGet(`/lists/${externalId}/extended`),
		tvdbGetOptional(`/lists/${externalId}/translations/${language}`),
	]);
	const translation = getTranslationFields(translationData);

	const fallbackTitle =
		typeof data?.name === "string" && data.name.trim() ? data.name.trim() : "Unnamed List";
	const title = translation.name ?? fallbackTitle;

	const description =
		translation.description ??
		(typeof data?.overview === "string" && data.overview.trim() ? data.overview.trim() : null);

	const images = [];
	if (typeof data?.image === "string" && data.image.trim()) {
		images.push({ type: "remote", url: data.image.trim() });
	}

	const entities = Array.isArray(data?.entities) ? data.entities : [];
	const movieEntities = entities.filter((e) => e && typeof e === "object" && e.movieId != null);
	const parts = movieEntities.length;

	const relatedEntities = movieEntities
		.sort((a, b) => {
			const orderA = typeof a.order === "number" ? a.order : 0;
			const orderB = typeof b.order === "number" ? b.order : 0;
			return orderA - orderB;
		})
		.map((entity, idx) => {
			const memberId =
				typeof entity.movieId === "string" && entity.movieId.trim() ? entity.movieId.trim() : null;
			if (!memberId) {
				return null;
			}
			const memberName =
				typeof entity.name === "string" && entity.name.trim() ? entity.name.trim() : "Loading...";
			return {
				name: memberName,
				externalId: memberId,
				scriptSlug: "movie.tvdb",
				relationshipProperties: { order: idx + 1 },
			};
		})
		.filter((e) => e !== null);

	const sourceUrl =
		typeof data?.url === "string" && data.url.trim()
			? `https://thetvdb.com/lists/${data.url.trim()}`
			: null;

	return {
		name: title,
		properties: {parts,images,sourceUrl,description,},
		relatedEntityGroups: [
			{
				direction: "outgoing",
				entities: relatedEntities,
				relationshipSchemaSlug: "movie-group-to-movie",
			},
		],
	};
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
		throw new Error("externalId must be a numeric TVDB list ID");
	}

	const providerLanguage = bcp47ToTvdb(language);
	const translationData = await tvdbGetOptional(
		`/lists/${externalId}/translations/${providerLanguage}`,
	);
	return buildTranslationResult(translationData);
});

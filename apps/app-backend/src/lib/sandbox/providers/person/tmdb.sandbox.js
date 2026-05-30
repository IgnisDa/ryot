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
	const prefsResult = await getUserPreferences();
	if (!prefsResult?.success) {
		return false;
	}
	return prefsResult?.data?.isNsfw === true;
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

	const token = await getTmdbAccessToken();
	const showNsfw = await getUserIsNsfw();
	const data = await tmdbGet(
		"/search/person",
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
		.map((person) => {
			const id =
				typeof person?.id === "number" && Number.isFinite(person.id)
					? String(Math.trunc(person.id))
					: null;
			if (!id) {
				return null;
			}

			const name =
				typeof person?.name === "string" && person.name.trim() ? person.name.trim() : null;
			if (!name) {
				return null;
			}

			const image = getImageUrl(person?.profile_path);

			return {
				externalId: id,
				calloutProperty: { kind: "null", value: null },
				titleProperty: { kind: "text", value: name },
				primarySubtitleProperty: { kind: "null", value: null },
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

driver("details", async function (context, { metadata }) {
	const { z } = await import("npm:zod");

	const { externalId } = z
		.object({
			externalId: z.string().trim().min(1, "externalId is required"),
		})
		.parse(context ?? {});

	if (!/^\d+$/.test(externalId)) {
		throw new Error("externalId must be a numeric TMDB person ID");
	}

	const language = metadata?.providerInformation?.canonicalLanguage ?? "en-US";
	const token = await getTmdbAccessToken();

	const personData = await tmdbGet(
		`/person/${externalId}`,
		{ language, append_to_response: "images" },
		token,
	);

	const name =
		typeof personData?.name === "string" && personData.name.trim() ? personData.name.trim() : null;
	if (!name) {
		throw new Error("TMDB returned no name for this person");
	}

	const profileImages = [];
	const mainProfile = getImageUrl(personData?.profile_path);
	if (mainProfile) {
		profileImages.push(mainProfile);
	}
	if (Array.isArray(personData?.images?.profiles)) {
		for (const img of personData.images.profiles) {
			const url = getImageUrl(img?.file_path);
			if (url && !profileImages.includes(url)) {
				profileImages.push(url);
			}
		}
	}

	const gender =
		typeof personData?.gender === "number"
			? personData.gender === 1
				? "Female"
				: personData.gender === 2
					? "Male"
					: personData.gender === 3
						? "Non-Binary"
						: null
			: null;

	const alternateNames = Array.isArray(personData?.also_known_as)
		? personData.also_known_as.filter((n) => typeof n === "string" && n.trim())
		: [];

	return {
		name,
		properties: {
			gender,
			alternateNames,
			images: profileImages.map((url) => ({ type: "remote", url })),
			sourceUrl: `https://www.themoviedb.org/person/${externalId}`,
			description:
				typeof personData?.biography === "string" && personData.biography.trim()
					? personData.biography.trim()
					: null,
			birthDate:
				typeof personData?.birthday === "string" && personData.birthday.trim()
					? personData.birthday.trim()
					: null,
			deathDate:
				typeof personData?.deathday === "string" && personData.deathday.trim()
					? personData.deathday.trim()
					: null,
			birthPlace:
				typeof personData?.place_of_birth === "string" && personData.place_of_birth.trim()
					? personData.place_of_birth.trim()
					: null,
			website:
				typeof personData?.homepage === "string" && personData.homepage.trim()
					? personData.homepage.trim()
					: null,
		},
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
		throw new Error("externalId must be a numeric TMDB person ID");
	}

	const [langPart, regionPart] = language.split("-");
	const langCode = langPart.trim().toLowerCase();
	const region = regionPart ? regionPart.trim().toUpperCase() : null;

	const token = await getTmdbAccessToken();
	const translationsData = await tmdbGet(`/person/${externalId}/translations`, {}, token);
	let imagesData = {};
	try {
		imagesData = await tmdbGet(`/person/${externalId}/images`, {}, token);
	} catch {}

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
	const orderedCandidates = regionMatch
		? [regionMatch, ...candidates.filter((entry) => entry !== regionMatch)]
		: candidates;
	const firstValue = (extract) => {
		for (const entry of orderedCandidates) {
			const value = extract(entry);
			if (typeof value === "string" && value.trim()) {
				return value.trim();
			}
		}
		return null;
	};

	const name = firstValue((entry) => entry?.data?.name);
	const description = firstValue((entry) => entry?.data?.biography);

	const profiles = Array.isArray(imagesData.profiles) ? imagesData.profiles : [];
	const localizedProfile = profiles.find(
		(profile) =>
			typeof profile?.iso_639_1 === "string" && profile.iso_639_1.toLowerCase() === langCode,
	);
	const imageUrl = localizedProfile ? getImageUrl(localizedProfile.file_path) : null;

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

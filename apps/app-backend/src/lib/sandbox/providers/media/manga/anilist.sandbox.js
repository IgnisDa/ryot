function parseJsonResponse(responseBody) {
	try {
		return JSON.parse(responseBody);
	} catch {
		throw new Error("Anilist returned invalid JSON");
	}
}

function extractGraphQlErrorMessage(payload) {
	if (!Array.isArray(payload?.errors) || payload.errors.length === 0) {
		return null;
	}

	const firstError = payload.errors[0];
	const message = typeof firstError?.message === "string" ? firstError.message.trim() : "";

	return message ?? "unknown GraphQL error";
}

function pickImage(coverImage, bannerImage) {
	const candidates = [coverImage?.extraLarge, bannerImage];

	for (const candidate of candidates) {
		if (typeof candidate !== "string") {
			continue;
		}

		const trimmedCandidate = candidate.trim();
		if (trimmedCandidate) {
			return trimmedCandidate;
		}
	}

	return null;
}

const ANILIST_TITLE_LANGUAGES = new Set(["english", "romaji", "native"]);

function normalizeAnilistTitleLanguage(language) {
	const normalized = typeof language === "string" ? language.trim().toLowerCase() : "";
	return ANILIST_TITLE_LANGUAGES.has(normalized) ? normalized : null;
}

function bcp47ToAnilistMode(language) {
	const normalized = typeof language === "string" ? language.trim().toLowerCase() : "";
	if (normalized === "en") {
		return "english";
	}
	if (normalized === "ja-latn") {
		return "romaji";
	}
	if (normalized === "ja") {
		return "native";
	}
	return null;
}

async function getAnilistPreferences() {
	const prefsResult = await getUserPreferences();
	return { showNsfw: prefsResult?.success ? prefsResult.data?.isNsfw === true : false };
}

function pickAnilistTitle(title, lang) {
	const normalizedLang = normalizeAnilistTitleLanguage(lang);
	const byLang = {
		english: title?.english,
		romaji: title?.romaji,
		native: title?.native,
	};
	return (
		(normalizedLang && typeof byLang[normalizedLang] === "string" && byLang[normalizedLang].trim()
			? byLang[normalizedLang].trim()
			: null) ??
		(typeof title?.english === "string" && title.english.trim() ? title.english.trim() : null) ??
		(typeof title?.romaji === "string" && title.romaji.trim() ? title.romaji.trim() : null) ??
		(typeof title?.native === "string" && title.native.trim() ? title.native.trim() : null) ??
		""
	);
}

function pickRequestedAnilistTitle(title, lang) {
	const normalizedLang = normalizeAnilistTitleLanguage(lang);
	if (!normalizedLang) {
		return null;
	}

	const byLang = {
		english: title?.english,
		romaji: title?.romaji,
		native: title?.native,
	};
	const value = byLang[normalizedLang];
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

function parseAnilistMediaId(contextIdentifier) {
	if (!/^\d+$/.test(contextIdentifier)) {
		throw new Error("externalId must be a numeric Anilist media id");
	}

	const mediaId = Number(contextIdentifier);
	if (!Number.isSafeInteger(mediaId) || mediaId <= 0) {
		throw new Error("externalId must be a positive safe integer Anilist media id");
	}

	return mediaId;
}

function parsePublishYear(startDate) {
	const year = startDate?.year;
	if (typeof year !== "number" || !Number.isFinite(year)) {
		return null;
	}

	return Math.trunc(year);
}

function collectSuggestions(recommendations, titleLang) {
	const suggestionByKey = new Map();
	const nodes = Array.isArray(recommendations?.nodes) ? recommendations.nodes : [];

	for (const node of nodes) {
		const media =
			node?.mediaRecommendation && typeof node.mediaRecommendation === "object"
				? node.mediaRecommendation
				: null;
		if (!media) {
			continue;
		}

		const externalId =
			typeof media.id === "number" && Number.isFinite(media.id)
				? String(Math.trunc(media.id))
				: null;
		if (!externalId) {
			continue;
		}

		const name = pickAnilistTitle(media.title, titleLang);
		if (!name) {
			continue;
		}

		let scriptSlug = null;
		if (media.type === "ANIME") {
			scriptSlug = "anime.anilist";
		} else if (media.type === "MANGA") {
			scriptSlug = "manga.anilist";
		}
		if (!scriptSlug) {
			continue;
		}

		suggestionByKey.set(`${scriptSlug}:${externalId}`, {
			name,
			externalId,
			scriptSlug,
		});
	}

	return [...suggestionByKey.values()];
}

function collectImages(coverImage, bannerImage) {
	const imageSet = new Set();
	const candidates = [coverImage?.extraLarge, bannerImage];

	for (const candidate of candidates) {
		if (typeof candidate !== "string") {
			continue;
		}

		const trimmedCandidate = candidate.trim();
		if (trimmedCandidate) {
			imageSet.add(trimmedCandidate);
		}
	}

	return [...imageSet].map((url) => ({ type: "remote", url }));
}

function collectGenres(genres, tags) {
	const genreSet = new Set();

	if (Array.isArray(genres)) {
		for (const genre of genres) {
			if (typeof genre !== "string") {
				continue;
			}
			const trimmedGenre = genre.trim();
			if (trimmedGenre) {
				genreSet.add(trimmedGenre);
			}
		}
	}

	if (Array.isArray(tags)) {
		for (const tag of tags) {
			const name = typeof tag?.name === "string" ? tag.name.trim() : "";
			if (name) {
				genreSet.add(name);
			}
		}
	}

	return [...genreSet];
}

async function cleanHtmlDescription(html) {
	if (typeof html !== "string" || !html.trim()) {
		return null;
	}
	const { load } = await import("npm:cheerio");
	const $ = load(html);
	$("br").replaceWith("\n");
	return $.root().text().trim() ?? null;
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

	const { showNsfw } = await getAnilistPreferences();

	const graphqlQuery = `
query MediaSearchQuery($page: Int!, $perPage: Int!, $search: String!, $type: MediaType!, $isAdult: Boolean) {
  Page(page: $page, perPage: $perPage) {
    pageInfo { total }
    media(search: $search, type: $type, isAdult: $isAdult) {
      id
      bannerImage
      startDate { year }
      coverImage { extraLarge }
      title { english romaji native userPreferred }
    }
  }
}
`;

	const response = await httpCall("POST", "https://graphql.anilist.co", {
		headers: {
			Accept: "application/json",
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			query: graphqlQuery,
			variables: {
				type: "MANGA",
				search: query,
				page: currentPage,
				perPage: pageSize,
				// null = no isAdult filter (all content); false = non-adult only
				isAdult: showNsfw ? null : false,
			},
		}),
	});

	if (!response?.success) {
		throw new Error(response?.error ?? "Anilist manga search request failed");
	}

	const payload = parseJsonResponse(response.data.body);

	const graphQlErrorMessage = extractGraphQlErrorMessage(payload);
	if (graphQlErrorMessage) {
		throw new Error(`Anilist manga search GraphQL error: ${graphQlErrorMessage}`);
	}

	const pageData =
		payload?.data?.Page && typeof payload.data.Page === "object" ? payload.data.Page : null;

	if (!pageData) {
		throw new Error("Anilist returned invalid response structure");
	}

	const totalItems =
		typeof pageData?.pageInfo?.total === "number" && Number.isFinite(pageData.pageInfo.total)
			? Math.max(0, Math.trunc(pageData.pageInfo.total))
			: 0;

	const mediaItems = Array.isArray(pageData.media) ? pageData.media : [];
	const items = mediaItems
		.map((item) => {
			if (!item || typeof item !== "object") {
				return null;
			}

			const mediaId =
				typeof item.id === "number" && Number.isFinite(item.id) ? Math.trunc(item.id) : null;
			if (mediaId === null || mediaId <= 0) {
				return null;
			}

			const title = pickAnilistTitle(item.title, "english");

			const image = pickImage(item.coverImage, item.bannerImage);
			const publishYear = parsePublishYear(item.startDate);

			return {
				externalId: String(mediaId),
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
		.filter((item) => item !== null);

	return {
		items,
		details: {
			totalItems: totalItems,
			nextPage: currentPage * pageSize < totalItems ? currentPage + 1 : null,
		},
	};
});

driver("details", async function (context, { metadata }) {
	const { z } = await import("npm:zod");

	const { externalId: contextIdentifier } = z
		.object({
			externalId: z.string().trim().min(1, "externalId is required"),
		})
		.parse(context ?? {});

	const mediaId = parseAnilistMediaId(contextIdentifier);
	const titleLang =
		bcp47ToAnilistMode(metadata?.providerInformation?.canonicalLanguage ?? "en") ?? "english";

	const graphqlQuery = `
query MediaDetailsQuery($id: Int!) {
  Media(id: $id) {
    id
    type
    genres
    status
    volumes
    isAdult
    chapters
    description
    bannerImage
    averageScore
    tags { name }
    startDate { year }
    title { english romaji native userPreferred }
    coverImage { extraLarge }
    recommendations { nodes { mediaRecommendation { id type title { english romaji native userPreferred } } } }
  }
}
`;

	const response = await httpCall("POST", "https://graphql.anilist.co", {
		body: JSON.stringify({ query: graphqlQuery, variables: { id: mediaId } }),
		headers: {
			Accept: "application/json",
			"Content-Type": "application/json",
		},
	});

	if (!response?.success) {
		throw new Error(response?.error ?? "Anilist manga details request failed");
	}

	const payload = parseJsonResponse(response.data.body);

	const graphQlErrorMessage = extractGraphQlErrorMessage(payload);
	if (graphQlErrorMessage) {
		throw new Error(`Anilist manga details GraphQL error: ${graphQlErrorMessage}`);
	}

	const media =
		payload?.data?.Media && typeof payload.data.Media === "object" ? payload.data.Media : null;

	if (!media) {
		throw new Error("Anilist returned no media data");
	}

	if (media.type !== "MANGA") {
		throw new Error("Anilist media is not a manga entry");
	}

	const payloadIdentifier =
		typeof media.id === "number" && Number.isFinite(media.id)
			? String(Math.trunc(media.id))
			: contextIdentifier;

	const title = pickAnilistTitle(media.title, titleLang);
	if (!title) {
		throw new Error("Anilist manga payload is missing title");
	}

	const volumes =
		typeof media?.volumes === "number" && Number.isFinite(media.volumes)
			? Math.max(0, Math.trunc(media.volumes))
			: null;

	const chapters =
		typeof media?.chapters === "number" && Number.isFinite(media.chapters) ? media.chapters : null;

	const productionStatus =
		typeof media?.status === "string" && media.status.trim() ? toTitleCase(media.status) : null;

	const rawDescription = typeof media?.description === "string" ? media.description : null;
	const description = await cleanHtmlDescription(rawDescription);

	return {
		name: title,
		suggestions: collectSuggestions(media.recommendations, titleLang),
		properties: {
			volumes,
			chapters,
			productionStatus: productionStatus,
			publishYear: parsePublishYear(media.startDate),
			genres: collectGenres(media.genres, media.tags),
			isNsfw: typeof media?.isAdult === "boolean" ? media.isAdult : null,
			sourceUrl: `https://anilist.co/manga/${payloadIdentifier}/${encodeURIComponent(title)}`,
			description,
			images: collectImages(media.coverImage, media.bannerImage),
			providerRating:
				typeof media?.averageScore === "number" && Number.isFinite(media.averageScore)
					? media.averageScore
					: null,
		},
	};
});

driver("translate", async function (context) {
	const { z } = await import("npm:zod");

	const { externalId: contextIdentifier, language } = z
		.object({
			language: z.string().trim().min(1, "language is required"),
			externalId: z.string().trim().min(1, "externalId is required"),
		})
		.parse(context ?? {});

	const titleLang = bcp47ToAnilistMode(language);
	if (!titleLang) {
		return {};
	}

	const mediaId = parseAnilistMediaId(contextIdentifier);

	const graphqlQuery = `
query MediaTranslationQuery($id: Int!) {
  Media(id: $id) {
    id
    type
    title { english romaji native userPreferred }
  }
}
`;

	const response = await httpCall("POST", "https://graphql.anilist.co", {
		body: JSON.stringify({ query: graphqlQuery, variables: { id: mediaId } }),
		headers: {
			Accept: "application/json",
			"Content-Type": "application/json",
		},
	});

	if (!response?.success) {
		throw new Error(response?.error ?? "Anilist manga translation request failed");
	}

	const payload = parseJsonResponse(response.data.body);

	const graphQlErrorMessage = extractGraphQlErrorMessage(payload);
	if (graphQlErrorMessage) {
		throw new Error(`Anilist manga translation GraphQL error: ${graphQlErrorMessage}`);
	}

	const media =
		payload?.data?.Media && typeof payload.data.Media === "object" ? payload.data.Media : null;

	if (!media) {
		throw new Error("Anilist returned no media data");
	}

	if (media.type !== "MANGA") {
		throw new Error("Anilist media is not a manga entry");
	}

	const name = pickRequestedAnilistTitle(media.title, titleLang);
	const result = {};
	if (name) {
		result.name = name;
	}

	return result;
});

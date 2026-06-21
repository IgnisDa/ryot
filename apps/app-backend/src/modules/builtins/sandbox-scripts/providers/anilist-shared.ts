import type { SandboxHost } from "@ryot/sandbox-sdk/core";
import type {
	ProviderDetailsRelatedEntity,
	ProviderSearchInput,
	ProviderSearchResult,
	ProviderTranslateInput,
	ProviderTranslateResult,
} from "@ryot/sandbox-sdk/provider";

import { getUserIsNsfw } from "../script-helpers/host";
import {
	asRecord,
	numberValue,
	parseJsonResponse,
	stringValue,
	type UnknownRecord,
} from "../script-helpers/records";

export type AnilistHost = SandboxHost<readonly ["httpCall"]>;

export type AnilistUserHost = SandboxHost<readonly ["httpCall", "getUserPreferences"]>;

export type AnilistMediaType = "ANIME" | "MANGA";

export type AnilistTitleLanguage = "english" | "native" | "romaji";

const ANILIST_GRAPHQL_URL = "https://graphql.anilist.co";

const extractGraphQlErrorMessage = (payload: UnknownRecord | null) => {
	const errors = payload?.["errors"];
	if (!Array.isArray(errors) || errors.length === 0) {
		return null;
	}
	const message = asRecord(errors[0])?.["message"];
	return typeof message === "string" ? message.trim() : "";
};

export const anilistGraphql = (
	host: AnilistHost,
	label: string,
	query: string,
	variables: Readonly<Record<string, unknown>>,
) =>
	host
		.httpCall("POST", ANILIST_GRAPHQL_URL, {
			body: JSON.stringify({ query, variables }),
			headers: { Accept: "application/json", "Content-Type": "application/json" },
		})
		.then((response) => {
			if (!response.success) {
				throw new Error(response.error || `Anilist ${label} request failed`);
			}
			const payload = asRecord(parseJsonResponse(response.data.body, "Anilist"));
			const graphQlErrorMessage = extractGraphQlErrorMessage(payload);
			if (graphQlErrorMessage) {
				throw new Error(`Anilist ${label} GraphQL error: ${graphQlErrorMessage}`);
			}
			return asRecord(payload?.["data"]);
		});

export const normalizeAnilistTitleLanguage = (language: unknown): AnilistTitleLanguage | null => {
	const normalized = typeof language === "string" ? language.trim().toLowerCase() : "";
	return normalized === "english" || normalized === "romaji" || normalized === "native"
		? normalized
		: null;
};

export const bcp47ToAnilistMode = (language: string): AnilistTitleLanguage | null => {
	const normalized = language.trim().toLowerCase();
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
};

export const pickAnilistTitle = (title: unknown, language: unknown) => {
	const record = asRecord(title);
	const normalizedLanguage = normalizeAnilistTitleLanguage(language);
	const requested = normalizedLanguage && record ? stringValue(record[normalizedLanguage]) : null;
	return (
		requested ??
		(record ? stringValue(record["english"]) : null) ??
		(record ? stringValue(record["romaji"]) : null) ??
		(record ? stringValue(record["native"]) : null) ??
		""
	);
};

export const pickRequestedAnilistTitle = (title: unknown, language: unknown) => {
	const normalizedLanguage = normalizeAnilistTitleLanguage(language);
	if (!normalizedLanguage) {
		return null;
	}
	const record = asRecord(title);
	return record ? stringValue(record[normalizedLanguage]) : null;
};

export const pickPreferredMediaName = (title: unknown) => {
	const record = asRecord(title);
	return (
		(record ? stringValue(record["userPreferred"]) : null) ??
		(record ? stringValue(record["english"]) : null) ??
		(record ? stringValue(record["romaji"]) : null) ??
		"Loading..."
	);
};

export const parseAnilistId = (externalId: string, label: string) => {
	if (!/^\d+$/.test(externalId)) {
		throw new Error(`externalId must be a numeric Anilist ${label} id`);
	}
	const id = Number(externalId);
	if (!Number.isSafeInteger(id) || id <= 0) {
		throw new Error(`externalId must be a positive safe integer Anilist ${label} id`);
	}
	return id;
};

export const parsePublishYear = (startDate: unknown) => {
	const year = asRecord(startDate)?.["year"];
	return typeof year === "number" && Number.isFinite(year) ? Math.trunc(year) : null;
};

export const mediaScriptSlug = (type: unknown) => {
	if (type === "ANIME") {
		return "anime.anilist";
	}
	if (type === "MANGA") {
		return "manga.anilist";
	}
	return null;
};

export const collectSuggestions = (recommendations: unknown, titleLanguage: unknown) => {
	const suggestionByKey = new Map<string, ProviderDetailsRelatedEntity>();
	const nodes = asRecord(recommendations)?.["nodes"];
	for (const node of Array.isArray(nodes) ? nodes : []) {
		const media = asRecord(asRecord(node)?.["mediaRecommendation"]);
		if (!media) {
			continue;
		}
		const id = numberValue(media["id"]);
		if (id === null) {
			continue;
		}
		const name = pickAnilistTitle(media["title"], titleLanguage);
		if (!name) {
			continue;
		}
		const scriptSlug = mediaScriptSlug(media["type"]);
		if (!scriptSlug) {
			continue;
		}
		const externalId = String(Math.trunc(id));
		suggestionByKey.set(`${scriptSlug}:${externalId}`, { name, externalId, scriptSlug });
	}
	return [...suggestionByKey.values()];
};

export const pickImage = (coverImage: unknown, bannerImage: unknown) =>
	stringValue(asRecord(coverImage)?.["extraLarge"]) ?? stringValue(bannerImage);

export const collectImages = (coverImage: unknown, bannerImage: unknown) => {
	const urls = new Set<string>();
	for (const candidate of [asRecord(coverImage)?.["extraLarge"], bannerImage]) {
		const url = stringValue(candidate);
		if (url) {
			urls.add(url);
		}
	}
	return [...urls].map((url) => ({ type: "remote" as const, url }));
};

export const collectGenres = (genres: unknown, tags: unknown) => {
	const genreSet = new Set<string>();
	for (const genre of Array.isArray(genres) ? genres : []) {
		const name = stringValue(genre);
		if (name) {
			genreSet.add(name);
		}
	}
	for (const tag of Array.isArray(tags) ? tags : []) {
		const name = stringValue(asRecord(tag)?.["name"]);
		if (name) {
			genreSet.add(name);
		}
	}
	return [...genreSet];
};

export const requireAnilistMedia = (data: UnknownRecord | null, type: AnilistMediaType) => {
	const media = asRecord(data?.["Media"]);
	if (!media) {
		throw new Error("Anilist returned no media data");
	}
	if (media["type"] !== type) {
		throw new Error(
			type === "ANIME"
				? "Anilist media is not an anime entry"
				: "Anilist media is not a manga entry",
		);
	}
	return media;
};

const MEDIA_SEARCH_QUERY = `
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

export const searchAnilistMedia = (
	host: AnilistUserHost,
	input: ProviderSearchInput,
	options: { readonly type: AnilistMediaType; readonly label: string },
): Promise<ProviderSearchResult> =>
	getUserIsNsfw(host)
		.then((showNsfw) =>
			anilistGraphql(host, `${options.label} search`, MEDIA_SEARCH_QUERY, {
				type: options.type,
				search: input.query,
				page: input.page,
				perPage: input.pageSize,
				// null = no isAdult filter (all content); false = non-adult only
				isAdult: showNsfw ? null : false,
			}),
		)
		.then((data) => {
			const pageData = asRecord(data?.["Page"]);
			if (!pageData) {
				throw new Error("Anilist returned invalid response structure");
			}
			const totalValue = numberValue(asRecord(pageData["pageInfo"])?.["total"]);
			const totalItems = totalValue === null ? 0 : Math.max(0, Math.trunc(totalValue));
			const mediaItems = Array.isArray(pageData["media"]) ? pageData["media"] : [];
			const items = mediaItems.flatMap((item) => {
				const media = asRecord(item);
				if (!media) {
					return [];
				}
				const idValue = numberValue(media["id"]);
				const mediaId = idValue === null ? null : Math.trunc(idValue);
				if (mediaId === null || mediaId <= 0) {
					return [];
				}
				const title = pickAnilistTitle(media["title"], "english");
				if (!title) {
					return [];
				}
				const image = pickImage(media["coverImage"], media["bannerImage"]);
				const publishYear = parsePublishYear(media["startDate"]);
				return [
					{
						externalId: String(mediaId),
						titleProperty: { kind: "text" as const, value: title },
						calloutProperty: { kind: "null" as const, value: null },
						secondarySubtitleProperty: { kind: "null" as const, value: null },
						primarySubtitleProperty:
							publishYear === null
								? { kind: "null" as const, value: null }
								: { kind: "number" as const, value: publishYear },
						imageProperty:
							image === null
								? { kind: "null" as const, value: null }
								: { kind: "image" as const, value: { type: "remote" as const, url: image } },
					},
				];
			});
			return {
				items,
				details: {
					totalItems,
					nextPage: input.page * input.pageSize < totalItems ? input.page + 1 : null,
				},
			};
		});

const MEDIA_TRANSLATION_QUERY = `
query MediaTranslationQuery($id: Int!) {
  Media(id: $id) {
    id
    type
    title { english romaji native userPreferred }
  }
}
`;

export const translateAnilistMedia = (
	host: AnilistHost,
	input: ProviderTranslateInput,
	options: { readonly type: AnilistMediaType; readonly label: string },
): Promise<ProviderTranslateResult> => {
	const titleLanguage = bcp47ToAnilistMode(input.language);
	if (!titleLanguage) {
		return Promise.resolve({});
	}
	const mediaId = parseAnilistId(input.externalId, "media");
	return anilistGraphql(host, `${options.label} translation`, MEDIA_TRANSLATION_QUERY, {
		id: mediaId,
	}).then((data) => {
		const media = requireAnilistMedia(data, options.type);
		const name = pickRequestedAnilistTitle(media["title"], titleLanguage);
		return name ? { name } : {};
	});
};

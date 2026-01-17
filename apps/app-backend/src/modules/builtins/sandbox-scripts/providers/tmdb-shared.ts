import type { SandboxHost } from "@ryot/sandbox-sdk";
import dayjs from "@ryot/sandbox-sdk/dayjs";
import type { ProviderDetailsRelatedEntity } from "@ryot/sandbox-sdk/provider";

export type TmdbHost = SandboxHost<readonly ["httpCall", "getAppConfigValue"]>;

export type TmdbUserHost = SandboxHost<
	readonly ["httpCall", "getAppConfigValue", "getUserPreferences"]
>;

export type UnknownRecord = Record<string, unknown>;

const TMDB_BASE_URL = "https://api.themoviedb.org/3";
const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/original";

const isRecord = (value: unknown): value is UnknownRecord =>
	value !== null && typeof value === "object" && !Array.isArray(value);

export const asRecord = (value: unknown): UnknownRecord | null => (isRecord(value) ? value : null);

export const recordsValue = (value: unknown) =>
	Array.isArray(value)
		? value.flatMap((item) => {
				const record = asRecord(item);
				return record ? [record] : [];
			})
		: [];

export const stringValue = (value: unknown) =>
	typeof value === "string" && value.trim() ? value.trim() : null;

export const numberValue = (value: unknown) =>
	typeof value === "number" && Number.isFinite(value) ? value : null;

const parseJsonResponse = (responseBody: string) => {
	try {
		const value: unknown = JSON.parse(responseBody);
		return value;
	} catch {
		throw new Error("TMDB returned invalid JSON");
	}
};

export const getUserIsNsfw = (host: TmdbUserHost) =>
	host.getUserPreferences().then((preferences) => preferences.success && preferences.data.isNsfw);

export const getTmdbAccessToken = (host: TmdbHost) =>
	host.getAppConfigValue("providers.tmdbAccessToken").then((response) => {
		if (!response.success) {
			throw new Error(response.error);
		}
		const token = stringValue(response.data);
		if (!token) {
			throw new Error(
				"TMDB access token is not configured. Set MOVIES_AND_SHOWS_TMDB_ACCESS_TOKEN in your environment.",
			);
		}
		return token;
	});

export const tmdbGet = (
	host: TmdbHost,
	path: string,
	params: Readonly<Record<string, string>>,
	token: string,
) => {
	const query = new URLSearchParams(params);
	return host
		.httpCall("GET", `${TMDB_BASE_URL}${path}?${query.toString()}`, {
			headers: { Authorization: `Bearer ${token}` },
		})
		.then((response) => {
			if (!response.success) {
				throw new Error(response.error || `TMDB request failed: ${path}`);
			}
			const payload = asRecord(parseJsonResponse(response.data.body));
			if (!payload) {
				throw new Error("TMDB returned an invalid response object");
			}
			const statusCode = numberValue(payload["status_code"]);
			if (statusCode !== null && statusCode !== 1) {
				throw new Error(
					stringValue(payload["status_message"]) ?? `TMDB API error (status ${statusCode})`,
				);
			}
			return payload;
		});
};

export const getImageUrl = (path: unknown) => {
	const value = stringValue(path);
	return value ? `${TMDB_IMAGE_BASE}${value}` : null;
};

export const parsePublishYear = (date: unknown) => {
	const value = stringValue(date);
	if (!value) {
		return null;
	}
	const parsed = dayjs(value);
	return parsed.isValid() && parsed.year() > 0 ? parsed.year() : null;
};

export const collectImages = (
	posterPath: unknown,
	backdropPath: unknown,
	posters: unknown,
	backdrops: unknown,
) => {
	const seen = new Set<string>();
	const images: Array<{ type: "remote"; url: string }> = [];
	const addImage = (path: unknown) => {
		const url = getImageUrl(path);
		if (url && !seen.has(url)) {
			seen.add(url);
			images.push({ type: "remote", url });
		}
	};

	addImage(posterPath);
	addImage(backdropPath);
	for (const image of recordsValue(posters)) {
		addImage(image["file_path"]);
	}
	for (const image of recordsValue(backdrops)) {
		addImage(image["file_path"]);
	}
	return images;
};

export const collectGenres = (genres: unknown) =>
	recordsValue(genres).flatMap((genre) => {
		const name = stringValue(genre["name"]);
		return name ? [name] : [];
	});

export const collectSuggestions = (
	results: unknown,
	options: { readonly nameKeys: readonly string[]; readonly scriptSlug: string },
) => {
	const suggestions = new Map<string, ProviderDetailsRelatedEntity>();
	for (const result of recordsValue(results)) {
		const id = numberValue(result["id"]);
		const name = options.nameKeys.reduce<string | null>(
			(value, key) => value ?? stringValue(result[key]),
			null,
		);
		if (id === null || !name) {
			continue;
		}
		const externalId = String(Math.trunc(id));
		suggestions.set(`${options.scriptSlug}:${externalId}`, {
			name,
			externalId,
			scriptSlug: options.scriptSlug,
		});
	}
	return [...suggestions.values()];
};

export const fetchTrendingItems = (
	host: TmdbHost,
	path: string,
	language: string,
	token: string,
	options: { readonly nameKeys: readonly string[]; readonly scriptSlug: string },
) =>
	[1, 2, 3]
		.reduce<Promise<unknown[]>>(
			(result, page) =>
				result.then((items) =>
					tmdbGet(host, path, { language, page: String(page) }, token).then((data) => {
						const pageResults = data["results"];
						return Array.isArray(pageResults) ? [...items, ...pageResults] : items;
					}),
				),
			Promise.resolve([]),
		)
		.then((results) =>
			collectSuggestions(results, options).map(({ name, externalId }) => ({ name, externalId })),
		);

export const parseTranslationLanguage = (language: string) => {
	const [languagePart = "", regionPart] = language.split("-");
	return {
		langCode: languagePart.trim().toLowerCase(),
		region: regionPart ? regionPart.trim().toUpperCase() : null,
	};
};

export const orderedTranslationCandidates = (
	translationsData: UnknownRecord,
	langCode: string,
	region: string | null,
) => {
	const candidates = recordsValue(translationsData["translations"]).filter(
		(entry) => stringValue(entry["iso_639_1"])?.toLowerCase() === langCode,
	);
	const regionMatch = region
		? candidates.find((entry) => stringValue(entry["iso_3166_1"])?.toUpperCase() === region)
		: null;
	return regionMatch
		? [regionMatch, ...candidates.filter((entry) => entry !== regionMatch)]
		: candidates;
};

export const firstTranslationValue = (
	candidates: readonly UnknownRecord[],
	extract: (data: UnknownRecord) => unknown,
) => {
	for (const entry of candidates) {
		const data = asRecord(entry["data"]);
		const value = data ? stringValue(extract(data)) : null;
		if (value) {
			return value;
		}
	}
	return null;
};

export const getLocalizedImageUrl = (
	imagesData: UnknownRecord,
	imageKey: string,
	langCode: string,
) => {
	const localizedImage = recordsValue(imagesData[imageKey]).find(
		(image) => stringValue(image["iso_639_1"])?.toLowerCase() === langCode,
	);
	return localizedImage ? getImageUrl(localizedImage["file_path"]) : null;
};

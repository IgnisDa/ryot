import type { SandboxHost } from "@ryot/sandbox-sdk";
import dayjs from "@ryot/sandbox-sdk/dayjs";
import type {
	ProviderDetailsRelatedEntity,
	ProviderSearchInput,
	ProviderSearchResult,
} from "@ryot/sandbox-sdk/provider";

export type MyAnimeListHost = SandboxHost<
	readonly ["httpCall", "getAppConfigValue", "getUserPreferences"]
>;

export type UnknownRecord = Record<string, unknown>;

const MAL_API_BASE_URL = "https://api.myanimelist.net/v2";

const isRecord = (value: unknown): value is UnknownRecord =>
	value !== null && typeof value === "object" && !Array.isArray(value);

export const asRecord = (value: unknown): UnknownRecord | null => (isRecord(value) ? value : null);

export const stringValue = (value: unknown) =>
	typeof value === "string" && value.trim() ? value.trim() : null;

export const numberValue = (value: unknown) =>
	typeof value === "number" && Number.isFinite(value) ? value : null;

const parseJsonResponse = (responseBody: string) => {
	try {
		const value: unknown = JSON.parse(responseBody);
		return value;
	} catch {
		throw new Error("MyAnimeList returned invalid JSON");
	}
};

export const getMalClientId = (host: MyAnimeListHost) =>
	host.getAppConfigValue("providers.malClientId").then((response) => {
		if (!response.success) {
			throw new Error(response.error || "Could not load MyAnimeList client ID");
		}
		const clientId = typeof response.data === "string" ? response.data.trim() : "";
		if (!clientId) {
			throw new Error("ANIME_AND_MANGA_MAL_CLIENT_ID is not configured");
		}
		return clientId;
	});

export const getUserIsNsfw = (host: MyAnimeListHost) =>
	host.getUserPreferences().then((preferences) => preferences.success && preferences.data.isNsfw);

export const malGet = (
	host: MyAnimeListHost,
	clientId: string,
	path: string,
	params: URLSearchParams,
	label: string,
) =>
	host
		.httpCall("GET", `${MAL_API_BASE_URL}${path}?${params.toString()}`, {
			headers: { "X-MAL-CLIENT-ID": clientId },
		})
		.then((response) => {
			if (!response.success) {
				throw new Error(response.error || `MyAnimeList ${label} request failed`);
			}
			return parseJsonResponse(response.data.body);
		});

export const parsePublishYear = (startDate: unknown) => {
	const value = stringValue(startDate);
	if (!value) {
		return null;
	}
	const parsed = dayjs(value);
	return parsed.isValid() ? parsed.year() : null;
};

export const parsePublishDate = (startDate: unknown) => {
	const value = stringValue(startDate);
	return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
};

export const parseIsNsfw = (nsfw: unknown) => {
	const value = stringValue(nsfw);
	return value === null ? null : value.toLowerCase() !== "white";
};

export const pickImage = (mainPicture: unknown) => {
	const record = asRecord(mainPicture);
	if (!record) {
		return null;
	}
	return stringValue(record["large"]) ?? stringValue(record["medium"]);
};

export const collectImages = (mainPicture: unknown) => {
	const record = asRecord(mainPicture);
	if (!record) {
		return [];
	}
	const urls = new Set<string>();
	for (const candidate of [record["large"], record["medium"]]) {
		const url = stringValue(candidate);
		if (url) {
			urls.add(url);
		}
	}
	return [...urls].map((url) => ({ type: "remote" as const, url }));
};

export const collectGenres = (genres: unknown) => {
	if (!Array.isArray(genres)) {
		return [];
	}
	const genreSet = new Set<string>();
	for (const genre of genres) {
		const name = stringValue(asRecord(genre)?.["name"]);
		if (name) {
			genreSet.add(name);
		}
	}
	return [...genreSet];
};

export const collectSuggestionItems = (entries: unknown, scriptSlug: string) => {
	if (!Array.isArray(entries)) {
		return [];
	}
	const suggestionByKey = new Map<string, ProviderDetailsRelatedEntity>();
	for (const entry of entries) {
		const node = asRecord(asRecord(entry)?.["node"]);
		if (!node) {
			continue;
		}
		const idValue = numberValue(node["id"]);
		if (idValue === null) {
			continue;
		}
		const name = stringValue(node["title"]);
		if (!name) {
			continue;
		}
		const externalId = String(Math.trunc(idValue));
		suggestionByKey.set(`${scriptSlug}:${externalId}`, { name, externalId, scriptSlug });
	}
	return [...suggestionByKey.values()];
};

export const searchMal = (
	host: MyAnimeListHost,
	input: ProviderSearchInput,
	options: { readonly path: "anime" | "manga" },
): Promise<ProviderSearchResult> =>
	Promise.all([getMalClientId(host), getUserIsNsfw(host)]).then(([clientId, showNsfw]) => {
		const params = new URLSearchParams({
			q: input.query,
			fields: "start_date,main_picture",
			offset: String((input.page - 1) * input.pageSize),
			limit: String(input.pageSize),
		});
		if (showNsfw) {
			params.set("nsfw", "true");
		}
		return malGet(host, clientId, `/${options.path}`, params, `${options.path} search`).then(
			(payloadValue) => {
				const payload = asRecord(payloadValue);
				const hasNextPage = stringValue(asRecord(payload?.["paging"])?.["next"]) !== null;
				const data = payload?.["data"];
				const items = (Array.isArray(data) ? data : []).flatMap((entry) => {
					const node = asRecord(asRecord(entry)?.["node"]);
					if (!node) {
						return [];
					}
					const idValue = numberValue(node["id"]);
					const nodeId = idValue === null ? null : Math.trunc(idValue);
					if (nodeId === null || nodeId <= 0) {
						return [];
					}
					const title = stringValue(node["title"]);
					if (!title) {
						return [];
					}
					const image = pickImage(node["main_picture"]);
					const publishYear = parsePublishYear(node["start_date"]);
					return [
						{
							externalId: String(nodeId),
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
				const minimumTotalItems = (input.page - 1) * input.pageSize + items.length;
				return {
					items,
					details: {
						nextPage: hasNextPage ? input.page + 1 : null,
						totalItems: hasNextPage ? minimumTotalItems + 1 : minimumTotalItems,
					},
				};
			},
		);
	});

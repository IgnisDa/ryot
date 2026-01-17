import type { SandboxHost } from "@ryot/sandbox-sdk/core";
import { DateTime, Effect, Option } from "@ryot/sandbox-sdk/effect";
import type {
	ProviderDetailsRelatedEntity,
	ProviderSearchInput,
	ProviderSearchResult,
} from "@ryot/sandbox-sdk/provider";

import { getUserIsNsfw } from "../script-helpers/host";
import { asRecord, numberValue, parseJsonResponse, stringValue } from "../script-helpers/records";

export type MyAnimeListHost = SandboxHost<
	readonly ["httpCall", "getPluginConfigValue", "getUserPreferences"]
>;

const MAL_API_BASE_URL = "https://api.myanimelist.net/v2";

export const getMalClientId = (host: MyAnimeListHost) =>
	host.getPluginConfigValue("malClientId").pipe(
		Effect.mapError((error) => new Error(error.message || "Could not load MyAnimeList client ID")),
		Effect.map((value) => {
			const clientId = typeof value === "string" ? value.trim() : "";
			if (!clientId) {
				throw new Error("RYOT_PLUGIN_MEDIA_MAL_CLIENT_ID is not configured");
			}
			return clientId;
		}),
	);

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
		.pipe(
			Effect.mapError((error) => new Error(error.message || `MyAnimeList ${label} request failed`)),
			Effect.map((response) => parseJsonResponse(response.body, "MyAnimeList")),
		);

export const parsePublishYear = (startDate: unknown) => {
	const value = stringValue(startDate);
	if (!value) {
		return null;
	}
	const parsed = DateTime.make(value);
	if (Option.isNone(parsed)) {
		return null;
	}
	return DateTime.toDateUtc(parsed.value).getFullYear();
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

export const collectSuggestionItems = (entries: unknown, providerSlug: string) => {
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
		suggestionByKey.set(`${providerSlug}:${externalId}`, { name, externalId, providerSlug });
	}
	return [...suggestionByKey.values()];
};

export const searchMal = (
	host: MyAnimeListHost,
	input: ProviderSearchInput,
	options: { readonly path: "anime" | "manga" },
): Effect.Effect<ProviderSearchResult, unknown> =>
	Effect.all([getMalClientId(host), getUserIsNsfw(host)], { concurrency: "unbounded" }).pipe(
		Effect.flatMap(([clientId, showNsfw]) => {
			const params = new URLSearchParams({
				q: input.query,
				fields: "start_date,main_picture",
				offset: String((input.page - 1) * input.pageSize),
				limit: String(input.pageSize),
			});
			if (showNsfw) {
				params.set("nsfw", "true");
			}
			return malGet(host, clientId, `/${options.path}`, params, `${options.path} search`).pipe(
				Effect.map((payloadValue) => {
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
				}),
			);
		}),
	);

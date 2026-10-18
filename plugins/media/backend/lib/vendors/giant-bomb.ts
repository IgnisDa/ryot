import type { ScriptHost } from "@ryot-app/plugin-backend-sdk/core";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { asRecord } from "@ryot-app/plugin-backend-sdk/wire";

import { MediaSandboxError } from "../failures";
import { normalizePlainDescription } from "../plain-description";
import { decodeJsonResponse, numberValue, stringValue, type UnknownRecord } from "../records";
import { normalizeRichDescription } from "../rich-description";

export type GiantBombHost = Pick<ScriptHost, "httpCall" | "getPluginConfig">;

export const BASE_URL = "https://www.giantbomb.com/api";
export const GUID_PATTERN = /^\d+-\d+$/;

export const getApiKey = (host: GiantBombHost) =>
	host.getPluginConfig({ required: ["giantBombApiKey"] }).pipe(
		Effect.map(({ giantBombApiKey }) => giantBombApiKey),
		Effect.mapError((error) => ({
			...error,
			message: error.message || "Failed to retrieve GiantBomb API key",
		})),
		Effect.flatMap((value) => {
			const apiKey = stringValue(value);
			if (!apiKey) {
				return Effect.fail(
					new MediaSandboxError({
						message:
							"GiantBomb API key is not configured. Set giantBombApiKey in the plugin configuration.",
					}),
				);
			}
			return Effect.succeed(apiKey);
		}),
	);

export const giantBombRequest = (
	host: GiantBombHost,
	path: string,
	params: Readonly<Record<string, string>>,
	failureMessage: string,
) =>
	getApiKey(host).pipe(
		Effect.flatMap((apiKey) => {
			const search = new URLSearchParams({ format: "json", api_key: apiKey, ...params });
			const url = `${BASE_URL}/${path}?${search.toString()}`;
			return host.httpCall("GET", url, { headers: { Accept: "application/json" } }).pipe(
				Effect.mapError((error) => ({ ...error, message: error.message || failureMessage })),
				Effect.flatMap((response) => decodeJsonResponse(response.body, "GiantBomb")),
				Effect.flatMap((response) => {
					const payload = asRecord(response);
					const errorValue = payload?.["error"];
					return typeof errorValue === "string" && errorValue && errorValue !== "OK"
						? Effect.fail(new MediaSandboxError({ message: `GiantBomb API error: ${errorValue}` }))
						: Effect.succeed(payload);
				}),
			);
		}),
	);

export const getPrioritizedImage = (image: unknown) => {
	const record = asRecord(image);
	if (!record) {
		return null;
	}
	const candidateKeys = [
		"original_url",
		"super_url",
		"medium_url",
		"screen_large_url",
		"screen_url",
		"small_url",
		"thumb_url",
		"icon_url",
		"tiny_url",
	];
	for (const key of candidateKeys) {
		const candidate = stringValue(record[key]);
		if (candidate) {
			return candidate;
		}
	}
	return null;
};

export const extractYear = (dateStr: unknown) => {
	if (typeof dateStr !== "string" || !dateStr.trim()) {
		return null;
	}
	const match = /^(\d{4})/.exec(dateStr);
	const year = match ? Number.parseInt(match[1] ?? "", 10) : Number.NaN;
	return Number.isFinite(year) ? year : null;
};

export const combineDescription = Effect.fn("combineDescription")(function* (
	deck: unknown,
	description: unknown,
) {
	const plain = normalizePlainDescription(deck);
	const rich = yield* normalizeRichDescription(description, "https://www.giantbomb.com");
	const parts = [plain, rich].filter((part) => part !== null);
	return parts.length > 0 ? parts.join("\n\n") : null;
});

export const extractGiantBombGuid = (apiDetailUrl: unknown) => {
	const value = stringValue(apiDetailUrl);
	if (!value) {
		return null;
	}
	const parts = value.split("/").filter((part) => part.trim());
	const guid = parts.at(-1);
	return typeof guid === "string" && guid.trim() ? guid.trim() : null;
};

export const collectNames = (items: unknown) => {
	if (!Array.isArray(items)) {
		return [];
	}
	return items.flatMap((item) => {
		const name = stringValue(asRecord(item)?.["name"]);
		return name ? [name] : [];
	});
};

export const readTotalItems = (payload: null | UnknownRecord) => {
	const total = numberValue(payload?.["number_of_total_results"]);
	return total === null ? 0 : Math.max(0, Math.trunc(total));
};

export const readResults = (payload: null | UnknownRecord) => {
	const results = payload?.["results"];
	return Array.isArray(results) ? results : [];
};

export const paginate = (page: number, pageSize: number, totalItems: number) => ({
	totalItems,
	nextPage: page * pageSize < totalItems ? page + 1 : null,
});

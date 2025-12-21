import type { JsonValue, SandboxHost } from "@ryot/sandbox-sdk";

export type MangaUpdatesHost = SandboxHost<readonly ["httpCall"]>;

export type UnknownRecord = Record<string, unknown>;

const MANGA_UPDATES_API_BASE_URL = "https://api.mangaupdates.com/v1";

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
		throw new Error("MangaUpdates returned invalid JSON");
	}
};

export const mangaUpdatesGet = (host: MangaUpdatesHost, path: string, label: string) =>
	host.httpCall("GET", `${MANGA_UPDATES_API_BASE_URL}${path}`).then((response) => {
		if (!response.success) {
			throw new Error(response.error || `MangaUpdates ${label} request failed`);
		}
		return parseJsonResponse(response.data.body);
	});

export const mangaUpdatesGetOptional = (host: MangaUpdatesHost, path: string) =>
	host.httpCall("GET", `${MANGA_UPDATES_API_BASE_URL}${path}`).then((response) => {
		if (!response.success) {
			return null;
		}
		try {
			const value: unknown = JSON.parse(response.data.body);
			return value;
		} catch {
			return null;
		}
	});

export const mangaUpdatesPost = (
	host: MangaUpdatesHost,
	path: string,
	body: JsonValue,
	label: string,
) =>
	host
		.httpCall("POST", `${MANGA_UPDATES_API_BASE_URL}${path}`, {
			body: JSON.stringify(body),
			headers: { "Content-Type": "application/json" },
		})
		.then((response) => {
			if (!response.success) {
				throw new Error(response.error || `MangaUpdates ${label} request failed`);
			}
			return parseJsonResponse(response.data.body);
		});

export const searchTotalItems = (payload: UnknownRecord | null) => {
	const totalValue = numberValue(payload?.["total_hits"]);
	return totalValue === null ? 0 : Math.max(0, Math.trunc(totalValue));
};

export const imageUrlValue = (image: unknown) =>
	stringValue(asRecord(asRecord(image)?.["url"])?.["original"]);

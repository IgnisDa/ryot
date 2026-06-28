import type { SandboxHost } from "@ryot/sandbox-sdk";

export type GiantBombHost = SandboxHost<readonly ["httpCall", "getAppConfigValue"]>;

export type UnknownRecord = Record<string, unknown>;

export const BASE_URL = "https://www.giantbomb.com/api";
export const GUID_PATTERN = /^\d+-\d+$/;

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
		throw new Error("GiantBomb returned invalid JSON");
	}
};

export const getApiKey = (host: GiantBombHost) =>
	host.getAppConfigValue("providers.giantBombApiKey").then((response) => {
		if (!response.success) {
			throw new Error(response.error || "Failed to retrieve GiantBomb API key");
		}
		const apiKey = stringValue(response.data);
		if (!apiKey) {
			throw new Error(
				"GiantBomb API key is not configured. Set VIDEO_GAMES_GIANT_BOMB_API_KEY in your environment.",
			);
		}
		return apiKey;
	});

export const giantBombRequest = (
	host: GiantBombHost,
	path: string,
	params: Readonly<Record<string, string>>,
	failureMessage: string,
): Promise<UnknownRecord | null> =>
	getApiKey(host).then((apiKey) => {
		const search = new URLSearchParams({ api_key: apiKey, format: "json", ...params });
		const url = `${BASE_URL}/${path}?${search.toString()}`;
		return host
			.httpCall("GET", url, { headers: { Accept: "application/json" } })
			.then((response) => {
				if (!response.success) {
					throw new Error(response.error || failureMessage);
				}
				const payload = asRecord(parseJsonResponse(response.data.body));
				const errorValue = payload?.["error"];
				if (typeof errorValue === "string" && errorValue && errorValue !== "OK") {
					throw new Error(`GiantBomb API error: ${errorValue}`);
				}
				return payload;
			});
	});

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

export const combineDescription = (deck: unknown, description: unknown) => {
	const deckTrimmed = typeof deck === "string" ? deck.trim() : null;
	const descTrimmed = typeof description === "string" ? description.trim() : null;
	if (deckTrimmed && descTrimmed) {
		return `${deckTrimmed}\n\n${descTrimmed}`;
	}
	return deckTrimmed ?? descTrimmed ?? null;
};

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

export const readTotalItems = (payload: UnknownRecord | null) => {
	const total = numberValue(payload?.["number_of_total_results"]);
	return total === null ? 0 : Math.max(0, Math.trunc(total));
};

export const readResults = (payload: UnknownRecord | null) => {
	const results = payload?.["results"];
	return Array.isArray(results) ? results : [];
};

export const paginate = (page: number, pageSize: number, totalItems: number) => ({
	totalItems,
	nextPage: page * pageSize < totalItems ? page + 1 : null,
});

export type ImageProperty =
	| { kind: "null"; value: null }
	| { kind: "image"; value: { type: "remote"; url: string } };

export const imageProperty = (url: string | null): ImageProperty =>
	url === null ? { kind: "null", value: null } : { kind: "image", value: { type: "remote", url } };

export type RoleRelatedEntity = {
	name: string;
	externalId: string;
	scriptSlug: string;
	relationshipProperties: { roles: string[] };
};

export const createRoleAccumulator = () => {
	const entities: RoleRelatedEntity[] = [];
	const byKey = new Map<string, RoleRelatedEntity>();
	const add = (entity: RoleRelatedEntity) => {
		const key = `${entity.scriptSlug}:${entity.externalId}`;
		const existing = byKey.get(key);
		if (!existing) {
			byKey.set(key, entity);
			entities.push(entity);
			return;
		}
		existing.relationshipProperties.roles = [
			...new Set([
				...existing.relationshipProperties.roles,
				...entity.relationshipProperties.roles,
			]),
		];
		if (existing.name === "Loading..." && entity.name !== "Loading...") {
			existing.name = entity.name;
		}
	};
	return { entities, add };
};

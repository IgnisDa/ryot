import type { SandboxHost } from "@ryot/sandbox-sdk";
import dayjs from "@ryot/sandbox-sdk/dayjs";

export type MusicBrainzHost = SandboxHost<readonly ["httpCall"]>;

export type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
	value !== null && typeof value === "object" && !Array.isArray(value);

export const asRecord = (value: unknown): UnknownRecord | null => (isRecord(value) ? value : null);

export const stringValue = (value: unknown) =>
	typeof value === "string" && value.trim() ? value.trim() : null;

export const numberValue = (value: unknown) =>
	typeof value === "number" && Number.isFinite(value) ? value : null;

export const trimmedString = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const MB_BASE = "https://musicbrainz.org/ws/2";
const CAA_BASE = "https://coverartarchive.org";
const MB_HEADERS = { Accept: "application/json" };

const parseJsonResponse = (responseBody: string) => {
	try {
		const value: unknown = JSON.parse(responseBody);
		return value;
	} catch {
		throw new Error("MusicBrainz returned invalid JSON");
	}
};

export const mbGet = (
	host: MusicBrainzHost,
	path: string,
	params: Readonly<Record<string, string>>,
): Promise<unknown> => {
	const search = new URLSearchParams({ fmt: "json", ...params });
	const url = `${MB_BASE}/${path}?${search.toString()}`;
	return host.httpCall("GET", url, { headers: MB_HEADERS }).then((response) => {
		if (!response.success) {
			if (response.data?.status === 404) {
				return null;
			}
			throw new Error(response.error || `MusicBrainz request failed: ${path}`);
		}
		return parseJsonResponse(response.data.body);
	});
};

export const fetchCoverArtUrl = (
	host: MusicBrainzHost,
	resourceType: string,
	resourceId: string,
): Promise<string | null> => {
	const url = `${CAA_BASE}/${resourceType}/${resourceId}`;
	return host.httpCall("GET", url, { headers: { Accept: "application/json" } }).then((response) => {
		if (!response.success) {
			return null;
		}
		let payload: unknown;
		try {
			payload = parseJsonResponse(response.data.body);
		} catch {
			return null;
		}
		const images = asRecord(payload)?.["images"];
		if (!Array.isArray(images)) {
			return null;
		}
		const frontImage = images.find((image) => asRecord(image)?.["front"] === true) ?? images[0];
		const front = asRecord(frontImage);
		if (!front) {
			return null;
		}
		const thumbnails = asRecord(front["thumbnails"]);
		return (
			stringValue(thumbnails?.["1200"]) ??
			stringValue(thumbnails?.["500"]) ??
			stringValue(thumbnails?.["250"]) ??
			stringValue(thumbnails?.["large"]) ??
			stringValue(thumbnails?.["small"]) ??
			stringValue(front["image"])
		);
	});
};

export const findCoverArtFromReleases = (
	host: MusicBrainzHost,
	releases: readonly unknown[],
): Promise<string | null> => {
	const firstThree = releases.slice(0, 3);
	const tryGroups = (index: number, seen: Set<string>): Promise<string | null> => {
		if (index >= firstThree.length) {
			return Promise.resolve(null);
		}
		const releaseGroupId = stringValue(
			asRecord(asRecord(firstThree[index])?.["release-group"])?.["id"],
		);
		if (!releaseGroupId || seen.has(releaseGroupId)) {
			return tryGroups(index + 1, seen);
		}
		seen.add(releaseGroupId);
		return fetchCoverArtUrl(host, "release-group", releaseGroupId).then(
			(url) => url ?? tryGroups(index + 1, seen),
		);
	};
	const tryReleases = (index: number): Promise<string | null> => {
		if (index >= firstThree.length) {
			return tryGroups(0, new Set<string>());
		}
		const releaseId = stringValue(asRecord(firstThree[index])?.["id"]);
		if (!releaseId) {
			return tryReleases(index + 1);
		}
		return fetchCoverArtUrl(host, "release", releaseId).then(
			(url) => url ?? tryReleases(index + 1),
		);
	};
	return tryReleases(0);
};

export const getPublishYear = (dateValue: unknown) => {
	const value = stringValue(dateValue);
	if (!value) {
		return null;
	}
	const parsed = dayjs(value);
	return parsed.isValid() && parsed.year() > 0 ? parsed.year() : null;
};

export const buildLuceneQuery = (query: string, fields: readonly string[]) => {
	const escaped = query.replace(/([+\-!(){}[\]^"~*?:\\/])/g, "\\$1");
	return fields.map((field) => `${field}:(${escaped})`).join(" OR ");
};

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

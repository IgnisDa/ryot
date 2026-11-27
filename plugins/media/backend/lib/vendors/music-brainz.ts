import type { ScriptHost } from "@ryot-app/plugin-backend-sdk/core";
import { DateTime, Effect, Option } from "@ryot-app/plugin-backend-sdk/effect";
import { asArray, asRecord } from "@ryot-app/plugin-backend-sdk/wire";

import { MediaSandboxError } from "../failures";
import { decodeJsonResponse, parseJsonResponse, stringValue } from "../records";

export type MusicBrainzHost = Pick<ScriptHost, "httpCall">;

const MB_BASE = "https://musicbrainz.org/ws/2";
const CAA_BASE = "https://coverartarchive.org";
const MB_HEADERS = { Accept: "application/json" };

export const mbGet = (
	host: MusicBrainzHost,
	path: string,
	params: Readonly<Record<string, string>>,
) => {
	const search = new URLSearchParams({ fmt: "json", ...params });
	const url = `${MB_BASE}/${path}?${search.toString()}`;
	return host.httpCall("GET", url, { headers: MB_HEADERS }).pipe(
		Effect.mapError((error) => ({
			...error,
			message: error.message || `MusicBrainz request failed: ${path}`,
		})),
		Effect.flatMap((response) => decodeJsonResponse(response.body, "MusicBrainz")),
	);
};

export const mbBrowsePage = Effect.fnUntraced(function* (
	host: MusicBrainzHost,
	entity: "release" | "recording" | "release-group",
	params: Readonly<Record<string, string>>,
	offset: number,
	expectedTotal: null | number,
) {
	return yield* mbGet(host, entity, { ...params, limit: "100", offset: String(offset) }).pipe(
		Effect.flatMap((value) => {
			const data = asRecord(value);
			const values = data?.[`${entity}s`];
			const count = data?.[`${entity}-count`];
			const returnedOffset = data?.[`${entity}-offset`];
			const total = typeof count === "number" ? count : expectedTotal;
			if (
				!Array.isArray(values) ||
				values.length > 100 ||
				(count !== undefined &&
					(typeof count !== "number" || !Number.isSafeInteger(count) || count < 0)) ||
				(returnedOffset !== undefined && returnedOffset !== offset) ||
				(expectedTotal !== null && total !== expectedTotal) ||
				(total !== null &&
					(offset + values.length > total || (values.length === 0 && offset < total)))
			) {
				return Effect.fail(
					new MediaSandboxError({
						message: `Invalid MusicBrainz ${entity} browse page at ${offset}`,
					}),
				);
			}
			const items: Record<string, unknown>[] = [];
			for (const itemValue of values) {
				const item = asRecord(itemValue);
				const id = stringValue(item?.["id"]);
				if (!item || !id || id.length > 256) {
					return Effect.fail(
						new MediaSandboxError({
							message: `MusicBrainz ${entity} browse item is missing a valid ID`,
						}),
					);
				}
				items.push(item);
			}
			const hasMore = total === null ? items.length > 0 : offset + items.length < total;
			return Effect.succeed({ items, total, nextOffset: hasMore ? offset + items.length : null });
		}),
	);
});

export const mbOffsetCursor = (value: unknown) => {
	const record = asRecord(value);
	const offset = record?.["offset"];
	const total = record?.["total"];
	return typeof offset === "number" &&
		Number.isSafeInteger(offset) &&
		offset >= 0 &&
		(total === null ||
			(typeof total === "number" && Number.isSafeInteger(total) && total >= offset))
		? Effect.succeed({ total, offset })
		: Effect.fail(new MediaSandboxError({ message: "Invalid MusicBrainz inventory continuation" }));
};

export const fetchCoverArtUrl = (
	host: MusicBrainzHost,
	resourceType: string,
	resourceId: string,
): Effect.Effect<null | string> => {
	const url = `${CAA_BASE}/${resourceType}/${resourceId}`;
	return host.httpCall("GET", url, { headers: { Accept: "application/json" } }).pipe(
		Effect.map((response) => {
			let payload: unknown;
			try {
				payload = parseJsonResponse(response.body, "MusicBrainz");
			} catch {
				return null;
			}
			const images = asArray(asRecord(payload)?.["images"]);
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
		}),
		Effect.orElseSucceed(() => null),
	);
};

export const findCoverArtFromReleases = (
	host: MusicBrainzHost,
	releases: readonly unknown[],
): Effect.Effect<null | string> => {
	const firstThree = releases.slice(0, 3);
	const tryGroups = (index: number, seen: Set<string>): Effect.Effect<null | string> => {
		if (index >= firstThree.length) {
			return Effect.succeed(null);
		}
		const releaseGroupId = stringValue(
			asRecord(asRecord(firstThree[index])?.["release-group"])?.["id"],
		);
		if (!releaseGroupId || seen.has(releaseGroupId)) {
			return tryGroups(index + 1, seen);
		}
		seen.add(releaseGroupId);
		return fetchCoverArtUrl(host, "release-group", releaseGroupId).pipe(
			Effect.filterOrElse(
				(url): url is string => Boolean(url),
				() => tryGroups(index + 1, seen),
			),
		);
	};
	const tryReleases = (index: number): Effect.Effect<null | string> => {
		if (index >= firstThree.length) {
			return tryGroups(0, new Set<string>());
		}
		const releaseId = stringValue(asRecord(firstThree[index])?.["id"]);
		if (!releaseId) {
			return tryReleases(index + 1);
		}
		return fetchCoverArtUrl(host, "release", releaseId).pipe(
			Effect.filterOrElse(
				(url): url is string => Boolean(url),
				() => tryReleases(index + 1),
			),
		);
	};
	return tryReleases(0);
};

export const getPublishYear = (dateValue: unknown) => {
	const value = stringValue(dateValue);
	if (!value) {
		return null;
	}
	const parsed = DateTime.make(value);
	if (Option.isNone(parsed)) {
		return null;
	}
	const year = DateTime.getPartUtc(parsed.value, "year");
	return year > 0 ? year : null;
};

export const buildLuceneQuery = (query: string, fields: readonly string[]) => {
	const escaped = query.replaceAll(/([+\-!(){}[\]^"~*?:\\/])/g, "\\$1");
	return fields.map((field) => `${field}:(${escaped})`).join(" OR ");
};

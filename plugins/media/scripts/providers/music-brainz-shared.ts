import type { SandboxHost } from "@ryot/sandbox-sdk/core";
import dayjs from "@ryot/sandbox-sdk/dayjs";
import { Effect } from "@ryot/sandbox-sdk/effect";

import { asRecord, parseJsonResponse, stringValue } from "../script-helpers/records";

export type MusicBrainzHost = SandboxHost<readonly ["httpCall"]>;

const MB_BASE = "https://musicbrainz.org/ws/2";
const CAA_BASE = "https://coverartarchive.org";
const MB_HEADERS = { Accept: "application/json" };

export const mbGet = (
	host: MusicBrainzHost,
	path: string,
	params: Readonly<Record<string, string>>,
): Effect.Effect<unknown, unknown> => {
	const search = new URLSearchParams({ fmt: "json", ...params });
	const url = `${MB_BASE}/${path}?${search.toString()}`;
	return host.httpCall("GET", url, { headers: MB_HEADERS }).pipe(
		Effect.map((response) => parseJsonResponse(response.body, "MusicBrainz")),
		Effect.catchAll((error) =>
			Effect.fail(new Error(error.message || `MusicBrainz request failed: ${path}`)),
		),
	);
};

export const fetchCoverArtUrl = (
	host: MusicBrainzHost,
	resourceType: string,
	resourceId: string,
): Effect.Effect<string | null> => {
	const url = `${CAA_BASE}/${resourceType}/${resourceId}`;
	return host.httpCall("GET", url, { headers: { Accept: "application/json" } }).pipe(
		Effect.map((response) => {
			let payload: unknown;
			try {
				payload = parseJsonResponse(response.body, "MusicBrainz");
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
		}),
		Effect.catchAll(() => Effect.succeed(null)),
	);
};

export const findCoverArtFromReleases = (
	host: MusicBrainzHost,
	releases: readonly unknown[],
): Effect.Effect<string | null> => {
	const firstThree = releases.slice(0, 3);
	const tryGroups = (index: number, seen: Set<string>): Effect.Effect<string | null> => {
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
			Effect.flatMap((url) => (url ? Effect.succeed(url) : tryGroups(index + 1, seen))),
		);
	};
	const tryReleases = (index: number): Effect.Effect<string | null> => {
		if (index >= firstThree.length) {
			return tryGroups(0, new Set<string>());
		}
		const releaseId = stringValue(asRecord(firstThree[index])?.["id"]);
		if (!releaseId) {
			return tryReleases(index + 1);
		}
		return fetchCoverArtUrl(host, "release", releaseId).pipe(
			Effect.flatMap((url) => (url ? Effect.succeed(url) : tryReleases(index + 1))),
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

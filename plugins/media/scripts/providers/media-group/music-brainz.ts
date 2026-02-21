import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { Effect } from "@ryot/sandbox-sdk/effect";
import { defineProvider } from "@ryot/sandbox-sdk/provider";

import {
	type UnknownRecord,
	asRecord,
	numberValue,
	stringValue,
} from "../../script-helpers/records";
import { buildLuceneQuery, fetchCoverArtUrl, mbGet } from "../music-brainz-shared";

export const manifest = defineManifest({
	kind: "provider",
	name: "MusicBrainz",
	slug: "music-group.music-brainz",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	capabilities: ["httpCall"],
});

type OrderedRelatedEntity = {
	name: string;
	externalId: string;
	providerSlug: string;
	relationshipProperties: { order: number };
};

const releaseGroupDescription = (releaseGroup: UnknownRecord) => {
	const parts: string[] = [];

	const primaryType = stringValue(releaseGroup["primary-type"]);
	if (primaryType) {
		parts.push(primaryType);
	}

	const secondaryTypes = Array.isArray(releaseGroup["secondary-types"])
		? releaseGroup["secondary-types"]
		: [];
	const secondary = secondaryTypes
		.flatMap((type) => {
			const value = stringValue(type);
			return value ? [value] : [];
		})
		.join(", ");
	if (secondary) {
		parts.push(secondary);
	}

	const disambiguation = stringValue(releaseGroup["disambiguation"]);
	if (disambiguation) {
		parts.push(disambiguation);
	}

	return parts.length > 0 ? parts.join(" - ") : null;
};

const parseDate = (value: unknown) => {
	const trimmed = stringValue(value);
	if (!trimmed) {
		return null;
	}
	const parsed = new Date(trimmed);
	return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const chooseRelease = (releases: readonly unknown[]): UnknownRecord | null => {
	const records = releases.flatMap((release) => {
		const record = asRecord(release);
		return record ? [record] : [];
	});
	if (records.length === 0) {
		return null;
	}
	const official = records.filter((record) => record["status"] === "Official");
	const candidates = official.length > 0 ? official : records;
	let best: UnknownRecord | null = null;
	for (const release of candidates) {
		if (!best) {
			best = release;
			continue;
		}
		const bestDate = parseDate(best["date"]);
		const releaseDate = parseDate(release["date"]);
		if (bestDate && releaseDate) {
			best = releaseDate.getTime() < bestDate.getTime() ? release : best;
			continue;
		}
		if (releaseDate && !bestDate) {
			best = release;
		}
	}
	return best;
};

export const search = defineProvider({
	manifest,
	operation: "search",
	run: (input, host) => {
		const luceneQuery = buildLuceneQuery(input.query, ["release-group", "artist"]);
		return mbGet(host, "release-group", {
			query: luceneQuery,
			limit: String(input.pageSize),
			offset: String((input.page - 1) * input.pageSize),
		}).pipe(
			Effect.flatMap((dataValue) => {
				const data = asRecord(dataValue);
				if (!data) {
					return Effect.fail(new Error("MusicBrainz release-group search returned no data"));
				}
				const totalItems = Math.max(0, numberValue(data["count"]) ?? 0);
				const groups = data["release-groups"];
				const items = (Array.isArray(groups) ? groups : []).flatMap((group) => {
					const record = asRecord(group);
					const id = stringValue(record?.["id"]);
					if (!id) {
						return [];
					}
					const title = stringValue(record?.["title"]) ?? id;
					return [
						{
							externalId: id,
							titleProperty: { kind: "text" as const, value: title },
							calloutProperty: { kind: "null" as const, value: null },
							imageProperty: { kind: "null" as const, value: null },
							primarySubtitleProperty: { kind: "null" as const, value: null },
							secondarySubtitleProperty: { kind: "null" as const, value: null },
						},
					];
				});
				return Effect.succeed({
					items,
					details: {
						totalItems,
						nextPage: input.page * input.pageSize < totalItems ? input.page + 1 : null,
					},
				});
			}),
		);
	},
});

const collectTrackEntities = (media: unknown): OrderedRelatedEntity[] => {
	const entities: OrderedRelatedEntity[] = [];
	let trackIdx = 0;
	for (const medium of Array.isArray(media) ? media : []) {
		const tracks = asRecord(medium)?.["tracks"];
		for (const track of Array.isArray(tracks) ? tracks : []) {
			const trackRecord = asRecord(track);
			const recording = asRecord(trackRecord?.["recording"]) ?? trackRecord;
			const memberId = stringValue(recording?.["id"]);
			if (!memberId) {
				trackIdx++;
				continue;
			}
			entities.push({
				externalId: memberId,
				providerSlug: "music.music-brainz",
				relationshipProperties: { order: trackIdx + 1 },
				name: stringValue(recording?.["title"]) ?? "Loading...",
			});
			trackIdx++;
		}
	}
	return entities;
};

const countTracks = (media: unknown) => {
	let trackCount = 0;
	for (const medium of Array.isArray(media) ? media : []) {
		const tracks = asRecord(medium)?.["tracks"];
		if (Array.isArray(tracks)) {
			trackCount += tracks.length;
		}
	}
	return trackCount;
};

export const details = defineProvider({
	manifest,
	operation: "details",
	run: (input, host) =>
		Effect.gen(function* () {
			const releaseGroupValue = yield* mbGet(host, `release-group/${input.externalId}`, {
				inc: "artists",
			});
			const releaseGroup = asRecord(releaseGroupValue);
			if (!releaseGroup) {
				return yield* Effect.fail(
					new Error(`MusicBrainz release-group not found: ${input.externalId}`),
				);
			}
			const title = stringValue(releaseGroup["title"]);
			if (!title) {
				return yield* Effect.fail(new Error("MusicBrainz release-group is missing title"));
			}
			const description = releaseGroupDescription(releaseGroup);

			const browseValue = yield* mbGet(host, "release", {
				"release-group": input.externalId,
				limit: "10",
			});
			const releases = asRecord(browseValue)?.["releases"];
			const bestRelease = chooseRelease(Array.isArray(releases) ? releases : []);
			const bestReleaseId = bestRelease ? stringValue(bestRelease["id"]) : null;

			const [releaseCover, releaseDetailsValue] = yield* bestReleaseId
				? Effect.all(
						[
							fetchCoverArtUrl(host, "release", bestReleaseId),
							mbGet(host, `release/${bestReleaseId}`, { inc: "recordings" }),
						],
						{ concurrency: "unbounded" },
					)
				: Effect.succeed([null, null] as const);
			const media = asRecord(releaseDetailsValue)?.["media"];
			const trackCount = countTracks(media);
			const relatedEntities = collectTrackEntities(media);

			const coverUrl =
				releaseCover ?? (yield* fetchCoverArtUrl(host, "release-group", input.externalId));

			return {
				name: title,
				relatedEntityGroups: [
					{
						direction: "outgoing" as const,
						synchronization: "authoritative" as const,
						entities: relatedEntities,
						relationshipSchemaSlug: "music-group-to-music",
					},
				],
				properties: {
					description,
					parts: trackCount > 0 ? trackCount : null,
					images: coverUrl ? [{ type: "remote" as const, url: coverUrl }] : [],
					sourceUrl: `https://musicbrainz.org/release-group/${input.externalId}`,
				},
			};
		}),
});

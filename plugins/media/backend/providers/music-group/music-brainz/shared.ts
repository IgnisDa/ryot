import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { defineProvider } from "@ryot-app/plugin-backend-sdk/provider";
import { asArray, asRecord } from "@ryot-app/plugin-backend-sdk/wire";

import { MediaSandboxError } from "../../../lib/failures";
import { normalizePlainDescription } from "../../../lib/plain-description";
import { numberValue, stringValue, type UnknownRecord } from "../../../lib/records";
import {
	buildLuceneQuery,
	fetchCoverArtUrl,
	mbBrowsePage,
	mbGet,
	mbOffsetCursor,
} from "../../../lib/vendors/music-brainz";

export const manifest = defineManifest({
	kind: "provider",
	name: "MusicBrainz",
	slug: "music-group.music-brainz",
});

const RELATED_BROWSE_PAGE_BATCH_SIZE = 10;

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
	return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
};

type ReleaseCandidate = { id: string; official: boolean; date: null | number };

const chooseRelease = (best: null | ReleaseCandidate, releases: readonly UnknownRecord[]) => {
	let candidateBest = best;
	for (const release of releases) {
		const id = stringValue(release["id"]);
		if (!id) {
			continue;
		}
		const candidate = {
			id,
			date: parseDate(release["date"]),
			official: release["status"] === "Official",
		};
		if (
			!candidateBest ||
			(candidate.official && !candidateBest.official) ||
			(candidate.official === candidateBest.official &&
				candidate.date !== null &&
				(candidateBest.date === null || candidate.date < candidateBest.date))
		) {
			candidateBest = candidate;
		}
	}
	return candidateBest;
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
					return Effect.fail(
						new MediaSandboxError({ message: "MusicBrainz release-group search returned no data" }),
					);
				}
				const totalItems = Math.max(0, numberValue(data["count"]) ?? 0);
				const groups = data["release-groups"];
				const items = asArray(groups).flatMap((group) => {
					const record = asRecord(group);
					const id = stringValue(record?.["id"]);
					if (!id) {
						return [];
					}
					const title = stringValue(record?.["title"]) ?? id;
					return [{ title, externalId: id }];
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

const collectTrackEntities = Effect.fnUntraced(function* (media: unknown) {
	if (!Array.isArray(media)) {
		return yield* new MediaSandboxError({ message: "MusicBrainz release is missing media" });
	}
	const entities: OrderedRelatedEntity[] = [];
	const seen = new Set<string>();
	let trackIdx = 0;
	for (const medium of media) {
		const record = asRecord(medium);
		const tracks = record?.["tracks"];
		const count = record?.["track-count"];
		if (!Array.isArray(tracks) || (count !== undefined && count !== tracks.length)) {
			return yield* new MediaSandboxError({
				message: "MusicBrainz release has an incomplete track list",
			});
		}
		for (const track of tracks) {
			const trackRecord = asRecord(track);
			const recording = asRecord(trackRecord?.["recording"]) ?? trackRecord;
			const memberId = stringValue(recording?.["id"]);
			if (!memberId) {
				return yield* new MediaSandboxError({
					message: "MusicBrainz release track is missing a recording ID",
				});
			}
			if (!seen.has(memberId)) {
				entities.push({
					externalId: memberId,
					providerSlug: "music.music-brainz",
					relationshipProperties: { order: trackIdx + 1 },
					name: stringValue(recording?.["title"]) ?? "Loading...",
				});
			}
			seen.add(memberId);
			trackIdx++;
		}
	}
	return entities;
});

export const details = defineProvider({
	manifest,
	operation: "details",
	run: (input, host) =>
		Effect.gen(function* () {
			const releaseGroupValue = yield* mbGet(host, `release-group/${input.externalId}`, {
				inc: "artist-credits",
			});
			const releaseGroup = asRecord(releaseGroupValue);
			if (!releaseGroup) {
				return yield* new MediaSandboxError({
					message: `MusicBrainz release-group not found: ${input.externalId}`,
				});
			}
			const title = stringValue(releaseGroup["title"]);
			if (!title) {
				return yield* new MediaSandboxError({
					message: "MusicBrainz release-group is missing title",
				});
			}
			const description = normalizePlainDescription(releaseGroupDescription(releaseGroup));

			const coverUrl = yield* fetchCoverArtUrl(host, "release-group", input.externalId);

			return {
				name: title,
				properties: {
					description,
					parts: null,
					sourceUrl: `https://musicbrainz.org/release-group/${input.externalId}`,
					images: coverUrl
						? [{ url: coverUrl, type: "remote" as const, purpose: "cover" as const }]
						: [],
				},
				relatedEntityGroups: [
					{
						entities: [],
						direction: "outgoing" as const,
						synchronization: "authoritative" as const,
						relationshipSchemaSlug: "music-group-to-music",
						coverage: {
							status: "more" as const,
							continuation: { offset: 0, best: null, total: null },
						},
					},
					{
						direction: "incoming" as const,
						synchronization: "authoritative" as const,
						relationshipSchemaSlug: "person-to-music-group",
						coverage:
							Array.isArray(releaseGroup["artist-credit"]) &&
							releaseGroup["artist-credit"].every((credit) =>
								stringValue(asRecord(asRecord(credit)?.["artist"])?.["id"]),
							)
								? { status: "complete" as const }
								: {
										status: "source-limited" as const,
										reason: "MusicBrainz release group did not include artist credits",
									},
						entities: asArray(releaseGroup["artist-credit"]).flatMap((credit) => {
							const artist = asRecord(asRecord(credit)?.["artist"]);
							const externalId = stringValue(artist?.["id"]);
							return externalId
								? [
										{
											externalId,
											providerSlug: "person.music-brainz",
											relationshipProperties: { roles: ["Artist"] },
											name: stringValue(artist?.["name"]) ?? externalId,
										},
									]
								: [];
						}),
					},
				],
			};
		}),
});

const releaseCursor = Effect.fnUntraced(function* (value: unknown) {
	const offset = yield* mbOffsetCursor(value);
	const candidate = asRecord(value)?.["best"];
	if (candidate === null) {
		return { ...offset, best: null };
	}
	const record = asRecord(candidate);
	const id = record?.["id"];
	const official = record?.["official"];
	const date = record?.["date"];
	if (
		typeof id !== "string" ||
		!id ||
		id.length > 256 ||
		typeof official !== "boolean" ||
		(date !== null && (typeof date !== "number" || !Number.isFinite(date)))
	) {
		return yield* new MediaSandboxError({
			message: "Invalid MusicBrainz release selection continuation",
		});
	}
	return { ...offset, best: { id, date, official } };
});

export const related = defineProvider({
	manifest,
	operation: "related",
	run: (input, host) =>
		Effect.gen(function* () {
			if (
				input.relationshipSchemaSlug !== "music-group-to-music" ||
				input.direction !== "outgoing"
			) {
				return yield* new MediaSandboxError({
					message: "Unsupported MusicBrainz release-group inventory",
				});
			}
			let { best, total, offset } = yield* releaseCursor(input.continuation);
			for (let calls = 0; calls < RELATED_BROWSE_PAGE_BATCH_SIZE; calls++) {
				const page = yield* mbBrowsePage(
					host,
					"release",
					{ "release-group": input.externalId },
					offset,
					total,
				);
				best = chooseRelease(best, page.items);
				if (page.nextOffset === null) {
					const release = best
						? yield* mbGet(host, `release/${best.id}`, { inc: "recordings" })
						: null;
					const entities = best ? yield* collectTrackEntities(asRecord(release)?.["media"]) : [];
					return { entities, coverage: { status: "complete" as const } };
				}
				offset = page.nextOffset;
				total = page.total;
			}
			return {
				entities: [],
				coverage: { status: "more" as const, continuation: { best, total, offset } },
			};
		}),
});

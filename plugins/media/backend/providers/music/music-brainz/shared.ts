import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { Effect } from "@ryot-app/sandbox-sdk/effect";
import { defineProvider } from "@ryot-app/sandbox-sdk/provider";

import { asRecord, numberValue, stringValue, trimmedString } from "../../../lib/records";
import { createRoleAccumulator } from "../../../lib/role-accumulator";
import {
	buildLuceneQuery,
	findCoverArtFromReleases,
	getPublishYear,
	mbGet,
} from "../../../lib/vendors/music-brainz";

export const manifest = defineManifest({
	kind: "provider",
	name: "MusicBrainz",
	capabilities: ["httpCall"],
	slug: "music.music-brainz",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
});

export const search = defineProvider({
	manifest,
	operation: "search",
	run: (input, host) => {
		const luceneQuery = buildLuceneQuery(input.query, ["recording", "artist"]);
		return mbGet(host, "recording", {
			query: luceneQuery,
			limit: String(input.pageSize),
			offset: String((input.page - 1) * input.pageSize),
		}).pipe(
			Effect.flatMap((dataValue) => {
				const data = asRecord(dataValue);
				if (!data) {
					return Effect.fail(new Error("MusicBrainz recording search returned no data"));
				}
				const totalItems = Math.max(0, numberValue(data["count"]) ?? 0);
				const recordings = data["recordings"];
				const items = (Array.isArray(recordings) ? recordings : []).flatMap((recording) => {
					const record = asRecord(recording);
					const id = stringValue(record?.["id"]);
					if (!id) {
						return [];
					}
					const title = stringValue(record?.["title"]) ?? id;
					const publishYear = getPublishYear(record?.["first-release-date"]);
					return [
						{
							title,
							externalId: id,
							...(publishYear === null ? {} : { metadata: [publishYear] as const }),
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

export const details = defineProvider({
	manifest,
	operation: "details",
	run: (input, host) =>
		Effect.gen(function* () {
			const dataValue = yield* mbGet(host, `recording/${input.externalId}`, {
				inc: "artists+releases+release-groups",
			});
			const data = asRecord(dataValue);
			if (!data) {
				return yield* Effect.fail(
					new Error(`MusicBrainz recording not found: ${input.externalId}`),
				);
			}
			const title = stringValue(data["title"]);
			if (!title) {
				return yield* Effect.fail(new Error("MusicBrainz recording is missing title"));
			}

			const publishYear = getPublishYear(data["first-release-date"]);
			const artistCredit = Array.isArray(data["artist-credit"]) ? data["artist-credit"] : [];
			const byVariousArtists = artistCredit.length === 0 ? null : artistCredit.length > 1;

			const accumulator = createRoleAccumulator();
			for (const credit of artistCredit) {
				const artist = asRecord(asRecord(credit)?.["artist"]);
				const artistId = stringValue(artist?.["id"]);
				if (!artistId) {
					continue;
				}
				accumulator.add({
					externalId: artistId,
					providerSlug: "person.music-brainz",
					name: trimmedString(artist?.["name"]),
					relationshipProperties: { roles: ["Artist"] },
				});
			}

			const releases = Array.isArray(data["releases"]) ? data["releases"] : [];
			const seenGroups = new Set<string>();
			for (const release of releases) {
				const releaseGroup = asRecord(asRecord(release)?.["release-group"]);
				const releaseGroupId = stringValue(releaseGroup?.["id"]);
				if (!releaseGroupId || seenGroups.has(releaseGroupId)) {
					continue;
				}
				seenGroups.add(releaseGroupId);
				accumulator.add({
					externalId: releaseGroupId,
					providerSlug: "music-group.music-brainz",
					name: trimmedString(releaseGroup?.["title"]),
					relationshipProperties: { roles: ["Member"] },
				});
			}

			const coverUrl = yield* findCoverArtFromReleases(host, releases);
			const durationMs = numberValue(data["length"]);
			const duration = durationMs === null ? null : Math.trunc(durationMs / 1000);
			return {
				name: title,
				properties: {
					duration,
					genres: [],
					publishYear,
					byVariousArtists,
					sourceUrl: `https://musicbrainz.org/recording/${input.externalId}`,
					images: coverUrl
						? [{ url: coverUrl, type: "remote" as const, purpose: "cover" as const }]
						: [],
				},
				relatedEntityGroups: [
					{
						direction: "incoming" as const,
						synchronization: "additive" as const,
						relationshipSchemaSlug: "person-to-music",
						entities: accumulator.entities.filter(
							(entity) => entity.providerSlug === "person.music-brainz",
						),
					},
					{
						direction: "incoming" as const,
						synchronization: "additive" as const,
						relationshipSchemaSlug: "music-group-to-music",
						entities: accumulator.entities.filter(
							(entity) => entity.providerSlug === "music-group.music-brainz",
						),
					},
				],
			};
		}),
});

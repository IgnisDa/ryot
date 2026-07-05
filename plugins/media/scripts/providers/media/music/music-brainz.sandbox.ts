import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { Effect } from "@ryot/sandbox-sdk/effect";
import { defineProvider, defineProviderDriver } from "@ryot/sandbox-sdk/provider";

import { asRecord, numberValue, stringValue, trimmedString } from "../../../script-helpers/records";
import { createRoleAccumulator } from "../../../script-helpers/role-accumulator";
import {
	buildLuceneQuery,
	findCoverArtFromReleases,
	getPublishYear,
	mbGet,
} from "../../music-brainz-shared";

export const manifest = defineManifest({
	kind: "provider",
	name: "MusicBrainz",
	requiredAppConfigKeys: [],
	capabilities: ["httpCall"],
	slug: "music.music-brainz",
	providerInformation: { source: "music-brainz" },
});

export const search = defineProviderDriver(manifest, "search", (input, host) => {
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
						externalId: id,
						imageProperty: { kind: "null" as const, value: null },
						titleProperty: { kind: "text" as const, value: title },
						calloutProperty: { kind: "null" as const, value: null },
						secondarySubtitleProperty: { kind: "null" as const, value: null },
						primarySubtitleProperty:
							publishYear === null
								? { kind: "null" as const, value: null }
								: { kind: "number" as const, value: publishYear },
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
});

export const details = defineProviderDriver(manifest, "details", (input, host) =>
	Effect.gen(function* () {
		const dataValue = yield* mbGet(host, `recording/${input.externalId}`, {
			inc: "artists+releases+release-groups",
		});
		const data = asRecord(dataValue);
		if (!data) {
			return yield* Effect.fail(new Error(`MusicBrainz recording not found: ${input.externalId}`));
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
				scriptSlug: "person.music-brainz",
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
				scriptSlug: "music-group.music-brainz",
				relationshipProperties: { roles: ["Member"] },
				name: trimmedString(releaseGroup?.["title"]),
			});
		}

		const coverUrl = yield* findCoverArtFromReleases(host, releases);
		const durationMs = numberValue(data["length"]);
		const duration = durationMs === null ? null : Math.trunc(durationMs / 1000);
		return {
			name: title,
			relatedEntityGroups: [
				{
					direction: "incoming" as const,
					synchronization: "additive" as const,
					relationshipSchemaSlug: "person-to-music",
					entities: accumulator.entities.filter(
						(entity) => entity.scriptSlug === "person.music-brainz",
					),
				},
				{
					direction: "incoming" as const,
					synchronization: "additive" as const,
					relationshipSchemaSlug: "music-group-to-music",
					entities: accumulator.entities.filter(
						(entity) => entity.scriptSlug === "music-group.music-brainz",
					),
				},
			],
			properties: {
				duration,
				genres: [],
				publishYear,
				byVariousArtists,
				images: coverUrl ? [{ type: "remote" as const, url: coverUrl }] : [],
				sourceUrl: `https://musicbrainz.org/recording/${input.externalId}`,
			},
		};
	}),
);

export default defineProvider({ manifest, drivers: { search, details } });

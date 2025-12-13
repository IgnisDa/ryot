import { defineManifest } from "@ryot/sandbox-sdk";
import { defineProvider, defineProviderDriver } from "@ryot/sandbox-sdk/provider";

import {
	asRecord,
	buildLuceneQuery,
	mbGet,
	numberValue,
	stringValue,
	trimmedString,
} from "../music-brainz-shared";

export const manifest = defineManifest({
	kind: "provider",
	name: "MusicBrainz",
	slug: "person.music-brainz",
	requiredAppConfigKeys: [],
	capabilities: ["httpCall"],
	providerInformation: { source: "music-brainz" },
});

const buildArtistDescription = (artist: Record<string, unknown>) => {
	const parts: string[] = [];

	const artistType = stringValue(artist["type"]);
	if (artistType) {
		parts.push(artistType);
	}

	const country = stringValue(artist["country"]);
	if (country) {
		parts.push(`Country: ${country}`);
	}

	const area = stringValue(asRecord(artist["area"])?.["name"]);
	if (area) {
		parts.push(`Area: ${area}`);
	}

	const lifeSpan = asRecord(artist["life-span"]);
	if (lifeSpan) {
		const begin = stringValue(lifeSpan["begin"]);
		const end = stringValue(lifeSpan["end"]);
		if (begin || end) {
			parts.push(`Active: ${begin ?? "?"} - ${end ?? "?"}`);
		}
	}

	const disambiguation = stringValue(artist["disambiguation"]);
	if (disambiguation) {
		parts.push(disambiguation);
	}

	return parts.length > 0 ? parts.join(" - ") : null;
};

export const search = defineProviderDriver(manifest, "search", (input, host) => {
	const luceneQuery = buildLuceneQuery(input.query, ["artist", "alias"]);
	return mbGet(host, "artist", {
		query: luceneQuery,
		limit: String(input.pageSize),
		offset: String((input.page - 1) * input.pageSize),
	}).then((dataValue) => {
		const data = asRecord(dataValue);
		if (!data) {
			throw new Error("MusicBrainz artist search returned no data");
		}
		const totalItems = Math.max(0, numberValue(data["count"]) ?? 0);
		const artists = data["artists"];
		const items = (Array.isArray(artists) ? artists : []).flatMap((artist) => {
			const record = asRecord(artist);
			const id = stringValue(record?.["id"]);
			if (!id) {
				return [];
			}
			const name = stringValue(record?.["name"]) ?? id;
			return [
				{
					externalId: id,
					titleProperty: { kind: "text" as const, value: name },
					calloutProperty: { kind: "null" as const, value: null },
					imageProperty: { kind: "null" as const, value: null },
					primarySubtitleProperty: { kind: "null" as const, value: null },
					secondarySubtitleProperty: { kind: "null" as const, value: null },
				},
			];
		});
		return {
			items,
			details: {
				totalItems,
				nextPage: input.page * input.pageSize < totalItems ? input.page + 1 : null,
			},
		};
	});
});

export const details = defineProviderDriver(manifest, "details", (input, host) =>
	Promise.all([
		mbGet(host, `artist/${input.externalId}`, { inc: "aliases release-groups" }),
		mbGet(host, "recording", { artist: input.externalId, limit: "100" }),
	]).then(([artistValue, recordingsValue]) => {
		const artist = asRecord(artistValue);
		if (!artist) {
			throw new Error(`MusicBrainz artist not found: ${input.externalId}`);
		}
		const name = stringValue(artist["name"]);
		if (!name) {
			throw new Error("MusicBrainz artist is missing name");
		}

		const lifeSpan = asRecord(artist["life-span"]);
		const birthDate = lifeSpan ? stringValue(lifeSpan["begin"]) : null;
		const deathDate = lifeSpan ? stringValue(lifeSpan["end"]) : null;

		const birthPlace =
			stringValue(asRecord(artist["begin-area"])?.["name"]) ??
			stringValue(asRecord(artist["area"])?.["name"]);

		const description = buildArtistDescription(artist);

		const aliases = Array.isArray(artist["aliases"]) ? artist["aliases"] : [];
		const alternateNames = aliases.flatMap((alias) => {
			const aliasName = stringValue(asRecord(alias)?.["name"]);
			return aliasName !== null && aliasName !== name ? [aliasName] : [];
		});

		const releaseGroups = Array.isArray(artist["release-groups"]) ? artist["release-groups"] : [];
		const groupEntities = releaseGroups.map((group) => {
			const record = asRecord(group);
			const groupId = trimmedString(record?.["id"]);
			return {
				externalId: groupId,
				scriptSlug: "music-group.music-brainz",
				relationshipProperties: { roles: ["Artist"] },
				name: stringValue(record?.["title"]) ?? groupId,
			};
		});

		const recordings = asRecord(recordingsValue)?.["recordings"];
		const mediaEntities = (Array.isArray(recordings) ? recordings : []).flatMap((recording) => {
			const record = asRecord(recording);
			const recordingId = stringValue(record?.["id"]);
			if (!recordingId) {
				return [];
			}
			return [
				{
					externalId: recordingId,
					scriptSlug: "music.music-brainz",
					relationshipProperties: { roles: ["Artist"] },
					name: stringValue(record?.["title"]) ?? recordingId,
				},
			];
		});

		return {
			name,
			relatedEntityGroups: [
				{
					direction: "outgoing" as const,
					synchronization: "authoritative" as const,
					entities: mediaEntities,
					relationshipSchemaSlug: "person-to-music",
				},
				{
					direction: "outgoing" as const,
					synchronization: "authoritative" as const,
					entities: groupEntities,
					relationshipSchemaSlug: "person-to-music-group",
				},
			],
			properties: {
				birthDate,
				deathDate,
				birthPlace,
				images: [],
				description,
				alternateNames,
				sourceUrl: `https://musicbrainz.org/artist/${input.externalId}`,
			},
		};
	}),
);

export default defineProvider({ manifest, drivers: { search, details } });

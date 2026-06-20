import { isObjectRecord } from "@ryot/ts-utils/predicates";
import { Schema } from "effect";

import { mediaMonitoringMessages, type MediaMonitoringChange } from "./messages";

const MediaMonitoringEntityKind = Schema.Literal("company", "person", "media");

export type MediaMonitoringEntityKind = typeof MediaMonitoringEntityKind.Type;

const MediaMonitoringEpisodeSnapshot = Schema.Struct({
	images: Schema.Unknown,
	name: Schema.NullOr(Schema.String),
	externalId: Schema.NullOr(Schema.String),
	publishDate: Schema.NullOr(Schema.String),
	episodeNumber: Schema.NullOr(Schema.Number),
});

export type MediaMonitoringEpisodeSnapshot = typeof MediaMonitoringEpisodeSnapshot.Type;

const MediaMonitoringSeasonSnapshot = Schema.Struct({
	name: Schema.String,
	externalId: Schema.NullOr(Schema.String),
	seasonNumber: Schema.NullOr(Schema.Number),
	episodes: Schema.Array(MediaMonitoringEpisodeSnapshot),
});

export type MediaMonitoringSeasonSnapshot = typeof MediaMonitoringSeasonSnapshot.Type;

const MediaMonitoringAssociationSnapshot = Schema.Struct({
	id: Schema.String,
	name: Schema.String,
	role: Schema.String,
	kind: Schema.Literal("group", "metadata"),
});

export type MediaMonitoringAssociationSnapshot = typeof MediaMonitoringAssociationSnapshot.Type;

export const MediaMonitoringSnapshot = Schema.Struct({
	name: Schema.String,
	entityId: Schema.String,
	entitySchemaSlug: Schema.String,
	entityKind: MediaMonitoringEntityKind,
	populatedAt: Schema.NullOr(Schema.String),
	mangaChapters: Schema.NullOr(Schema.Number),
	animeEpisodes: Schema.NullOr(Schema.Number),
	seasons: Schema.Array(MediaMonitoringSeasonSnapshot),
	podcastEpisodes: Schema.Array(MediaMonitoringEpisodeSnapshot),
	associations: Schema.Array(MediaMonitoringAssociationSnapshot),
	properties: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
});

export type MediaMonitoringSnapshot = typeof MediaMonitoringSnapshot.Type;

const asRecord = (value: unknown): Record<string, unknown> | null =>
	isObjectRecord(value) ? value : null;

const asString = (value: unknown) => (typeof value === "string" ? value : null);

const asNumber = (value: unknown) =>
	typeof value === "number" && Number.isFinite(value) ? value : null;

const isSpecialSeason = (name: string) => ["Specials", "Special"].includes(name);

const stableJson = (value: unknown): string => {
	if (Array.isArray(value)) {
		return `[${value.map(stableJson).sort().join(",")}]`;
	}
	if (isObjectRecord(value)) {
		return `{${Object.entries(value)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
			.join(",")}}`;
	}
	return JSON.stringify(value) ?? "undefined";
};

const sameImageSet = (before: unknown, after: unknown) => {
	const afterImages = Array.isArray(after) ? after : [];
	const beforeImages = Array.isArray(before) ? before : [];
	const afterSet = new Set(afterImages.map(stableJson));
	const beforeSet = new Set(beforeImages.map(stableJson));
	return beforeSet.size === afterSet.size && [...beforeSet].every((image) => afterSet.has(image));
};

const identityKeys = (input: { externalId: string | null; number: number | null }): string[] =>
	[
		...(input.externalId === null ? [] : [`external:${input.externalId}`]),
		...(input.number === null ? [] : [`number:${input.number}`]),
	] as const;

const matchByIdentity = <T>(
	before: ReadonlyArray<T>,
	after: ReadonlyArray<T>,
	identity: (value: T) => { externalId: string | null; number: number | null },
) => {
	const unmatchedAfter = new Set(after);
	const matches: Array<{ after: T; before: T }> = [];
	for (const beforeValue of before) {
		const beforeKeys = identityKeys(identity(beforeValue));
		const afterValue = [...unmatchedAfter].find((candidate) => {
			const afterKeys = identityKeys(identity(candidate));
			return beforeKeys.some((key) => afterKeys.includes(key));
		});
		if (afterValue !== undefined) {
			unmatchedAfter.delete(afterValue);
			matches.push({ after: afterValue, before: beforeValue });
		}
	}
	return matches;
};

const diffShowEpisodes = (
	before: MediaMonitoringSeasonSnapshot,
	after: MediaMonitoringSeasonSnapshot,
	entityName: string,
) => {
	if (isSpecialSeason(before.name) && isSpecialSeason(after.name)) {
		return [];
	}
	if (before.episodes.length !== after.episodes.length) {
		return [
			mediaMonitoringMessages.episodeReleased({
				entityName,
				newCount: after.episodes.length,
				oldCount: before.episodes.length,
				seasonNumber: before.seasonNumber,
			}),
		];
	}

	const changes: MediaMonitoringChange[] = [];
	for (const pair of matchByIdentity(before.episodes, after.episodes, (episode) => ({
		externalId: episode.externalId,
		number: episode.episodeNumber,
	}))) {
		const seasonNumber = before.seasonNumber ?? after.seasonNumber;
		const episodeNumber = pair.before.episodeNumber ?? pair.after.episodeNumber;
		if (episodeNumber === null || seasonNumber === null) {
			continue;
		}
		if (pair.before.name !== pair.after.name) {
			changes.push(
				mediaMonitoringMessages.episodeNameChanged({
					entityName,
					seasonNumber,
					episodeNumber,
					newName: pair.after.name,
					oldName: pair.before.name,
				}),
			);
		}
		if (!sameImageSet(pair.before.images, pair.after.images)) {
			changes.push(
				mediaMonitoringMessages.episodeImagesChanged({ entityName, episodeNumber, seasonNumber }),
			);
		}
		if (
			pair.before.publishDate !== null &&
			pair.after.publishDate !== null &&
			pair.before.publishDate !== pair.after.publishDate
		) {
			changes.push(
				mediaMonitoringMessages.episodeReleaseDateChanged({
					entityName,
					seasonNumber,
					episodeNumber,
					newDate: pair.after.publishDate,
					oldDate: pair.before.publishDate,
				}),
			);
		}
	}
	return changes;
};

const diffShows = (before: MediaMonitoringSnapshot, after: MediaMonitoringSnapshot) => {
	if (before.seasons.length !== after.seasons.length) {
		return [
			mediaMonitoringMessages.seasonsChanged({
				entityName: after.name,
				newCount: after.seasons.length,
				oldCount: before.seasons.length,
			}),
		];
	}

	return matchByIdentity(before.seasons, after.seasons, (season) => ({
		externalId: season.externalId,
		number: season.seasonNumber,
	})).flatMap((pair) => diffShowEpisodes(pair.before, pair.after, after.name));
};

const diffPodcastEpisodes = (before: MediaMonitoringSnapshot, after: MediaMonitoringSnapshot) => {
	if (before.podcastEpisodes.length !== after.podcastEpisodes.length) {
		return [
			mediaMonitoringMessages.episodeReleased({
				seasonNumber: null,
				entityName: after.name,
				newCount: after.podcastEpisodes.length,
				oldCount: before.podcastEpisodes.length,
			}),
		];
	}

	const changes: MediaMonitoringChange[] = [];
	for (const pair of matchByIdentity(before.podcastEpisodes, after.podcastEpisodes, (episode) => ({
		externalId: episode.externalId,
		number: episode.episodeNumber,
	}))) {
		const episodeNumber = pair.before.episodeNumber ?? pair.after.episodeNumber;
		if (episodeNumber === null) {
			continue;
		}
		if (pair.before.name !== pair.after.name) {
			changes.push(
				mediaMonitoringMessages.episodeNameChanged({
					episodeNumber,
					seasonNumber: null,
					entityName: after.name,
					newName: pair.after.name,
					oldName: pair.before.name,
				}),
			);
		}
		if (!sameImageSet(pair.before.images, pair.after.images)) {
			changes.push(
				mediaMonitoringMessages.episodeImagesChanged({
					episodeNumber,
					seasonNumber: null,
					entityName: after.name,
				}),
			);
		}
	}
	return changes;
};

const diffAssociations = (before: MediaMonitoringSnapshot, after: MediaMonitoringSnapshot) => {
	const entityKind = after.entityKind;
	if (entityKind === "media") {
		return [];
	}
	const seen = new Set(
		before.associations.map((association) =>
			[association.kind, association.id, association.role].join(":"),
		),
	);

	return after.associations.flatMap((association) => {
		const key = [association.kind, association.id, association.role].join(":");
		if (seen.has(key)) {
			return [];
		}
		seen.add(key);
		return [
			mediaMonitoringMessages.associationAdded({
				entityKind,
				entityName: after.name,
				role: association.role,
				associationKind: association.kind,
				associationName: association.name,
			}),
		];
	});
};

export const diffMediaMonitoringSnapshots = (
	before: MediaMonitoringSnapshot,
	after: MediaMonitoringSnapshot,
): ReadonlyArray<MediaMonitoringChange> => {
	if (before.populatedAt === null || after.populatedAt === null) {
		return [];
	}

	const changes: MediaMonitoringChange[] = [];
	const beforeStatus = asString(before.properties.productionStatus);
	const afterStatus = asString(after.properties.productionStatus);
	if (beforeStatus !== null && afterStatus !== null && beforeStatus !== afterStatus) {
		changes.push(
			mediaMonitoringMessages.statusChanged({
				entityName: after.name,
				newStatus: afterStatus,
				oldStatus: beforeStatus,
			}),
		);
	}
	const beforePublishYear = asNumber(before.properties.publishYear);
	const afterPublishYear = asNumber(after.properties.publishYear);
	if (
		beforePublishYear !== null &&
		afterPublishYear !== null &&
		beforePublishYear !== afterPublishYear
	) {
		changes.push(
			mediaMonitoringMessages.publishYearChanged({
				entityName: after.name,
				newYear: afterPublishYear,
				oldYear: beforePublishYear,
			}),
		);
	}
	if (after.entitySchemaSlug === "show") {
		changes.push(...diffShows(before, after));
	}
	if (
		after.entitySchemaSlug === "anime" &&
		before.animeEpisodes !== null &&
		after.animeEpisodes !== null &&
		before.animeEpisodes !== after.animeEpisodes
	) {
		changes.push(
			mediaMonitoringMessages.chaptersOrEpisodesChanged({
				entityName: after.name,
				contentType: "episodes",
				newCount: after.animeEpisodes,
				oldCount: before.animeEpisodes,
			}),
		);
	}
	if (
		after.entitySchemaSlug === "manga" &&
		before.mangaChapters !== null &&
		after.mangaChapters !== null &&
		before.mangaChapters !== after.mangaChapters
	) {
		changes.push(
			mediaMonitoringMessages.chaptersOrEpisodesChanged({
				entityName: after.name,
				contentType: "chapters",
				newCount: after.mangaChapters,
				oldCount: before.mangaChapters,
			}),
		);
	}
	if (after.entitySchemaSlug === "podcast") {
		changes.push(...diffPodcastEpisodes(before, after));
	}
	changes.push(...diffAssociations(before, after));
	return changes;
};

export const snapshotProperties = (value: unknown) => asRecord(value) ?? {};

export const snapshotSeason = (input: {
	name: string;
	properties: unknown;
	externalId: string | null;
}): MediaMonitoringSeasonSnapshot => {
	const properties = snapshotProperties(input.properties);
	return {
		episodes: [],
		name: input.name,
		externalId: input.externalId,
		seasonNumber: asNumber(properties.seasonNumber),
	};
};

export const snapshotEpisode = (input: {
	name: string;
	properties: unknown;
	externalId: string | null;
}): MediaMonitoringEpisodeSnapshot => {
	const properties = snapshotProperties(input.properties);
	return {
		name: input.name,
		externalId: input.externalId,
		images: properties.images ?? null,
		episodeNumber: asNumber(properties.episodeNumber),
		publishDate: asString(properties.publishDate),
	};
};

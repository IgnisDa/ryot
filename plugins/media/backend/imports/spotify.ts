import { DateTime, Option, Schema } from "@ryot-app/sandbox-sdk/effect";

import type { ImportMediaEntityGroupBuilder } from "./groups";
import type { MediaImportAdapterFailure } from "./schemas";

const PLAYS_PER_ITEM = 6;
const TRACK_URI_PREFIX = "spotify:track:";

const StreamingHistoryFile = Schema.Array(
	Schema.Struct({
		ts: Schema.NullishOr(Schema.String),
		ms_played: Schema.NullishOr(Schema.Finite),
		reason_end: Schema.NullishOr(Schema.String),
		spotify_track_uri: Schema.NullishOr(Schema.String),
		master_metadata_track_name: Schema.NullishOr(Schema.String),
	}),
);

const decodeStreamingHistoryFile = Schema.decodeUnknownOption(StreamingHistoryFile);

type Play = { occurredAt: string; occurredAtMs: number; timeSpent: number };
type TrackPlays = { name: string; plays: Play[] };

export const adaptSpotifyStreamingHistory = (
	files: ReadonlyArray<{ name: string; rows: unknown }>,
) => {
	const tracks = new Map<string, TrackPlays>();
	const seenPlays = new Set<string>();
	const invalidPlays: Array<{ uri: string; label: string }> = [];
	for (const file of files) {
		const rows = decodeStreamingHistoryFile(file.rows);
		if (Option.isNone(rows)) {
			throw new Error(`${file.name} is not a Spotify streaming history file`);
		}
		for (const row of rows.value) {
			const uri = row.spotify_track_uri;
			if (!uri?.startsWith(TRACK_URI_PREFIX) || row.reason_end !== "trackdone") {
				continue;
			}
			const trackId = uri.slice(TRACK_URI_PREFIX.length);
			const name = row.master_metadata_track_name?.trim() ?? "";
			const playKey = JSON.stringify([trackId, row.ts]);
			if (seenPlays.has(playKey)) {
				continue;
			}
			seenPlays.add(playKey);
			const playedAt = row.ts ? DateTime.make(row.ts) : Option.none();
			if (Option.isNone(playedAt)) {
				invalidPlays.push({ uri, label: name || uri });
				continue;
			}
			const occurredAtMs = DateTime.toEpochMillis(playedAt.value);
			const track = tracks.get(trackId) ?? { name, plays: [] };
			track.name ||= name;
			track.plays.push({
				occurredAtMs,
				occurredAt: DateTime.formatIso(playedAt.value),
				timeSpent: Math.round((row.ms_played ?? 0) / 600) / 100,
			});
			tracks.set(trackId, track);
		}
	}

	const entityGroups: ImportMediaEntityGroupBuilder[] = [];
	for (const [trackId, track] of tracks) {
		const plays = track.plays.sort((left, right) => left.occurredAtMs - right.occurredAtMs);
		for (let offset = 0; offset < plays.length; offset += PLAYS_PER_ITEM) {
			entityGroups.push({
				collectionMemberships: [],
				itemIndex: entityGroups.length,
				entityRef: {
					kind: "resolved",
					externalId: trackId,
					entitySchemaSlug: "music",
					providerSlug: "music.spotify",
					sourceLabel: track.name || trackId,
				},
				events: plays
					.slice(offset, offset + PLAYS_PER_ITEM)
					.map((play) => ({
						occurredAt: play.occurredAt,
						eventSchemaSlug: "complete",
						properties: {
							consumedOn: "spotify",
							timeSpent: play.timeSpent,
							completedOn: play.occurredAt,
							completionMode: "custom_timestamps",
						},
					})),
			});
		}
	}
	const failures: MediaImportAdapterFailure[] = invalidPlays.map((play, index) => ({
		sourceLabel: play.label,
		entitySchemaSlug: "music",
		sourceIdentifier: play.uri,
		stage: "input_transformation",
		message: "Play has no valid end time",
		itemIndex: entityGroups.length + index,
	}));
	return { failures, entityGroups, totalItems: entityGroups.length + failures.length };
};

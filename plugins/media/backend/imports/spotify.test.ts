import { describe, expect, it } from "vitest";

import { adaptSpotifyStreamingHistory } from "./spotify";

const play = (
	ts: string,
	trackId: string,
	overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
	ts,
	ms_played: 215_400,
	reason_end: "trackdone",
	spotify_track_uri: `spotify:track:${trackId}`,
	master_metadata_track_name: `Track ${trackId}`,
	...overrides,
});

const file = (rows: unknown, name = "Streaming_History_Audio_2020.json") => ({ name, rows });

const minutes = (count: number, trackId: string) =>
	Array.from({ length: count }, (_, index) =>
		play(`2020-01-01T00:${String(index).padStart(2, "0")}:00Z`, trackId),
	);

describe("adaptSpotifyStreamingHistory", () => {
	it("records only finished track plays and skips episodes and audiobooks without failures", () => {
		const result = adaptSpotifyStreamingHistory([
			file([
				play("2020-01-01T00:00:00Z", "a"),
				play("2020-01-01T00:05:00Z", "a", { reason_end: "fwdbtn" }),
				play("2020-01-01T00:06:00Z", "a", { reason_end: "endplay" }),
				play("2020-01-01T00:07:00Z", "a", { reason_end: null }),
				play("2020-01-01T00:08:00Z", "a", { incognito_mode: true }),
				play("2020-01-01T00:09:00Z", "ignored", { spotify_track_uri: null }),
				play("2020-01-01T00:10:00Z", "ignored", { spotify_track_uri: "spotify:episode:e1" }),
				play("2020-01-01T00:11:00Z", "ignored", { spotify_track_uri: "spotify:audiobook:b1" }),
			]),
		]);

		expect(result.failures).toEqual([]);
		expect(result.totalItems).toBe(1);
		expect(result.entityGroups[0]?.events.map(({ occurredAt }) => occurredAt)).toEqual([
			"2020-01-01T00:00:00.000Z",
			"2020-01-01T00:08:00.000Z",
		]);
	});

	it("keeps a play once when the same track and end time repeat across files", () => {
		const duplicate = play("2020-03-01T10:00:00Z", "a");
		const result = adaptSpotifyStreamingHistory([
			file([duplicate, duplicate]),
			file([duplicate], "Streaming_History_Video_2020.json"),
		]);

		expect(result.entityGroups).toHaveLength(1);
		expect(result.entityGroups[0]?.events).toHaveLength(1);
	});

	it("splits a track's plays into sorted slices of six with consecutive indices", () => {
		const shuffled = minutes(13, "a").toReversed();
		const result = adaptSpotifyStreamingHistory([file(shuffled)]);

		expect(result.entityGroups.map(({ events, itemIndex }) => [itemIndex, events.length])).toEqual([
			[0, 6],
			[1, 6],
			[2, 1],
		]);
		const events = result.entityGroups.flatMap(({ events: groupEvents }) => groupEvents);
		expect(events.map(({ occurredAt }) => occurredAt)).toEqual(
			minutes(13, "a")
				.map((row) => String(row["ts"]).replace("Z", ".000Z"))
				.sort(),
		);
		expect(events[0]).toEqual({
			eventSchemaSlug: "complete",
			occurredAt: "2020-01-01T00:00:00.000Z",
			properties: {
				timeSpent: 3.59,
				consumedOn: "spotify",
				completionMode: "custom_timestamps",
				completedOn: "2020-01-01T00:00:00.000Z",
			},
		});
		for (const group of result.entityGroups) {
			expect(group.entityRef).toEqual({
				externalId: "a",
				kind: "resolved",
				sourceLabel: "Track a",
				entitySchemaSlug: "music",
				providerSlug: "music.spotify",
			});
		}
	});

	it("merges a track across files in first-seen order and falls back to the id for its label", () => {
		const result = adaptSpotifyStreamingHistory([
			file([
				play("2020-01-01T00:00:00Z", "a", { master_metadata_track_name: null }),
				play("2020-01-01T00:01:00Z", "b"),
			]),
			file([play("2021-01-01T00:00:00Z", "a")], "Streaming_History_Audio_2021.json"),
		]);

		expect(
			result.entityGroups.map(({ events, entityRef }) => [
				entityRef.kind === "resolved" ? entityRef.externalId : null,
				entityRef.sourceLabel,
				events.length,
			]),
		).toEqual([
			["a", "Track a", 2],
			["b", "Track b", 1],
		]);
		expect(
			adaptSpotifyStreamingHistory([
				file([play("2020-01-01T00:00:00Z", "z", { master_metadata_track_name: "" })]),
			]).entityGroups[0]?.entityRef.sourceLabel,
		).toBe("z");
	});

	it("reports a finished play with an invalid end time as a failure after the item indices", () => {
		const result = adaptSpotifyStreamingHistory([
			file([
				play("not a date", "bad"),
				play("2020-01-01T00:00:00Z", "a"),
				play("2020-01-01T00:01:00Z", "bad"),
			]),
		]);

		expect(result.totalItems).toBe(3);
		expect(result.entityGroups.map(({ itemIndex }) => itemIndex)).toEqual([0, 1]);
		expect(result.failures).toEqual([
			{
				itemIndex: 2,
				sourceLabel: "Track bad",
				entitySchemaSlug: "music",
				stage: "input_transformation",
				sourceIdentifier: "spotify:track:bad",
				message: "Play has no valid end time",
			},
		]);
	});

	it("rejects a file that is not an array of play objects", () => {
		for (const rows of [{ plays: [] }, [1, 2], "text", null]) {
			expect(() =>
				adaptSpotifyStreamingHistory([file(rows, "Streaming_History_Audio_2019.json")]),
			).toThrow("Streaming_History_Audio_2019.json is not a Spotify streaming history file");
		}
	});
});

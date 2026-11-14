import { describe, expect, it } from "bun:test";

import {
	mediaEpisodicActivityCopy,
	mediaFlatActivityCopy,
	mediaListStateDetail,
	mediaPositionLabel,
} from "./activity-copy";

describe("media activity copy", () => {
	it("names the noun and the verb in every flat string", () => {
		const copy = mediaFlatActivityCopy({ verb: "read", noun: "book" });

		expect(copy).toMatchObject({
			segmentNoun: "Read",
			progressVerb: "read",
			completionsLabel: "Reads",
			recordLabel: "Reading record",
			loadingDetail: "Fetching everything you have recorded for this book.",
			beats: { dropped: "Stopped reading", on_hold: "Put this book on hold" },
			emptyDetail:
				"Nothing has been recorded for this book. Whatever you read will appear here as your reading record.",
		});
		expect(copy.rowLabels.review).toBe("Reviewed the book");
		expect(copy.rowLabels.completion).toBe("Finished the book");
		expect(copy.rowLabels.progress("62", {})).toBe("62% through the book");
		expect(copy.rowLabels.progress(undefined, {})).toBe("Part-way through the book");
	});

	it("keeps a schema's own progress label", () => {
		const copy = mediaFlatActivityCopy({
			verb: "play",
			noun: "game",
			progress: (_percent, extra: { readonly chapter: number }) => `Chapter ${extra.chapter}`,
		});

		expect(copy.completionsLabel).toBe("Playthroughs");
		expect(copy.rowLabels.progress("62", { chapter: 3 })).toBe("Chapter 3");
	});

	it("names positions by unit, with chapter volume context", () => {
		expect(mediaPositionLabel({ position: 5, unit: "episodes" })).toBe("Ep 5");
		expect(mediaPositionLabel({ position: 10.5, unit: "chapters" })).toBe("Ch 10.5");
		expect(mediaPositionLabel({ position: 3, unit: "volumes" })).toBe("Vol 3");
		expect(mediaPositionLabel({ volume: 2, position: 12, unit: "chapters" })).toBe("Ch 12 · Vol 2");
		expect(
			mediaFlatActivityCopy({ verb: "read", noun: "manga" }).itemLabel({
				position: 3,
				unit: "volumes",
			}),
		).toBe("Read Vol 3");
	});

	it("shows the AniList observation state, snapshot position, and repeat metadata", () => {
		expect(
			mediaListStateDetail({
				listState: {
					repeatCount: 2,
					source: "anilist",
					state: "in_progress",
					sourceEntryId: "entry-1",
					sourceAccountId: "account-1",
					sourceUpdatedAt: "2026-05-01T10:00:00.000Z",
					position: { volume: 0, position: 0, unit: "chapters" },
				},
			}),
		).toBe("In progress · Ch 0 · Vol 0 · Repeat count 2");
	});

	it("hints progress with the verb's participle", () => {
		expect(mediaFlatActivityCopy({ verb: "play", noun: "game" }).progressVerb).toBe("played");
		expect(mediaFlatActivityCopy({ verb: "watch", noun: "movie" }).progressVerb).toBe("watched");
		expect(mediaFlatActivityCopy({ verb: "listen", noun: "audiobook" }).progressVerb).toBe(
			"listened",
		);
	});

	it("counts episodic completions under the verb and takes the watched label", () => {
		const copy = mediaEpisodicActivityCopy({
			verb: "listen",
			noun: "podcast",
			watchedLabel: "Played",
		});

		expect(copy).toMatchObject({
			segmentNoun: "Listen",
			recordLabel: "Listen record",
			rowLabels: { watched: "Played", review: "Reviewed the podcast" },
			figures: {
				time: "Time",
				episodes: "Episodes",
				current: "This listen",
				watches: "Completed listens",
			},
			beats: {
				backlog: "Added to backlog",
				dropped: "Stopped listening",
				on_hold: "Put this podcast on hold",
			},
		});
		expect(copy.emptyDetail).toBe(
			"Nothing has been recorded for this podcast. Whatever you listen to will appear here as your listen record.",
		);
	});
});

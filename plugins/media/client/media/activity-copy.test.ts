import { describe, expect, it } from "vitest";

import { mediaEpisodicActivityCopy, mediaFlatActivityCopy } from "./activity-copy";

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
			figures: { time: "Time", watches: "Listens", episodes: "Episodes" },
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

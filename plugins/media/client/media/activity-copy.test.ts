import { describe, expect, it } from "bun:test";

import { testMediaCopy, testMediaText } from "../../tests/client/test-text";
import {
	mediaEpisodicActivityCopy,
	mediaFlatActivityCopy,
	mediaListStateDetail,
	mediaPositionLabel,
} from "./activity-copy";

const label = (position: Parameters<typeof mediaPositionLabel>[1]) =>
	mediaPositionLabel(testMediaText, position);

const progress = (verb: "play" | "watch" | "listen") =>
	mediaFlatActivityCopy(testMediaCopy, { verb, kind: "movie" }).progressLabel(40);

describe("media activity copy", () => {
	it("names the kind and the verb in the flat strings that need them", () => {
		const copy = mediaFlatActivityCopy(testMediaCopy, { verb: "read", kind: "book" });

		const flat: unknown = {
			segment: copy.segment,
			recordLabel: copy.recordLabel,
			emptyDetail: copy.emptyDetail,
			loadingDetail: copy.loadingDetail,
			completionsLabel: copy.completionsLabel,
			beats: { dropped: copy.beats.dropped, on_hold: copy.beats.on_hold },
		};
		expect(flat).toEqual({
			segment: "read",
			completionsLabel: "Reads",
			recordLabel: "Reading record",
			loadingDetail: "Fetching everything you have recorded.",
			beats: { on_hold: "Put on hold", dropped: "Stopped reading" },
			emptyDetail:
				"Nothing has been recorded yet. Whatever you read will appear here as your reading record.",
		});
		expect<string>(copy.rowLabels.review).toBe("Reviewed the book");
		expect<string>(copy.rowLabels.completion).toBe("Finished the book");
		expect<string>(copy.rowLabels.progress(62.5, {})).toBe("62.5% through");
		expect<string>(copy.rowLabels.progress(undefined, {})).toBe("Part-way through");
	});

	it("names positions by unit, with chapter volume context", () => {
		expect<string>(label({ position: 5, unit: "episodes" })).toBe("Ep 5");
		expect<string>(label({ position: 10.5, unit: "chapters" })).toBe("Ch 10.5");
		expect<string>(label({ position: 3, unit: "volumes" })).toBe("Vol 3");
		expect<string>(label({ volume: 2, position: 12, unit: "chapters" })).toBe("Ch 12 · Vol 2");
		expect<string>(
			mediaFlatActivityCopy(testMediaCopy, { verb: "read", kind: "manga" }).itemLabel({
				position: 3,
				unit: "volumes",
			}),
		).toBe("Read Vol 3");
	});

	it("shows the AniList observation state, snapshot position, and repeat metadata", () => {
		expect(
			mediaListStateDetail(testMediaCopy, {
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

	it("labels the AniList snapshot row", () => {
		const copy = mediaFlatActivityCopy(testMediaCopy, {
			verb: "watch",
			kind: "anime",
			snapshot: { source: "anilist", detail: () => undefined },
		});

		expect<string>(copy.snapshot.label).toBe("Synced from AniList");
	});

	it("hints progress with the verb's participle", () => {
		expect<string>(progress("play")).toBe("40% played");
		expect<string>(progress("watch")).toBe("40% watched");
		expect<string>(progress("listen")).toBe("40% listened");
	});

	it("counts episodic completions under the verb and takes the watched label", () => {
		const copy = mediaEpisodicActivityCopy(testMediaCopy.text, {
			verb: "listen",
			kind: "podcast",
			watched: "played",
		});

		const episodic: unknown = {
			beats: copy.beats,
			segment: copy.segment,
			figures: copy.figures,
			recordLabel: copy.recordLabel,
			rowLabels: { review: copy.rowLabels.review, watched: copy.rowLabels.watched },
		};
		expect(episodic).toEqual({
			segment: "listen",
			recordLabel: "Listen record",
			rowLabels: { watched: "played", review: "Reviewed the podcast" },
			beats: { on_hold: "Put on hold", backlog: "Added to backlog", dropped: "Stopped listening" },
			figures: {
				time: "Time",
				episodes: "Episodes",
				current: "This listen",
				watches: "Completed listens",
			},
		});
		expect<string>(copy.emptyDetail).toBe(
			"Nothing has been recorded yet. Whatever you listen to will appear here as your listen record.",
		);
	});
});

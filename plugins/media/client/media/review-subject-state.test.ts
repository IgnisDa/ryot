import { describe, expect, it } from "bun:test";

import {
	positionalReviewSubject,
	reviewTarget,
	WHOLE_REVIEW_SUBJECT,
} from "./review-subject-state";

describe("review subject target", () => {
	it("reviews the whole entity by default", () => {
		expect(reviewTarget("media-1", WHOLE_REVIEW_SUBJECT)).toEqual({ entityId: "media-1" });
	});

	it("names the chosen position and waits for a valid number", () => {
		const draft = positionalReviewSubject({ position: 8, unit: "chapters" });
		expect(reviewTarget("media-1", draft)).toEqual({
			entityId: "media-1",
			position: { position: 8, unit: "chapters" },
		});
		expect(reviewTarget("media-1", { ...draft, position: undefined })).toBeUndefined();
		expect(reviewTarget("media-1", { ...draft, position: 0 })).toBeUndefined();
	});

	it("moves the review to the chosen season or episode and waits for a choice", () => {
		expect(
			reviewTarget("show-1", {
				...WHOLE_REVIEW_SUBJECT,
				mode: "season",
				season: { id: "season-2", seasonNumber: 2 },
			}),
		).toEqual({ entityId: "season-2" });
		expect(reviewTarget("show-1", { ...WHOLE_REVIEW_SUBJECT, mode: "season" })).toBeUndefined();
		expect(
			reviewTarget("show-1", { ...WHOLE_REVIEW_SUBJECT, mode: "episode", episodeId: "episode-3" }),
		).toEqual({ entityId: "episode-3" });
		expect(reviewTarget("show-1", { ...WHOLE_REVIEW_SUBJECT, mode: "episode" })).toBeUndefined();
	});
});

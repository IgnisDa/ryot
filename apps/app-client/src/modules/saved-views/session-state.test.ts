import { describe, expect, it } from "vitest";

import {
	emptySavedViewSession,
	savedViewSessionEntry,
	withSavedViewQuery,
	withSavedViewScrollOffset,
} from "./session-state";

describe("savedViewSessionEntry", () => {
	it("returns an empty entry for an unvisited view", () => {
		expect(savedViewSessionEntry(emptySavedViewSession, "media", "movies")).toEqual({
			query: "",
			scrollOffset: 0,
		});
	});

	it("returns an empty entry when the workspace differs", () => {
		const session = withSavedViewQuery(emptySavedViewSession, "media", "movies", "drama");

		expect(savedViewSessionEntry(session, "fitness", "movies")).toEqual({
			query: "",
			scrollOffset: 0,
		});
	});
});

describe("saved view session retention", () => {
	it("keeps query and scroll offset per slug", () => {
		const withMovies = withSavedViewScrollOffset(
			withSavedViewQuery(emptySavedViewSession, "media", "movies", "drama"),
			"media",
			"movies",
			420,
		);
		const session = withSavedViewQuery(withMovies, "media", "books", "ursula");

		expect(savedViewSessionEntry(session, "media", "movies")).toEqual({
			query: "drama",
			scrollOffset: 420,
		});
		expect(savedViewSessionEntry(session, "media", "books")).toEqual({
			query: "ursula",
			scrollOffset: 0,
		});
	});

	it("resets the scroll offset when the query changes", () => {
		const scrolled = withSavedViewScrollOffset(emptySavedViewSession, "media", "movies", 420);

		expect(withSavedViewQuery(scrolled, "media", "movies", "drama")).toEqual({
			workspace: "media",
			views: { movies: { query: "drama", scrollOffset: 0 } },
		});
	});

	it("drops every view when the workspace changes", () => {
		const session = withSavedViewQuery(emptySavedViewSession, "media", "movies", "drama");

		expect(withSavedViewScrollOffset(session, "fitness", "exercises", 12)).toEqual({
			workspace: "fitness",
			views: { exercises: { query: "", scrollOffset: 12 } },
		});
	});
});

import { describe, expect, it } from "vitest";

import { decodeEpisodicEpisodePage } from "../../tests/client/episodic/episodes-fixture";
import type { EpisodicFixtureEpisode } from "../../tests/client/episodic/recipes";
import {
	malformedQueryResult,
	pendingQueryResult,
	readyQueryResult,
	transportErrorQueryResult,
} from "../../tests/client/query-result-fixture";
import {
	mapMediaCursorPage,
	mediaCursorPageError,
	type MediaCursorPage,
} from "./cursor-page-state";

type EpisodicPage = MediaCursorPage<EpisodicFixtureEpisode>;

describe("media cursor page state", () => {
	it("maps a pending query to the loading state", () => {
		expect(mapMediaCursorPage(pendingQueryResult<EpisodicPage>())).toEqual({ status: "loading" });
	});

	it("maps a malformed decode failure apart from a transport failure", () => {
		expect(mapMediaCursorPage(malformedQueryResult<EpisodicPage>()).status).toBe("malformed");
		expect(mapMediaCursorPage(transportErrorQueryResult<EpisodicPage>()).status).toBe(
			"transport-error",
		);
	});

	it("carries the cursor a page hands back so the next page can resume", () => {
		expect(
			mapMediaCursorPage(readyQueryResult(decodeEpisodicEpisodePage({ nextCursor: "cursor-2" }))),
		).toMatchObject({ status: "ready", nextCursor: "cursor-2", items: [{ id: "episode-1" }] });
		expect(mapMediaCursorPage(readyQueryResult(decodeEpisodicEpisodePage()))).toMatchObject({
			status: "ready",
			nextCursor: null,
		});
	});

	it("keeps error copy free of decoder and transport internals", () => {
		expect(
			mediaCursorPageError({ noun: "episodes", state: { status: "malformed" } }).detail,
		).not.toContain("RyotQL");
		expect(
			mediaCursorPageError({ noun: "episodes", state: { status: "transport-error" } }),
		).toEqual({
			title: "Unable to load these episodes",
			detail: "These episodes could not be loaded. Check your connection and try again.",
		});
	});
});
